/**
 * Browser half of dsh-prompt-polish.
 *
 * Served by the DSH client module loader: a self-registering lazy factory whose
 * id equals the package name. It renders two compact buttons in the composer
 * tool row immediately before the model selector:
 *
 *   优化  — POST the draft to the Host route, then replace it with the result.
 *   撤销  — restore the exact draft captured before the polish.
 *
 * Constraints (host UI rules): only `react` is required from the frozen module
 * table; colours come from `--dsw-*` theme tokens; every resource is owned by
 * `ctx.effect`; no DOM is written outside this component except the plugin's
 * own stylesheet, which is removed on dispose.
 *
 * State is session-keyed: the store and controller live once per plugin, while
 * `owner` records the session a request belongs to, so a polish started in one
 * session can never paint another session's button or undo another session's
 * draft. Applying the result is guarded by both the editor revision captured at
 * click time and the live draft text.
 */

window.__ModuleLoader__.load({
  id: 'dsh-prompt-polish',

  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'promptPolish';
    const API = 'api/dsh-prompt-polish/optimize';
    const HEALTH_API = 'api/dsh-prompt-polish/health';
    const STYLE_ID = 'dsh-prompt-polish-styles';
    const DEFAULT_MAX_INPUT_CHARS = 12000;
    const DEFAULT_MAX_CONTEXT_ROUNDS = 20;
    const STYLE_KEY = 'dsh-prompt-polish:style';
    const CONTEXT_KEY = 'dsh-prompt-polish:context';
    const STYLES = ['structured', 'concise', 'detailed'];
    const CONTEXT_OPTIONS = [0, 3, 5, 10, 20];
    const MAX_HISTORY = 5;

    const cachedHealth = {
      maxInputChars: DEFAULT_MAX_INPUT_CHARS,
      maxContextRounds: DEFAULT_MAX_CONTEXT_ROUNDS,
      defaultContextRounds: 0,
    };
    let healthRequest = null;

    /** Persisted rewrite style; storage failures fall back to structured. */
    function readStyle() {
      try {
        const value = localStorage.getItem(STYLE_KEY);
        return STYLES.includes(value) ? value : 'structured';
      } catch {
        return 'structured';
      }
    }

    function saveStyle(style) {
      try {
        localStorage.setItem(STYLE_KEY, style);
      } catch {
        // Storage can be unavailable in private or sandboxed pages.
      }
    }

    /** Persisted context round count; null means the user has no preference yet. */
    function readContextRounds() {
      try {
        const raw = localStorage.getItem(CONTEXT_KEY);
        if (raw === null) return null;
        const value = Number(raw);
        return CONTEXT_OPTIONS.includes(value) ? value : null;
      } catch {
        return null;
      }
    }

    function saveContextRounds(rounds) {
      try {
        localStorage.setItem(CONTEXT_KEY, String(rounds));
      } catch {
        // Storage can be unavailable in private or sandboxed pages.
      }
    }

    /** Fetch the live limits once; the server owns the config values. */
    function loadHealth() {
      if (healthRequest === null) {
        healthRequest = fetch(HEALTH_API, { credentials: 'same-origin' })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            const limits = payload?.value?.limits;
            if (typeof limits?.maxInputChars === 'number' && Number.isFinite(limits.maxInputChars) && limits.maxInputChars > 0) {
              cachedHealth.maxInputChars = Math.floor(limits.maxInputChars);
            }
            const maxRounds = payload?.value?.context?.maxRounds;
            if (typeof maxRounds === 'number' && Number.isFinite(maxRounds) && maxRounds > 0) {
              cachedHealth.maxContextRounds = Math.floor(maxRounds);
            }
            const defaultRounds = payload?.value?.context?.rounds;
            const defaultEnabled = payload?.value?.context?.default === true;
            if (defaultEnabled && typeof defaultRounds === 'number' && CONTEXT_OPTIONS.includes(defaultRounds)) {
              cachedHealth.defaultContextRounds = defaultRounds;
            }
            return { ...cachedHealth };
          })
          .catch(() => ({ ...cachedHealth }));
      }
      return healthRequest;
    }

    // --------------------------------------------------------------- 文案

    const zh = {
      'optimize.label': 'AI 润色',
      'optimize.aria': 'AI 润色提示词',
      'optimize.tooltip': '用当前模型润色提示词（可撤销，不会自动发送）',
      'optimize.again': '继续润色',
      'optimize.againTooltip': '以上一次结果为基础继续润色，可继续撤销',
      'undo.label': '撤销上一步',
      'undo.short': '撤销',
      'undo.tooltip': '回退到上一步润色；可连续回退',
      'cancel': '取消',
      'status.working': '正在润色提示词…',
      'context.label': '上下文',
      'context.off': '无上下文',
      'context.round': '最近 {n} 轮',
      'reason.loading': '正在润色…',
      'reason.locked': '发送中不能润色',
      'reason.empty': '先输入提示词',
      'reason.references': '草稿里有引用，暂不支持润色（避免丢失引用）',
      'reason.too-long': '提示词超过 {limit} 字上限',
      'reason.changed': '草稿已修改，无法撤销',
      'style.label': '改写风格',
      'style.structured': '结构化',
      'style.concise': '简洁',
      'style.detailed': '详细',
      'details.title': '本次请求详情',
      'details.model': '模型',
      'details.style': '风格',
      'details.input': '输入长度',
      'details.chars': '{n} 字',
      'details.context': '上下文',
      'details.contextOff': '关闭',
      'details.contextOn': '最近 {n} 轮，{chars} 字{truncated}',
      'details.truncated': '，已截断',
      'details.retry': '近似无改写重试',
      'details.retryYes': '已重试 1 次',
      'details.retryNo': '未重试',
      'details.system': '实际 System Prompt',
      'details.close': '关闭详情',
      'error.component': '润色组件出错，已隔离；刷新页面可恢复。',
      'error.context-unavailable': '当前环境无法读取会话上下文，请关闭上下文后重试。',
      'error.context-read-failed': '读取会话上下文失败，请重试或关闭上下文。',
      'error.invalid-context': '上下文轮数不合法。',
      'error.generic': '优化失败，请重试。',
      'error.network': '无法连接优化服务，请检查页面连接。',
      'error.request-failed': '优化服务返回错误。',
      'error.model-unavailable': '当前模型不可用，请换一个模型。',
      'error.model-error': '模型调用失败，请重试。',
      'error.llm-unavailable': 'Host 的模型服务不可用。',
      'error.empty-output': '模型没有返回内容，请重试。',
      'error.draft-changed': '优化期间草稿被修改，结果没有写入。',
      'error.too-long': '提示词超出单次润色上限。',
      'error.timeout': '优化超时，请重试。',
      'error.aborted': '优化已取消。',
      'error.no-model': '当前工作区未配置可用模型，请先在输入框选择或配置模型。',
      'error.unauthorized': '会话已失效，请刷新页面。',
      'error.empty-input': '先输入提示词。',
      'error.internal': '优化服务内部错误。',
      'error.apply-failed': '优化结果无法写回输入框，请重试。',
      'error.undo-failed': '撤销失败，请重试。',
      'error.no-improvement': '模型没有给出实质优化，请换个风格、重试或换一个更强的模型。',
      'error.dismiss': '关闭提示',
    };

    const en = {
      'optimize.label': 'AI polish',
      'optimize.aria': 'Polish prompt with AI',
      'optimize.tooltip': 'Polish the current prompt with the selected model (undoable, never sent automatically)',
      'optimize.again': 'Polish again',
      'optimize.againTooltip': 'Continue from the last result; every step stays undoable',
      'undo.label': 'Undo last step',
      'undo.short': 'Undo',
      'undo.tooltip': 'Step back one polish; repeat to go further',
      'cancel': 'Cancel',
      'status.working': 'Polishing the prompt…',
      'context.label': 'Context',
      'context.off': 'No context',
      'context.round': 'Last {n} turns',
      'reason.loading': 'Polishing…',
      'reason.locked': 'Wait for the current message to finish',
      'reason.empty': 'Type a prompt first',
      'reason.references': 'Drafts with references cannot be polished yet (the reference would be lost)',
      'reason.too-long': 'Over the {limit}-character limit',
      'reason.changed': 'The draft changed, so undo is unavailable',
      'style.label': 'Rewrite style',
      'style.structured': 'Structured',
      'style.concise': 'Concise',
      'style.detailed': 'Detailed',
      'details.title': 'Request details',
      'details.model': 'Model',
      'details.style': 'Style',
      'details.input': 'Input length',
      'details.chars': '{n} chars',
      'details.context': 'Context',
      'details.contextOff': 'Off',
      'details.contextOn': 'Last {n} turns, {chars} chars{truncated}',
      'details.truncated': ', truncated',
      'details.retry': 'Near-no-op retry',
      'details.retryYes': 'Retried once',
      'details.retryNo': 'No retry',
      'details.system': 'Actual System Prompt',
      'details.close': 'Close details',
      'error.component': 'The polish component crashed and was isolated. Reload the page to recover.',
      'error.context-unavailable': 'Session context is unavailable here. Turn context off and retry.',
      'error.context-read-failed': 'Could not read the session context. Retry or turn context off.',
      'error.invalid-context': 'The context round count is invalid.',
      'error.generic': 'Prompt polish failed. Please try again.',
      'error.network': 'Could not reach the polish service. Check the page connection.',
      'error.request-failed': 'The polish service returned an error.',
      'error.model-unavailable': 'The selected model is unavailable. Choose another model.',
      'error.model-error': 'The model call failed. Please try again.',
      'error.llm-unavailable': 'The Host model service is unavailable.',
      'error.empty-output': 'The model returned no text. Please try again.',
      'error.draft-changed': 'The draft changed during the polish, so the result was not applied.',
      'error.too-long': 'The prompt is over the one-shot polish limit.',
      'error.timeout': 'The polish timed out. Please try again.',
      'error.aborted': 'The polish was cancelled.',
      'error.no-model': 'No model is configured for this workspace. Select or configure a model first.',
      'error.unauthorized': 'The session expired. Reload the page.',
      'error.empty-input': 'Type a prompt first.',
      'error.internal': 'The polish service hit an internal error.',
      'error.apply-failed': 'The polished text could not be written back to the composer. Please try again.',
      'error.undo-failed': 'Undo failed. Please try again.',
      'error.no-improvement': 'The model made no substantive change. Try another style, retry, or choose a stronger model.',
      'error.dismiss': 'Dismiss notice',
    };

    // ------------------------------------------------------------- 样式

    const STYLE = `
.dpp-root { display: inline-flex; align-items: center; gap: 12px; min-width: 0; }
.dpp-tip { display: inline-flex; min-width: 0; }
.dpp-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 8px; border: none; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 13px; line-height: 20px; font-weight: 400;
  white-space: nowrap; cursor: pointer;
}
@media (hover: hover) {
  .dpp-btn:hover:not([data-disabled="true"]) {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
    color: var(--dsw-alias-label-primary);
  }
}
.dpp-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dpp-btn[data-disabled="true"] {
  color: var(--dsw-alias-label-secondary); opacity: .5; cursor: default;
}
.dpp-btn[aria-busy="true"] { opacity: 1; }
.dpp-style {
  height: 28px; max-width: 96px; padding: 0 4px; border: none; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 20px; cursor: pointer;
}
@media (hover: hover) {
  .dpp-style:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
}
.dpp-style:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dpp-style:disabled { opacity: .5; cursor: default; }
.dpp-context { max-width: 88px; }
@media (max-width: 560px) {
  .dpp-label { display: none; }
  .dpp-btn { padding: 0 6px; }
  .dpp-style { max-width: 72px; }
}
.dpp-icon { flex: none; }
.dpp-spin { animation: dpp-rotate .9s linear infinite; transform-origin: 50% 50%; }
@keyframes dpp-rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dpp-spin { animation-duration: 2.4s; }
}
.dpp-status {
  box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 4px 8px; border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px;
}
.dpp-status[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dpp-status-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; flex: none; }
.dpp-status-text { min-width: 0; }
.dpp-status-close {
  margin-left: auto; min-width: 24px; min-height: 24px;
  border: none; border-radius: 6px; background: transparent;
  color: inherit; font-size: 15px; line-height: 15px; padding: 0; cursor: pointer;
}
.dpp-status-close:hover { background: var(--dsw-alias-bg-layer-2); }
.dpp-status-action {
  margin-left: auto; min-height: 24px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.dpp-status-action:hover { background: var(--dsw-alias-bg-layer-2); }
.dpp-details {
  box-sizing: border-box; width: 100%; padding: 8px 10px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px;
}
.dpp-details-head { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary); }
.dpp-details-close {
  margin-left: auto; min-width: 24px; min-height: 24px; border: none; border-radius: 6px;
  background: transparent; color: inherit; font-size: 15px; line-height: 15px; cursor: pointer;
}
.dpp-details-close:hover { background: var(--dsw-alias-bg-layer-2); }
.dpp-details-row { display: flex; gap: 8px; margin-top: 4px; }
.dpp-details-key { flex: none; color: var(--dsw-alias-label-secondary); }
.dpp-details-value { min-width: 0; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dpp-details-pre {
  max-height: 180px; overflow: auto; margin: 6px 0 0; padding: 8px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere;
}
.dpp-boundary { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dpp-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;

    let styleCount = 0;

    /** Install the plugin stylesheet; the returned disposer removes it. */
    function installStyles() {
      let element = document.getElementById(STYLE_ID);
      if (element === null) {
        element = document.createElement('style');
        element.id = STYLE_ID;
        element.textContent = STYLE;
        document.head.appendChild(element);
      }
      styleCount += 1;
      return () => {
        styleCount -= 1;
        if (styleCount <= 0) element.remove();
      };
    }

    // ------------------------------------------------------------- 状态

    const IDLE_STATE = Object.freeze({
      status: 'idle', error: null, owner: null, history: [], after: '', before: '', meta: null, detailsOpen: false,
    });

    /** Shared, framework-free state for the buttons, details, and status strip. */
    function createStore() {
      let state = IDLE_STATE;
      const listeners = new Set();
      return {
        get() { return state; },
        set(patch) {
          const next = { ...state, ...patch };
          if (next.status === state.status
            && next.error === state.error
            && next.before === state.before
            && next.after === state.after
            && next.owner === state.owner
            && next.history === state.history
            && next.meta === state.meta
            && next.detailsOpen === state.detailsOpen) return;
          state = next;
          for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
      };
    }

    /**
     * Project shared state onto one session: another session's request is
     * invisible here, so its spinner, notice, details, and undo window never leak.
     *
     * @param {object} state - store state.
     * @param {string | undefined} sessionId - viewing session.
     * @returns {object} state for this session, or the idle state.
     */
    function stateFor(state, sessionId) {
      if (state.owner === null || state.owner === (sessionId ?? null)) return state;
      return IDLE_STATE;
    }

    /** Restore the last successful step (or idle) after a stop/dismiss. */
    function stateAfterStop(state) {
      const history = Array.isArray(state.history) ? state.history : [];
      if (history.length === 0) return { ...IDLE_STATE };
      const last = history[history.length - 1];
      return {
        status: 'done',
        error: null,
        owner: state.owner,
        history,
        after: last.after,
        before: last.before,
        meta: last.meta ?? null,
        detailsOpen: false,
      };
    }

    /**
     * Whether the optimize button can run, independent of React.
     *
     * @param {object} view - current composer view.
     * @returns {{ enabled: boolean, reason: string }} decision.
     */
    function canOptimize({ phase, text, occurrenceCount, status, maxInputChars }) {
      if (status === 'loading') return { enabled: false, reason: 'loading' };
      if (phase !== 'plain') return { enabled: false, reason: 'locked' };
      if (typeof text !== 'string' || text.trim() === '') return { enabled: false, reason: 'empty' };
      if (typeof maxInputChars === 'number' && text.length > maxInputChars) {
        return { enabled: false, reason: 'too-long' };
      }
      if (occurrenceCount > 0) return { enabled: false, reason: 'references' };
      return { enabled: true, reason: 'ready' };
    }

    /**
     * Whether undo should appear and whether it may run. Every successful step
     * is stored, so undo walks back one step at a time.
     *
     * @param {{ status: string, after: string, history?: object[] }} state - store state.
     * @param {string} text - current draft.
     * @returns {{ visible: boolean, enabled: boolean, reason: string }} decision.
     */
    function canUndo(state, text) {
      if (state.status === 'loading') return { visible: false, enabled: false, reason: 'idle' };
      const history = Array.isArray(state.history) ? state.history : [];
      if (history.length === 0) return { visible: false, enabled: false, reason: 'idle' };
      if (typeof text !== 'string' || text !== state.after) {
        return state.status === 'done'
          ? { visible: true, enabled: false, reason: 'changed' }
          : { visible: false, enabled: false, reason: 'idle' };
      }
      return { visible: true, enabled: true, reason: 'ready' };
    }

    /** Read the live editor revision without letting a disposed shell throw. */
    function revisionOf(getRev) {
      if (typeof getRev !== 'function') return undefined;
      try {
        const value = getRev();
        return typeof value === 'number' ? value : undefined;
      } catch {
        return undefined;
      }
    }

    /**
     * Run the polish request and apply the result.
     *
     * @param {object} store - shared store.
     * @param {{ api?: string, fetch?: Function }} [options] - test seams.
     * @returns {{ optimize: Function, undo: Function, cancel: Function }} controller.
     */
    function createController(store, options = {}) {
      const api = options.api ?? API;
      const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
      let generation = 0;
      /** @type {{ controller: AbortController, sessionId: string | null } | null} */
      let inflight = null;

      /** Restore the last successful step (or idle) after cancellation. */
      function restoredState(state) {
        const history = Array.isArray(state.history) ? state.history : [];
        if (history.length === 0) return { ...IDLE_STATE };
        const last = history[history.length - 1];
        return {
          status: 'done',
          error: null,
          owner: state.owner,
          history,
          after: last.after,
          before: last.before,
          meta: last.meta ?? null,
          detailsOpen: false,
        };
      }

      /**
       * Cancel the in-flight request of one session (or any request when the
       * session is omitted). Cancelling restores the previous successful step.
       *
       * @param {string} [sessionId] - owning session.
       */
      function cancel(sessionId) {
        if (inflight === null) return;
        if (sessionId !== undefined && inflight.sessionId !== (sessionId ?? null)) return;
        const owner = inflight.sessionId;
        generation += 1;
        inflight.controller.abort();
        inflight = null;
        const state = store.get();
        if (state.status === 'loading' && state.owner === owner) {
          store.set(restoredState(state));
        }
      }

      async function optimize({
        text, sessionId, style, includeContext = false, contextRounds, rev, setDraft, getDraft, getRev,
      }) {
        const draft = typeof text === 'string' ? text : '';
        if (draft.trim() === '') return { ok: false, code: 'empty-input' };

        const owner = sessionId ?? null;
        const startRev = typeof rev === 'number' ? rev : revisionOf(getRev);

        const mine = ++generation;
        if (inflight !== null) inflight.controller.abort();
        const controller = new AbortController();
        inflight = { controller, sessionId: owner };
        const prior = store.get();
        const sameOwner = prior.owner === owner;
        const baseHistory = sameOwner && Array.isArray(prior.history) ? prior.history : [];
        store.set({
          status: 'loading',
          error: null,
          owner,
          history: baseHistory,
          after: sameOwner ? prior.after : '',
          before: sameOwner ? prior.before : '',
          meta: sameOwner ? prior.meta : null,
          detailsOpen: false,
        });

        const requestBody = { text: draft, sessionId: owner ?? undefined, style: style ?? 'structured' };
        if (includeContext) {
          requestBody.includeContext = true;
          if (Number.isInteger(contextRounds)) requestBody.contextRounds = contextRounds;
        }

        let payload = null;
        let response;
        try {
          response = await doFetch(api, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            signal: controller.signal,
            body: JSON.stringify(requestBody),
          });
          if (response.status === 401 || response.status === 403) {
            throw Object.assign(new Error('unauthorized'), { code: 'unauthorized', detail: '' });
          }
          payload = await response.json().catch(() => null);
          if (!response.ok || payload === null || payload.ok !== true) {
            const detail = typeof payload?.error?.message === 'string' ? payload.error.message : `HTTP ${response.status}`;
            const code = typeof payload?.error?.code === 'string' ? payload.error.code : 'request-failed';
            throw Object.assign(new Error(detail), { code, detail });
          }
        } catch (error) {
          if (mine !== generation) return { ok: false, code: 'superseded' };
          if (error?.name === 'AbortError' || controller.signal.aborted) return { ok: false, code: 'aborted' };
          const code = typeof error?.code === 'string' ? error.code : 'network';
          const detail = typeof error?.detail === 'string' ? error.detail : String(error?.message ?? error);
          store.set({ status: 'error', error: { code, detail }, owner, detailsOpen: false });
          return { ok: false, code };
        } finally {
          if (inflight !== null && inflight.controller === controller) inflight = null;
        }

        if (mine !== generation) return { ok: false, code: 'superseded' };

        const polished = typeof payload.value?.text === 'string' ? payload.value.text : '';
        if (polished.trim() === '') {
          store.set({ status: 'error', error: { code: 'empty-output', detail: '' }, owner, detailsOpen: false });
          return { ok: false, code: 'empty-output' };
        }
        if (startRev !== undefined) {
          const nowRev = revisionOf(getRev);
          if (nowRev !== undefined && nowRev !== startRev) {
            store.set({ status: 'error', error: { code: 'draft-changed', detail: '' }, owner, detailsOpen: false });
            return { ok: false, code: 'draft-changed' };
          }
        }
        if (typeof getDraft === 'function' && getDraft() !== draft) {
          store.set({ status: 'error', error: { code: 'draft-changed', detail: '' }, owner, detailsOpen: false });
          return { ok: false, code: 'draft-changed' };
        }

        try {
          setDraft(polished);
        } catch (error) {
          store.set({
            status: 'error',
            error: { code: 'apply-failed', detail: String(error?.message ?? error) },
            owner,
            detailsOpen: false,
          });
          return { ok: false, code: 'apply-failed' };
        }

        const meta = payload.value?.meta ?? null;
        const history = [...baseHistory, { before: draft, after: polished, meta }].slice(-MAX_HISTORY);
        store.set({
          status: 'done',
          history,
          after: polished,
          before: draft,
          meta,
          error: null,
          owner,
          detailsOpen: false,
        });
        return { ok: true, text: polished, meta };
      }

      function undo({ sessionId, setDraft, getDraft }) {
        const state = store.get();
        if (sessionId !== undefined && state.owner !== null && state.owner !== sessionId) {
          return { ok: false, code: 'wrong-session' };
        }
        const history = Array.isArray(state.history) ? state.history : [];
        if (state.status === 'loading' || history.length === 0) {
          return { ok: false, code: 'nothing-to-undo' };
        }
        if (typeof getDraft === 'function' && getDraft() !== state.after) {
          store.set({ status: 'error', error: { code: 'draft-changed', detail: '' }, owner: state.owner, detailsOpen: false });
          return { ok: false, code: 'draft-changed' };
        }

        const entry = history[history.length - 1];
        try {
          setDraft(entry.before);
        } catch (error) {
          store.set({
            status: 'error',
            error: { code: 'undo-failed', detail: String(error?.message ?? error) },
            owner: state.owner,
            detailsOpen: false,
          });
          return { ok: false, code: 'undo-failed' };
        }

        const rest = history.slice(0, -1);
        if (rest.length === 0) {
          store.set({ ...IDLE_STATE });
        } else {
          // The restored draft is the next undo guard. It only carries the
          // previous step's meta when it really is that step's result; after an
          // edit between steps it is a plain draft, so details stay hidden.
          const last = rest[rest.length - 1];
          const restored = entry.before;
          store.set({
            status: 'done',
            history: rest,
            after: restored,
            before: entry.before,
            meta: restored === last.after ? (last.meta ?? null) : null,
            error: null,
            owner: state.owner,
            detailsOpen: false,
          });
        }
        return { ok: true };
      }

      return { optimize, undo, cancel };
    }

    // ------------------------------------------------------------- 图标

    const SparkleIcon = h('svg', {
      className: 'dpp-icon', viewBox: '0 0 16 16', width: 14, height: 14, fill: 'currentColor', 'aria-hidden': 'true',
    },
    h('path', { d: 'M7.9 1.2 9.5 5.9l4.7 1.6-4.7 1.6-1.6 4.7-1.6-4.7L1.6 7.5l4.7-1.6L7.9 1.2Z' }),
    h('path', { d: 'M12.6 9.9l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z', opacity: '0.65' }));

    const UndoIcon = h('svg', {
      className: 'dpp-icon', viewBox: '0 0 16 16', width: 14, height: 14,
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: 'M3.2 6.6h6.4a3.6 3.6 0 1 1 0 7.2H6.4' }),
    h('path', { d: 'M5.9 3.9 3.2 6.6l2.7 2.7' }));

    const InfoIcon = h('svg', {
      className: 'dpp-icon', viewBox: '0 0 16 16', width: 14, height: 14,
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': 'true',
    },
    h('circle', { cx: 8, cy: 8, r: 6 }),
    h('path', { d: 'M8 7.2v4.1', strokeLinecap: 'round' }),
    h('circle', { cx: 8, cy: 4.7, r: 0.9, fill: 'currentColor', stroke: 'none' }));

    const SpinnerIcon = h('svg', {
      className: 'dpp-icon dpp-spin', viewBox: '0 0 16 16', width: 14, height: 14,
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': 'true',
    },
    h('circle', { cx: 8, cy: 8, r: 5.6, strokeOpacity: 0.3 }),
    h('path', { d: 'M8 2.4a5.6 5.6 0 0 1 5.6 5.6', strokeLinecap: 'round' }));

    // ------------------------------------------------------------- 装配

    return {
      // Client service names (not package ids); DSH starts the plugin once these exist.
      inject: ['slots', 'locale'],

      apply(ctx) {
        ctx.effect(installStyles, 'dsh-prompt-polish: styles');
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-polish: dictionaries');
        const t = ctx.locale.bind(NS);

        const store = createStore();
        const controller = createController(store);
        ctx.effect(() => () => controller.cancel(), 'dsh-prompt-polish: cancel in-flight request');

        const knownErrors = new Set([
          'network', 'request-failed', 'model-unavailable', 'model-error', 'llm-unavailable',
          'empty-output', 'draft-changed', 'too-long', 'timeout', 'aborted', 'no-model',
          'unauthorized', 'empty-input', 'internal', 'apply-failed', 'undo-failed', 'no-improvement',
          'context-unavailable', 'context-read-failed', 'invalid-context',
        ]);

        const describeError = (error) => {
          if (error === null || typeof error !== 'object') return t('error.generic');
          const key = `error.${error.code}`;
          if (!knownErrors.has(error.code)) {
            return error.detail ? `${t('error.generic')} ${error.detail}` : t('error.generic');
          }
          const base = t(key);
          return error.code === 'request-failed' && error.detail ? `${base} ${error.detail}` : base;
        };

        /** Composer tool-row cell: polish, style, context, undo, and details. */
        function PolishButtons(props) {
          const raw = React.useSyncExternalStore(store.subscribe, store.get);
          const state = stateFor(raw, props.sessionId);
          const draft = props.useInput((snapshot) => snapshot.draft);
          const phase = props.useInput((snapshot) => snapshot.phase);
          const occurrences = props.useInput((snapshot) => snapshot.occurrences);

          const [style, setStyle] = React.useState(readStyle);
          const [contextRounds, setContextRounds] = React.useState(() => readContextRounds() ?? 0);
          const [maxInputChars, setMaxInputChars] = React.useState(cachedHealth.maxInputChars);
          const [maxContextRounds, setMaxContextRounds] = React.useState(cachedHealth.maxContextRounds);

          const draftRef = React.useRef(draft);
          draftRef.current = draft;

          React.useEffect(() => {
            let live = true;
            loadHealth().then((health) => {
              if (!live) return;
              setMaxInputChars(health.maxInputChars);
              setMaxContextRounds(health.maxContextRounds);
              setContextRounds((current) => {
                if (current > health.maxContextRounds) {
                  saveContextRounds(0);
                  return 0;
                }
                if (readContextRounds() === null && health.defaultContextRounds > 0) {
                  saveContextRounds(health.defaultContextRounds);
                  return health.defaultContextRounds;
                }
                return current;
              });
            });
            return () => { live = false; };
          }, []);

          const effectiveContextRounds = contextRounds > maxContextRounds ? 0 : contextRounds;
          const gate = canOptimize({
            phase,
            text: draft,
            occurrenceCount: Array.isArray(occurrences) ? occurrences.length : 0,
            status: state.status,
            maxInputChars,
          });
          const undo = canUndo(state, draft);
          const again = state.status === 'done' && Array.isArray(state.history) && state.history.length > 0;
          const label = again ? t('optimize.again') : t('optimize.label');
          const tooltip = again ? t('optimize.againTooltip') : t('optimize.tooltip');
          const gateReason = gate.enabled
            ? tooltip
            : gate.reason === 'too-long'
              ? t('reason.too-long', { limit: maxInputChars })
              : t(`reason.${gate.reason}`);

          // A sent or manually cleared draft ends the undo window.
          React.useEffect(() => {
            const current = stateFor(store.get(), props.sessionId);
            if (current.status !== 'loading'
              && Array.isArray(current.history)
              && current.history.length > 0
              && draft === '') {
              store.set({ ...IDLE_STATE });
            }
          }, [draft, props.sessionId]);

          // A session switch (mount/unmount of this session-scoped cell) must
          // not let the old session's request land in the new composer.
          React.useEffect(() => () => controller.cancel(props.sessionId), [props.sessionId]);

          const reasonId = `dpp-reason-${String(props.sessionId ?? 'session')}`;
          const undoReasonId = `${reasonId}-undo`;

          const onOptimize = () => {
            if (!gate.enabled) return;
            let rev;
            try {
              rev = props.inputActions.captureInsertion().draftRev;
            } catch {
              rev = undefined;
            }
            void controller.optimize({
              text: draftRef.current,
              sessionId: props.sessionId,
              style,
              includeContext: effectiveContextRounds > 0,
              contextRounds: effectiveContextRounds > 0 ? effectiveContextRounds : undefined,
              rev,
              setDraft: props.inputActions.setDraft,
              getDraft: () => draftRef.current,
              getRev: () => props.inputActions.captureInsertion().draftRev,
            }).catch((error) => {
              store.set({
                status: 'error',
                error: { code: 'internal', detail: String(error?.message ?? error) },
                owner: props.sessionId ?? null,
                detailsOpen: false,
              });
            });
          };

          const onUndo = () => {
            if (!undo.enabled) return;
            void controller.undo({
              sessionId: props.sessionId,
              setDraft: props.inputActions.setDraft,
              getDraft: () => draftRef.current,
            }).catch((error) => {
              store.set({
                status: 'error',
                error: { code: 'undo-failed', detail: String(error?.message ?? error) },
                owner: props.sessionId ?? null,
                detailsOpen: false,
              });
            });
          };

          const toggleDetails = () => {
            if (state.meta === null) return;
            store.set({ detailsOpen: !state.detailsOpen });
          };

          const contextOptions = CONTEXT_OPTIONS
            .filter((rounds) => rounds === 0 || rounds <= maxContextRounds);

          // The title lives on a wrapper: browsers suppress hover titles on a
          // disabled control, and a disabled control must still explain itself.
          // `aria-disabled` (not `disabled`) keeps controls focusable so
          // keyboard and assistive-technology users can read the reason.
          return h('span', { className: 'dpp-root' },
            h('span', {
              className: 'dpp-tip',
              title: gateReason,
            },
            h('button', {
              type: 'button',
              className: 'dpp-btn',
              onClick: onOptimize,
              onMouseDown: (event) => event.preventDefault(),
              'data-disabled': gate.enabled ? undefined : 'true',
              'aria-disabled': gate.enabled ? undefined : 'true',
              'aria-describedby': gate.enabled ? undefined : reasonId,
              'aria-label': again ? t('optimize.again') : t('optimize.aria'),
              'aria-busy': state.status === 'loading' ? 'true' : undefined,
            },
            state.status === 'loading' ? SpinnerIcon : SparkleIcon,
            h('span', { className: 'dpp-label' }, label))),
            h('span', { id: reasonId, className: 'dpp-sr' }, gate.enabled ? '' : gateReason),

            h('select', {
              className: 'dpp-style',
              value: style,
              disabled: state.status === 'loading',
              title: t('style.label'),
              'aria-label': t('style.label'),
              onChange: (event) => {
                const next = event.target.value;
                setStyle(next);
                saveStyle(next);
              },
            }, STYLES.map((id) => h('option', { key: id, value: id }, t(`style.${id}`)))),

            h('select', {
              className: 'dpp-style dpp-context',
              value: effectiveContextRounds,
              disabled: state.status === 'loading',
              title: t('context.label'),
              'aria-label': t('context.label'),
              onChange: (event) => {
                const next = Number(event.target.value);
                setContextRounds(next);
                saveContextRounds(next);
              },
            }, contextOptions.map((rounds) => h(
              'option',
              { key: rounds, value: rounds },
              rounds === 0 ? t('context.off') : t('context.round', { n: rounds }),
            ))),

            undo.visible ? h('span', {
              className: 'dpp-tip',
              title: undo.enabled ? t('undo.tooltip') : t('reason.changed'),
            },
            h('button', {
              type: 'button',
              className: 'dpp-btn',
              onClick: onUndo,
              onMouseDown: (event) => event.preventDefault(),
              'data-disabled': undo.enabled ? undefined : 'true',
              'aria-disabled': undo.enabled ? undefined : 'true',
              'aria-describedby': undo.enabled ? undefined : undoReasonId,
              'aria-label': t('undo.label'),
            }, UndoIcon, h('span', { className: 'dpp-label' }, t('undo.short')))) : null,
            undo.visible ? h('span', { id: undoReasonId, className: 'dpp-sr' }, undo.enabled ? '' : t('reason.changed')) : null,
            state.meta !== null && state.status === 'done' ? h('span', {
              className: 'dpp-tip',
              title: t('details.title'),
            },
            h('button', {
              type: 'button',
              className: 'dpp-btn',
              onClick: toggleDetails,
              onMouseDown: (event) => event.preventDefault(),
              'aria-label': t('details.title'),
              'aria-expanded': state.detailsOpen ? 'true' : 'false',
            }, InfoIcon)) : null);
        }

        /** Full-width notice above the composer card: in-flight, errors, details. */
        function PolishStatus(props) {
          const raw = React.useSyncExternalStore(store.subscribe, store.get);
          const state = stateFor(raw, props.sessionId);
          const [elapsed, setElapsed] = React.useState(0);

          React.useEffect(() => {
            if (state.status !== 'loading') {
              setElapsed(0);
              return undefined;
            }
            const started = Date.now();
            setElapsed(0);
            const timer = setInterval(() => {
              setElapsed(Math.floor((Date.now() - started) / 1000));
            }, 1000);
            return () => clearInterval(timer);
          }, [state.status]);

          if (state.status === 'loading') {
            return h('div', {
              className: 'dpp-status',
              'data-tone': 'working',
              role: 'status',
              'aria-live': 'polite',
            },
            SpinnerIcon,
            h('span', { className: 'dpp-status-text' }, elapsed > 0 ? `${t('status.working')} ${elapsed}s` : t('status.working')),
            h('button', {
              type: 'button',
              className: 'dpp-status-action',
              onClick: () => controller.cancel(props.sessionId),
            }, t('cancel')));
          }

          if (state.status === 'error' && state.error !== null) {
            return h('div', { className: 'dpp-status', 'data-tone': 'error', role: 'alert' },
              h('span', { className: 'dpp-status-dot', 'aria-hidden': 'true' }),
              h('span', { className: 'dpp-status-text' }, describeError(state.error)),
              h('button', {
                type: 'button',
                className: 'dpp-status-close',
                onClick: () => store.set(stateAfterStop(state)),
                'aria-label': t('error.dismiss'),
                title: t('error.dismiss'),
              }, '\u00d7'));
          }

          if (state.status === 'done' && state.detailsOpen && state.meta !== null) {
            const meta = state.meta;
            const context = meta.context ?? {};
            const contextText = context.enabled === true
              ? t('details.contextOn', {
                  n: context.turns ?? 0,
                  chars: context.chars ?? 0,
                  truncated: context.truncated ? t('details.truncated') : '',
                })
              : t('details.contextOff');
            return h('div', { className: 'dpp-details', role: 'region', 'aria-label': t('details.title') },
              h('div', { className: 'dpp-details-head' },
                h('span', null, t('details.title')),
                h('button', {
                  type: 'button',
                  className: 'dpp-details-close',
                  onClick: () => store.set({ detailsOpen: false }),
                  'aria-label': t('details.close'),
                  title: t('details.close'),
                }, '\u00d7')),
              h('div', { className: 'dpp-details-row' }, h('span', { className: 'dpp-details-key' }, t('details.model')),
                h('span', { className: 'dpp-details-value' }, `${meta.provider ?? ''}/${meta.model ?? ''}`)),
              h('div', { className: 'dpp-details-row' }, h('span', { className: 'dpp-details-key' }, t('details.style')),
                h('span', { className: 'dpp-details-value' }, t(`style.${meta.style}`))),
              h('div', { className: 'dpp-details-row' }, h('span', { className: 'dpp-details-key' }, t('details.input')),
                h('span', { className: 'dpp-details-value' }, t('details.chars', { n: meta.inputChars ?? 0 }))),
              h('div', { className: 'dpp-details-row' }, h('span', { className: 'dpp-details-key' }, t('details.context')),
                h('span', { className: 'dpp-details-value' }, contextText)),
              h('div', { className: 'dpp-details-row' }, h('span', { className: 'dpp-details-key' }, t('details.retry')),
                h('span', { className: 'dpp-details-value' }, meta.retry ? t('details.retryYes') : t('details.retryNo'))),
              h('div', { className: 'dpp-details-row' }, h('span', { className: 'dpp-details-key' }, t('details.system'))),
              h('pre', { className: 'dpp-details-pre' }, meta.systemPrompt ?? ''));
          }

          return null;
        }

        // A slot entry that throws blanks the composer toolbar. Keep one
        // boundary class for the plugin lifetime and give each entry its own
        // instance, so a component bug is isolated before it reaches the shell.
        let BoundaryClass = null;
        const boundaryClass = () => {
          if (BoundaryClass !== null) return BoundaryClass;
          BoundaryClass = class extends React.Component {
            constructor(props) {
              super(props);
              this.state = { failed: false };
            }

            static getDerivedStateFromError() {
              return { failed: true };
            }

            componentDidCatch(error, info) {
              console.error('[dsh-prompt-polish] slot component crashed', error, info);
            }

            render() {
              if (this.state.failed) {
                return h('span', {
                  className: 'dpp-boundary',
                  role: 'alert',
                  title: t('error.component'),
                }, '\u26a0 ', t('error.component'));
              }
              return this.props.children;
            }
          };
          return BoundaryClass;
        };
        const wrap = (Component) => function PromptPolishBoundary(props) {
          return h(boundaryClass(), null, h(Component, props));
        };

        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'prompt-polish',
          order: 10,
        }, wrap(PolishButtons)));

        // `conversation.input.dock` renders above the card in BOTH the blank
        // hero composer and the conversation composer, so a failure during a
        // first-ever prompt is still visible.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'prompt-polish-status',
          order: 5,
        }, wrap(PolishStatus)));
      },

      // Test seams: no UI dependency, exercised by test/client.test.mjs.
      __test: { createStore, createController, canOptimize, canUndo, stateFor },
    };
  },
});
