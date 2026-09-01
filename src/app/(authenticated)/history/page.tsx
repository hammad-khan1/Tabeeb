"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Clock,
  Share2,
  Printer,
  Pill,
  AlertTriangle,
  Stethoscope,
  FileText,
  Loader2,
  Copy,
  CheckCircle2,
  FlaskConical,
  Link2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TimelineEvent {
  date: string;
  type: string;
  title: string;
  hospital?: string | null;
  doctorName?: string | null;
}

interface TimelineGroup {
  month: string;
  events: TimelineEvent[];
}

interface HistoryData {
  conditions: Array<{
    condition: string;
    icd10Code?: string | null;
    severity?: string | null;
    diagnosedDate?: string | null;
  }>;
  currentMedications: Array<{
    name: string;
    genericName?: string | null;
    dosage?: string | null;
    frequency?: string | null;
    route?: string | null;
    prescribedDate?: string | null;
  }>;
  allergies: Array<{
    allergen: string;
    allergyType?: string | null;
    severity?: string | null;
    reaction?: string | null;
  }>;
  recentLabResults: Array<{
    testName: string;
    value: string;
    numericValue?: number | null;
    unit?: string | null;
    referenceRange?: string | null;
    isAbnormal?: boolean | null;
    testDate: string;
  }>;
  visitTimeline: TimelineGroup[];
  documentCount: number;
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const eventTypeIcons: Record<string, React.ElementType> = {
  prescription: Pill,
  lab_report: FlaskConical,
  discharge_summary: Stethoscope,
  consultation_note: Stethoscope,
  other: FileText,
};

export default function HistoryPage() {
  const { data, isLoading } = useSWR<HistoryData>("/api/history", fetcher);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTitle, setShareTitle] = useState("My Medical History");
  const [shareExpiry, setShareExpiry] = useState("168");
  const [shareLink, setShareLink] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    setShareLoading(true);
    setShareError("");
    try {
      const res = await fetch("/api/history/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: shareTitle,
          expiresInHours: parseInt(shareExpiry),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create share link");
      }
      const result = await res.json();
      setShareLink(result.url);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <Clock className="mb-4 size-12 text-muted-foreground/50" />
        <h2 className="text-xl font-semibold">No history available</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload documents to build your medical history timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Medical History</h1>
          <p className="text-muted-foreground">
            {data.documentCount} document{data.documentCount !== 1 ? "s" : ""} on
            record
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 size-4" />
            Print
          </Button>
          <Button variant="outline" onClick={() => setShareDialogOpen(true)}>
            <Share2 className="mr-2 size-4" />
            Share
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Conditions
            </CardTitle>
            <Stethoscope className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.conditions.length}
            </div>
            {data.conditions.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {data.conditions
                  .slice(0, 2)
                  .map((c) => c.condition)
                  .join(", ")}
                {data.conditions.length > 2 ? ` +${data.conditions.length - 2} more` : ""}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Medications
            </CardTitle>
            <Pill className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.currentMedications.length}
            </div>
            {data.currentMedications.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {data.currentMedications
                  .slice(0, 2)
                  .map((m) => m.name)
                  .join(", ")}
                {data.currentMedications.length > 2
                  ? ` +${data.currentMedications.length - 2} more`
                  : ""}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Allergies
            </CardTitle>
            <AlertTriangle className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.allergies.length}</div>
            {data.allergies.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {data.allergies
                  .slice(0, 2)
                  .map((a) => a.allergen)
                  .join(", ")}
                {data.allergies.length > 2
                  ? ` +${data.allergies.length - 2} more`
                  : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      {data.visitTimeline.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Clock className="mb-3 size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No timeline events yet. Upload dated documents to build your
              timeline.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border print:left-[15px]" />

          <div className="space-y-8">
            {data.visitTimeline.map((group) => (
              <div key={group.month} className="relative">
                {/* Month header */}
                <div className="relative mb-4 flex items-center gap-4">
                  <div className="z-10 flex size-10 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground print:size-8">
                    <Clock className="size-4" />
                  </div>
                  <h2 className="text-lg font-semibold">
                    {formatMonth(group.month)}
                  </h2>
                </div>

                {/* Events */}
                <div className="ml-14 space-y-3 print:ml-12">
                  {group.events.map((event, i) => {
                    const EventIcon =
                      eventTypeIcons[event.type] ?? FileText;
                    return (
                      <Card key={i}>
                        <CardContent className="flex items-start gap-3 p-4">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <EventIcon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{event.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(event.date)}
                              {event.hospital ? ` \u00b7 ${event.hospital}` : ""}
                              {event.doctorName ? ` \u00b7 ${event.doctorName}` : ""}
                            </p>
                            <Badge variant="outline" className="mt-1 text-[10px]">
                              {DOCUMENT_TYPE_LABELS[event.type] ?? event.type}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Share Dialog */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Medical History</DialogTitle>
            <DialogDescription>
              Generate a secure, time-limited link to share your medical history
              with your doctor.
            </DialogDescription>
          </DialogHeader>

          {!shareLink ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="share-title">Title</Label>
                <Input
                  id="share-title"
                  value={shareTitle}
                  onChange={(e) => setShareTitle(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="share-expiry">Expires in (hours)</Label>
                <Input
                  id="share-expiry"
                  type="number"
                  min="1"
                  max="720"
                  value={shareExpiry}
                  onChange={(e) => setShareExpiry(e.target.value)}
                />
              </div>
              {shareError && (
                <p className="text-sm text-red-600">{shareError}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" />
                Share link created successfully.
              </div>
              <div className="flex gap-2">
                <Input value={shareLink} readOnly className="flex-1 text-xs" />
                <Button variant="outline" size="icon" onClick={handleCopy}>
                  {copied ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            {!shareLink ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShareDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleShare} disabled={shareLoading}>
                  {shareLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Link2 className="mr-2 size-4" />
                      Generate Link
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={() => {
                setShareDialogOpen(false);
                setShareLink("");
              }}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
