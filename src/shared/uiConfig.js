/** UI preferences persisted in app config (Settings → Chat). */

export const DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS = 300;

export const DEFAULT_UI_CONFIG = {
    /** When true, thinking steps are not grouped in the chat transcript. */
    verbose_thinking: false,
    /** When false, hooks.json command hooks are not executed. */
    hooks_enabled: true,
    /** Max wait time for a single LLM API request. */
    llm_request_timeout_seconds: DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
};

export function mergeUiConfig(partial = {}) {
    return { ...DEFAULT_UI_CONFIG, ...partial };
}

export function resolveLlmRequestTimeoutMs(ui) {
    const seconds = Number(mergeUiConfig(ui).llm_request_timeout_seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS * 1000;
    }
    return Math.round(seconds * 1000);
}
