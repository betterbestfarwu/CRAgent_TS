import { getMessageRunId, collectMessagesUpToTurn, resolveForkLlmContext } from "./chatMessages.js";

function defaultCreateId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return `fork-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Clone messages for a forked session with fresh ids, run ids, and tool call refs. */
export function cloneMessagesForFork(messages, createId = defaultCreateId) {
    const runIdMap = new Map();
    const toolCallIdMap = new Map();

    const cloned = (messages || []).map((message) => {
        const next = { ...message, id: createId() };
        const runId = getMessageRunId(message);
        if (runId) {
            if (!runIdMap.has(runId)) {
                runIdMap.set(runId, createId());
            }
            next.runId = runIdMap.get(runId);
            delete next.run_id;
        }

        if (next.toolCalls?.length) {
            next.toolCalls = next.toolCalls.map((call) => {
                const clonedCall = { ...call };
                if (clonedCall.id) {
                    const mappedId = createId();
                    toolCallIdMap.set(clonedCall.id, mappedId);
                    clonedCall.id = mappedId;
                }
                if (clonedCall.function) {
                    clonedCall.function = { ...clonedCall.function };
                }
                return clonedCall;
            });
        }

        return next;
    });

    const remapped = cloned.map((message) => {
        if (!message.toolCallId) {
            return message;
        }
        const mapped = toolCallIdMap.get(message.toolCallId);
        return mapped ? { ...message, toolCallId: mapped } : message;
    });

    return { messages: remapped, runIdMap };
}

/** Copy todo run snapshots onto forked session meta using remapped run ids. */
export function remapTodoRunsForFork(sourceTodoRuns, runIdMap) {
    if (!sourceTodoRuns || !runIdMap?.size) {
        return undefined;
    }
    const todoRuns = {};
    for (const [oldRunId, newRunId] of runIdMap) {
        if (sourceTodoRuns[oldRunId]) {
            todoRuns[newRunId] = sourceTodoRuns[oldRunId];
        }
    }
    return Object.keys(todoRuns).length ? todoRuns : undefined;
}

export function buildForkedSession(sourceSession, messageId, createSession) {
    const slice = collectMessagesUpToTurn(sourceSession.messages, messageId);
    if (!slice.length) {
        throw new Error("无法分叉：未找到消息");
    }

    const { messages, runIdMap } = cloneMessagesForFork(slice);
    const created = createSession({
        projectId: sourceSession.meta.projectId,
        executionMode: sourceSession.meta.executionMode,
        authMode: sourceSession.meta.authMode,
    });

    const todoRuns = remapTodoRunsForFork(sourceSession.meta.todoRuns, runIdMap);
    const llmContext = resolveForkLlmContext(messages, sourceSession.meta);

    return {
        meta: {
            ...created.meta,
            providerKey: sourceSession.meta.providerKey,
            modelId: sourceSession.meta.modelId,
            title: sourceSession.meta.title,
            executionMode: sourceSession.meta.executionMode,
            authMode: sourceSession.meta.authMode,
            ...(llmContext.llmContextDividerId
                ? { llmContextDividerId: llmContext.llmContextDividerId }
                : {}),
            ...(llmContext.contextSummary ? { contextSummary: llmContext.contextSummary } : {}),
            ...(llmContext.postCompactContext
                ? { postCompactContext: llmContext.postCompactContext }
                : {}),
            ...(todoRuns ? { todoRuns } : {}),
        },
        messages,
    };
}
