import { useCallback, useEffect, useRef } from "react";
import { formatAtMentionsForDisplay } from "@shared/atMention.js";
import {
  appendedMessagesNeedFullRender,
  dedupeConsecutiveContextDividers,
  getMessageModelId,
  stableUserWireMessage,
  userImagesWireFingerprint,
} from "@shared/chatMessages.js";
import {
  isPlanRejectionMessage,
  parsePlanRejectionDisplay,
} from "@shared/planMessages.js";
import { resolveSessionImageWireFields } from "@shared/sessionImageUrl.js";
import { injectChatLayout } from "./chatLayoutSync.js";

function wireMessageRunId(message) {
  return message?.run_id || "";
}

function findLastActiveRunUserIndex(messages) {
  for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && wireMessageRunId(message)) {
      return index;
    }
  }
  return -1;
}

function userImageWireChanged(nextMessages, previousMessages) {
  if (!previousMessages?.length || nextMessages.length !== previousMessages.length) {
    return false;
  }
  return userImagesWireFingerprint(nextMessages) !== userImagesWireFingerprint(previousMessages);
}

function canPatchActiveRunUpdate(messages, previousMessages) {
  if (!messages?.length || !previousMessages?.length || messages.length !== previousMessages.length) {
    return false;
  }
  const userIndex = findLastActiveRunUserIndex(messages);
  if (userIndex < 0) return false;

  const runId = wireMessageRunId(messages[userIndex]);
  let nextIndex = userIndex + 1;
  while (nextIndex < messages.length && wireMessageRunId(messages[nextIndex]) === runId) {
    nextIndex += 1;
  }
  if (nextIndex !== messages.length) return false;

  for (let index = 0; index <= userIndex; index += 1) {
    const nextMessage = messages[index];
    const previousMessage = previousMessages[index];
    const nextKey =
      nextMessage?.role === "user"
        ? JSON.stringify(stableUserWireMessage(nextMessage))
        : JSON.stringify(nextMessage);
    const previousKey =
      previousMessage?.role === "user"
        ? JSON.stringify(stableUserWireMessage(previousMessage))
        : JSON.stringify(previousMessage);
    if (nextKey !== previousKey) {
      return false;
    }
  }
  return true;
}

function toWireMessage(message, planContext, sessionId) {
  const useDirectImageSrc = window.cragent?.isDesktop === true;
  const toolCalls = message.toolCalls?.map((call) => ({
    ...(call.id ? { id: call.id } : {}),
    name: call.function?.name || call.name || "tool",
    arguments:
      typeof call.function?.arguments === "string"
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments ?? {}),
  }));

  const hasAtMentions = Boolean(message.atMentions?.length);
  const systemHint = message.systemHint ?? null;
  const userDisplayText = message.userText ?? null;
  const content =
    message.role === "user"
      ? systemHint || userDisplayText != null
        ? hasAtMentions
          ? userDisplayText ?? ""
          : formatAtMentionsForDisplay(userDisplayText ?? message.content)
        : hasAtMentions
          ? message.userText ?? ""
          : formatAtMentionsForDisplay(message.content)
      : message.content;
  const images = message.images?.length
    ? message.images.map((image, index) =>
        resolveSessionImageWireFields(sessionId, message.id, image, index, {
          useDirectImageSrc,
        }),
      )
    : null;

  return {
    id: message.id,
    role: message.role,
    content,
    created_at: message.createdAt,
    ...(getMessageModelId(message) ? { model_id: getMessageModelId(message) } : {}),
    ...(message.runId ? { run_id: message.runId } : {}),
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    ...(message.reasoningContent
      ? { reasoning_content: message.reasoningContent }
      : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(images?.length ? { image_count: images.length, images } : {}),
    ...((hasAtMentions || userDisplayText != null) && message.role === "user"
      ? {
          ...(hasAtMentions
            ? {
                at_mentions: message.atMentions.map((mention) => ({
                  name: mention.name,
                  relative_path: mention.relativePath,
                })),
              }
            : {}),
          user_text: userDisplayText ?? message.userText ?? "",
        }
      : {}),
    ...(systemHint ? { system_hint: systemHint } : {}),
    ...(planContext?.active && message.role === "assistant"
      ? {
          plan_file_path: planContext.displayPath,
          plan_session_id: planContext.sessionId,
        }
      : {}),
    ...(isPlanRejectionMessage(message)
      ? (() => {
          const { plan, feedback } = parsePlanRejectionDisplay(message.content);
          return {
            plan_rejection: true,
            plan_rejection_plan: plan,
            ...(feedback ? { plan_rejection_feedback: feedback } : {}),
          };
        })()
      : {}),
  };
}

export function ChatView({
  sessionId,
  sessionModelId,
  messages,
  todoRuns,
  busy,
  verboseThinking,
  planContext,
  onDelete,
  onFork,
  onOpenImage,
  onOpenPlanFile,
}) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef([]);
  const messagesRef = useRef(messages);
  const todoRunsRef = useRef(todoRuns);
  const wireSnapshotRef = useRef({ ids: [], todoJson: "", wireJson: "", wireMessages: [] });
  const syncedSessionIdRef = useRef("");
  const verboseThinkingRef = useRef(verboseThinking);
  const planContextRef = useRef(planContext);
  messagesRef.current = messages;
  todoRunsRef.current = todoRuns;
  verboseThinkingRef.current = verboseThinking;
  planContextRef.current = planContext;

  const syncIframeLayout = useCallback(() => {
    injectChatLayout(iframeRef.current?.contentDocument ?? null);
  }, []);

  const postToChat = useCallback((fn, arg) => {
    const win = iframeRef.current?.contentWindow;
    if (!win?.app) {
      pendingRef.current.push(() => postToChat(fn, arg));
      return;
    }
    win.app[fn](arg);
  }, []);

  const syncMessages = useCallback(() => {
    const nextSessionId = sessionId || "";
    if (syncedSessionIdRef.current !== nextSessionId) {
      postToChat("setSessionId", nextSessionId);
      syncedSessionIdRef.current = nextSessionId;
      wireSnapshotRef.current = { ids: [], todoJson: "", wireJson: "", wireMessages: [] };
    }

    const wireMessages = dedupeConsecutiveContextDividers(messagesRef.current || []).map((message) =>
      toWireMessage(message, planContextRef.current, sessionId),
    );
    const ids = wireMessages.map((message) => message.id);
    const todoJson = JSON.stringify(todoRunsRef.current || {});
    const wireJson = JSON.stringify(wireMessages);
    const prev = wireSnapshotRef.current;
    const idsSame =
      ids.length === prev.ids.length && ids.every((id, index) => id === prev.ids[index]);
    if (idsSame && todoJson === prev.todoJson && wireJson === prev.wireJson) {
      return;
    }
    const idsAppended =
      prev.ids.length > 0 &&
      ids.length >= prev.ids.length &&
      prev.ids.every((id, index) => id === ids[index]);
    const todosOnly = idsSame && todoJson !== prev.todoJson && wireJson === prev.wireJson;
    const needsFullRender =
      idsAppended && appendedMessagesNeedFullRender(wireMessages, prev.ids.length);
    const activeRunUpdated =
      idsSame &&
      wireJson !== prev.wireJson &&
      canPatchActiveRunUpdate(wireMessages, prev.wireMessages);
    const userImagesChanged =
      idsSame &&
      wireJson !== prev.wireJson &&
      userImageWireChanged(wireMessages, prev.wireMessages);

    if (todosOnly) {
      postToChat("updateTodoRuns", todoRunsRef.current || {});
    } else if (idsAppended && ids.length > prev.ids.length && !needsFullRender) {
      postToChat("patchActiveRun", {
        messages: wireMessages,
        todoRuns: todoRunsRef.current || {},
      });
    } else if (activeRunUpdated && !userImagesChanged) {
      postToChat("patchActiveRun", {
        messages: wireMessages,
        todoRuns: todoRunsRef.current || {},
      });
    } else {
      postToChat("renderAll", {
        messages: wireMessages,
        todoRuns: todoRunsRef.current || {},
      });
    }

    wireSnapshotRef.current = { ids, todoJson, wireJson, wireMessages };
  }, [postToChat, sessionId]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => syncIframeLayout();
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [syncIframeLayout]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.action === "ready") {
        readyRef.current = true;
        syncedSessionIdRef.current = "";
        syncIframeLayout();
        postToChat("setSessionModel", sessionModelId || "");
        postToChat("setVerboseThinking", verboseThinkingRef.current);
        postToChat("setPlanContext", planContextRef.current || { active: false });
        syncMessages();
        postToChat("setBusy", busy);
        const queue = pendingRef.current;
        pendingRef.current = [];
        queue.forEach((run) => run());
        return;
      }

      if (data.action === "delete" && data.id) {
        void onDelete?.(data.id);
      }

      if (data.action === "fork" && data.id) {
        void onFork?.(data.id);
      }

      if (data.action === "openImage" && (data.dataUrl || data.src)) {
        onOpenImage?.({
          dataUrl: data.dataUrl || "",
          src: data.src || data.dataUrl || "",
          mimeType: data.mimeType || "",
        });
      }

      if (data.action === "openPlan" && data.sessionId) {
        void onOpenPlanFile?.(data.sessionId);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [busy, onDelete, onFork, onOpenImage, onOpenPlanFile, postToChat, syncIframeLayout, syncMessages]);

  useEffect(() => {
    if (!readyRef.current) return;
    postToChat("setSessionModel", sessionModelId || "");
  }, [sessionModelId, postToChat]);

  useEffect(() => {
    if (!readyRef.current) return;
    syncMessages();
  }, [messages, todoRuns, syncMessages]);

  useEffect(() => {
    if (!readyRef.current) return;
    postToChat("setBusy", busy);
  }, [busy, postToChat]);

  useEffect(() => {
    if (!readyRef.current) return;
    postToChat("setVerboseThinking", verboseThinking);
  }, [verboseThinking, postToChat]);

  useEffect(() => {
    if (!readyRef.current) return;
    postToChat("setPlanContext", planContext || { active: false });
  }, [planContext, postToChat]);

  return (
    <iframe
      ref={iframeRef}
      className="chat-frame"
      title="CRAgent chat"
      src="./chat/chat.html"
    />
  );
}
