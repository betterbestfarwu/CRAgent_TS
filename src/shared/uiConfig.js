/** UI preferences persisted in app config (Settings → Chat). */

export const DEFAULT_UI_CONFIG = {
    /** When true, thinking steps are not grouped in the chat transcript. */
    verbose_thinking: false,
    /** When false, hooks.json command hooks are not executed. */
    hooks_enabled: true,
};

export function mergeUiConfig(partial = {}) {
    return { ...DEFAULT_UI_CONFIG, ...partial };
}
