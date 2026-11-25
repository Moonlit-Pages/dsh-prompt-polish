/**
 * Plugin configuration: defaults, validation, and the one normalized shape the
 * rest of the Host half reads. Kept free of `@deepseek-ai/*` imports so the
 * plugin resolves from a linked workspace directory.
 *
 * @module dsh-prompt-polish/config
 */

/** Values used when the loader row supplies no config. Must stay in sync with cordis.patch.yml. */
export const DEFAULT_CONFIG = Object.freeze({
  maxInputChars: 12000,
  maxOutputTokens: 4096,
  timeoutMs: 60000,
  temperature: 0.3,
  provider: '',
  model: '',
  systemPrompt: '',
});

const LIMITS = Object.freeze({
  maxInputChars: [64, 200000],
  maxOutputTokens: [64, 32000],
  timeoutMs: [1000, 300000],
  temperature: [0, 2],
});

const SYSTEM_PROMPT_MAX_CHARS = 16000;

/**
 * Reject a config value that is outside its documented range.
 *
 * @param {string} key - config field.
 * @param {unknown} value - supplied value.
 * @returns {number} the narrowed number.
 */
function boundedNumber(key, value) {
  const [min, max] = LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`dsh-prompt-polish: config.${key} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}

/**
 * Validate one optional route override: both fields together, or neither.
 *
 * @param {unknown} provider - configured provider id.
 * @param {unknown} model - configured model id.
 * @returns {{ provider: string, model: string }} empty strings when unset.
 */
function routeOverride(provider, model) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim() : '';
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if ((normalizedProvider === '') !== (normalizedModel === '')) {
    throw new Error('dsh-prompt-polish: config.provider and config.model must be supplied together');
  }
  return { provider: normalizedProvider, model: normalizedModel };
}

/**
 * Normalize and validate the loader config.
 *
 * @param {unknown} input - value from `cordis.patch.yml`.
 * @returns {Readonly<typeof DEFAULT_CONFIG>} frozen, validated config.
 */
export function resolveConfig(input) {
  const raw = input !== null && typeof input === 'object' ? input : {};

  const maxInputChars = raw.maxInputChars === undefined
    ? DEFAULT_CONFIG.maxInputChars
    : boundedNumber('maxInputChars', raw.maxInputChars);
  const maxOutputTokens = raw.maxOutputTokens === undefined
    ? DEFAULT_CONFIG.maxOutputTokens
    : boundedNumber('maxOutputTokens', raw.maxOutputTokens);
  const timeoutMs = raw.timeoutMs === undefined
    ? DEFAULT_CONFIG.timeoutMs
    : boundedNumber('timeoutMs', raw.timeoutMs);
  const temperature = raw.temperature === undefined
    ? DEFAULT_CONFIG.temperature
    : boundedNumber('temperature', raw.temperature);

  const { provider, model } = routeOverride(raw.provider, raw.model);

  const systemPrompt = typeof raw.systemPrompt === 'string' ? raw.systemPrompt.trim() : '';
  if (systemPrompt.length > SYSTEM_PROMPT_MAX_CHARS) {
    throw new Error(`dsh-prompt-polish: config.systemPrompt must be at most ${SYSTEM_PROMPT_MAX_CHARS} characters`);
  }

  return Object.freeze({
    maxInputChars: Math.floor(maxInputChars),
    maxOutputTokens: Math.floor(maxOutputTokens),
    timeoutMs: Math.floor(timeoutMs),
    temperature,
    provider,
    model,
    systemPrompt,
  });
}
