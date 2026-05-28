import { useCallback, useEffect, useRef } from "react";

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
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
    ...(message.name ? { name: message.name } : {}),
  };
}

export function ChatView({ messages, busy, onDelete }) {
  const iframeRef = useRef(null);
  const readyRef = useRef(false);
  const pendingRef = useRef([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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
    const onMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.action === "ready") {
        readyRef.current = true;
        syncMessages();
        postToChat("setBusy", busy);
        const queue = pendingRef.current;
        pendingRef.current = [];
        queue.forEach((run) => run());
        return;
      }

      if (data.action === "delete" && data.id) {
        onDelete?.(data.id);
        postToChat("removeMessage", data.id);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [busy, onDelete, postToChat, syncMessages]);

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
      src="./chat/chat.html"
    />
  );
}
