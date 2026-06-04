import { shouldRequireToolConfirmation } from "./authPolicy.js";
import { executeToolSearch, schemasForToolCatalog } from "./toolSearch.js";

export class ToolRegistry {
    constructor(toolFactory, confirmToolExecution, getAuthMode = () => "default") {
        this.toolFactory = toolFactory;
        this.confirmToolExecution = confirmToolExecution;
        this.getAuthMode = getAuthMode;
    }

    activeTools(sessionId) {
        return this.toolFactory().filter((tool) => {
            if (sessionId && typeof tool.enabledForSession === "function") {
                return tool.enabledForSession(sessionId);
            }
            return tool.enabled();
        });
    }

    allTools() {
        return this.toolFactory();
    }

    schemas(options = {}) {
        const { sessionId, tools: toolsOverride, ...schemaOptions } = options;
        const tools =
            toolsOverride ||
            this.activeTools(typeof sessionId === "string" ? sessionId : undefined);
        return schemasForToolCatalog(tools, schemaOptions);
    }

    async execute(call, context = {}) {
        if (call.function.name === "tool_search") {
            let args = {};
            try {
                args = JSON.parse(call.function.arguments || "{}");
            } catch (error) {
                return `Error: invalid tool arguments ${error.message}`;
            }
            const unlocked = context.unlockedToolNames || new Set();
            return executeToolSearch(args, this.activeTools(), unlocked);
        }

        const tool = this.activeTools(context.sessionId).find((entry) => entry.name === call.function.name);
        if (!tool) {
            return `Error: unknown tool '${call.function.name}'`;
        }

        let args = {};
        try {
            args = JSON.parse(call.function.arguments || "{}");
        } catch (error) {
            return `Error: invalid tool arguments ${error.message}`;
        }

        if (shouldRequireToolConfirmation(tool, () => this.getAuthMode(context.sessionId))) {
            const approved = await this.confirmToolExecution(
                tool.name,
                JSON.stringify(args, null, 2),
            );
            if (!approved) {
                return `Error: user declined ${tool.name}`;
            }
        }

        try {
            // Always pass context. Default parameters make execute.length === 1 even when
            // the tool accepts a second argument (e.g. computer_* tools need sessionId).
            return await tool.execute(args, context);
        } catch (error) {
            return `Error: ${error.message}`;
        }
    }
}
