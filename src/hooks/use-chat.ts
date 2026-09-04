"use client";

import { useState, useCallback, useRef } from "react";
import useSWR from "swr";
import type { ChatMessage, SourceReference, ConversationSummary } from "@/types/chat";

const fetchConversationList = (url: string): Promise<ConversationSummary[]> =>
  fetch(url).then((r) => (r.ok ? r.json() : []));

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: conversations = [], mutate: refreshConversations } = useSWR<
    ConversationSummary[]
  >("/api/chat/history", fetchConversationList, { revalidateOnFocus: false });

  const loadConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/chat/history?conversationId=${id}`);
      if (res.ok) {
        const rows = await res.json();
        const loaded: ChatMessage[] = rows.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          conversationId: r.conversationId as string,
          role: r.role as "user" | "assistant",
          content: r.content as string,
          sources: (r.sources as SourceReference[]) ?? undefined,
          timestamp: new Date(r.createdAt as string),
        }));
        setMessages(loaded);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: content.trim(),
      timestamp: new Date(),
      conversationId: conversationId ?? undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      sources: [],
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, assistantMessage]);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content.trim(), conversationId }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Chat request failed" }));
        throw new Error(err.error || "Chat request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      let sources: SourceReference[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const payload = trimmed.slice(6);
          if (payload === "[DONE]") break;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(payload);
          } catch {
            // A partial frame; the buffer will complete it on the next read.
            continue;
          }

          // Raised outside the JSON.parse try: an error frame used to be thrown
          // inside it and immediately swallowed by the "unparseable chunk" catch, so
          // a failed stream showed the user nothing at all.
          if (typeof parsed.error === "string") {
            throw new Error(parsed.error);
          }

          {
            if (typeof parsed.conversationId === "string" && !conversationId) {
              setConversationId(parsed.conversationId);
            }

            if (parsed.sources && Array.isArray(parsed.sources)) {
              sources = parsed.sources.map(
                (s: Record<string, unknown>) => ({
                  documentId: s.documentId as string,
                  documentTitle: s.documentTitle as string,
                  documentType: s.documentType as string,
                  chunkContent: (s.chunkContent as string) ?? "",
                  relevanceScore: (s.relevanceScore as number) ?? 0,
                  section: s.section as string | undefined,
                })
              );
            }

            if (typeof parsed.content === "string" && parsed.content) {
              accumulated += parsed.content;
              const currentSources = sources.length > 0 ? [...sources] : undefined;

              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: accumulated,
                  sources: currentSources,
                  timestamp: new Date(),
                };
                return updated;
              });
            }
          }
        }
      }

      refreshConversations();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled
      } else {
        const errorMsg =
          err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Sorry, I encountered an error: ${errorMsg}. Please try again.`,
            timestamp: new Date(),
          };
          return updated;
        });
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [isLoading, conversationId, refreshConversations]);

  const clearMessages = useCallback(() => {
    startNewConversation();
  }, [startNewConversation]);

  return {
    messages,
    sendMessage,
    clearMessages,
    isLoading,
    conversationId,
    conversations,
    loadConversation,
    startNewConversation,
  };
}
