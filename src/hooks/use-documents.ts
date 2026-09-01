"use client";

import useSWR, { mutate } from "swr";
import { useCallback } from "react";

interface DocumentFilters {
  type?: string;
  hospital?: string;
  from?: string;
  to?: string;
  search?: string;
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
  storagePath: string;
  extractionStatus: string;
  rawExtractedText: string | null;
  structuredData: Record<string, unknown> | null;
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
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useDocuments(filters?: DocumentFilters) {
  const key = `/api/documents${buildQueryString(filters)}`;

  const { data, error, isLoading, isValidating } = useSWR<DocumentRecord[]>(
    key,
    fetcher
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
    documents: data ?? [],
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
