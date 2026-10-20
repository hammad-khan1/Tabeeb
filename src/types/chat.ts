export type SourceSelectionMode = 'auto' | 'latest' | 'all' | 'specific';

export interface ChatScopeInput {
  mode?: SourceSelectionMode;
  documentIds?: string[];
}

export interface ChatSourceScope {
  mode: SourceSelectionMode;
  documentIds?: string[];
  resolvedDocumentIds?: string[];
  label?: string;
}

export interface ClarificationOption {
  label: string;
  mode: SourceSelectionMode;
  documentIds?: string[];
}

export interface ChatClarification {
  question: string;
  options: ClarificationOption[];
  originalQuestion: string;
}

export interface ChatMessage {
  id?: string;
  conversationId?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceReference[];
  scope?: ChatSourceScope;
  clarification?: ChatClarification;
  timestamp: Date;
}

export interface ConversationSummary {
  conversationId: string;
  title: string;
  lastMessageAt: string;
}

export interface SourceReference {
  documentId: string;
  documentTitle: string;
  documentType: string;
  chunkContent: string;
  relevanceScore: number;
  section?: string;
}
