import { shouldRequireToolConfirmation } from "./authPolicy.js";

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

    schemas() {
        return this.activeTools()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((tool) => tool.schema);
    }

    async execute(call, context = {}) {
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
