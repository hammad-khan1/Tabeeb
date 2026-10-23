"use client";

import { useState, useEffect } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCw,
  Download,
  FileText,
  AlertCircle,
  ExternalLink,
  Calendar,
  UserCheck,
  Building2,
  PanelRightClose,
  PanelRightOpen,
  Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface SourceDocumentViewerProps {
  isOpen: boolean;
  onClose: () => void;
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
}

export function SourceDocumentViewer(props: SourceDocumentViewerProps) {
  if (!props.isOpen) return null;
  return <SourceDocumentViewerModal key={`${props.documentId}-${props.pageNumber ?? 0}`} {...props} />;
}

function SourceDocumentViewerModal({
  isOpen: _isOpen,
  onClose,
  documentId,
  documentTitle,
  documentDate,
  fileUrl,
  mimeType,
  pageNumber,
  doctorName,
  hospital,
  excerpt,
  highlightTerm,
  entityContext,
}: SourceDocumentViewerProps) {


  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showEvidencePanel, setShowEvidencePanel] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [fileMissing, setFileMissing] = useState(false);

  const isPdf = mimeType?.includes("pdf") || fileUrl.toLowerCase().includes(".pdf");
  const isImage =
    mimeType?.startsWith("image/") ||
    fileUrl.match(/\.(png|jpe?g|webp|gif|bmp)$/i) ||
    (!isPdf && Boolean(mimeType));

  useEffect(() => {
    let active = true;
    fetch(fileUrl, { method: "HEAD" })
      .then((res) => {
        if (!active) return;
        if (res.status === 410) {
          setFileMissing(true);
          setImageError(true);
          setImageLoading(false);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [fileUrl]);

  const handleImageError = async () => {
    setImageLoading(false);
    setImageError(true);
    try {
      const res = await fetch(fileUrl);
      if (res.status === 410) {
        setFileMissing(true);
      }
    } catch {
      // ignore
    }
  };
  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const renderHighlightedExcerpt = (text: string, term?: string | null) => {
    if (!term || term.trim().length < 2) {
      return <span>{text}</span>;
    }
    const cleanTerm = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${cleanTerm})`, "gi");
    const parts = text.split(regex);

    return (
      <>
        {parts.map((part, index) =>
          regex.test(part) ? (
            <mark
              key={index}
              className="bg-amber-300 dark:bg-amber-600/60 text-foreground font-semibold px-1 rounded-xs"
            >
              {part}
            </mark>
          ) : (
            <span key={index}>{part}</span>
          )
        )}
      </>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="viewer-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-2 sm:p-4 transition-opacity animate-in fade-in-0"
    >
      <div
        className={`bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isFullscreen
            ? "w-full h-full rounded-none"
            : "w-full max-w-6xl h-[92vh] max-h-[950px]"
        }`}
      >
        {/* Top Header Bar */}
        <header className="px-4 py-3 border-b bg-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="viewer-title" className="text-base font-semibold truncate text-foreground">
                  {documentTitle || "Original Medical Record"}
                </h2>
                {pageNumber && (
                  <Badge variant="secondary" className="text-xs">
                    Page {pageNumber}
                  </Badge>
                )}
                {isPdf && (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    PDF Document
                  </Badge>
                )}
                {isImage && (
                  <Badge variant="outline" className="text-[10px] uppercase">
                    Scanned Image
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                {documentDate && (
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3.5" />
                    {documentDate}
                  </span>
                )}
                {doctorName && (
                  <span className="flex items-center gap-1">
                    <UserCheck className="size-3.5" />
                    Dr. {doctorName}
                  </span>
                )}
                {hospital && (
                  <span className="flex items-center gap-1">
                    <Building2 className="size-3.5" />
                    {hospital}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
            {isImage && (
              <>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={handleZoomOut}
                  title="Zoom Out"
                  aria-label="Zoom Out"
                >
                  <ZoomOut className="size-4" />
                </Button>
                <span className="text-xs font-mono px-1.5 text-muted-foreground w-12 text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={handleZoomIn}
                  title="Zoom In"
                  aria-label="Zoom In"
                >
                  <ZoomIn className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={handleRotate}
                  title="Rotate 90 degrees"
                  aria-label="Rotate"
                >
                  <RotateCw className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleResetZoom}
                  className="text-xs hidden sm:inline-flex"
                >
                  Reset
                </Button>
              </>
            )}

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setShowEvidencePanel((p) => !p)}
              title={showEvidencePanel ? "Hide Evidence Panel" : "Show Evidence Panel"}
              aria-label="Toggle Evidence Panel"
              className={showEvidencePanel ? "bg-accent text-accent-foreground" : ""}
            >
              {showEvidencePanel ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>

            <Button
              variant="outline"
              size="icon-sm"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              aria-label="Toggle Fullscreen"
              className="hidden sm:inline-flex"
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>

            {!fileMissing ? (
              <a
                href={`${fileUrl}${fileUrl.includes("?") ? "&" : "?"}download=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg border bg-background size-8 text-foreground hover:bg-accent transition"
                title="Download Original File"
                aria-label="Download File"
              >
                <Download className="size-4" />
              </a>
            ) : (
              <span
                className="inline-flex items-center justify-center rounded-lg border bg-muted/30 size-8 text-muted-foreground/40 cursor-not-allowed"
                title="File missing from storage"
                aria-label="File Unavailable"
              >
                <Download className="size-4" />
              </span>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              title="Close Viewer"
              aria-label="Close Viewer"
            >
              <X className="size-5" />
            </Button>
          </div>
        </header>

        {/* Content Container (Split Viewer & Evidence Drawer) */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden bg-zinc-950/5 dark:bg-zinc-950/50">
          {/* Main Visual Display Area */}
          <div className="flex-1 min-h-0 relative flex items-center justify-center p-3 overflow-auto">
            {isPdf ? (
              <div className="w-full h-full flex flex-col bg-card rounded-lg border shadow-xs overflow-hidden">
                <iframe
                  src={`${fileUrl}#page=${pageNumber || 1}&view=FitH`}
                  className="w-full h-full border-0"
                  title={`Source document: ${documentTitle}`}
                />
              </div>
            ) : isImage ? (
              <div className="relative w-full h-full flex items-center justify-center overflow-auto p-4">
                {imageLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 z-10">
                    <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-muted-foreground">Loading source document...</span>
                  </div>
                )}
                {imageError ? (
                  <div className="p-6 text-center space-y-3 max-w-md bg-card rounded-xl border shadow-sm">
                    <AlertCircle className="size-10 text-destructive mx-auto" />
                    {fileMissing ? (
                      <>
                        <p className="text-sm font-semibold text-foreground">
                          Original File Not Found in Storage
                        </p>
                        <Badge variant="destructive" className="text-[11px] uppercase tracking-wider">
                          HTTP 410: File Cleared
                        </Badge>
                        <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                          The physical file for this document is missing from local storage on this system.
                          All extracted clinical findings, medications, and laboratory data remain intact and safely preserved in your patient briefing.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-foreground">
                          Unable to render document preview inline
                        </p>
                        <p className="text-xs text-muted-foreground">
                          The document format or file size may require external viewing. You can still open
                          or download the original file directly.
                        </p>
                        <a
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
                        >
                          <ExternalLink className="size-3.5" />
                          Open Original in New Tab
                        </a>
                      </>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: "center center",
                      transition: "transform 0.15s ease-out",
                    }}
                    className="max-w-full max-h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fileUrl}
                      alt={documentTitle || "Original medical record"}
                      onLoad={() => setImageLoading(false)}
                      onError={handleImageError}
                      className="max-w-full max-h-[78vh] object-contain rounded-md shadow-md bg-white"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 text-center space-y-3 max-w-md bg-card rounded-xl border shadow-sm">
                <FileText className="size-12 text-primary mx-auto" />
                <h3 className="text-base font-semibold text-foreground">{documentTitle}</h3>
                {fileMissing ? (
                  <>
                    <Badge variant="destructive" className="text-[11px]">
                      HTTP 410: File Missing
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      The physical document is not available in local storage. Clinical briefing data remains safely recorded.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Original clinical document on file. Click below to inspect or download the original file.
                    </p>
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
                      >
                        <ExternalLink className="size-3.5" />
                        Open Original File
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right Evidence & OCR Verification Panel */}
          {showEvidencePanel && (
            <aside className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l bg-card flex flex-col shrink-0 overflow-y-auto max-h-[40vh] lg:max-h-full">
              <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Eye className="size-3.5 text-primary" />
                  Clinical Provenance
                </span>
                <span className="text-[11px] text-primary font-medium">Source of Truth</span>
              </div>

              <div className="p-4 space-y-4 text-xs">
                {/* Active Entity Being Verified */}
                {entityContext && (
                  <div className="p-3 rounded-lg border bg-primary/5 border-primary/20 space-y-1">
                    <span className="text-[10px] uppercase font-bold text-primary tracking-wider block">
                      Target Entity under Verification
                    </span>
                    <p className="text-sm font-semibold text-foreground">{entityContext.name}</p>
                    {entityContext.value && (
                      <p className="text-xs font-medium text-foreground">
                        Reported Value / Dose:{" "}
                        <span className="text-primary font-bold">{entityContext.value}</span>
                      </p>
                    )}
                    {entityContext.details && (
                      <p className="text-xs text-muted-foreground">{entityContext.details}</p>
                    )}
                  </div>
                )}

                {/* Excerpt with Evidence Highlight */}
                {excerpt && (
                  <div className="space-y-1.5">
                    <span className="font-semibold text-foreground block">Extracted Evidence Excerpt:</span>
                    <div className="p-3 rounded-lg border bg-background font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {renderHighlightedExcerpt(excerpt, highlightTerm || entityContext?.name)}
                    </div>
                  </div>
                )}

                {/* Verification Notice */}
                <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-500/10 space-y-1.5 text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertCircle className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Visual Clinical Verification</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                    Always confirm critical medication dosages, units, and handwritten doctor notes against
                    the scanned source displayed on the left. The uploaded original record is the primary
                    source of clinical truth.
                  </p>
                </div>

                {/* Metadata Details */}
                <div className="space-y-2 pt-2 border-t text-[11px]">
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-muted-foreground">Document ID</span>
                    <span className="font-mono text-foreground">{documentId.slice(0, 13)}...</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-muted-foreground">Location in Document</span>
                    <span className="text-foreground font-medium">
                      {pageNumber ? `Page ${pageNumber}` : "Single-page / Page 1"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">Region Coordinates</span>
                    <span className="text-muted-foreground italic">
                      Full page (exact bbox not recorded)
                    </span>
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
