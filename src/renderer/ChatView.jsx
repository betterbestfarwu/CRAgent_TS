import { useCallback, useEffect, useRef, useState } from "react";
import { formatAtMentionsForDisplay } from "@shared/atMention.js";
import {
  appendedMessagesNeedFullRender,
  dedupeConsecutiveContextDividers,
  getMessageModelId,
} from "@shared/chatMessages.js";
import {
  isPlanRejectionMessage,
  parsePlanRejectionDisplay,
} from "@shared/planMessages.js";
import { injectChatLayout } from "./chatLayoutSync.js";

function imageKey(sessionId, messageId, index) {
  return `${sessionId || ""}:${messageId || ""}:${index}`;
}

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
    if (JSON.stringify(messages[index]) !== JSON.stringify(previousMessages[index])) {
      return false;
    }
  }
  return true;
}

function toWireMessage(message, planContext, sessionId, imageDataByKey) {
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
    ? message.images.map((image, index) => {
        const actualIndex = image.index ?? index;
        const loaded = imageDataByKey[imageKey(sessionId, message.id, actualIndex)];
        const inlineDataUrl = image.dataUrl || null;
        return {
          index: actualIndex,
          mime_type: loaded?.mimeType || image.mimeType || "",
          has_data: Boolean(image.hasData || loaded?.dataUrl || inlineDataUrl),
          ...((loaded?.dataUrl || inlineDataUrl)
            ? { data_url: loaded?.dataUrl || inlineDataUrl }
            : {}),
        };
      })
    : null;

  return {
    id: message.id,
    role: message.role,
    content,
    created_at: message.createdAt,
    ...(getMessageModelId(message) ? { model_id: getMessageModelId(message) } : {}),
    ...(message.runId ? { run_id: message.runId } : {}),
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
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
  const verboseThinkingRef = useRef(verboseThinking);
  const planContextRef = useRef(planContext);
  const imageDataRef = useRef({});
  const [imageDataByKey, setImageDataByKey] = useState({});
  messagesRef.current = messages;
  todoRunsRef.current = todoRuns;
  verboseThinkingRef.current = verboseThinking;
  planContextRef.current = planContext;
  imageDataRef.current = imageDataByKey;

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
    const wireMessages = dedupeConsecutiveContextDividers(messagesRef.current || []).map((message) =>
      toWireMessage(message, planContextRef.current, sessionId, imageDataRef.current),
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

    if (todosOnly) {
      postToChat("updateTodoRuns", todoRunsRef.current || {});
    } else if (idsAppended && ids.length > prev.ids.length && !needsFullRender) {
      postToChat("patchActiveRun", {
        messages: wireMessages,
        todoRuns: todoRunsRef.current || {},
      });
    } else if (activeRunUpdated) {
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
    imageDataRef.current = {};
    setImageDataByKey({});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !window.cragent?.getSessionImage) return;
    const targets = [];
    for (const message of messages || []) {
      if (!message?.id || !message.images?.length) continue;
      message.images.forEach((image, index) => {
        if (!image?.hasData && !image?.dataUrl) return;
        const actualIndex = image.index ?? index;
        const key = imageKey(sessionId, message.id, actualIndex);
        if (imageDataRef.current[key]) return;
        targets.push({ key, messageId: message.id, imageIndex: actualIndex });
      });
    }
    if (!targets.length) return;

    let cancelled = false;
    for (const target of targets) {
      window.cragent
        .getSessionImage({
          sessionId,
          messageId: target.messageId,
          imageIndex: target.imageIndex,
        })
        .then((image) => {
          if (cancelled || !image?.dataUrl) return;
          setImageDataByKey((current) => {
            if (current[target.key]) return current;
            return {
              ...current,
              [target.key]: {
                mimeType: image.mimeType || "",
                dataUrl: image.dataUrl,
              },
            };
          });
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [sessionId, messages]);

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
        syncIframeLayout();
        postToChat("setSessionId", sessionId || "");
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

      if (data.action === "openImage" && data.dataUrl) {
        onOpenImage?.({
          dataUrl: data.dataUrl,
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
    postToChat("setSessionId", sessionId || "");
  }, [sessionId, postToChat]);

  useEffect(() => {
    if (!readyRef.current) return;
    postToChat("setSessionModel", sessionModelId || "");
  }, [sessionModelId, postToChat]);

  useEffect(() => {
    wireSnapshotRef.current = { ids: [], todoJson: "", wireJson: "", wireMessages: [] };
  }, [sessionId]);

  useEffect(() => {
    if (!readyRef.current) return;
    syncMessages();
  }, [messages, todoRuns, imageDataByKey, syncMessages]);

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
