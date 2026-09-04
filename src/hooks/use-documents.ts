"use client";

import useSWR, { mutate } from "swr";
import { useCallback } from "react";

interface DocumentFilters {
  type?: string;
  hospital?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface DocumentRecord {
  id: string;
  userId: string;
  title: string;
  documentType: string;
  hospital: string | null;
  doctorName: string | null;
  documentDate: string | null;
  language: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  extractionStatus: string;
  // Only returned by the single-document endpoint; the list omits both to keep the
  // payload small.
  rawExtractedText?: string | null;
  structuredData?: Record<string, unknown> | null;
  /** Authenticated download URL; the file is no longer served statically. */
  fileUrl?: string;
  summary: string | null;
  extractionConfidence: number | null;
  extractionNotes: string | null;
  isHandwritten: boolean;
  isScannedPdf: boolean;
  createdAt: string;
  updatedAt: string;
}

function buildQueryString(filters?: DocumentFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.hospital) params.set("hospital", filters.hospital);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.search) params.set("search", filters.search);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function fetcher(url: string) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}

interface DocumentListResponse {
  documents: DocumentRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function useDocuments(filters?: DocumentFilters) {
  const key = `/api/documents${buildQueryString(filters)}`;

  const { data, error, isLoading, isValidating } = useSWR<DocumentListResponse>(
    key,
    fetcher,
    {
      // A document is processed in the background, so its status changes after the
      // upload response has already been returned.
      refreshInterval: (latest) =>
        latest?.documents.some(
          (d) => d.extractionStatus === "pending" || d.extractionStatus === "processing"
        )
          ? 4000
          : 0,
    }
  );

  const uploadDocument = useCallback(
    async (formData: FormData): Promise<DocumentRecord> => {
      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const doc = await res.json();
      await mutate(key);
      return doc;
    },
    [key]
  );

  return {
    documents: data?.documents ?? [],
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,
    error,
    isLoading,
    isValidating,
    uploadDocument,
  };
}

export function useDocument(id: string | null) {
  const key = id ? `/api/documents/${id}` : null;

  const { data, error, isLoading, isValidating } = useSWR<DocumentRecord>(
    key,
    fetcher
  );

  const updateDocument = useCallback(
    async (updates: Record<string, unknown>): Promise<DocumentRecord> => {
      if (!id) throw new Error("No document ID");
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Update failed");
      }
      const doc = await res.json();
      await mutate(key);
      await mutate((k: string) => k?.startsWith("/api/documents"), undefined, {
        revalidate: true,
      });
      return doc;
    },
    [id, key]
  );

  const deleteDocument = useCallback(async (): Promise<void> => {
    if (!id) throw new Error("No document ID");
    const res = await fetch(`/api/documents/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Delete failed");
    }
    await mutate(
      (k: string) => k?.startsWith("/api/documents"),
      undefined,
      { revalidate: true }
    );
  }, [id]);

  const confirmExtraction = useCallback(
    async (
      correctedText?: string,
      structuredData?: Record<string, unknown>
    ): Promise<DocumentRecord> => {
      if (!id) throw new Error("No document ID");
      const res = await fetch(`/api/documents/${id}/confirm-extraction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correctedText, structuredData }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Confirm failed");
      }
      const doc = await res.json();
      await mutate(key);
      return doc;
    },
    [id, key]
  );

  return {
    document: data,
    error,
    isLoading,
    isValidating,
    updateDocument,
    deleteDocument,
    confirmExtraction,
  };
}
