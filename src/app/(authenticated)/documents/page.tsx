"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileText,
  FlaskConical,
  Stethoscope,
  ScanLine,
  FilePlus,
  Mic,
  Upload,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { useDocuments } from "@/hooks/use-documents";

const typeIcons: Record<string, React.ElementType> = {
  prescription: FilePlus,
  lab_report: FlaskConical,
  discharge_summary: Stethoscope,
  imaging_report: ScanLine,
  consultation_note: Stethoscope,
  voice_entry: Mic,
  other: FileText,
};

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  processing: "secondary",
  needs_review: "destructive",
  confirmed: "default",
  failed: "destructive",
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DocumentsPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [hospitalFilter, setHospitalFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filters = {
    type: typeFilter !== "all" ? typeFilter : undefined,
    hospital: hospitalFilter || undefined,
    from: dateFrom || undefined,
    to: dateTo || undefined,
  };

  const { documents, isLoading } = useDocuments(filters);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Manage and review your medical documents.
          </p>
        </div>
        <Button render={<Link href="/documents/upload" />}>
          <Upload className="me-2 size-4" />
          Upload
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Document Type
            </label>
            <Select value={typeFilter} onValueChange={(val) => val && setTypeFilter(val)}>
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Hospital
            </label>
            <div className="relative">
              <Search className="absolute start-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search hospital..."
                value={hospitalFilter}
                onChange={(e) => setHospitalFilter(e.target.value)}
                className="ps-8"
              />
            </div>
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              From
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              To
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Document Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="space-y-3">
                  <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
              <FileText className="size-7 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">No documents found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {typeFilter !== "all" || hospitalFilter || dateFrom || dateTo
                ? "Try adjusting your filters."
                : "Upload your first medical document to get started."}
            </p>
            {!typeFilter && !hospitalFilter && !dateFrom && !dateTo && (
              <Button className="mt-4" render={<Link href="/documents/upload" />}>
                <Upload className="me-2 size-4" />
                Upload Document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => {
            const Icon = typeIcons[doc.documentType] ?? FileText;
            return (
              <Link key={doc.id} href={`/documents/${doc.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold">
                          {doc.title}
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {doc.documentDate
                          ? formatDate(doc.documentDate as string)
                          : formatDate(doc.createdAt as string)}
                        {doc.hospital ? ` \u00b7 ${doc.hospital}` : ""}
                      </span>
                      <Badge
                        variant={statusVariant[doc.extractionStatus as string] ?? "secondary"}
                        className="text-[10px]"
                      >
                        {doc.extractionStatus as string}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
