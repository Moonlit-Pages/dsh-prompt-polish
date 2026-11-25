/**
 * Host half of dsh-prompt-polish.
 *
 * Wiring only: config, one core operation shared by the HTTP route and the
 * agent tool, and the two registrations. The browser half lives in
 * `lib/client.js` and is served by the DSH client module loader.
 *
 * @module dsh-prompt-polish
 */

import { resolveConfig } from './config.js';
import { optimizePrompt, OptimizeError } from './optimizer.js';
import { createAuthorize, createRoutes } from './routes.js';
import { createPolishTool } from './tool.js';

/** Keep in sync with package.json; preflight checks it. */
export const VERSION = '0.1.0';

/**
 * Resolve the model route for one request: an explicit config override wins,
 * then the calling session's selected model, then the profile default.
 *
 * @param {object} services - scoped Cordis context with `get()`.
 * @param {ReturnType<typeof resolveConfig>} config - validated config.
 * @param {string} [sessionId] - calling session.
 * @returns {{ provider: string, model: string }} route.
 */
function resolveRoute(services, config, sessionId) {
  if (config.provider !== '' && config.model !== '') {
    return { provider: config.provider, model: config.model };
  }

  if (sessionId !== undefined) {
    const agent = services.get('agents')?.get?.(sessionId);
    try {
      const selection = agent?.model?.current?.();
      if (typeof selection?.provider === 'string' && selection.provider !== ''
        && typeof selection?.model === 'string' && selection.model !== '') {
        return { provider: selection.provider, model: selection.model };
      }
    } catch {
      // A session without a readable selection falls through to the profile default.
    }
  }

  const fallback = services.get('agentDefaultModel')?.currentSelection?.();
  if (typeof fallback?.provider === 'string' && fallback.provider !== ''
    && typeof fallback?.model === 'string' && fallback.model !== '') {
    return { provider: fallback.provider, model: fallback.model };
  }

  throw new OptimizeError(
    'no-model',
    'No model is available for prompt optimization. Select a model in the composer, or set provider and model in the plugin config.',
    409,
  );
}

/**
 * Plugin entry.
 *
 * @param {object} ctx - Cordis context.
 * @param {unknown} [rawConfig] - loader row config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);

  /** @param {object} scope - context with `llm`. */
  const runOptimize = (scope, request) => optimizePrompt({
    llm: scope.llm,
    route: resolveRoute(scope, config, request.sessionId),
    text: request.text,
    signal: request.signal,
    config,
  });

  ctx.inject(['webServer', 'llm'], (scope) => {
    scope.effect(() => {
      const routes = createRoutes({
        config,
        version: VERSION,
        logger: scope.logger,
        authorize: createAuthorize(() => scope.get('connection')),
        optimize: (request) => runOptimize(scope, request),
      });

      const disposers = [];
      for (const route of routes) {
        try {
          disposers.push(scope.webServer.register(route));
        } catch (error) {
          scope.logger?.error?.(
            `dsh-prompt-polish: route ${route.path} registration failed: ${String(error?.message ?? error)}`,
          );
        }
      }

      if (disposers.length === 0) {
        scope.logger?.error?.('dsh-prompt-polish: no HTTP routes registered; the composer button will report a network error');
      } else {
        scope.logger?.info?.(
          `dsh-prompt-polish: ${disposers.length}/${routes.length} HTTP route(s) registered`,
        );
      }

      return () => {
        for (const dispose of disposers) if (typeof dispose === 'function') dispose();
      };
    }, 'dsh-prompt-polish: HTTP routes');
  });

  ctx.inject(['tools', 'llm'], (scope) => {
    scope.effect(() => {
      const dispose = scope.tools.register(createPolishTool({
        optimize: (request) => runOptimize(scope, request),
      }));
      scope.logger?.info?.('dsh-prompt-polish: agent tool "polish_prompt" registered');
      return dispose;
    }, 'dsh-prompt-polish: polish_prompt tool');
  });
}
