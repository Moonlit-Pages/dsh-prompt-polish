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
    const STYLE_ID = 'dsh-prompt-polish-styles';

    // --------------------------------------------------------------- 文案

    const zh = {
      'optimize.label': '优化',
      'optimize.aria': '优化提示词',
      'optimize.tooltip': '优化当前提示词（可撤销）',
      'undo.label': '撤销优化',
      'undo.short': '撤销',
      'undo.tooltip': '恢复优化前的提示词',
      'status.working': '正在优化提示词…',
      'reason.loading': '正在优化…',
      'reason.locked': '发送中不能优化',
      'reason.empty': '先输入提示词',
      'reason.references': '草稿里有引用，暂不支持优化（避免丢失引用）',
      'reason.changed': '草稿已修改，无法撤销',
      'error.generic': '优化失败，请重试。',
      'error.network': '无法连接优化服务，请检查页面连接。',
      'error.request-failed': '优化服务返回错误。',
      'error.model-unavailable': '当前模型不可用，请换一个模型。',
      'error.model-error': '模型调用失败，请重试。',
      'error.llm-unavailable': 'Host 的模型服务不可用。',
      'error.empty-output': '模型没有返回内容，请重试。',
      'error.draft-changed': '优化期间草稿被修改，结果没有写入。',
      'error.too-long': '提示词太长，超出单次优化上限。',
      'error.timeout': '优化超时，请重试。',
      'error.aborted': '优化已取消。',
      'error.no-model': '没有可用模型，请先在输入框选择模型。',
      'error.unauthorized': '会话已失效，请刷新页面。',
      'error.empty-input': '先输入提示词。',
      'error.internal': '优化服务内部错误。',
      'error.apply-failed': '优化结果无法写回输入框，请重试。',
      'error.undo-failed': '撤销失败，请重试。',
      'error.no-improvement': '模型没有给出实质优化，请重试或换一个更强的模型。',
      'error.dismiss': '关闭提示',
    };

    const en = {
      'optimize.label': 'Polish',
      'optimize.aria': 'Polish prompt',
      'optimize.tooltip': 'Polish the current prompt (undoable)',
      'undo.label': 'Undo polish',
      'undo.short': 'Undo',
      'undo.tooltip': 'Restore the prompt from before the polish',
      'status.working': 'Polishing the prompt…',
      'reason.loading': 'Polishing…',
      'reason.locked': 'Wait for the current message to finish',
      'reason.empty': 'Type a prompt first',
      'reason.references': 'Drafts with references cannot be polished yet (the reference would be lost)',
      'reason.changed': 'The draft changed, so undo is unavailable',
      'error.generic': 'Prompt polish failed. Please try again.',
      'error.network': 'Could not reach the polish service. Check the page connection.',
      'error.request-failed': 'The polish service returned an error.',
      'error.model-unavailable': 'The selected model is unavailable. Choose another model.',
      'error.model-error': 'The model call failed. Please try again.',
      'error.llm-unavailable': 'The Host model service is unavailable.',
      'error.empty-output': 'The model returned no text. Please try again.',
      'error.draft-changed': 'The draft changed during the polish, so the result was not applied.',
      'error.too-long': 'The prompt is too long for one polish request.',
      'error.timeout': 'The polish timed out. Please try again.',
      'error.aborted': 'The polish was cancelled.',
      'error.no-model': 'No model is available. Select one in the composer first.',
      'error.unauthorized': 'The session expired. Reload the page.',
      'error.empty-input': 'Type a prompt first.',
      'error.internal': 'The polish service hit an internal error.',
      'error.apply-failed': 'The polished text could not be written back to the composer. Please try again.',
      'error.undo-failed': 'Undo failed. Please try again.',
      'error.no-improvement': 'The model made no substantive change. Try again or choose a stronger model.',
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

    const IDLE_STATE = Object.freeze({ status: 'idle', error: null, before: '', after: '', owner: null });

    /** Shared, framework-free state for the button and the status strip. */
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
            && next.owner === state.owner) return;
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
     * invisible here, so its spinner, notice, and undo window never leak.
     *
     * @param {object} state - store state.
     * @param {string | undefined} sessionId - viewing session.
     * @returns {object} state for this session, or the idle state.
     */
    function stateFor(state, sessionId) {
      if (state.owner === null || state.owner === (sessionId ?? null)) return state;
      return IDLE_STATE;
    }

    /**
     * Whether the optimize button can run, independent of React.
     *
     * @param {object} view - current composer view.
     * @returns {{ enabled: boolean, reason: string }} decision.
     */
    function canOptimize({ phase, text, occurrenceCount, status }) {
      if (status === 'loading') return { enabled: false, reason: 'loading' };
      if (phase !== 'plain') return { enabled: false, reason: 'locked' };
      if (typeof text !== 'string' || text.trim() === '') return { enabled: false, reason: 'empty' };
      if (occurrenceCount > 0) return { enabled: false, reason: 'references' };
      return { enabled: true, reason: 'ready' };
    }

    /**
     * Whether undo should appear and whether it may run. Undo survives a failed
     * re-polish while the draft still holds the previous polished text.
     *
     * @param {{ status: string, after: string }} state - store state.
     * @param {string} text - current draft.
     * @returns {{ visible: boolean, enabled: boolean, reason: string }} decision.
     */
    function canUndo(state, text) {
      if (state.status === 'loading') return { visible: false, enabled: false, reason: 'idle' };
      if (typeof state.after !== 'string' || state.after === '') {
        return { visible: false, enabled: false, reason: 'idle' };
      }
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

      /**
       * Cancel the in-flight request of one session (or any request when the
       * session is omitted). Cancelling never leaves the owner stuck loading.
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
          store.set({ status: 'idle', error: null, before: '', after: '', owner });
        }
      }

      async function optimize({ text, sessionId, rev, setDraft, getDraft, getRev }) {
        const draft = typeof text === 'string' ? text : '';
        if (draft.trim() === '') return { ok: false, code: 'empty-input' };

        const owner = sessionId ?? null;
        const startRev = typeof rev === 'number' ? rev : revisionOf(getRev);

        const mine = ++generation;
        if (inflight !== null) inflight.controller.abort();
        const controller = new AbortController();
        inflight = { controller, sessionId: owner };
        store.set({ status: 'loading', error: null, owner });

        let payload = null;
        let response;
        try {
          response = await doFetch(api, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            signal: controller.signal,
            body: JSON.stringify({ text: draft, sessionId: owner ?? undefined }),
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
          store.set({ status: 'error', error: { code, detail }, owner });
          return { ok: false, code };
        } finally {
          if (inflight !== null && inflight.controller === controller) inflight = null;
        }

        if (mine !== generation) return { ok: false, code: 'superseded' };

        const polished = typeof payload.value?.text === 'string' ? payload.value.text : '';
        if (polished.trim() === '') {
          store.set({ status: 'error', error: { code: 'empty-output', detail: '' }, owner });
          return { ok: false, code: 'empty-output' };
        }
        if (startRev !== undefined) {
          const nowRev = revisionOf(getRev);
          if (nowRev !== undefined && nowRev !== startRev) {
            store.set({ status: 'error', error: { code: 'draft-changed', detail: '' }, owner });
            return { ok: false, code: 'draft-changed' };
          }
        }
        if (typeof getDraft === 'function' && getDraft() !== draft) {
          store.set({ status: 'error', error: { code: 'draft-changed', detail: '' }, owner });
          return { ok: false, code: 'draft-changed' };
        }

        try {
          setDraft(polished);
        } catch (error) {
          store.set({
            status: 'error',
            error: { code: 'apply-failed', detail: String(error?.message ?? error) },
            owner,
          });
          return { ok: false, code: 'apply-failed' };
        }
        store.set({ status: 'done', before: draft, after: polished, error: null, owner });
        return { ok: true, text: polished };
      }

      function undo({ sessionId, setDraft, getDraft }) {
        const state = store.get();
        if (sessionId !== undefined && state.owner !== null && state.owner !== sessionId) {
          return { ok: false, code: 'wrong-session' };
        }
        if (state.status === 'loading' || typeof state.after !== 'string' || state.after === '') {
          return { ok: false, code: 'nothing-to-undo' };
        }
        if (typeof getDraft === 'function' && getDraft() !== state.after) {
          store.set({ status: 'error', error: { code: 'draft-changed', detail: '' }, owner: state.owner });
          return { ok: false, code: 'draft-changed' };
        }
        try {
          setDraft(state.before);
        } catch (error) {
          store.set({
            status: 'error',
            error: { code: 'undo-failed', detail: String(error?.message ?? error) },
            owner: state.owner,
          });
          return { ok: false, code: 'undo-failed' };
        }
        store.set({ status: 'idle', before: '', after: '', error: null, owner: null });
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

        /** Composer tool-row cell: the polish and undo buttons. */
        function PolishButtons(props) {
          const raw = React.useSyncExternalStore(store.subscribe, store.get);
          const state = stateFor(raw, props.sessionId);
          const draft = props.useInput((snapshot) => snapshot.draft);
          const phase = props.useInput((snapshot) => snapshot.phase);
          const occurrences = props.useInput((snapshot) => snapshot.occurrences);

          const draftRef = React.useRef(draft);
          draftRef.current = draft;

          const gate = canOptimize({
            phase,
            text: draft,
            occurrenceCount: Array.isArray(occurrences) ? occurrences.length : 0,
            status: state.status,
          });
          const undo = canUndo(state, draft);

          // A sent or manually cleared draft ends the undo window.
          React.useEffect(() => {
            if (store.get().status === 'done' && draft === '') {
              store.set({ status: 'idle', before: '', after: '', error: null, owner: null });
            }
          }, [draft]);

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
              rev,
              setDraft: props.inputActions.setDraft,
              getDraft: () => draftRef.current,
              getRev: () => props.inputActions.captureInsertion().draftRev,
            }).catch((error) => {
              store.set({
                status: 'error',
                error: { code: 'internal', detail: String(error?.message ?? error) },
                owner: props.sessionId ?? null,
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
              });
            });
          };

          // The title lives on a wrapper: browsers suppress hover titles on a
          // disabled control, and a disabled control must still explain itself.
          // `aria-disabled` (not `disabled`) keeps both buttons focusable so
          // keyboard and assistive-technology users can read the reason.
          return h('span', { className: 'dpp-root' },
            h('span', {
              className: 'dpp-tip',
              title: gate.enabled ? t('optimize.tooltip') : t(`reason.${gate.reason}`),
            },
            h('button', {
              type: 'button',
              className: 'dpp-btn',
              onClick: onOptimize,
              onMouseDown: (event) => event.preventDefault(),
              'data-disabled': gate.enabled ? undefined : 'true',
              'aria-disabled': gate.enabled ? undefined : 'true',
              'aria-describedby': gate.enabled ? undefined : reasonId,
              'aria-label': t('optimize.aria'),
              'aria-busy': state.status === 'loading' ? 'true' : undefined,
            },
            state.status === 'loading' ? SpinnerIcon : SparkleIcon,
            h('span', { className: 'dpp-label' }, t('optimize.label')))),
            h('span', { id: reasonId, className: 'dpp-sr' }, gate.enabled ? '' : t(`reason.${gate.reason}`)),

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
            undo.visible ? h('span', { id: undoReasonId, className: 'dpp-sr' }, undo.enabled ? '' : t('reason.changed')) : null);
        }

        /** Full-width notice above the composer card: in-flight and failures. */
        function PolishStatus(props) {
          const raw = React.useSyncExternalStore(store.subscribe, store.get);
          const state = stateFor(raw, props.sessionId);
          if (state.status === 'loading') {
            return h('div', {
              className: 'dpp-status',
              'data-tone': 'working',
              role: 'status',
              'aria-live': 'polite',
            }, SpinnerIcon, h('span', { className: 'dpp-status-text' }, t('status.working')));
          }
          if (state.status !== 'error' || state.error === null) return null;
          return h('div', { className: 'dpp-status', 'data-tone': 'error', role: 'alert' },
            h('span', { className: 'dpp-status-dot', 'aria-hidden': 'true' }),
            h('span', { className: 'dpp-status-text' }, describeError(state.error)),
            h('button', {
              type: 'button',
              className: 'dpp-status-close',
              onClick: () => store.set({ status: 'idle', error: null, before: '', after: '', owner: null }),
              'aria-label': t('error.dismiss'),
              title: t('error.dismiss'),
            }, '\u00d7'));
        }

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'prompt-polish',
          order: 10,
        }, PolishButtons));

        // `conversation.input.dock` renders above the card in BOTH the blank
        // hero composer and the conversation composer, so a failure during a
        // first-ever prompt is still visible.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'prompt-polish-status',
          order: 5,
        }, PolishStatus));
      },

      // Test seams: no UI dependency, exercised by test/client.test.mjs.
      __test: { createStore, createController, canOptimize, canUndo, stateFor },
    };
  },
});
