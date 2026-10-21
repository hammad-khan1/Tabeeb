"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import useSWR from "swr";
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
  Sparkles,
  Layers,
  Check,
  X,
  FileSearch,
  BookOpen,
  Copy,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { TabeebLogo } from "@/components/brand";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useChat } from "@/hooks/use-chat";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import type { SourceReference, SourceSelectionMode, ClarificationOption } from "@/types/chat";

interface DocumentItem {
  id: string;
  title: string;
  documentType: string;
  createdAt: string;
  documentDate: string | null;
  extractionStatus: string;
}

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : { documents: [] }));

export default function ChatPage() {
  const {
    messages,
    sendMessage,
    isLoading,
    conversationId,
    conversations,
    loadConversation,
    startNewConversation,
    activeScope,
    setActiveScope,
    resetScope,
  } = useChat();
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  // Document picker modal state
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [pendingClarificationQuestion, setPendingClarificationQuestion] = useState<string | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [docSearch, setDocSearch] = useState("");

  // Voice recording state
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

  // Fetch user documents for picker
  const { data: docData } = useSWR<{ documents: DocumentItem[] }>(
    "/api/documents?limit=100",
    fetcher,
    { revalidateOnFocus: false }
  );
  const userDocuments = docData?.documents || [];

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

  const handleClarificationClick = (option: ClarificationOption, originalQuestion: string) => {
    if (option.mode === "specific") {
      setPendingClarificationQuestion(originalQuestion);
      setSelectedDocIds(activeScope.documentIds || []);
      setDocPickerOpen(true);
      return;
    }

    sendMessage(originalQuestion, { mode: option.mode }, option.label);
  };

  const handleModeChange = (mode: SourceSelectionMode) => {
    if (mode === "auto") {
      resetScope();
    } else if (mode === "latest") {
      setActiveScope({ mode: "latest", label: "Latest Document" });
    } else if (mode === "all") {
      setActiveScope({ mode: "all", label: "Complete Medical History" });
    } else if (mode === "specific") {
      setPendingClarificationQuestion(null);
      setSelectedDocIds(activeScope.documentIds || []);
      setDocPickerOpen(true);
    }
  };

  const applyDocumentSelection = () => {
    if (selectedDocIds.length === 0) {
      setDocPickerOpen(false);
      return;
    }

    const selectedDocs = userDocuments.filter((d) => selectedDocIds.includes(d.id));
    const label =
      selectedDocs.length === 1
        ? selectedDocs[0].title
        : `${selectedDocs.length} Documents Selected`;

    if (pendingClarificationQuestion) {
      sendMessage(
        pendingClarificationQuestion,
        { mode: "specific", documentIds: selectedDocIds },
        `Selected: ${label}`
      );
      setPendingClarificationQuestion(null);
    } else {
      setActiveScope({
        mode: "specific",
        documentIds: selectedDocIds,
        label,
      });
    }

    setDocPickerOpen(false);
  };

  const toggleDocSelection = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
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

  const filteredDocs = userDocuments.filter((d) => {
    if (!docSearch.trim()) return true;
    const q = docSearch.toLowerCase();
    return d.title.toLowerCase().includes(q) || d.documentType.toLowerCase().includes(q);
  });

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
              aria-label="Start a new conversation"
            >
              <Plus className="size-4" aria-hidden="true" />
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
                    className={`w-full truncate rounded-lg px-3 py-2 text-start text-sm transition-colors ${
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
        <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 md:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle conversation history"
            >
              <History className="size-4" />
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Ask Tabeeb</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Grounded answers from your medical records and prescriptions.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden md:flex text-xs"
            >
              <History className="me-1.5 size-3.5" />
              History
            </Button>
            <Button variant="ghost" size="sm" onClick={startNewConversation} className="text-xs">
              <Plus className="me-1.5 size-3.5" aria-hidden="true" />
              New Chat
            </Button>
          </div>
        </div>

        {/* Source Scope Toolbar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            <span className="me-1 text-xs font-medium text-muted-foreground">Source:</span>
            <Button
              variant={activeScope.mode === "auto" ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1 px-2.5 text-xs"
              onClick={() => handleModeChange("auto")}
            >
              <Sparkles className="size-3" />
              Auto
            </Button>
            <Button
              variant={activeScope.mode === "latest" ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1 px-2.5 text-xs"
              onClick={() => handleModeChange("latest")}
            >
              <FileSearch className="size-3" />
              Latest Doc
            </Button>
            <Button
              variant={activeScope.mode === "all" ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1 px-2.5 text-xs"
              onClick={() => handleModeChange("all")}
            >
              <BookOpen className="size-3" />
              All History
            </Button>
            <Button
              variant={activeScope.mode === "specific" ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1 px-2.5 text-xs"
              onClick={() => handleModeChange("specific")}
            >
              <Layers className="size-3" />
              Choose Docs
            </Button>
          </div>

          {/* Active Scope Indicator Badge */}
          {activeScope.mode !== "auto" && (
            <div className="flex items-center gap-1">
              <Badge variant="secondary" className="gap-1 text-[11px] font-normal">
                <span className="font-semibold">Scoped:</span> {activeScope.label || activeScope.mode}
                <button
                  type="button"
                  onClick={resetScope}
                  className="ms-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  aria-label="Reset scope to Auto"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </div>
          )}
        </div>

        {/* Messages Container */}
        <ScrollArea className="flex-1 rounded-xl border bg-background">
          <div
            className="space-y-4 p-4"
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-busy={isLoading}
            aria-label="Conversation"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <MessageSquare className="size-7" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold">
                  Ask me anything about your health records
                </h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Choose to ask about your latest document, compare recent visits, or search your complete medical history.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    "What medications am I taking right now?",
                    "What medicines are listed in my latest prescription?",
                    "Compare my last two blood tests",
                    "Have I ever been prescribed amoxicillin?",
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
                  {msg.role === "user" ? (
                    <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-primary px-4 py-2.5 text-primary-foreground shadow-xs sm:max-w-[80%]">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {msg.content}
                      </p>
                    </div>
                  ) : (
                    <div className="group relative flex max-w-[92%] gap-2.5 sm:max-w-[85%]">
                      <div className="shrink-0 mt-1">
                        <TabeebLogo variant="icon" size="sm" alt="Tabeeb" />
                      </div>
                      <div className="flex-1 rounded-2xl rounded-tl-xs border border-border/70 bg-card/90 px-4 py-3.5 shadow-xs dark:bg-muted/30">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 overflow-hidden">
                            <MarkdownRenderer
                              content={msg.content}
                              sources={msg.sources}
                              isStreaming={isLoading && i === messages.length - 1}
                            />
                          </div>
                          {msg.content && (
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.content, i)}
                              className="shrink-0 -mt-1 -me-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                              aria-label="Copy response"
                              title="Copy response"
                            >
                              {copiedIndex === i ? (
                                <Check className="size-3.5 text-primary" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                            </button>
                          )}
                        </div>

                        {/* Clarification prompt & clickable option buttons */}
                        {msg.clarification && (
                          <div className="mt-3.5 space-y-2 rounded-xl border border-primary/20 bg-background/90 p-3 shadow-xs">
                            <p className="text-xs font-semibold text-foreground">
                              Please choose how you would like me to answer:
                            </p>
                            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
                              {msg.clarification.options.map((option, idx) => (
                                <Button
                                  key={idx}
                                  variant="outline"
                                  size="sm"
                                  className="h-8 justify-start gap-1.5 text-xs hover:border-primary hover:bg-primary/5 sm:justify-center"
                                  onClick={() =>
                                    handleClarificationClick(option, msg.clarification!.originalQuestion)
                                  }
                                >
                                  {option.mode === "latest" && <FileSearch className="size-3.5 text-primary" />}
                                  {option.mode === "all" && <BookOpen className="size-3.5 text-primary" />}
                                  {option.mode === "specific" && <Layers className="size-3.5 text-primary" />}
                                  <span>{option.label}</span>
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Citations */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5">
                            <span className="me-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Sources:
                            </span>
                            {msg.sources.map((source: SourceReference, si: number) => (
                              <Link
                                key={si}
                                href={`/documents/${source.documentId}`}
                                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground/80 transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                              >
                                <FileText className="size-2.5 text-primary" aria-hidden="true" />
                                <span className="max-w-[180px] truncate">{source.documentTitle}</span>
                                {source.section && (
                                  <span className="text-muted-foreground">({source.section})</span>
                                )}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}

            {isLoading &&
              messages.length > 0 &&
              messages[messages.length - 1].content === "" && (
                <div className="flex justify-start">
                  <div className="flex max-w-[90%] gap-2.5 sm:max-w-[85%]">
                    <div className="shrink-0 mt-1">
                      <TabeebLogo variant="icon" size="sm" alt="Tabeeb" />
                    </div>
                    <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-xs border border-border/60 bg-card/90 px-4 py-3 shadow-xs dark:bg-muted/30">
                      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                      <span className="text-sm text-muted-foreground">
                        Searching records & analyzing...
                      </span>
                    </div>
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
              className="min-h-[44px] resize-none pe-12"
              rows={1}
              aria-label="Ask about your health records"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-[44px] shrink-0"
            onClick={() => setVoiceDialogOpen(true)}
            aria-label="Ask by voice"
          >
            <Mic className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            className="size-[44px] shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            aria-label={isLoading ? "Sending your question" : "Send question"}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {/* Choose Documents Dialog */}
      <Dialog open={docPickerOpen} onOpenChange={setDocPickerOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Select Source Documents</DialogTitle>
            <DialogDescription>
              Choose one or more documents to scope Tabeeb&apos;s answer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Input
              placeholder="Filter documents by title or type..."
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              className="h-8 text-xs"
            />

            <ScrollArea className="h-64 rounded-md border p-2">
              {filteredDocs.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  No documents found.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {filteredDocs.map((doc) => {
                    const isSelected = selectedDocIds.includes(doc.id);
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => toggleDocSelection(doc.id)}
                        className={`flex w-full items-start justify-between rounded-lg border p-2.5 text-start text-xs transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <p className="font-semibold text-foreground">{doc.title}</p>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Badge variant="outline" className="text-[10px]">
                              {doc.documentType}
                            </Badge>
                            <span>Uploaded {new Date(doc.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div
                          className={`mt-0.5 flex size-4 items-center justify-center rounded border ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {isSelected && <Check className="size-3" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {selectedDocIds.length} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDocPickerOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={applyDocumentSelection}
                disabled={selectedDocIds.length === 0}
              >
                {pendingClarificationQuestion ? "Continue Question" : "Apply Scope"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <AlertCircle className="size-4" aria-hidden="true" />
                {recorderError}
              </div>
            )}

            {!isRecording && !audioBlob && (
              <Button size="lg" onClick={startRecording}>
                <Mic className="me-2 size-5" aria-hidden="true" />
                Start Recording
              </Button>
            )}

            {isRecording && (
              <div className="flex items-center gap-3">
                <Badge variant="destructive" className="animate-pulse">
                  Recording
                </Badge>
                <Button variant="destructive" size="lg" onClick={stopRecording}>
                  <Square className="me-2 size-4" aria-hidden="true" />
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
                        <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />
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
