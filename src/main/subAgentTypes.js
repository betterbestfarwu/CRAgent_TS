export const SUB_AGENT_TYPES = {
    generalPurpose: {
        label: "generalPurpose",
        description:
            "General-purpose agent for researching questions, searching code, and executing multi-step tasks.",
        excludeTools: [
            "Task",
            "computer_screenshot",
            "computer_move",
            "computer_click",
            "computer_type",
            "computer_key",
            "computer_scroll",
        ],
    },
    explore: {
        label: "explore",
        description:
            "Fast read-only agent for exploring codebases. Cannot modify files, run shell commands, or spawn sub-agents.",
        includeTools: [
            "read_file",
            "list_dir",
            "web_fetch",
            "memory_get",
            "memory_search",
            "load_skill",
        ],
    },
};

export function filterToolsForSubAgent(tools, subagentType) {
    const spec = SUB_AGENT_TYPES[subagentType] || SUB_AGENT_TYPES.generalPurpose;
    if (spec.includeTools) {
        const allowed = new Set(spec.includeTools);
        return tools.filter((tool) => allowed.has(tool.name));
    }
    const excluded = new Set(spec.excludeTools || ["Task"]);
    return tools.filter((tool) => !excluded.has(tool.name));
}

export function subAgentSystemPrompt(subagentType) {
    const spec = SUB_AGENT_TYPES[subagentType] || SUB_AGENT_TYPES.generalPurpose;
    return [
        `You are a sub-agent (${spec.label}) working on a delegated task.`,
        spec.description,
        "Complete the task autonomously using available tools.",
        "Return a concise final summary of findings and actions when done.",
        "You cannot spawn additional sub-agents.",
    ].join("\n");
}
