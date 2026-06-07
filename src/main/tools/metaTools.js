function fnSchema(name, description, parameters) {
    return {
        type: "function",
        function: { name, description, parameters },
    };
}

export function createMetaTools({ getAgentTools, updateTodos, runSubAgent }) {
  return [
    {
      name: "TodoWrite",
      requiresConfirmation: false,
      enabled: () => getAgentTools().enable_tools !== false,
      schema: fnSchema(
        "TodoWrite",
        "Create or update the session todo list. Pass the full desired list; merge=true merges by id, and merge=false replaces the list.",
        {
          type: "object",
          properties: {
            todos: {
              type: "array",
              description: "Full todo list to write.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Unique identifier for the todo item" },
                  content: { type: "string", description: "Description of the todo" },
                  activeForm: {
                    type: "string",
                    description:
                      "Present-continuous label shown while in_progress (e.g. Running tests)",
                  },
                  status: {
                    type: "string",
                    enum: ["pending", "in_progress", "completed", "cancelled"],
                  },
                },
                required: ["id", "content", "status"],
              },
            },
            merge: {
              type: "boolean",
              description: "If true, merge items by id. If false, replace the entire list.",
            },
          },
          required: ["todos", "merge"],
        },
      ),
      async execute(args, context) {
        const sessionId = context?.sessionId;
        if (!sessionId) {
          throw new Error("TodoWrite requires an active session");
        }
        const todos = Array.isArray(args.todos) ? args.todos : [];
        if (!todos.length && args.merge !== false) {
          throw new Error("todos must contain at least one item");
        }
        const next = updateTodos(sessionId, todos, Boolean(args.merge), context?.runId);
        const autoRunHint =
          "\n\n请立即开始执行上述 todos：先将第一个 pending 项标记为 in_progress（建议提供清晰的 activeForm 进行时文案），然后在每次状态变化后调用 TodoWrite(merge=true) 持续更新，直到全部完成。";
        const summary = next.length
          ? next.map((item) => `[${item.status}] ${item.content}`).join("\n")
          : "(empty)";
        return `Updated todo list (${next.length} items):\n${summary}${autoRunHint}`;
      },
    },
    {
      name: "Task",
      requiresConfirmation: false,
      enabled: () => getAgentTools().allow_sub_agents === true,
      schema: fnSchema(
        "Task",
        "Launch one isolated sub-agent for a delegated task. Use it for work that benefits from a separate prompt; sub-agents cannot spawn further sub-agents.",
        {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Short 3-5 word task label",
            },
            prompt: {
              type: "string",
              description: "Full instructions, constraints, and expected output for the sub-agent",
            },
            subagent_type: {
              type: "string",
              enum: ["generalPurpose", "explore"],
              description: "Sub-agent type; defaults to generalPurpose",
            },
            model: {
              type: "string",
              description: "Optional model override in provider/modelId form",
            },
          },
          required: ["description", "prompt"],
        },
      ),
      async execute(args, context) {
        const sessionId = context?.sessionId;
        const parentRunId = context?.runId;
        if (!sessionId) {
          throw new Error("Task requires an active session");
        }
        const prompt = String(args.prompt || "").trim();
        if (!prompt) {
          throw new Error("'prompt' is required");
        }
        return runSubAgent({
          sessionId,
          parentRunId,
          description: String(args.description || "sub-agent task").trim(),
          prompt,
          subagentType: args.subagent_type || "generalPurpose",
          modelOverride: args.model || null,
        });
      },
    },
  ];
}
