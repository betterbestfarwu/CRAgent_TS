import { useCallback, useEffect, useRef } from "react";
import { getMessageModelId } from "@shared/chatMessages.js";
import { injectChatLayout } from "./chatLayoutSync.js";

function toWireMessage(message) {
  const toolCalls = message.toolCalls?.map((call) => ({
    name: call.function?.name || call.name || "tool",
    arguments:
      typeof call.function?.arguments === "string"
        ? call.function.arguments
        : JSON.stringify(call.function?.arguments ?? {}),
  }));

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    created_at: message.createdAt,
    ...(getMessageModelId(message) ? { model_id: getMessageModelId(message) } : {}),
    ...(message.runId ? { run_id: message.runId } : {}),
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.images?.length
      ? {
          images: message.images.map((image) => ({
            mime_type: image.mimeType,
            data_url: image.dataUrl,
          })),
        }
      : {}),
  };
}

export function ChatView({ messages, busy, onDelete, onOpenImage }) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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
    postToChat(
      "renderAll",
      (messagesRef.current || []).map(toWireMessage),
    );
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
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [busy, onDelete, onOpenImage, postToChat, syncIframeLayout, syncMessages]);

  useEffect(() => {
    if (!readyRef.current) return;
    syncMessages();
  }, [messages, syncMessages]);

  useEffect(() => {
    if (!readyRef.current) return;
    postToChat("setBusy", busy);
  }, [busy, postToChat]);

  return (
    <iframe
      ref={iframeRef}
      className="chat-frame"
      title="CRAgent chat"
      src="./chat/chat.html?v=8"
    />
  );
}
