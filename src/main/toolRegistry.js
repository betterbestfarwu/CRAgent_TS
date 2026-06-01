import { shouldRequireToolConfirmation } from "./authPolicy.js";
import { executeToolSearch, schemasForToolCatalog } from "./toolSearch.js";

export class ToolRegistry {
    constructor(toolFactory, confirmToolExecution, getAuthMode = () => "default") {
        this.toolFactory = toolFactory;
        this.confirmToolExecution = confirmToolExecution;
        this.getAuthMode = getAuthMode;
    }

    activeTools() {
        return this.toolFactory().filter((tool) => tool.enabled());
    }

    allTools() {
        return this.toolFactory();
    }

    schemas(options = {}) {
        const tools = options.tools || this.activeTools();
        const { tools: _omit, ...rest } = options;
        return schemasForToolCatalog(tools, rest);
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

        const tool = this.activeTools().find((entry) => entry.name === call.function.name);
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
            if (tool.execute.length >= 2) {
                return await tool.execute(args, context);
            }
            return await tool.execute(args);
        } catch (error) {
            return `Error: ${error.message}`;
        }
    }
}
