/** UI-only marker: not sent to the LLM. */
export const CONTEXT_DIVIDER_ROLE = "context_divider";

/** Shown on the context reset divider after /clear. */
export const CONTEXT_DIVIDER_LABEL = "上文仅供查阅 · 已移出模型上下文";

/** Shown on the divider inserted by /compact. */
export const CONTEXT_COMPACT_DIVIDER_LABEL = "较早对话已压缩为摘要 · 下文为当前模型上下文";

export function isContextDividerMessage(message) {
    return message?.role === CONTEXT_DIVIDER_ROLE;
}
