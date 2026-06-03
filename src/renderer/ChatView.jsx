import { useCallback, useEffect, useRef } from "react";
import { formatAtMentionsForDisplay } from "@shared/atMention.js";
import {
  appendedMessagesNeedFullRender,
  dedupeConsecutiveContextDividers,
  getMessageModelId,
} from "@shared/chatMessages.js";
import {
  isPlanRejectionMessage,
  parsePlanRejectionDisplay,
  splitPlanModeAutoSystemHint,
} from "@shared/planMessages.js";
import { injectChatLayout } from "./chatLayoutSync.js";

function toWireMessage(message, planContext) {
  const toolCalls = message.toolCalls?.map((call) => ({
    ...(call.id ? { id: call.id } : {}),
    name: call.function?.name || call.name || "tool",
    arguments:
      typeof call.function?.arguments === "string"
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments ?? {}),
  }));

  const hasAtMentions = Boolean(message.atMentions?.length);
  let systemHint = message.systemHint ?? null;
  let userDisplayText = message.userText ?? null;
  if (message.role === "user" && !systemHint && !userDisplayText) {
    const split = splitPlanModeAutoSystemHint(message.content);
    if (split.systemHint) {
      systemHint = split.systemHint;
      userDisplayText = split.userText;
    }
  }
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
    ...(message.images?.length ? { image_count: message.images.length } : {}),
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
  messages,
  todoRuns,
  busy,
  verboseThinking,
  planContext,
  onDelete,
  onOpenImage,
  onOpenPlanFile,
}) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef([]);
  const messagesRef = useRef(messages);
  const todoRunsRef = useRef(todoRuns);
  const wireSnapshotRef = useRef({ ids: [], todoJson: "", wireJson: "" });
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
    const wireMessages = dedupeConsecutiveContextDividers(messagesRef.current || []).map((message) =>
      toWireMessage(message, planContextRef.current),
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
    const todosOnly = idsSame && todoJson !== prev.todoJson;
    const needsFullRender =
      idsAppended && appendedMessagesNeedFullRender(wireMessages, prev.ids.length);

    if (todosOnly) {
      postToChat("updateTodoRuns", todoRunsRef.current || {});
    } else if (idsAppended && ids.length > prev.ids.length && !needsFullRender) {
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

    wireSnapshotRef.current = { ids, todoJson, wireJson };
  }, [postToChat]);

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
        syncMessages();
        postToChat("setBusy", busy);
        postToChat("setVerboseThinking", verboseThinkingRef.current);
        const queue = pendingRef.current;
        pendingRef.current = [];
        queue.forEach((run) => run());
        return;
      }

      if (data.action === "delete" && data.id) {
        void onDelete?.(data.id);
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
  }, [busy, onDelete, onOpenImage, onOpenPlanFile, postToChat, syncIframeLayout, syncMessages]);

  useEffect(() => {
    wireSnapshotRef.current = { ids: [], todoJson: "", wireJson: "" };
  }, [sessionId]);

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
