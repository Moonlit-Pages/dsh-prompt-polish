/**
 * Host HTTP transport for the composer button.
 *
 * The browser half posts the draft to `/api/dsh-prompt-polish/optimize` with a
 * document-relative URL (the Web GUI uses `<base href="./">`). These routes are
 * exact-path registrations, so they sit *outside* the `/api` connection
 * handler's own fence: every handler therefore asks `connection` for a
 * rejection first, exactly like the shipped `open-in-app` routes.
 *
 * @module dsh-prompt-polish/routes
 */

import { OptimizeError } from './optimizer.js';

/** Route prefix, absolute as the web server requires. */
export const ROUTE_PREFIX = '/api/dsh-prompt-polish';

/** Requests bigger than this are hostile; the prompt limit is far lower. */
const MAX_BODY_BYTES = 256 * 1024;

/** Envelope failure with the status the route should answer. */
class RouteError extends Error {
  /**
   * @param {string} code - stable machine code.
   * @param {string} message - message shown to the user.
   * @param {number} status - HTTP status.
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'RouteError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Loopback fence used only when the composition has no `connection` service.
 *
 * @param {import('node:http').IncomingMessage} req - raw request.
 * @returns {boolean} whether the request came from this machine.
 */
export function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? '';
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
  if (!loopback) return false;

  let hostname;
  try {
    hostname = new URL(`http://${req.headers?.host ?? ''}`).hostname;
  } catch {
    return false;
  }
  if (!(hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname))) return false;

  return req.headers?.['sec-fetch-site'] !== 'cross-site';
}

/**
 * Build the route admission check.
 *
 * @param {() => object | undefined} [getConnection] - lazy `connection` lookup.
 * @returns {(req: object) => number | undefined} rejection status, or undefined to allow.
 */
export function createAuthorize(getConnection) {
  return (req) => {
    if (typeof getConnection === 'function') {
      let connection;
      try {
        connection = getConnection();
      } catch {
        connection = undefined;
      }
      if (connection !== undefined && typeof connection.requestRejection === 'function') {
        try {
          const rejection = connection.requestRejection(req);
          return rejection === undefined ? undefined : rejection;
        } catch {
          return 403;
        }
      }
    }
    return isLoopbackRequest(req) ? undefined : 403;
  };
}

/**
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON body.
 */
function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(payload));
}

/** @param {string} code - machine code. @param {string} message - user message. */
const failure = (code, message) => ({ ok: false, error: { code, message } });

/**
 * Read and parse a bounded JSON body.
 *
 * @param {import('node:http').IncomingMessage} req - request stream.
 * @returns {Promise<Record<string, unknown>>} parsed object.
 */
async function readJsonBody(req) {
  const declared = Number(req.headers?.['content-length'] ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new RouteError('body-too-large', 'The request body is too large.', 413);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new RouteError('body-too-large', 'The request body is too large.', 413);
    chunks.push(chunk);
  }
  if (size === 0) throw new RouteError('empty-body', 'The request body is empty.', 400);

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RouteError('invalid-body', 'The request body is not valid JSON.', 400);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RouteError('invalid-body', 'The request body must be a JSON object.', 400);
  }
  return parsed;
}

/**
 * Build this plugin's route table.
 *
 * @param {object} options - route dependencies.
 * @param {(request: { text: string, sessionId?: string, signal: AbortSignal }) => Promise<object>} options.optimize - core operation.
 * @param {(req: object) => number | undefined} options.authorize - admission check.
 * @param {object} options.config - validated config.
 * @param {string} options.version - plugin version for `/health`.
 * @param {{ error?: Function, info?: Function }} [options.logger] - host logger.
 * @returns {Array<{ kind: 'exact', path: string, handler: Function }>} registrations.
 */
export function createRoutes({ optimize, authorize, config, version, logger }) {
  const admit = (req, res) => {
    const rejection = authorize(req);
    if (rejection === undefined) return true;
    res.statusCode = rejection;
    res.end();
    return false;
  };

  return [
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/health`,
      handler: (req, res) => {
        if (!admit(req, res)) return;
        if (req.method !== 'GET') {
          res.setHeader('allow', 'GET');
          sendJson(res, 405, failure('method-not-allowed', 'Use GET.'));
          return;
        }
        sendJson(res, 200, {
          ok: true,
          value: {
            plugin: 'dsh-prompt-polish',
            version,
            limits: {
              maxInputChars: config.maxInputChars,
              maxOutputTokens: config.maxOutputTokens,
              timeoutMs: config.timeoutMs,
            },
            routeOverride: config.provider !== '' ? { provider: config.provider, model: config.model } : null,
          },
        });
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/optimize`,
      handler: async (req, res) => {
        if (!admit(req, res)) return;
        if (req.method !== 'POST') {
          res.setHeader('allow', 'POST');
          sendJson(res, 405, failure('method-not-allowed', 'Use POST.'));
          return;
        }

        let body;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          if (error instanceof RouteError) {
            sendJson(res, error.status, failure(error.code, error.message));
            return;
          }
          logger?.error?.(`dsh-prompt-polish: body read failed: ${String(error?.message ?? error)}`);
          sendJson(res, 400, failure('invalid-body', 'The request body could not be read.'));
          return;
        }

        const text = body.text;
        if (typeof text !== 'string' || text.trim() === '') {
          sendJson(res, 400, failure('empty-input', 'Provide a non-empty "text" field.'));
          return;
        }
        if (text.length > config.maxInputChars) {
          sendJson(res, 413, failure('too-long', `The draft must be at most ${config.maxInputChars} characters.`));
          return;
        }
        const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined;

        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, config.timeoutMs);

        try {
          const result = await optimize({ text, sessionId, signal: controller.signal });
          sendJson(res, 200, { ok: true, value: result });
        } catch (error) {
          if (timedOut) {
            sendJson(res, 504, failure('timeout', `Prompt optimization timed out after ${config.timeoutMs} ms.`));
            return;
          }
          if (error instanceof OptimizeError) {
            sendJson(res, error.status, failure(error.code, error.message));
            return;
          }
          if (error?.name === 'AbortError' || error?.code === 'aborted') {
            sendJson(res, 499, failure('aborted', 'Prompt optimization was cancelled.'));
            return;
          }
          logger?.error?.(`dsh-prompt-polish: optimize failed: ${String(error?.stack ?? error)}`);
          sendJson(res, 500, failure('internal', 'Prompt optimization failed unexpectedly.'));
        } finally {
          clearTimeout(timer);
        }
      },
    },
  ];
}
