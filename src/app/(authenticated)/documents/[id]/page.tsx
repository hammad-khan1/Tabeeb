"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  FlaskConical,
  Stethoscope,
  ScanLine,
  FilePlus,
  Mic,
  Trash2,
  CheckCircle2,
  Loader2,
  Pill,
  AlertTriangle,
  Calendar,
  Building2,
  User,
  Globe,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { useDocument } from "@/hooks/use-documents";
import type { Medication, Diagnosis, LabResult, Allergy } from "@/types/medical";

interface ImagingFinding {
  id: string;
  bodyPart: string;
  modality: string | null;
  finding: string;
  location: string | null;
  severity: string | null;
  description: string | null;
  aiConfidence: number | null;
  urgencyLevel: string | null;
  validationNotes: string | null;
  validated: boolean;
}

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

function formatDate(dateStr: string | null) {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const {
    document: doc,
    isLoading,
    deleteDocument,
    confirmExtraction,
  } = useDocument(id);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [correctedText, setCorrectedText] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="space-y-4">
          <div className="h-6 w-48 animate-pulse rounded bg-muted" />
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-96 animate-pulse rounded-xl bg-muted" />
            <div className="h-96 animate-pulse rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center py-16 text-center">
        <FileText className="mb-4 size-12 text-muted-foreground/50" />
        <h2 className="text-xl font-semibold">Document not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This document may have been deleted or does not exist.
        </p>
        <Button className="mt-4" variant="outline" render={<Link href="/documents" />}>
          Back to Documents
        </Button>
      </div>
    );
  }

  const structured = doc.structuredData as {
    medications?: Medication[];
    diagnoses?: Diagnosis[];
    labResults?: LabResult[];
    allergies?: Allergy[];
  } | null;

  const imagingFindingsList = (doc as unknown as { imagingFindings?: ImagingFinding[] }).imagingFindings ?? [];
  const isImagingDoc = doc.documentType === "imaging_report";

  const Icon = typeIcons[doc.documentType] ?? FileText;
  const needsReview = doc.extractionStatus === "needs_review";

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteDocument();
      router.push("/documents");
    } catch {
      setIsDeleting(false);
    }
  };

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await confirmExtraction(
        correctedText !== doc.rawExtractedText ? correctedText : undefined
      );
    } catch {
      // Error handling
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Back + Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" render={<Link href="/documents" />}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{doc.title}</h1>
              <p className="text-sm text-muted-foreground">
                {DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant[doc.extractionStatus] ?? "secondary"}>
            {doc.extractionStatus}
          </Badge>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="me-2 size-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {doc.summary && (
        <Card className="mb-6 border-primary/20 bg-primary/[0.03]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" />
              What this document says
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {doc.summary
              .split(/\n{2,}/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph, index) => (
                <p key={index} className="text-sm leading-relaxed">
                  {paragraph}
                </p>
              ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Written for you from your own document. Always confirm details with your
              doctor.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Split Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Metadata */}
        <div className="space-y-4">
          {/* The original scan. Files live outside ./public now, so this goes through
              the authenticated route that re-checks ownership on every request. */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Original document</CardTitle>
              <a
                href={`/api/documents/${id}/file?download=1`}
                className="text-sm text-primary underline underline-offset-4"
              >
                Download
              </a>
            </CardHeader>
            <CardContent>
              {String(doc.mimeType).startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/documents/${id}/file`}
                  alt={`Scan of ${doc.title}`}
                  className="max-h-[28rem] w-full rounded-md border object-contain"
                />
              ) : doc.mimeType === "application/pdf" ? (
                <iframe
                  src={`/api/documents/${id}/file`}
                  title={`Scan of ${doc.title}`}
                  className="h-[28rem] w-full rounded-md border"
                />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {String(doc.fileName)} cannot be previewed here. Use Download to open it.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Document Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Calendar className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">Date:</span>
                <span className="font-medium">
                  {formatDate(doc.documentDate as string | null)}
                </span>
              </div>
              {doc.hospital && (
                <div className="flex items-center gap-3 text-sm">
                  <Building2 className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Hospital:</span>
                  <span className="font-medium">{doc.hospital}</span>
                </div>
              )}
              {doc.doctorName && (
                <div className="flex items-center gap-3 text-sm">
                  <User className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Doctor:</span>
                  <span className="font-medium">{doc.doctorName}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm">
                <Globe className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">Language:</span>
                <span className="font-medium uppercase">{doc.language}</span>
              </div>
              <Separator />
              <div className="text-sm">
                <span className="text-muted-foreground">File:</span>{" "}
                <span className="font-medium">{doc.fileName}</span>{" "}
                <span className="text-muted-foreground">
                  ({formatFileSize(doc.fileSize)})
                </span>
              </div>
              {doc.extractionConfidence !== null && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Confidence:</span>{" "}
                  <span className="font-medium">
                    {doc.extractionConfidence}%
                  </span>
                </div>
              )}
              {doc.extractionNotes && (
                <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  {doc.extractionNotes}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Raw Extracted Text */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Extracted Text</CardTitle>
            </CardHeader>
            <CardContent>
              {needsReview ? (
                <div className="space-y-3">
                  <p className="text-xs text-amber-700">
                    This text needs your review. Edit if needed, then confirm.
                  </p>
                  <Textarea
                    value={
                      correctedText || doc.rawExtractedText || ""
                    }
                    onChange={(e) => setCorrectedText(e.target.value)}
                    rows={12}
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={handleConfirm}
                    disabled={isConfirming}
                    size="sm"
                  >
                    {isConfirming ? (
                      <>
                        <Loader2 className="me-2 size-3.5 animate-spin" />
                        Confirming...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="me-2 size-3.5" />
                        Confirm Extraction
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-64">
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {doc.rawExtractedText || "No text extracted yet."}
                  </pre>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Structured Data */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Structured Data</CardTitle>
            </CardHeader>
            <CardContent>
              {!structured ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <FileText className="mb-3 size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {doc.extractionStatus === "processing"
                      ? "Processing document..."
                      : doc.extractionStatus === "pending"
                        ? "Waiting to be processed."
                        : "No structured data extracted yet."}
                  </p>
                </div>
              ) : (
                <Tabs defaultValue={isImagingDoc ? "imaging" : "medications"}>
                  <TabsList className={`grid w-full ${isImagingDoc ? "grid-cols-5" : "grid-cols-4"}`}>
                    {isImagingDoc && (
                      <TabsTrigger value="imaging" className="text-xs">
                        Imaging
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="medications" className="text-xs">
                      Meds
                    </TabsTrigger>
                    <TabsTrigger value="diagnoses" className="text-xs">
                      Diagnoses
                    </TabsTrigger>
                    <TabsTrigger value="labs" className="text-xs">
                      Labs
                    </TabsTrigger>
                    <TabsTrigger value="allergies" className="text-xs">
                      Allergies
                    </TabsTrigger>
                  </TabsList>

                  {isImagingDoc && (
                    <TabsContent value="imaging" className="mt-4 space-y-3">
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        <AlertTriangle className="me-1.5 inline size-3.5" />
                        AI-assisted analysis only. Not a substitute for professional radiological interpretation.
                      </div>
                      {imagingFindingsList.length > 0 ? (
                        <div className="space-y-2">
                          {imagingFindingsList.map((f) => (
                            <div
                              key={f.id}
                              className={`rounded-lg border p-3 ${
                                f.urgencyLevel === "critical" || f.urgencyLevel === "urgent"
                                  ? "border-red-200 bg-red-50"
                                  : ""
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{f.finding}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {[f.bodyPart, f.location].filter(Boolean).join(" — ")}
                                  </p>
                                  {f.description && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {f.description}
                                    </p>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  {f.severity && (
                                    <Badge
                                      variant={
                                        f.severity === "critical" || f.severity === "severe"
                                          ? "destructive"
                                          : "secondary"
                                      }
                                      className="text-[10px]"
                                    >
                                      {f.severity}
                                    </Badge>
                                  )}
                                  {f.aiConfidence !== null && (
                                    <span className="text-[10px] text-muted-foreground">
                                      {f.aiConfidence}% conf.
                                    </span>
                                  )}
                                </div>
                              </div>
                              {f.validationNotes && (
                                <p className="mt-2 text-[10px] text-muted-foreground italic">
                                  {f.validationNotes}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-sm text-muted-foreground">
                          No imaging findings detected.
                        </p>
                      )}
                    </TabsContent>
                  )}

                  <TabsContent value="medications" className="mt-4">
                    {structured.medications && structured.medications.length > 0 ? (
                      <div className="space-y-2">
                        {structured.medications.map((med, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 rounded-lg border p-3"
                          >
                            <Pill className="mt-0.5 size-4 shrink-0 text-primary" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{med.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {[med.dosage, med.frequency, med.route, med.duration]
                                  .filter(Boolean)
                                  .join(" | ")}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-sm text-muted-foreground">
                        No medications found.
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="diagnoses" className="mt-4">
                    {structured.diagnoses && structured.diagnoses.length > 0 ? (
                      <div className="space-y-2">
                        {structured.diagnoses.map((diag, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 rounded-lg border p-3"
                          >
                            <Stethoscope className="mt-0.5 size-4 shrink-0 text-primary" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">
                                {diag.condition}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {[diag.severity, diag.diagnosedDate]
                                  .filter(Boolean)
                                  .join(" | ")}
                              </p>
                              {diag.notes && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {diag.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-sm text-muted-foreground">
                        No diagnoses found.
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="labs" className="mt-4">
                    {structured.labResults && structured.labResults.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-start text-xs text-muted-foreground">
                              <th className="pb-2 pe-3">Test</th>
                              <th className="pb-2 pe-3">Value</th>
                              <th className="pb-2 pe-3">Range</th>
                              <th className="pb-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {structured.labResults.map((lab, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-2 pe-3 font-medium">
                                  {lab.testName}
                                </td>
                                <td className="py-2 pe-3">
                                  {lab.value}
                                  {lab.unit ? ` ${lab.unit}` : ""}
                                </td>
                                <td className="py-2 pe-3 text-muted-foreground">
                                  {lab.referenceRange ?? "N/A"}
                                </td>
                                <td className="py-2">
                                  {lab.isAbnormal ? (
                                    <Badge
                                      variant="destructive"
                                      className="text-[10px]"
                                    >
                                      <AlertTriangle className="me-1 size-3" />
                                      Abnormal
                                    </Badge>
                                  ) : (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px]"
                                    >
                                      Normal
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-center text-sm text-muted-foreground">
                        No lab results found.
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="allergies" className="mt-4">
                    {structured.allergies && structured.allergies.length > 0 ? (
                      <div className="space-y-2">
                        {structured.allergies.map((allergy, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3"
                          >
                            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">
                                {allergy.allergen}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {[allergy.allergyType, allergy.severity]
                                  .filter(Boolean)
                                  .join(" | ")}
                              </p>
                              {allergy.reaction && (
                                <p className="mt-1 text-xs text-red-700">
                                  Reaction: {allergy.reaction}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-sm text-muted-foreground">
                        No allergies found.
                      </p>
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{doc.title}&quot;? This action
              cannot be undone and will also remove all extracted data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="me-2 size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="me-2 size-4" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
