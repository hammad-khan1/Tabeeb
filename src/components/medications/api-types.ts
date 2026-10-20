import type {
  InteractionCoverage,
  MedicationRecord,
  MedicationStatus,
  MedicationTimelineEvent,
  SafetyFinding,
} from '@/services/medications/types';

export interface MedicationPagination {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface MedicationAuditEntry {
  id: string;
  medicationId: string | null;
  findingId: string | null;
  action: string;
  note: string | null;
  createdAt: string;
  before?: unknown;
  after?: unknown;
}

export interface MedicationDashboardResponse {
  medications: MedicationRecord[];
  pagination: MedicationPagination;
  counts: Record<MedicationStatus, number>;
  documents: Array<{ id: string; title: string; documentDate: string | null }>;
  medicationOptions: Array<{ id: string; name: string; status: MedicationStatus }>;
  interactionCheck: InteractionCoverage;
  limitations: string[];
  truncated?: boolean;
}

export interface MedicationDetailsResponse {
  medication: MedicationRecord;
  audit: MedicationAuditEntry[];
  events: MedicationTimelineEvent[];
  findings: SafetyFinding[];
}

export interface MedicationFindingsResponse {
  findings: SafetyFinding[];
  pagination: MedicationPagination;
}

export interface MedicationTimelineResponse {
  events: MedicationTimelineEvent[];
  pagination: MedicationPagination;
}
