import { confirmToolExecution } from "./tools/builtinTools.js";

export class ToolRegistry {
    constructor(toolFactory) {
        this.toolFactory = toolFactory;
    }

    activeTools() {
        return this.toolFactory().filter((tool) => tool.enabled());
    }

    schemas() {
        return this.activeTools()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((tool) => tool.schema);
    }

    async execute(call) {
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

        if (tool.requiresConfirmation) {
            const approved = await confirmToolExecution(tool.name, JSON.stringify(args, null, 2));
            if (!approved) {
                return `Error: user declined ${tool.name}`;
            }
        }

        try {
            return await tool.execute(args);
        } catch (error) {
            return `Error: ${error.message}`;
        }
    }
}
