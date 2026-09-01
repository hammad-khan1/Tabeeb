"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, Calendar, FileText, Pill, AlertTriangle, Building2 } from "lucide-react";

interface SharedHistory {
  summary: {
    conditions: Array<{ condition: string; severity?: string; diagnosedDate?: string }>;
    currentMedications: Array<{ name: string; dosage?: string; frequency?: string }>;
    allergies: Array<{ allergen: string; severity?: string; reaction?: string }>;
    recentLabResults: Array<{ testName: string; value: string; unit?: string; testDate: string; isAbnormal?: boolean }>;
    visitTimeline: Record<string, Array<{ id: string; title: string; documentType: string; hospital?: string; documentDate?: string }>>;
    documentCount: number;
  };
  shareLink: { title?: string; expiresAt: string; viewCount: number };
}

export default function SharedHistoryPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<SharedHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch(`/api/history/share?token=${token}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to load" }));
          setError(err.error || "This link may have expired or is invalid.");
          return;
        }
        setData(await res.json());
      } catch {
        setError("Failed to load shared history.");
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Activity className="w-12 h-12 text-primary animate-pulse mx-auto" />
          <p className="text-muted-foreground">Loading medical history...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold">Unable to Load History</h2>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, shareLink } = data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Activity className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">{shareLink.title || "Medical History Summary"}</h1>
            <p className="text-sm text-muted-foreground">Shared via Tabeeb &middot; Expires {new Date(shareLink.expiresAt).toLocaleDateString()}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="grid md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FileText className="w-4 h-4" /> Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary.documentCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Pill className="w-4 h-4" /> Active Medications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary.currentMedications.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Allergies
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary.allergies.length}</p>
            </CardContent>
          </Card>
        </div>

        {summary.conditions.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Conditions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {summary.conditions.map((c, i) => (
                <div key={i} className="flex justify-between items-center py-1">
                  <span className="font-medium">{c.condition}</span>
                  <div className="flex gap-2">
                    {c.severity && <Badge variant="outline">{c.severity}</Badge>}
                    {c.diagnosedDate && <span className="text-sm text-muted-foreground">{new Date(c.diagnosedDate).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {summary.currentMedications.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Current Medications</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-muted-foreground">Medication</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Dosage</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.currentMedications.map((m, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{m.name}</td>
                      <td className="py-2">{m.dosage || "-"}</td>
                      <td className="py-2">{m.frequency || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {summary.allergies.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Allergies</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {summary.allergies.map((a, i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <Badge variant="destructive">{a.allergen}</Badge>
                  {a.severity && <span className="text-sm text-muted-foreground">{a.severity}</span>}
                  {a.reaction && <span className="text-sm text-muted-foreground">&mdash; {a.reaction}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {summary.recentLabResults.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Recent Lab Results</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-muted-foreground">Test</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Value</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentLabResults.map((l, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2">{l.testName}</td>
                      <td className="py-2">
                        <span className={l.isAbnormal ? "text-destructive font-medium" : ""}>
                          {l.value} {l.unit}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">{new Date(l.testDate).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {Object.keys(summary.visitTimeline).length > 0 && (
          <Card>
            <CardHeader><CardTitle>Visit Timeline</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {Object.entries(summary.visitTimeline).map(([month, visits]) => (
                <div key={month}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Calendar className="w-3 h-3" /> {month}
                  </h3>
                  <div className="space-y-2 ml-5 border-l-2 border-border pl-4">
                    {visits.map((v) => (
                      <div key={v.id} className="space-y-1">
                        <p className="font-medium text-sm">{v.title}</p>
                        <div className="flex gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">{v.documentType.replace(/_/g, " ")}</Badge>
                          {v.hospital && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{v.hospital}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Separator />
        <p className="text-center text-xs text-muted-foreground pb-8">
          This medical history was shared securely via Tabeeb. Only extracted summaries are shown — original documents are not accessible.
        </p>
      </main>
    </div>
  );
}
