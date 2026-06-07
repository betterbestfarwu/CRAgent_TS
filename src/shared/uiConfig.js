/** UI preferences persisted in app config (Settings → Chat). */

export const DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS = 300;
export const DEFAULT_LLM_TEMPERATURE = 0.7;

export const DEFAULT_UI_CONFIG = {
    /** When true, thinking steps are not grouped in the chat transcript. */
    verbose_thinking: false,
    /** When false, hooks.json command hooks are not executed. */
    hooks_enabled: true,
    /** Max wait time for a single LLM API request. */
    llm_request_timeout_seconds: DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
    /** Sampling temperature for LLM API requests (0–1). */
    llm_temperature: DEFAULT_LLM_TEMPERATURE,
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

export function resolveLlmTemperature(ui) {
    const temperature = Number(mergeUiConfig(ui).llm_temperature);
    if (!Number.isFinite(temperature)) {
        return DEFAULT_LLM_TEMPERATURE;
    }
    return Math.min(1, Math.max(0, temperature));
}
