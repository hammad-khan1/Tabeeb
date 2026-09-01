"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Upload,
  FileText,
  X,
  CheckCircle2,
  Loader2,
  Mic,
  Square,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DOCUMENT_TYPE_LABELS, MAX_FILE_SIZE, SUPPORTED_FILE_TYPES } from "@/lib/constants";
import { useDocuments } from "@/hooks/use-documents";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";

type UploadStatus = "idle" | "uploading" | "success" | "error";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadDocument } = useDocuments();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("other");
  const [hospital, setHospital] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [language, setLanguage] = useState("mixed");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState("");
  const [uploadedDocId, setUploadedDocId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Voice recording dialog
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    error: recorderError,
    duration,
  } = useVoiceRecorder();

  const acceptedMimes = Object.keys(SUPPORTED_FILE_TYPES);
  const acceptedExtensions = ".pdf,.jpg,.jpeg,.png,.docx,.txt";

  const validateFile = useCallback(
    (f: File): string | null => {
      if (!acceptedMimes.includes(f.type) && !f.name.match(/\.(pdf|jpg|jpeg|png|docx|txt)$/i)) {
        return "Unsupported file type. Please upload PDF, JPG, PNG, DOCX, or TXT files.";
      }
      if (f.size > MAX_FILE_SIZE) {
        return `File is too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`;
      }
      return null;
    },
    [acceptedMimes]
  );

  const handleFile = useCallback(
    (f: File) => {
      const err = validateFile(f);
      if (err) {
        setUploadError(err);
        setUploadStatus("error");
        return;
      }
      setFile(f);
      setTitle(f.name.replace(/\.[^.]+$/, ""));
      setUploadError("");
      setUploadStatus("idle");
    },
    [validateFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleUpload = async () => {
    if (!file) return;

    setUploadStatus("uploading");
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title || file.name);
      formData.append("documentType", documentType);
      if (hospital) formData.append("hospital", hospital);
      if (doctorName) formData.append("doctorName", doctorName);
      if (documentDate) formData.append("documentDate", documentDate);
      formData.append("language", language);

      const doc = await uploadDocument(formData);
      setUploadStatus("success");
      setUploadedDocId(doc.id);
    } catch (err: unknown) {
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleVoiceUpload = async () => {
    if (!audioBlob) return;
    setVoiceUploading(true);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice-recording.webm");

      const transcribeRes = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });
      if (!transcribeRes.ok) {
        const err = await transcribeRes.json();
        throw new Error(err.error || "Transcription failed");
      }

      const { transcript, structuredEntry } = await transcribeRes.json();

      // Create a text file with the transcript
      const textBlob = new Blob([transcript], { type: "text/plain" });
      const uploadForm = new FormData();
      uploadForm.append("file", textBlob, "voice-entry.txt");
      uploadForm.append("title", `Voice Entry - ${new Date().toLocaleDateString()}`);
      uploadForm.append("documentType", "voice_entry");
      uploadForm.append("language", structuredEntry?.language ?? "mixed");

      const doc = await uploadDocument(uploadForm);
      setVoiceDialogOpen(false);
      router.push(`/documents/${doc.id}`);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Voice upload failed");
      setVoiceDialogOpen(false);
    } finally {
      setVoiceUploading(false);
    }
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Success state
  if (uploadStatus === "success" && uploadedDocId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="size-7" />
            </div>
            <h2 className="text-xl font-semibold">Document Uploaded</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your document is being processed. Extraction may take a few moments.
            </p>
            <div className="mt-6 flex gap-3">
              <Button render={<Link href={`/documents/${uploadedDocId}`} />}>
                View Document
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setFile(null);
                  setUploadStatus("idle");
                  setTitle("");
                  setUploadedDocId(null);
                }}
              >
                Upload Another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Document</h1>
        <p className="text-muted-foreground">
          Upload a medical document for processing and analysis.
        </p>
      </div>

      {/* Drop Zone */}
      {!file ? (
        <Card>
          <CardContent className="p-6">
            <div
              className={`flex flex-col items-center rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
                isDragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Upload className="size-6" />
              </div>
              <h3 className="text-base font-semibold">
                Drag and drop your file here
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                or click to browse
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={acceptedExtensions}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <p className="mt-4 text-xs text-muted-foreground">
                Accepted: PDF, JPG, PNG, DOCX, TXT (max {formatFileSize(MAX_FILE_SIZE)})
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setFile(null);
                  setTitle("");
                  setUploadStatus("idle");
                  setUploadError("");
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metadata Form */}
      {file && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Document Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Document title"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="type">Document Type</Label>
                <Select value={documentType} onValueChange={(val) => val && setDocumentType(val)}>
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="date">Document Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={documentDate}
                  onChange={(e) => setDocumentDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="hospital">Hospital</Label>
                <Input
                  id="hospital"
                  value={hospital}
                  onChange={(e) => setHospital(e.target.value)}
                  placeholder="Hospital name"
                />
              </div>
              <div>
                <Label htmlFor="doctor">Doctor Name</Label>
                <Input
                  id="doctor"
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="Dr. name"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="language">Language</Label>
              <Select value={language} onValueChange={(val) => val && setLanguage(val)}>
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ur">Urdu</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {uploadError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="size-4 shrink-0" />
          {uploadError}
        </div>
      )}

      {/* Actions */}
      {file && (
        <div className="flex gap-3">
          <Button
            onClick={handleUpload}
            disabled={uploadStatus === "uploading"}
            className="flex-1"
          >
            {uploadStatus === "uploading" ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 size-4" />
                Upload Document
              </>
            )}
          </Button>
        </div>
      )}

      {/* Voice Intake */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => {
            setVoiceDialogOpen(true);
          }}
        >
          <Mic className="mr-2 size-4" />
          Voice Intake
        </Button>
      </div>

      {/* Voice Recording Dialog */}
      <Dialog open={voiceDialogOpen} onOpenChange={setVoiceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voice Intake</DialogTitle>
            <DialogDescription>
              Record a voice note about your symptoms, medications, or health
              updates.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="text-3xl font-mono tabular-nums">
              {formatDuration(duration)}
            </div>

            {recorderError && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="size-4" />
                {recorderError}
              </div>
            )}

            {!isRecording && !audioBlob && (
              <Button size="lg" onClick={startRecording}>
                <Mic className="mr-2 size-5" />
                Start Recording
              </Button>
            )}

            {isRecording && (
              <div className="flex items-center gap-3">
                <Badge variant="destructive" className="animate-pulse">
                  Recording
                </Badge>
                <Button variant="destructive" size="lg" onClick={stopRecording}>
                  <Square className="mr-2 size-4" />
                  Stop
                </Button>
              </div>
            )}

            {audioBlob && !isRecording && (
              <div className="flex flex-col items-center gap-3">
                <audio
                  controls
                  src={URL.createObjectURL(audioBlob)}
                  className="w-full"
                />
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      startRecording();
                    }}
                  >
                    Re-record
                  </Button>
                  <Button onClick={handleVoiceUpload} disabled={voiceUploading}>
                    {voiceUploading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 size-4" />
                        Upload
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
