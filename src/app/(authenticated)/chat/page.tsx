"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Send,
  Mic,
  Square,
  Loader2,
  MessageSquare,
  FileText,
  AlertCircle,
  Plus,
  History,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useChat } from "@/hooks/use-chat";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import type { SourceReference } from "@/types/chat";

export default function ChatPage() {
  const {
    messages,
    sendMessage,
    clearMessages,
    isLoading,
    conversationId,
    conversations,
    loadConversation,
    startNewConversation,
  } = useChat();
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    error: recorderError,
    duration,
  } = useVoiceRecorder();
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoiceTranscribe = async () => {
    if (!audioBlob) return;
    setTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice.webm");
      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Transcription failed");
      }
      const { transcript } = await res.json();
      setInput(transcript);
      setVoiceDialogOpen(false);
    } catch {
      // Error displayed in dialog
    } finally {
      setTranscribing(false);
    }
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-6xl gap-4">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-64" : "w-0 overflow-hidden"
        } hidden shrink-0 transition-all md:block`}
      >
        <Card className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b p-3">
            <span className="text-sm font-semibold">Conversations</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={startNewConversation}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-1 p-2">
              {conversations.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No conversations yet
                </p>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.conversationId}
                    onClick={() => loadConversation(conv.conversationId)}
                    className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      conversationId === conv.conversationId
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="truncate font-medium">
                      {conv.title || "New conversation"}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatDate(conv.lastMessageAt)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 md:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <History className="size-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Ask Tabeeb</h1>
              <p className="text-sm text-muted-foreground">
                Ask questions about your medical history and documents.
              </p>
            </div>
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden md:flex"
            >
              <History className="mr-2 size-3.5" />
              History
            </Button>
            <Button variant="ghost" size="sm" onClick={startNewConversation}>
              <Plus className="mr-2 size-3.5" />
              New Chat
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 rounded-xl border bg-background">
          <div className="space-y-4 p-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center py-20 text-center">
                <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <MessageSquare className="size-8" />
                </div>
                <h2 className="text-lg font-semibold">
                  Ask me anything about your medical history
                </h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  I can help you understand your lab results, check medication
                  interactions, summarize your health records, and more.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    "What medications am I taking?",
                    "Summarize my last lab report",
                    "Any drug interactions?",
                  ].map((q) => (
                    <Button
                      key={q}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setInput(q);
                        textareaRef.current?.focus();
                      }}
                      className="text-xs"
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={msg.id ?? i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {msg.content}
                    </p>

                    {msg.role === "assistant" &&
                      msg.sources &&
                      msg.sources.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
                          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            Sources:
                          </span>
                          {msg.sources.map(
                            (source: SourceReference, si: number) => (
                              <Link
                                key={si}
                                href={`/documents/${source.documentId}`}
                                className="inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-background"
                              >
                                <FileText className="size-2.5" />
                                {source.documentTitle}
                              </Link>
                            )
                          )}
                        </div>
                      )}
                  </div>
                </div>
              ))
            )}

            {isLoading &&
              messages.length > 0 &&
              messages[messages.length - 1].content === "" && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Thinking...
                    </span>
                  </div>
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Bar */}
        <div className="mt-3 flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (textareaRef.current) {
                  textareaRef.current.style.height = "auto";
                  textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your health records..."
              className="min-h-[44px] resize-none pr-12"
              rows={1}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-[44px] shrink-0"
            onClick={() => setVoiceDialogOpen(true)}
          >
            <Mic className="size-4" />
          </Button>
          <Button
            size="icon"
            className="size-[44px] shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Voice Dialog */}
      <Dialog open={voiceDialogOpen} onOpenChange={setVoiceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voice Input</DialogTitle>
            <DialogDescription>
              Speak your question and it will be transcribed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="text-3xl font-mono tabular-nums">
              {formatDuration(duration)}
            </div>

            {recorderError && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="size-4" />
                {recorderError}
              </div>
            )}

            {!isRecording && !audioBlob && (
              <Button size="lg" onClick={startRecording}>
                <Mic className="mr-2 size-5" />
                Start Recording
              </Button>
            )}

            {isRecording && (
              <div className="flex items-center gap-3">
                <Badge variant="destructive" className="animate-pulse">
                  Recording
                </Badge>
                <Button variant="destructive" size="lg" onClick={stopRecording}>
                  <Square className="mr-2 size-4" />
                  Stop
                </Button>
              </div>
            )}

            {audioBlob && !isRecording && (
              <div className="flex flex-col items-center gap-3">
                <audio
                  controls
                  src={URL.createObjectURL(audioBlob)}
                  className="w-full"
                />
                <div className="flex gap-3">
                  <Button variant="outline" onClick={startRecording}>
                    Re-record
                  </Button>
                  <Button
                    onClick={handleVoiceTranscribe}
                    disabled={transcribing}
                  >
                    {transcribing ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Transcribing...
                      </>
                    ) : (
                      "Use Transcript"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
