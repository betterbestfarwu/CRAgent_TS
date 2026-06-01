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
        "Create and manage a structured todo list for the current session. Each call replaces the entire list unless merge=true.",
        {
          type: "object",
          properties: {
            todos: {
              type: "array",
              description: "Todo items to create or update.",
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
              description: "If true, merge todos by id. If false, replace the entire list.",
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
          "\n\n请立即开始执行上述 todos：将第一个 pending 项标记为 in_progress（建议提供 activeForm 进行时文案），逐步完成并在每项状态变化时调用 TodoWrite(merge=true) 更新。";
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
        "Launch a specialized sub-agent to handle a complex task autonomously. Sub-agents cannot spawn further sub-agents.",
        {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Short 3-5 word summary of the task",
            },
            prompt: {
              type: "string",
              description: "Detailed task description for the sub-agent",
            },
            subagent_type: {
              type: "string",
              enum: ["generalPurpose", "explore"],
              description: "Specialized agent type. Defaults to generalPurpose.",
            },
            model: {
              type: "string",
              description: "Optional model override as provider/modelId",
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
