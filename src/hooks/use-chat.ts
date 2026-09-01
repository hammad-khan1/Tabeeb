"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, SourceReference, ConversationSummary } from "@/types/chat";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/history");
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

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

          try {
            const parsed = JSON.parse(payload);

            if (parsed.error) {
              throw new Error(parsed.error);
            }

            if (parsed.conversationId && !conversationId) {
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

            if (parsed.content) {
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
          } catch {
            // Skip unparseable chunks
          }
        }
      }

      fetchConversations();
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
  }, [isLoading, conversationId, fetchConversations]);

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
