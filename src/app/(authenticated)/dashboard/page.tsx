"use client";

import Link from "next/link";
import useSWR from "swr";
import { useUser } from "@clerk/nextjs";
import {
  FileText,
  Upload,
  MessageSquare,
  Mic,
  Pill,
  AlertTriangle,
  Clock,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(dateStr);
}

export default function DashboardPage() {
  const { user } = useUser();
  // The list endpoint is paginated and returns { documents, total, ... }; the
  // dashboard only needs the most recent few for its cards and counts.
  const { data: documentList, isLoading: docsLoading } = useSWR<{
    documents: Record<string, unknown>[];
    total: number;
  }>("/api/documents?limit=50", fetcher);
  const { data: history, isLoading: historyLoading } = useSWR<Record<string, unknown>>(
    "/api/history",
    fetcher
  );

  const docs = (documentList?.documents ?? []) as Array<{
    id: string;
    title: string;
    documentType: string;
    extractionStatus: string;
    createdAt: string;
    documentDate: string | null;
    hospital: string | null;
  }>;

  const historyData = history as {
    conditions?: Array<{ condition: string }>;
    currentMedications?: Array<{ name: string; dosage?: string | null }>;
    allergies?: Array<{ allergen: string; severity?: string | null }>;
    recentLabResults?: Array<{
      testName: string;
      isAbnormal?: boolean | null;
    }>;
  } | undefined;

  // Stats
  // The server's count, not the page length — the fetch above is capped at 50.
  const totalDocs = documentList?.total ?? 0;
  // Display-only stat; a cutoff that drifts by milliseconds between renders is harmless.
  // eslint-disable-next-line react-hooks/purity
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentUploads = docs.filter(
    (d) => new Date(d.createdAt).getTime() > sevenDaysAgo
  ).length;
  const activeMeds = historyData?.currentMedications?.length ?? 0;
  const abnormalLabs =
    historyData?.recentLabResults?.filter((l) => l.isAbnormal).length ?? 0;
  const allergiesCount = historyData?.allergies?.length ?? 0;
  const pendingAlerts = abnormalLabs + allergiesCount;

  const recentDocs = docs.slice(0, 5);

  const isLoading = docsLoading || historyLoading;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back{user?.firstName ? `, ${user.firstName}` : ""}
        </h1>
        <p className="text-muted-foreground">
          Here is an overview of your health records.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Documents
            </CardTitle>
            <FileText className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "--" : totalDocs}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recent Uploads
            </CardTitle>
            <Clock className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "--" : recentUploads}
            </div>
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Medications
            </CardTitle>
            <Pill className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "--" : activeMeds}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Alerts
            </CardTitle>
            <AlertTriangle className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "--" : pendingAlerts}
            </div>
            {pendingAlerts > 0 && (
              <p className="text-xs text-amber-600">Needs attention</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button render={<Link href="/documents/upload" />}>
            <Upload className="mr-2 size-4" />
            Upload Document
          </Button>
          <Button variant="outline" render={<Link href="/chat" />}>
            <MessageSquare className="mr-2 size-4" />
            Ask Tabeeb
          </Button>
          <Button variant="outline" render={<Link href="/documents/upload" />}>
            <Mic className="mr-2 size-4" />
            Voice Note
          </Button>
          <Button variant="outline" render={<Link href="/trends" />}>
            <TrendingUp className="mr-2 size-4" />
            View Trends
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Documents */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Documents</CardTitle>
            <Button variant="ghost" size="sm" render={<Link href="/documents" />}>
              View all
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 animate-pulse rounded-lg bg-muted"
                  />
                ))}
              </div>
            ) : recentDocs.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <FileText className="mb-3 size-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No documents yet. Upload your first document to get started.
                </p>
                <Button className="mt-4" size="sm" render={<Link href="/documents/upload" />}>
                  Upload Document
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {recentDocs.map((doc) => (
                  <Link
                    key={doc.id}
                    href={`/documents/${doc.id}`}
                    className="flex items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType}{" "}
                        &middot; {formatRelative(doc.createdAt)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        doc.extractionStatus === "confirmed"
                          ? "default"
                          : doc.extractionStatus === "needs_review"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-xs"
                    >
                      {doc.extractionStatus}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Health Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Health Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-lg bg-muted"
                  />
                ))}
              </div>
            ) : abnormalLabs === 0 && allergiesCount === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <TrendingUp className="size-5" />
                </div>
                <p className="text-sm font-medium">All clear</p>
                <p className="text-xs text-muted-foreground">
                  No abnormal results or alerts.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {abnormalLabs > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-4 text-amber-600" />
                      <p className="text-sm font-medium text-amber-800">
                        {abnormalLabs} abnormal lab result{abnormalLabs > 1 ? "s" : ""}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-amber-700">
                      Review your lab trends for details.
                    </p>
                    <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" render={<Link href="/trends" />}>
                      View trends
                    </Button>
                  </div>
                )}
                {allergiesCount > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-4 text-red-600" />
                      <p className="text-sm font-medium text-red-800">
                        {allergiesCount} known allerg{allergiesCount > 1 ? "ies" : "y"}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-red-700">
                      Always check interactions before new medications.
                    </p>
                    <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" render={<Link href="/interactions" />}>
                      Check interactions
                    </Button>
                  </div>
                )}
              </div>
            )}
            <Separator className="my-3" />
            <Button variant="outline" size="sm" className="w-full" render={<Link href="/insights" />}>
              View Health Insights
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
