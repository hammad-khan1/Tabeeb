export interface ChatMessage {
  id?: string;
  conversationId?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceReference[];
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
