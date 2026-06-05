/** Default context compression settings (shared by main process and Settings UI). */
export const DEFAULT_CONTEXT_CONFIG = {
    auto_compact_enabled: true,
    session_memory_enabled: true,
    auto_compact_threshold_percent: 85,
    compact_buffer_tokens: 13_000,
    compact_max_input_tokens: 120_000,
    compact_ptl_max_retries: 3,
    microcompact_keep_recent: 5,
    microcompact_idle_minutes: 30,
    microcompact_idle_keep_recent: 2,
    precompact_keep_recent: 2,
    keep_min_tokens: 8000,
    keep_min_text_messages: 5,
    keep_max_tokens: 40_000,
    post_compact_max_files: 5,
    post_compact_token_budget: 50_000,
    post_compact_max_tokens_per_file: 5000,
    post_compact_skills_token_budget: 25_000,
    post_compact_max_tokens_per_skill: 5000,
    post_compact_max_skills: 3,
};

export function mergeContextConfig(partial = {}) {
    return { ...DEFAULT_CONTEXT_CONFIG, ...partial };
}
