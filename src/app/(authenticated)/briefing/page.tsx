"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  Eye,
  FileCheck2,
  FileText,
  FlaskConical,
  HelpCircle,
  Link2,
  Loader2,
  Pill,
  Plus,
  Printer,
  Search,
  Share2,
  ShieldAlert,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type {
  PatientBriefingData,
  DoctorProfile,
} from "@/services/briefing/types";
import { SourceDocumentViewer } from "@/components/briefing/source-document-viewer";

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error("Failed to load briefing data");
  return res.json();
});

export default function BriefingPage() {
  // Query parameters state
  const [datePreset, setDatePreset] = useState<string>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  // Timeline / List filters
  const [selectedDoctorFilter, setSelectedDoctorFilter] = useState<string>("all");
  const [selectedSpecialtyFilter, setSelectedSpecialtyFilter] = useState<string>("all");
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Construct API URL
  const queryParams = new URLSearchParams();
  if (datePreset !== "all" && datePreset !== "custom") {
    queryParams.set("preset", datePreset);
  } else if (datePreset === "custom") {
    if (customFrom) queryParams.set("from", customFrom);
    if (customTo) queryParams.set("to", customTo);
  }

  const briefingUrl = `/api/briefing${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
  const { data: briefing, error, isLoading, mutate } = useSWR<PatientBriefingData>(briefingUrl, fetcher);

  // Sharing links state & query
  const { data: shareLinks, mutate: mutateShareLinks } = useSWR<Array<{
    token: string;
    url: string;
    title: string | null;
    expiresAt: string;
    isActive: boolean;
    viewCount: number;
    lastViewedAt: string | null;
    isExpired: boolean;
  }>>("/api/briefing/share", fetcher);

  // Dialogs
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [doctorModalOpen, setDoctorModalOpen] = useState(false);
  const [selectedDoctorForEdit, setSelectedDoctorForEdit] = useState<DoctorProfile | null>(null);

  // PDF Export loading
  const [pdfDownloading, setPdfDownloading] = useState(false);

  // Share form state
  const [shareTitle, setShareTitle] = useState("Doctor-Ready Health Briefing");
  const [shareHours, setShareHours] = useState("168");
  const [shareLoading, setShareLoading] = useState(false);
  const [generatedShareUrl, setGeneratedShareUrl] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState("");
  const [selectedSections, setSelectedSections] = useState<Record<string, boolean>>({
    summary: true,
    doctors: true,
    medications: true,
    allergies: true,
    labs: true,
    trends: true,
    conflicts: true,
    questions: true,
    timeline: true,
    citations: true,
  });

  // Doctor Form State
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpecialty, setDoctorSpecialty] = useState("");
  const [doctorHospital, setDoctorHospital] = useState("");
  const [doctorContact, setDoctorContact] = useState("");
  const [doctorNotes, setDoctorNotes] = useState("");
  const [doctorSaving, setDoctorSaving] = useState(false);
  const [doctorError, setDoctorError] = useState("");

  // Document Viewer State
  const [viewerState, setViewerState] = useState<{
    isOpen: boolean;
    documentId: string;
    documentTitle: string;
    documentDate?: string | null;
    fileUrl: string;
    mimeType?: string | null;
    pageNumber?: number | null;
    doctorName?: string | null;
    hospital?: string | null;
    excerpt?: string | null;
    highlightTerm?: string | null;
    entityContext?: {
      entityType: "medication" | "lab" | "condition" | "conflict" | "timeline";
      name: string;
      value?: string | null;
      details?: string | null;
    };
  }>({
    isOpen: false,
    documentId: "",
    documentTitle: "",
    fileUrl: "",
  });

  const openSourceViewer = (params: {
    documentId: string;
    documentTitle?: string;
    documentDate?: string | null;
    pageNumber?: number | null;
    mimeType?: string | null;
    doctorName?: string | null;
    hospital?: string | null;
    excerpt?: string | null;
    highlightTerm?: string | null;
    entityContext?: {
      entityType: "medication" | "lab" | "condition" | "conflict" | "timeline";
      name: string;
      value?: string | null;
      details?: string | null;
    };
  }) => {
    setViewerState({
      isOpen: true,
      documentId: params.documentId,
      documentTitle: params.documentTitle || "Medical Record",
      documentDate: params.documentDate,
      fileUrl: `/api/documents/${params.documentId}/file`,
      mimeType: params.mimeType,
      pageNumber: params.pageNumber,
      doctorName: params.doctorName,
      hospital: params.hospital,
      excerpt: params.excerpt,
      highlightTerm: params.highlightTerm,
      entityContext: params.entityContext,
    });
  };

  const handleDownloadPdf = async () => {
    try {
      setPdfDownloading(true);
      const res = await fetch("/api/briefing/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: queryParams.get("from") || undefined,
          to: queryParams.get("to") || undefined,
        }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tabeeb-patient-briefing-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error(err);
      alert("Failed to download PDF briefing. Please try again.");
    } finally {
      setPdfDownloading(false);
    }
  };

  const handleCreateShareLink = async () => {
    setShareLoading(true);
    setShareError("");
    try {
      const activeSections = Object.entries(selectedSections)
        .filter(([, checked]) => checked)
        .map(([k]) => k);

      const res = await fetch("/api/briefing/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: shareTitle,
          expiresInHours: parseInt(shareHours) || 168,
          includedSections: activeSections,
          dateRangeFrom: queryParams.get("from") || undefined,
          dateRangeTo: queryParams.get("to") || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create share link");
      }

      const result = await res.json();
      setGeneratedShareUrl(result.url);
      mutateShareLinks();
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : "Failed to generate share link");
    } finally {
      setShareLoading(false);
    }
  };

  const handleRevokeShareLink = async (token: string) => {
    if (!confirm("Are you sure you want to revoke access? The link will stop working immediately.")) return;
    try {
      const res = await fetch(`/api/briefing/share/${token}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to revoke link");
      mutateShareLinks();
    } catch (err) {
      console.error(err);
      alert("Failed to revoke link");
    }
  };

  const handleSaveDoctor = async () => {
    if (!doctorName.trim()) {
      setDoctorError("Doctor name is required");
      return;
    }
    setDoctorSaving(true);
    setDoctorError("");
    try {
      if (selectedDoctorForEdit && !selectedDoctorForEdit.id.startsWith("extracted-")) {
        // Edit existing patient doctor
        const res = await fetch(`/api/briefing/doctors/${selectedDoctorForEdit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: doctorName,
            specialty: doctorSpecialty || null,
            hospital: doctorHospital || null,
            contactInfo: doctorContact || null,
            notes: doctorNotes || null,
          }),
        });
        if (!res.ok) throw new Error("Failed to update doctor record");
      } else {
        // Create new or override extracted doctor
        const res = await fetch("/api/briefing/doctors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: doctorName,
            specialty: doctorSpecialty || null,
            hospital: doctorHospital || null,
            contactInfo: doctorContact || null,
            notes: doctorNotes || null,
          }),
        });
        if (!res.ok) throw new Error("Failed to save doctor record");
      }

      setDoctorModalOpen(false);
      setSelectedDoctorForEdit(null);
      resetDoctorForm();
      mutate();
    } catch (err: unknown) {
      setDoctorError(err instanceof Error ? err.message : "Error saving doctor");
    } finally {
      setDoctorSaving(false);
    }
  };

  const resetDoctorForm = () => {
    setDoctorName("");
    setDoctorSpecialty("");
    setDoctorHospital("");
    setDoctorContact("");
    setDoctorNotes("");
    setDoctorError("");
  };

  const openAddDoctorModal = () => {
    resetDoctorForm();
    setSelectedDoctorForEdit(null);
    setDoctorModalOpen(true);
  };

  const openEditDoctorModal = (doc: DoctorProfile) => {
    setSelectedDoctorForEdit(doc);
    setDoctorName(doc.name);
    setDoctorSpecialty(doc.specialty || "");
    setDoctorHospital(doc.hospital || "");
    setDoctorContact(doc.contactInfo || "");
    setDoctorNotes(doc.notes || "");
    setDoctorError("");
    setDoctorModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 animate-pulse">
        <div className="h-10 w-64 rounded-lg bg-muted" />
        <div className="h-28 rounded-xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-96 rounded-xl bg-muted" />
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center space-y-4">
        <AlertTriangle className="mx-auto size-12 text-destructive" />
        <h2 className="text-xl font-semibold">Unable to load briefing</h2>
        <p className="text-sm text-muted-foreground">
          {error?.message || "An error occurred while compiling your medical briefing. Please try again."}
        </p>
        <Button onClick={() => mutate()}>Retry</Button>
      </div>
    );
  }

  // Filtered timeline
  const filteredTimeline = briefing.doctorTimeline.filter((ev) => {
    if (selectedDoctorFilter !== "all" && ev.doctorName.toLowerCase() !== selectedDoctorFilter.toLowerCase()) return false;
    if (selectedSpecialtyFilter !== "all" && ev.doctorSpecialty?.toLowerCase() !== selectedSpecialtyFilter.toLowerCase()) return false;
    if (timelineTypeFilter !== "all" && ev.type !== timelineTypeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match = ev.title.toLowerCase().includes(q) ||
        ev.description.toLowerCase().includes(q) ||
        ev.doctorName.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const uniqueSpecialties = Array.from(
    new Set(briefing.doctors.map((d) => d.specialty).filter(Boolean))
  ) as string[];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12 print:space-y-4">
      {/* Top Header & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary mb-1">
            <ClipboardCheck className="size-3.5" />
            Clinical Briefing & Provider Tracking
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Doctor-Ready Patient Briefing
          </h1>
          <p className="text-sm text-muted-foreground">
            Evidence-backed medical summary, cross-doctor treatment reference tracking, and consultation preparation.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openAddDoctorModal}
            className="gap-1.5"
          >
            <UserPlus className="size-4" />
            <span className="hidden sm:inline">Add Doctor</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="gap-1.5"
          >
            <Printer className="size-4" />
            <span className="hidden sm:inline">Print</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPdf}
            disabled={pdfDownloading}
            className="gap-1.5"
          >
            {pdfDownloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Download PDF
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setGeneratedShareUrl("");
              setShareDialogOpen(true);
            }}
            className="gap-1.5"
          >
            <Share2 className="size-4" />
            Share with Doctor
          </Button>
        </div>
      </div>

      {/* Date Range & Controls Banner */}
      <Card className="print:hidden">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
              <Calendar className="size-3.5" /> Covered Range:
            </span>
            {[
              { id: "all", label: "All Records" },
              { id: "30d", label: "Past 30 Days" },
              { id: "90d", label: "Past 3 Months" },
              { id: "180d", label: "Past 6 Months" },
              { id: "1y", label: "Past 1 Year" },
              { id: "custom", label: "Custom Dates" },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setDatePreset(preset.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                  datePreset === preset.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {datePreset === "custom" && (
            <div className="flex items-center gap-2 text-xs">
              <div>
                <Label htmlFor="custom-from" className="text-[10px] text-muted-foreground">From</Label>
                <Input
                  id="custom-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label htmlFor="custom-to" className="text-[10px] text-muted-foreground">To</Label>
                <Input
                  id="custom-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{briefing.documentCount}</span> document{briefing.documentCount === 1 ? "" : "s"} included
          </div>
        </CardContent>
      </Card>

      {/* Overview Stat Cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Attending Doctors</span>
            <UserCheck className="size-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{briefing.doctors.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {briefing.doctors.map((d) => d.name).slice(0, 2).join(", ") || "No doctors noted"}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Current Medications</span>
            <Pill className="size-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{briefing.currentMedications.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {briefing.historicalMedications.length} historical / discontinued
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active Conditions</span>
            <Stethoscope className="size-4 text-primary" />
          </div>
          <div className="mt-2 text-2xl font-bold">{briefing.conditions.length}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {briefing.allergies.length} documented allergies
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Clinical Alerts</span>
            <ShieldAlert className="size-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {briefing.treatmentConflicts.length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {briefing.labTrends.filter((t) => t.latestIsAbnormal).length} abnormal lab readings
          </p>
        </Card>
      </div>

      {/* Executive Clinical Digest Box */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5">
          <h2 className="text-xs font-bold text-primary uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <FileText className="size-3.5" />
            Executive Clinical Summary
          </h2>
          <p className="text-sm leading-relaxed text-foreground">
            {briefing.clinicalSummary}
          </p>
        </CardContent>
      </Card>

      {/* Main Feature Tabs */}
      <Tabs defaultValue="briefing" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 max-w-2xl print:hidden">
          <TabsTrigger value="briefing" className="text-xs sm:text-sm">
            Briefing & Report
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs sm:text-sm">
            Doctor Timeline
          </TabsTrigger>
          <TabsTrigger value="doctors" className="text-xs sm:text-sm">
            Doctor Directory
          </TabsTrigger>
          <TabsTrigger value="sharing" className="text-xs sm:text-sm">
            Secure Shares ({shareLinks?.filter((l) => l.isActive && !l.isExpired).length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: BRIEFING & REPORT ───────────────────────────────────── */}
        <TabsContent value="briefing" className="space-y-6">
          {/* 1. Potential Treatment Discrepancies & Duplicate Therapies */}
          {briefing.treatmentConflicts.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-amber-900 dark:text-amber-400 flex items-center gap-2">
                  <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400" />
                  Potential Treatment Conflicts Flagged for Review ({briefing.treatmentConflicts.length})
                </CardTitle>
                <CardDescription className="text-xs text-amber-800/80 dark:text-amber-300/80">
                  Detected cross-doctor medication overlaps or duplicate therapeutic classes. Do not alter doses without clinical guidance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {briefing.treatmentConflicts.map((conf) => (
                  <div key={conf.id} className="p-4 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-background space-y-2 text-sm shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{conf.title}</span>
                      <Badge variant={conf.severity === "high" ? "destructive" : "secondary"} className="uppercase text-[10px]">
                        {conf.severity} Priority
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{conf.description}</p>
                    <div className="rounded bg-muted/50 p-2 text-xs font-medium text-amber-900 dark:text-amber-300">
                      Recommendation: {conf.recommendation}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Sources: {conf.sourceCitations.join(" · ")}
                    </div>
                    {conf.sourceDocumentIds && conf.sourceDocumentIds.length > 0 && (
                      <div className="pt-2 flex items-center gap-2 flex-wrap">
                        {conf.sourceDocumentIds.map((docId, idx) => (
                          <Button
                            key={docId}
                            variant="outline"
                            size="sm"
                            onClick={() => openSourceViewer({
                              documentId: docId,
                              documentTitle: `Prescription Record ${idx + 1}`,
                              highlightTerm: conf.involvedMedications[0],
                              entityContext: {
                                entityType: "conflict",
                                name: conf.title,
                                details: conf.recommendation,
                              },
                            })}
                            className="text-[11px] h-6 px-2 gap-1 text-primary hover:text-primary print:hidden"
                          >
                            <Eye className="size-3" />
                            Verify Source Record {conf.sourceDocumentIds && conf.sourceDocumentIds.length > 1 ? `#${idx + 1}` : ""}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 2. Attending Doctors Directory Overview */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <UserCheck className="size-4.5 text-primary" />
                  Healthcare Professionals Involved in Care ({briefing.doctors.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Doctors identified from prescriptions, lab orders, and patient records.
                </CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={openAddDoctorModal} className="h-8 text-xs gap-1">
                <Plus className="size-3.5" /> Add Doctor
              </Button>
            </CardHeader>
            <CardContent>
              {briefing.doctors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No doctors identified in available records. Click &quot;Add Doctor&quot; to manually record your healthcare provider.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {briefing.doctors.map((doc) => (
                    <div key={doc.id} className="p-3.5 rounded-lg border bg-card/60 space-y-2 text-sm shadow-sm flex flex-col justify-between">
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-1">
                          <span className="font-semibold text-foreground">Dr. {doc.name}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {doc.sourceType === "verified"
                              ? "Verified"
                              : doc.sourceType === "patient_entered"
                              ? "Patient Entered"
                              : "From Record"}
                          </Badge>
                        </div>
                        <p className="text-xs text-primary font-medium">{doc.specialty || "Specialty not specified"}</p>
                        {doc.hospital && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Building2 className="size-3 shrink-0" />
                            <span className="truncate">{doc.hospital}</span>
                          </p>
                        )}
                        {doc.contactInfo && (
                          <p className="text-xs text-muted-foreground truncate">Contact: {doc.contactInfo}</p>
                        )}
                      </div>
                      <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                        <span>{doc.prescriptionsCount} Rx · {doc.labOrdersCount} Labs</span>
                        <button
                          type="button"
                          onClick={() => openEditDoctorModal(doc)}
                          className="text-primary hover:underline font-medium text-xs"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3. Current Medications & Prescribing Attribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Pill className="size-4.5 text-primary" />
                Current Medications & Prescribing Attribution ({briefing.currentMedications.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Active prescriptions with doctor, strength, instructions, and source evidence.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {briefing.currentMedications.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No active medications found in selected records.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <th className="py-2.5 pe-4">Medication</th>
                        <th className="py-2.5 pe-4">Dosage / Instructions</th>
                        <th className="py-2.5 pe-4">Prescribing Doctor</th>
                        <th className="py-2.5 pe-4">Hospital / Facility</th>
                        <th className="py-2.5">Source Evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {briefing.currentMedications.map((med) => (
                        <tr key={med.id} className="hover:bg-muted/40 transition">
                          <td className="py-2.5 pe-4 font-medium text-foreground">
                            {med.name}
                            {med.genericName && (
                              <span className="block text-xs text-muted-foreground font-normal">
                                Active Ingredient: {med.genericName}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pe-4 text-xs text-muted-foreground">
                            {[med.dosage, med.frequency, med.route].filter(Boolean).join(" · ") || "Instructions unrecorded"}
                          </td>
                          <td className="py-2.5 pe-4 text-xs">
                            <span className={med.prescribingDoctor.isIdentified ? "font-semibold text-foreground" : "italic text-muted-foreground"}>
                              {med.prescribingDoctor.name}
                            </span>
                            {med.prescribingDoctor.specialty && (
                              <span className="block text-[11px] text-muted-foreground">
                                {med.prescribingDoctor.specialty}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pe-4 text-xs text-muted-foreground">
                            {med.hospital || "Not documented"}
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col gap-1 items-start">
                              <span>
                                {med.sourceCitation}
                                {med.pageNumber && (
                                  <span className="ms-1 font-mono text-[11px] text-primary">(p. {med.pageNumber})</span>
                                )}
                              </span>
                              {med.sourceDocumentId && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openSourceViewer({
                                    documentId: med.sourceDocumentId,
                                    documentTitle: med.sourceDocumentTitle,
                                    documentDate: med.sourceDocumentDate,
                                    pageNumber: med.pageNumber,
                                    mimeType: med.mimeType,
                                    highlightTerm: med.name,
                                    entityContext: {
                                      entityType: "medication",
                                      name: med.name,
                                      value: [med.dosage, med.frequency].filter(Boolean).join(" · "),
                                      details: `Prescribed by ${med.prescribingDoctor.name}`,
                                    },
                                  })}
                                  className="text-[11px] h-6 px-2 gap-1 text-primary hover:text-primary print:hidden"
                                >
                                  <Eye className="size-3" />
                                  Verify in Original Document
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 4. Historical & Discontinued Medications */}
          {briefing.historicalMedications.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="size-4.5 text-muted-foreground" />
                  Historical & Discontinued Medications ({briefing.historicalMedications.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Prior prescriptions distinguished from current active therapy.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <th className="py-2.5 pe-4">Medication</th>
                        <th className="py-2.5 pe-4">Status</th>
                        <th className="py-2.5 pe-4">Prescribed By</th>
                        <th className="py-2.5">Documented Date & Citation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {briefing.historicalMedications.map((med) => (
                        <tr key={med.id} className="text-muted-foreground hover:bg-muted/40 transition">
                          <td className="py-2.5 pe-4 font-medium text-foreground">{med.name}</td>
                          <td className="py-2.5 pe-4 text-xs">
                            <Badge variant={med.status === "discontinued" ? "destructive" : "secondary"} className="text-[10px]">
                              {med.status.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="py-2.5 pe-4 text-xs">{med.prescribingDoctor.name}</td>
                          <td className="py-2.5 text-xs">{med.sourceCitation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 5. Documented Medical Conditions & History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Stethoscope className="size-4.5 text-primary" />
                Medical Conditions & Diagnoses ({briefing.conditions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {briefing.conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No documented conditions in available records.
                </p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {briefing.conditions.map((c) => (
                    <li key={c.id} className="py-2.5 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="font-semibold text-foreground">{c.condition}</span>
                        {c.icd10Code && (
                          <span className="ms-2 font-mono text-xs text-muted-foreground">({c.icd10Code})</span>
                        )}
                        {c.diagnosingDoctor && (
                          <span className="ms-2 text-xs text-muted-foreground">
                            · Diagnosed by {c.diagnosingDoctor}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {c.severity && <Badge variant="secondary">{c.severity}</Badge>}
                        <span>Source: {c.sourceDocumentTitle}</span>
                        {c.sourceDocumentId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSourceViewer({
                              documentId: c.sourceDocumentId,
                              documentTitle: c.sourceDocumentTitle,
                              pageNumber: c.pageNumber,
                              mimeType: c.mimeType,
                              highlightTerm: c.condition,
                              entityContext: {
                                entityType: "condition",
                                name: c.condition,
                                details: c.icd10Code ? `ICD-10: ${c.icd10Code}` : undefined,
                              },
                            })}
                            className="text-[11px] h-6 px-1.5 gap-1 text-primary hover:text-primary print:hidden"
                          >
                            <Eye className="size-3" />
                            View
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* 6. Known Allergies */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-4.5 text-destructive" />
                Documented Allergies ({briefing.allergies.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {briefing.allergies.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No documented allergies found in medical records.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {briefing.allergies.map((a, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{a.allergen}</span>
                      {a.severity && <Badge variant="destructive">{a.severity}</Badge>}
                      {a.reaction && <span className="text-xs text-muted-foreground">Reaction: {a.reaction}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* 7. Laboratory Results & Analyte Longitudinal Trends */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="size-4.5 text-primary" />
                Laboratory Test Results & Longitudinal Trends ({briefing.labTrends.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Comparisons across sequential tests, reference ranges, and abnormal findings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {briefing.labTrends.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No laboratory results found in selected records.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <th className="py-2.5 pe-4">Test / Analyte</th>
                        <th className="py-2.5 pe-4">Latest Result</th>
                        <th className="py-2.5 pe-4">Reference Range</th>
                        <th className="py-2.5 pe-4">Comparison / Trend</th>
                        <th className="py-2.5">Clinical Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {briefing.labTrends.map((trend, i) => (
                        <tr key={i} className="hover:bg-muted/40 transition">
                          <td className="py-2.5 pe-4 font-medium text-foreground">{trend.testName}</td>
                          <td className="py-2.5 pe-4 text-xs font-semibold tabular-nums">
                            <span className={trend.latestIsAbnormal ? "text-destructive font-bold" : "text-foreground"}>
                              {trend.latestValue} {trend.unit || ""}
                            </span>
                            {trend.latestIsAbnormal && (
                              <span className="ms-1.5 inline-block text-[10px] text-destructive uppercase border border-destructive/30 px-1 py-0.2 rounded">
                                Abnormal
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pe-4 text-xs text-muted-foreground tabular-nums">
                            {trend.referenceRange || "—"}
                          </td>
                          <td className="py-2.5 pe-4 text-xs">
                            {trend.direction === "worsened" ? (
                              <span className="flex items-center gap-1 text-destructive font-medium">
                                <TrendingUp className="size-3.5" /> Worsened
                              </span>
                            ) : trend.direction === "improved" ? (
                              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                <TrendingDown className="size-3.5" /> Improved
                              </span>
                            ) : trend.direction === "stable" ? (
                              <span className="text-muted-foreground">Stable</span>
                            ) : (
                              <span className="text-muted-foreground capitalize">{trend.direction.replace("_", " ")}</span>
                            )}
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            <div className="flex flex-col gap-1 items-start">
                              <span>{trend.clinicalNote}</span>
                              {trend.sourceDocumentId && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openSourceViewer({
                                    documentId: trend.sourceDocumentId!,
                                    documentTitle: `Lab Report: ${trend.testName}`,
                                    highlightTerm: trend.testName,
                                    entityContext: {
                                      entityType: "lab",
                                      name: trend.testName,
                                      value: `${trend.latestValue} ${trend.unit || ""}`,
                                      details: trend.clinicalNote,
                                    },
                                  })}
                                  className="text-[11px] h-6 px-2 gap-1 text-primary hover:text-primary print:hidden"
                                >
                                  <Eye className="size-3" />
                                  View Original Report
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 8. Laboratory Test Ordering Doctors & Facilities */}
          {briefing.recentLabResults.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="size-4.5 text-primary" />
                  Laboratory Test Attribution & Performing Facilities
                </CardTitle>
                <CardDescription className="text-xs">
                  Separating the ordering doctor from the testing laboratory facility.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <th className="py-2.5 pe-4">Test</th>
                        <th className="py-2.5 pe-4">Ordering Doctor</th>
                        <th className="py-2.5 pe-4">Performing Laboratory / Hospital</th>
                        <th className="py-2.5">Report Citation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {briefing.recentLabResults.slice(0, 10).map((lab) => (
                        <tr key={lab.id} className="hover:bg-muted/40 transition text-xs">
                          <td className="py-2 pe-4 font-medium text-foreground">{lab.testName}</td>
                          <td className="py-2 pe-4">
                            <span className={lab.orderingDoctor.isIdentified ? "font-semibold text-foreground" : "italic text-muted-foreground"}>
                              {lab.orderingDoctor.name}
                            </span>
                          </td>
                          <td className="py-2 pe-4 text-muted-foreground">{lab.performingFacility}</td>
                          <td className="py-2 text-muted-foreground">{lab.sourceCitation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 9. Doctor Consultation Questions */}
          {briefing.consultationQuestions.length > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-primary flex items-center gap-2">
                  <HelpCircle className="size-5" />
                  Suggested Doctor Consultation Questions ({briefing.consultationQuestions.length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Evidence-grounded questions you can discuss directly with your doctor.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {briefing.consultationQuestions.map((q) => (
                  <div key={q.id} className="p-3.5 rounded-lg border bg-background space-y-1 text-sm shadow-sm">
                    <p className="font-semibold text-foreground">“{q.question}”</p>
                    <p className="text-xs text-muted-foreground">Why this matters: {q.rationale}</p>
                    {q.relevantDoctor && (
                      <p className="text-[11px] text-primary">Target provider: {q.relevantDoctor}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 10. Missing / Uncertain Information Audit */}
          {briefing.uncertainties.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="size-4.5 text-muted-foreground" />
                  Missing or Incomplete Clinical Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {briefing.uncertainties.map((u, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="font-semibold text-foreground">• {u.detail}</span>
                      <span>— Impact: {u.impact}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* 11. Source Citations & Provenance */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileCheck2 className="size-4.5 text-primary" />
                Source Records & Evidence Citations ({briefing.citations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {briefing.citations.map((c) => (
                  <div key={c.documentId} className="p-3 rounded-lg border bg-card/60 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground text-sm">
                        [{c.index}] {c.documentTitle}
                      </span>
                      <div className="flex items-center gap-2">
                        {c.pageNumber && (
                          <Badge variant="secondary" className="text-[10px]">
                            p. {c.pageNumber}
                          </Badge>
                        )}
                        <span className="text-muted-foreground">{c.documentDate || "Undated"}</span>
                      </div>
                    </div>
                    <p className="text-muted-foreground">“{c.excerpt}”</p>
                    <div className="flex items-center justify-between pt-1 border-t">
                      <p className="text-[11px] text-primary/80 font-medium">{c.doctorAttributionEvidence}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openSourceViewer({
                          documentId: c.documentId,
                          documentTitle: c.documentTitle,
                          documentDate: c.documentDate,
                          pageNumber: c.pageNumber,
                          mimeType: c.mimeType,
                          excerpt: c.excerpt,
                          doctorName: c.doctorName,
                          hospital: c.hospital,
                        })}
                        className="text-[11px] h-6 px-2 gap-1 text-primary hover:text-primary print:hidden"
                      >
                        <Eye className="size-3" />
                        View Document
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 2: DOCTOR-WISE TIMELINE ───────────────────────────────── */}
        <TabsContent value="timeline" className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Chronological Treatment & Clinical Timeline</CardTitle>
                  <CardDescription className="text-xs">
                    Track events across different doctors, prescriptions, tests, and diagnoses over time.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Doctor filter */}
                  <select
                    value={selectedDoctorFilter}
                    onChange={(e) => setSelectedDoctorFilter(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label="Filter by Doctor"
                  >
                    <option value="all">All Doctors</option>
                    {briefing.doctors.map((d) => (
                      <option key={d.id} value={d.name}>Dr. {d.name}</option>
                    ))}
                  </select>

                  {/* Specialty filter */}
                  <select
                    value={selectedSpecialtyFilter}
                    onChange={(e) => setSelectedSpecialtyFilter(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label="Filter by Specialty"
                  >
                    <option value="all">All Specialties</option>
                    {uniqueSpecialties.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>

                  {/* Search query input */}
                  <div className="relative">
                    <Search className="absolute start-2 top-2 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search events..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 ps-7 text-xs w-36 sm:w-44"
                    />
                  </div>

                  {/* Event type filter */}
                  <select
                    value={timelineTypeFilter}
                    onChange={(e) => setTimelineTypeFilter(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label="Filter by Event Type"
                  >
                    <option value="all">All Event Types</option>
                    <option value="prescription">Prescriptions</option>
                    <option value="consultation">Consultations</option>
                    <option value="lab_result">Lab Results</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {filteredTimeline.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No timeline events found matching the selected filters.
                </p>
              ) : (
                <div className="relative border-s border-border ms-4 ps-6 space-y-6">
                  {filteredTimeline.map((event) => (
                    <div key={event.id} className="relative group">
                      {/* Timeline dot */}
                      <div className="absolute -start-[31px] top-1 size-3.5 rounded-full border-2 border-background bg-primary" />

                      <div className="p-3.5 rounded-lg border bg-card/60 shadow-sm space-y-1.5 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="font-semibold text-foreground">{event.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(event.date).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{event.description}</p>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {event.type.replace("_", " ").toUpperCase()}
                            </Badge>
                            <span className="font-medium text-foreground">Dr. {event.doctorName}</span>
                            {event.doctorSpecialty && <span>· {event.doctorSpecialty}</span>}
                            {event.hospital && <span>· {event.hospital}</span>}
                          </div>
                          {event.sourceDocumentId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openSourceViewer({
                                documentId: event.sourceDocumentId!,
                                documentTitle: event.sourceDocumentTitle || "Clinical Document",
                                pageNumber: event.pageNumber,
                                mimeType: event.mimeType,
                                doctorName: event.doctorName,
                                hospital: event.hospital,
                                entityContext: {
                                  entityType: "timeline",
                                  name: event.title,
                                  details: `Dr. ${event.doctorName} (${event.type.replace("_", " ")})`,
                                },
                              })}
                              className="text-[11px] h-6 px-1.5 gap-1 text-primary hover:text-primary print:hidden"
                            >
                              <Eye className="size-3" />
                              View Document
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 3: DOCTOR DIRECTORY & MANAGEMENT ──────────────────────── */}
        <TabsContent value="doctors" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Doctor Directory & Care Attributions</CardTitle>
                <CardDescription className="text-xs">
                  Review doctors associated with your medical records, correct specialties, or add private clinic contacts.
                </CardDescription>
              </div>
              <Button size="sm" onClick={openAddDoctorModal} className="gap-1.5">
                <Plus className="size-4" /> Add Doctor
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-4">
                {briefing.doctors.map((doc) => (
                  <Card key={doc.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-foreground text-base">Dr. {doc.name}</h3>
                        <p className="text-xs text-primary font-medium">{doc.specialty || "Specialty not specified"}</p>
                      </div>
                      <Badge variant={doc.isVerified ? "default" : "outline"} className="text-[10px]">
                        {doc.sourceType === "verified"
                          ? "Verified"
                          : doc.sourceType === "patient_entered"
                          ? "Patient Entered"
                          : "Extracted"}
                      </Badge>
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground">
                      {doc.hospital && (
                        <p className="flex items-center gap-1.5">
                          <Building2 className="size-3.5 shrink-0" />
                          {doc.hospital}
                        </p>
                      )}
                      {doc.contactInfo && (
                        <p className="truncate">Contact: {doc.contactInfo}</p>
                      )}
                      {doc.notes && (
                        <p className="italic text-foreground/80 mt-1">&quot;{doc.notes}&quot;</p>
                      )}
                    </div>

                    <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                      <span>{doc.prescriptionsCount} Prescriptions · {doc.labOrdersCount} Lab orders</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditDoctorModal(doc)}
                        className="h-7 text-xs"
                      >
                        Edit Details
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 4: SECURE SHARING AUDIT & MANAGEMENT ──────────────────── */}
        <TabsContent value="sharing" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Active Doctor Share Links & Security Audit</CardTitle>
                <CardDescription className="text-xs">
                  Manage unguessable links created for doctor consultations. Immediate revocation stops access on demand.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setShareDialogOpen(true)} className="gap-1.5">
                <Share2 className="size-4" /> New Share Link
              </Button>
            </CardHeader>
            <CardContent>
              {!shareLinks || shareLinks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No share links generated yet. Click &quot;New Share Link&quot; to securely share a briefing with your healthcare provider.
                </p>
              ) : (
                <div className="divide-y divide-border text-sm">
                  {shareLinks.map((link) => (
                    <div key={link.token} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{link.title || "Patient Briefing"}</span>
                          <Badge variant={link.isActive && !link.isExpired ? "default" : "secondary"} className="text-[10px]">
                            {link.isExpired ? "Expired" : link.isActive ? "Active" : "Revoked"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Expires: {new Date(link.expiresAt).toLocaleDateString()} · Viewed: {link.viewCount} time{link.viewCount === 1 ? "" : "s"}
                          {link.lastViewedAt ? ` · Last viewed ${new Date(link.lastViewedAt).toLocaleDateString()}` : ""}
                        </p>
                        <p className="text-xs text-primary font-mono truncate max-w-md">{link.url}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(link.url);
                            alert("Link copied to clipboard!");
                          }}
                          className="h-8 text-xs gap-1"
                        >
                          <Copy className="size-3.5" /> Copy
                        </Button>

                        {link.isActive && !link.isExpired && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleRevokeShareLink(link.token)}
                            className="h-8 text-xs"
                          >
                            Revoke
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── SHARE WITH DOCTOR DIALOG ─────────────────────────────────────── */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-5 text-primary" />
              Secure Sharing with Doctor
            </DialogTitle>
            <DialogDescription className="text-xs">
              Generate a time-limited, unguessable link for your doctor. You control which sections are disclosed.
            </DialogDescription>
          </DialogHeader>

          {!generatedShareUrl ? (
            <div className="space-y-4 py-2 text-sm">
              <div>
                <Label htmlFor="share-title-input">Link Title / Label</Label>
                <Input
                  id="share-title-input"
                  value={shareTitle}
                  onChange={(e) => setShareTitle(e.target.value)}
                  placeholder="e.g. Briefing for Dr. Ahmed"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="share-hours-select">Access Expiration</Label>
                <select
                  id="share-hours-select"
                  value={shareHours}
                  onChange={(e) => setShareHours(e.target.value)}
                  className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="24">24 Hours</option>
                  <option value="72">3 Days</option>
                  <option value="168">7 Days (Recommended)</option>
                  <option value="336">14 Days</option>
                  <option value="720">30 Days</option>
                </select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                  Included Sections
                </Label>
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  {[
                    { id: "summary", label: "Clinical Summary" },
                    { id: "doctors", label: "Doctor Directory" },
                    { id: "medications", label: "Medications & Attribution" },
                    { id: "allergies", label: "Allergies" },
                    { id: "labs", label: "Laboratory Results" },
                    { id: "trends", label: "Longitudinal Trends" },
                    { id: "conflicts", label: "Treatment Conflicts" },
                    { id: "questions", label: "Consultation Questions" },
                    { id: "timeline", label: "Doctor Timeline" },
                    { id: "citations", label: "Source Citations" },
                  ].map((sec) => (
                    <label key={sec.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedSections[sec.id])}
                        onChange={(e) =>
                          setSelectedSections((prev) => ({ ...prev, [sec.id]: e.target.checked }))
                        }
                        className="rounded border-border text-primary focus:ring-primary size-4"
                      />
                      <span>{sec.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {shareError && <p className="text-xs text-destructive">{shareError}</p>}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                Secure link generated. Only the sections you selected are visible.
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Secure Link URL</Label>
                <div className="flex gap-2">
                  <Input value={generatedShareUrl} readOnly className="text-xs font-mono" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedShareUrl);
                      setShareCopied(true);
                      setTimeout(() => setShareCopied(false), 2000);
                    }}
                  >
                    {shareCopied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {!generatedShareUrl ? (
              <>
                <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateShareLink} disabled={shareLoading}>
                  {shareLoading ? <Loader2 className="size-4 animate-spin me-2" /> : <Link2 className="size-4 me-2" />}
                  Generate Link
                </Button>
              </>
            ) : (
              <Button onClick={() => setShareDialogOpen(false)}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ADD / EDIT DOCTOR MODAL ─────────────────────────────────────── */}
      <Dialog open={doctorModalOpen} onOpenChange={setDoctorModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedDoctorForEdit ? "Edit Doctor Information" : "Add Healthcare Professional"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Record or correct doctor specialty, clinic, and professional contact details.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div>
              <Label htmlFor="doc-name">Doctor Name *</Label>
              <Input
                id="doc-name"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="e.g. Dr. Tariq Mahmood"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="doc-spec">Specialty</Label>
              <Input
                id="doc-spec"
                value={doctorSpecialty}
                onChange={(e) => setDoctorSpecialty(e.target.value)}
                placeholder="e.g. Cardiologist, Consultant Physician"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="doc-hosp">Hospital / Clinic</Label>
              <Input
                id="doc-hosp"
                value={doctorHospital}
                onChange={(e) => setDoctorHospital(e.target.value)}
                placeholder="e.g. Shaukat Khanum Hospital, National Hospital"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="doc-contact">Contact Details (Phone / Email)</Label>
              <Input
                id="doc-contact"
                value={doctorContact}
                onChange={(e) => setDoctorContact(e.target.value)}
                placeholder="e.g. 042-35718222"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="doc-notes">Notes / OPD Timings</Label>
              <Input
                id="doc-notes"
                value={doctorNotes}
                onChange={(e) => setDoctorNotes(e.target.value)}
                placeholder="e.g. Mon-Wed 5pm-8pm, OPD Room 12"
                className="mt-1"
              />
            </div>

            {doctorError && <p className="text-xs text-destructive">{doctorError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDoctorModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveDoctor} disabled={doctorSaving}>
              {doctorSaving ? <Loader2 className="size-4 animate-spin me-2" /> : null}
              Save Doctor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Interactive Source Document Viewer Modal */}
      <SourceDocumentViewer
        isOpen={viewerState.isOpen}
        onClose={() => setViewerState((prev) => ({ ...prev, isOpen: false }))}
        documentId={viewerState.documentId}
        documentTitle={viewerState.documentTitle}
        documentDate={viewerState.documentDate}
        fileUrl={viewerState.fileUrl}
        mimeType={viewerState.mimeType}
        pageNumber={viewerState.pageNumber}
        doctorName={viewerState.doctorName}
        hospital={viewerState.hospital}
        excerpt={viewerState.excerpt}
        highlightTerm={viewerState.highlightTerm}
        entityContext={viewerState.entityContext}
      />
    </div>
  );
}
