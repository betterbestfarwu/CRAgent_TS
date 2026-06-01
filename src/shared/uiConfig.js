/** UI preferences persisted in app config (Settings → Chat). */

export const DEFAULT_UI_CONFIG = {
    /** When true, thinking steps are not grouped in the chat transcript. */
    verbose_thinking: false,
};

export function mergeUiConfig(partial = {}) {
    return { ...DEFAULT_UI_CONFIG, ...partial };
}
