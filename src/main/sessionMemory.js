import { getActiveLlmContextStartIndex, isContextDividerMessage } from "@shared/chatMessages";
import { estimateMessagesTokens, estimateTextTokens } from "@shared/tokenEstimator";
import { groupMessagesByApiRound } from "./contextGrouping.js";
import { formatMessagesForSummary } from "./contextCompression.js";

export const SESSION_MEMORY_MIN_TOKENS = 800;
export const SESSION_MEMORY_UPDATE_SYSTEM = `You maintain running session memory for a coding agent.
Write analysis in <analysis>...</analysis>, then output ONLY the updated memory in <memory>...</memory>.

Use the same section tags as compaction summaries:
<section name="primary_request">...</section>
<section name="technical_concepts">...</section>
<section name="files_and_code">...</section>
<section name="errors_and_fixes">...</section>
<section name="problem_solving">...</section>
<section name="user_messages">ALL user messages verbatim from new turns</section>
<section name="pending_tasks">...</section>
<section name="current_work">...</section>
<section name="next_step">...</section>

Rules:
- Merge new facts into existing memory; drop stale superseded details.
- user_messages section must quote new user instructions verbatim.
- Match conversation language. Do not invent facts.`;

export function formatSessionMemory(raw) {
    const text = String(raw || "").trim();
    const match = text.match(/<memory>([\s\S]*?)<\/memory>/i);
    if (match) {
        return match[1].trim();
    }
    return text.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
}

export function getPendingMemoryMessages(session) {
    const contextFrom = getActiveLlmContextStartIndex(session);
    const memoryFrom = Math.max(contextFrom, (session.meta.sessionMemoryUpToIndex ?? contextFrom - 1) + 1);
    return session.messages
        .slice(memoryFrom)
        .filter((message) => !isContextDividerMessage(message));
}

export function shouldRefreshSessionMemory(session) {
    if (session.meta.sessionMemoryRefreshBusy) {
        return false;
    }
    const pending = getPendingMemoryMessages(session);
    if (pending.length < 2) {
        return false;
    }
    return estimateMessagesTokens(pending) >= SESSION_MEMORY_MIN_TOKENS;
}

export function buildSessionMemoryTranscript(session, pendingMessages) {
    const parts = [];
    if (session.meta.sessionMemory) {
        parts.push(`Existing memory:\n${session.meta.sessionMemory}`);
    }
    parts.push(`New turns:\n${formatMessagesForSummary(pendingMessages)}`);
    return parts.join("\n\n---\n\n");
}

export function syncSessionMemoryAfterCompact(session, summary, lastSummarizedIndex) {
    session.meta.sessionMemory = summary;
    session.meta.sessionMemoryUpToIndex = lastSummarizedIndex;
    session.meta.sessionMemoryUpdatedAt = new Date().toISOString();
}

export function clearSessionMemory(session) {
    delete session.meta.sessionMemory;
    delete session.meta.sessionMemoryUpToIndex;
    delete session.meta.sessionMemoryUpdatedAt;
    delete session.meta.sessionMemoryRefreshBusy;
}
