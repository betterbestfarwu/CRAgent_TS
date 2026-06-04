import { randomUUID } from "node:crypto";
import { formatHelpText, matchChatCommand } from "@shared/chatCommands";
import { IPC_CHANNELS } from "@shared/ipc";

export function createChatCommandHandlers({
    sessionStore,
    emit,
    clearLlmContext,
    compactLlmContext,
    appendHelpMessage,
}) {
    async function execute(commandId, sessionId, runId) {
        switch (commandId) {
            case "new_session": {
                const current = sessionStore.get(sessionId);
                const projectId = current?.meta?.projectId ?? null;
                const session = sessionStore.openNewSession({ projectId });
                emit(IPC_CHANNELS.onSessionChanged, session);
                return true;
            }
            case "reset_context":
                clearLlmContext(sessionId);
                return true;
            case "compact_context":
                await compactLlmContext(sessionId);
                return true;
            case "help":
                appendHelpMessage(sessionId, formatHelpText(), runId);
                return true;
            default:
                return false;
        }
    }

    return {
        match(input) {
            return matchChatCommand(input);
        },
        execute,
    };
}

export function appendAssistantMessage(sessionStore, emit, sessionId, content, options = {}) {
    const session = sessionStore.get(sessionId);
    const message = {
        id: randomUUID(),
        role: "assistant",
        content,
        createdAt: new Date().toISOString(),
        modelId: options.modelId ?? session.meta.modelId,
        ...(options.runId ? { runId: options.runId } : {}),
    };
    const updated = sessionStore.appendMessage(sessionId, message);
    emit(IPC_CHANNELS.onMessageAppended, { sessionId, message });
    emit(IPC_CHANNELS.onSessionChanged, updated);
    return updated;
}
