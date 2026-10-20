import { eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { documents } from '../../../drizzle/schema';
import type { SourceSelectionMode, ChatScopeInput } from '@/types/chat';
import type { ConversationTurn } from './query-rewriter';

export interface ClarificationOption {
  label: string;
  mode: SourceSelectionMode;
  documentIds?: string[];
}

export interface ScopeClarification {
  question: string;
  options: ClarificationOption[];
  originalQuestion: string;
}

export interface ResolvedScope {
  mode: SourceSelectionMode;
  documentIds?: string[];
  documentTitles?: string[];
  label: string;
  clarification?: ScopeClarification;
  unavailableReason?: string;
}

export interface ScopeResolverOptions {
  userId: string;
  message: string;
  requestedScope?: ChatScopeInput;
  priorTurns?: ConversationTurn[];
  priorTurnSources?: Array<{ documentId: string; documentTitle: string }>;
}

export function isLikelyFollowUp(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length > 200) return false;

  const referring = /\b(?:it|its|it's|that|this|those|these|they|them|their|the (?:dosage|dose|frequency|purpose|doctor|date|result|instruction|instructions|test|medicine|medication)|and (?:the|what)|what about|how about|why|is (?:that|it|this)|same|earlier|above)\b/i;
  const continuation = /^\s*(?:and|but|so|also|what about|how about|why|ok|okay|then|what is the dose|dosage\??|frequency\??)\b/i;

  return referring.test(trimmed) || continuation.test(trimmed);
}

export function isExplicitAllHistoryRequest(message: string): boolean {
  return /\b(?:ever|all[- ]time|over time|in the past|historically|complete (?:medical )?history|all (?:my )?(?:medications|medicines|records|prescriptions|documents|reports)|across all (?:my )?(?:records|history|documents))\b/i.test(message);
}

export function isExplicitLatestPrescriptionRequest(message: string): boolean {
  return /\b(?:latest|most recent|last|newest)\s+(?:prescription|rx|medication list|prescribed)\b/i.test(message);
}

export function isExplicitLatestLabRequest(message: string): boolean {
  return /\b(?:latest|most recent|last|newest)\s+(?:lab|blood test|lab report|test result|blood work|cbc|lft|kft|lipid panel|hba1c)\b/i.test(message);
}

export function isExplicitLatestDocumentRequest(message: string): boolean {
  return /\b(?:latest|most recent|last|newest)\s+(?:uploaded )?(?:document|report|record|upload|file|visit|consultation)\b/i.test(message);
}

export function isExplicitCompareRequest(message: string): { isCompare: boolean; type?: 'lab_report' | 'prescription' | 'general' } {
  if (/\b(?:compare|trend|difference between)\s+(?:my\s+)?(?:last|latest|recent)?\s*(?:two|2)?\s*(?:blood tests|lab reports|tests|labs|results)\b/i.test(message)) {
    return { isCompare: true, type: 'lab_report' };
  }
  if (/\b(?:compare|difference between)\s+(?:it\s+with\s+|this\s+with\s+)?(?:my\s+)?(?:previous|older|last|two|2)\s+prescription/i.test(message)) {
    return { isCompare: true, type: 'prescription' };
  }
  if (/\b(?:compare\s+(?:the\s+)?(?:last|latest|recent)\s*(?:two|2)\s+(?:reports|documents))\b/i.test(message)) {
    return { isCompare: true, type: 'general' };
  }
  return { isCompare: false };
}

export function isMateriallyAmbiguousQuestion(message: string): boolean {
  if (isExplicitAllHistoryRequest(message) ||
      isExplicitLatestPrescriptionRequest(message) ||
      isExplicitLatestLabRequest(message) ||
      isExplicitLatestDocumentRequest(message) ||
      isExplicitCompareRequest(message).isCompare) {
    return false;
  }

  // Medication current use ambiguity: "What medications am I taking right now?", etc.
  if (/\b(?:what (?:medications|medicines|drugs|pills|prescriptions)|am i taking|current medications|what am i on|what do i take)\b/i.test(message)) {
    return true;
  }

  // General health status / diagnoses ambiguity without established scope
  if (/\b(?:what (?:is|are) my (?:diagnosis|condition|conditions|allergies)|what did (?:the|my) doctor say|what did the doctor prescribe)\b/i.test(message) &&
      !/\b(?:in this|in the|from the|from this)\b/i.test(message)) {
    return true;
  }

  return false;
}

export async function resolveSourceScope(options: ScopeResolverOptions): Promise<ResolvedScope> {
  const { userId, message, requestedScope, priorTurns = [], priorTurnSources = [] } = options;
  const db = getDb();

  // Fetch summary of all user documents, newest upload first (createdAt)
  const userDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      documentType: documents.documentType,
      extractionStatus: documents.extractionStatus,
      createdAt: documents.createdAt,
      documentDate: documents.documentDate,
    })
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.createdAt));

  // 1. If user has no documents at all
  if (userDocs.length === 0) {
    return {
      mode: 'all',
      label: 'No Uploaded Documents',
      unavailableReason: 'You have not uploaded any medical documents yet. Please upload a medical document first to get grounded answers.',
    };
  }

  // Helper to validate and build result for a single latest document
  const buildLatestDocResult = (doc: typeof userDocs[number], labelPrefix = 'Latest Document') => {
    if (doc.extractionStatus === 'pending' || doc.extractionStatus === 'processing') {
      return {
        mode: 'latest' as SourceSelectionMode,
        documentIds: [doc.id],
        documentTitles: [doc.title],
        label: `${labelPrefix}: ${doc.title}`,
        unavailableReason: `Your ${labelPrefix.toLowerCase()} ("${doc.title}") is currently being processed. Please wait a moment for analysis to complete before asking questions about it, or select a previous document / Complete Medical History.`,
      };
    }
    if (doc.extractionStatus === 'failed') {
      return {
        mode: 'latest' as SourceSelectionMode,
        documentIds: [doc.id],
        documentTitles: [doc.title],
        label: `${labelPrefix}: ${doc.title}`,
        unavailableReason: `Your ${labelPrefix.toLowerCase()} ("${doc.title}") could not be processed successfully. Please check the document or choose another document from your records.`,
      };
    }
    return {
      mode: 'latest' as SourceSelectionMode,
      documentIds: [doc.id],
      documentTitles: [doc.title],
      label: `${labelPrefix}: ${doc.title}`,
    };
  };

  // 2. EXPLICIT REQUESTED SCOPE from client (user clicked dropdown or option)
  if (requestedScope && requestedScope.mode && requestedScope.mode !== 'auto') {
    if (requestedScope.mode === 'all') {
      return {
        mode: 'all',
        label: 'Complete Medical History',
      };
    }

    if (requestedScope.mode === 'latest') {
      const latestDoc = userDocs[0];
      return buildLatestDocResult(latestDoc);
    }

    if (requestedScope.mode === 'specific') {
      const requestedIds = requestedScope.documentIds ?? [];
      const matched = userDocs.filter((d) => requestedIds.includes(d.id));

      if (matched.length === 0) {
        return {
          mode: 'specific',
          label: 'Selected Documents',
          unavailableReason: 'The selected document could not be found or you do not have permission to view it.',
        };
      }

      // Check if any selected doc is still processing or failed
      const processing = matched.find((d) => d.extractionStatus === 'pending' || d.extractionStatus === 'processing');
      if (processing) {
        return {
          mode: 'specific',
          documentIds: matched.map((d) => d.id),
          documentTitles: matched.map((d) => d.title),
          label: matched.length === 1 ? matched[0].title : `${matched.length} Documents Selected`,
          unavailableReason: `The document "${processing.title}" is currently still being processed. Please wait for processing to finish or choose a ready document.`,
        };
      }

      const failed = matched.find((d) => d.extractionStatus === 'failed');
      if (failed) {
        return {
          mode: 'specific',
          documentIds: matched.map((d) => d.id),
          documentTitles: matched.map((d) => d.title),
          label: matched.length === 1 ? matched[0].title : `${matched.length} Documents Selected`,
          unavailableReason: `The document "${failed.title}" failed processing and cannot be retrieved.`,
        };
      }

      return {
        mode: 'specific',
        documentIds: matched.map((d) => d.id),
        documentTitles: matched.map((d) => d.title),
        label: matched.length === 1 ? matched[0].title : `${matched.length} Documents Selected`,
      };
    }
  }

  // 3. AUTOMATIC SCOPE DETECTION

  // 3a. Explicit comparison requests ("Compare my last two blood tests", etc.)
  const comp = isExplicitCompareRequest(message);
  if (comp.isCompare) {
    let eligible = userDocs;
    if (comp.type === 'lab_report') {
      eligible = userDocs.filter((d) => d.documentType === 'lab_report');
    } else if (comp.type === 'prescription') {
      eligible = userDocs.filter((d) => d.documentType === 'prescription');
    }

    if (eligible.length >= 2) {
      const selected = eligible.slice(0, 2);
      return {
        mode: 'specific',
        documentIds: selected.map((d) => d.id),
        documentTitles: selected.map((d) => d.title),
        label: `Comparison: ${selected[0].title} & ${selected[1].title}`,
      };
    } else if (eligible.length === 1) {
      return {
        mode: 'specific',
        documentIds: [eligible[0].id],
        documentTitles: [eligible[0].title],
        label: eligible[0].title,
      };
    } else {
      return {
        mode: 'all',
        label: 'Complete Medical History',
      };
    }
  }

  // 3b. Explicit "latest prescription" request
  if (isExplicitLatestPrescriptionRequest(message)) {
    const latestPrescription = userDocs.find((d) => d.documentType === 'prescription');
    if (latestPrescription) {
      return buildLatestDocResult(latestPrescription, 'Latest Prescription');
    }
    // Fall back to latest document if no explicit prescription type exists
    return buildLatestDocResult(userDocs[0], 'Latest Document');
  }

  // 3c. Explicit "latest lab report" request
  if (isExplicitLatestLabRequest(message)) {
    const latestLab = userDocs.find((d) => d.documentType === 'lab_report');
    if (latestLab) {
      return buildLatestDocResult(latestLab, 'Latest Lab Report');
    }
    return buildLatestDocResult(userDocs[0], 'Latest Document');
  }

  // 3d. Explicit "latest document / report" request
  if (isExplicitLatestDocumentRequest(message)) {
    return buildLatestDocResult(userDocs[0], 'Latest Document');
  }

  // 3e. Explicit "all history" request
  if (isExplicitAllHistoryRequest(message)) {
    return {
      mode: 'all',
      label: 'Complete Medical History',
    };
  }

  // 3f. Conversational follow-up inheritance
  // If this message is a follow-up ("What about the dosage?", "And the frequency?"),
  // inherit the active scope from the previous turn!
  if (priorTurns.length > 0 && isLikelyFollowUp(message)) {
    if (priorTurnSources.length > 0) {
      const inheritedDocIds = [...new Set(priorTurnSources.map((s) => s.documentId))];
      const validInherited = userDocs.filter((d) => inheritedDocIds.includes(d.id));

      if (validInherited.length > 0) {
        return {
          mode: 'specific',
          documentIds: validInherited.map((d) => d.id),
          documentTitles: validInherited.map((d) => d.title),
          label: validInherited.length === 1 ? validInherited[0].title : `${validInherited.length} Documents (Inherited)`,
        };
      }
    }
  }

  // 3g. Materially ambiguous query (e.g. "What medications am I taking right now?")
  // When user has multiple documents and no clear scope is established, ask clarification!
  if (userDocs.length > 1 && isMateriallyAmbiguousQuestion(message)) {
    const isMedQuestion = /\b(?:medication|medicine|drug|pill|prescription|taking)\b/i.test(message);
    const clarificationQuestion = isMedQuestion
      ? 'Would you like me to check your latest uploaded document or your complete medication history?'
      : 'Would you like me to check your latest uploaded document or your complete medical history?';

    return {
      mode: 'auto',
      label: 'Clarification Needed',
      clarification: {
        question: clarificationQuestion,
        options: [
          { label: 'Latest uploaded document', mode: 'latest' },
          { label: 'Complete medical history', mode: 'all' },
          { label: 'Choose a specific document', mode: 'specific' },
        ],
        originalQuestion: message,
      },
    };
  }

  // 3h. Default: If user has only 1 document, scope to that document directly
  if (userDocs.length === 1) {
    return buildLatestDocResult(userDocs[0], 'Latest Document');
  }

  // 3i. Fallback: Complete medical history
  return {
    mode: 'all',
    label: 'Complete Medical History',
  };
}
