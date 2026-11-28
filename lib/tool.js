/**
 * Agent-facing half of the same operation: one tool that rewrites a draft
 * through the identical core call, so the UI action and the tool can never
 * drift. No `@deepseek-ai/*` import is used; a plain ToolDefinition is enough.
 *
 * @module dsh-prompt-polish/tool
 */

/**
 * Build the `polish_prompt` tool definition.
 *
 * @param {object} options - tool dependencies.
 * @param {(request: { text: string, sessionId?: string, signal: AbortSignal }) => Promise<{ text: string }>} options.optimize - core operation.
 * @returns {object} ToolDefinition accepted by `ctx.tools.register`.
 */
export function createPolishTool({ optimize }) {
  return {
    name: 'polish_prompt',
    description: 'Rewrite a draft prompt into a clearer, more specific prompt while preserving its intent, language, and every concrete detail. Returns only the polished prompt. Use it when the user asks to improve, polish, or optimize a prompt, not to answer the prompt itself.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The draft prompt to polish. Preserve the draft text exactly as the user wrote it.',
        },
        style: {
          type: 'string',
          enum: ['structured', 'concise', 'detailed'],
          description: 'Rewrite style: structured (numbered requirements and output shape), concise (shortest unambiguous version), or detailed (scope, constraints, edge cases, acceptance criteria). Defaults to structured.',
        },
        include_context: {
          type: 'boolean',
          description: 'Include the most recent human/assistant turns of this session as context. Defaults to false; the user must opt in.',
        },
        context_rounds: {
          type: 'number',
          description: 'Recent rounds to include when include_context is true. Defaults to the plugin configuration (5).',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const prompt = args !== null && typeof args === 'object' ? args.prompt : undefined;
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        throw new Error('polish_prompt: "prompt" must be a non-empty string');
      }
      const sessionId = exec?.agent?.session?.id;
      const signal = exec?.signal ?? new AbortController().signal;
      const style = typeof args.style === 'string' ? args.style : 'structured';
      const includeContext = args.include_context === true;
      const contextRounds = includeContext && Number.isInteger(args.context_rounds) ? args.context_rounds : undefined;
      const result = await optimize({ text: prompt, sessionId, style, includeContext, contextRounds, signal });
      return result.text;
    },
  };
}
