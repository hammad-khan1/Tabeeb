import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSharedBriefing, type SharedBriefingData } from '@/services/briefing/share';
import { SharedBriefingView } from './shared-briefing-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Doctor-Ready Patient Briefing — Tabeeb',
  robots: { index: false, follow: false, nocache: true },
};

function Unavailable({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full border-destructive/30 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-destructive">
            <AlertTriangle className="size-5" aria-hidden="true" />
            Briefing Link Unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground/80">
            For patient privacy and security, access expires automatically or can be revoked by the patient at any time.
            Please request a fresh link from the patient.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default async function SharedBriefingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let data: SharedBriefingData;
  try {
    data = await getSharedBriefing(token);
  } catch (error) {
    return (
      <Unavailable
        message={
          error instanceof Error
            ? error.message
            : 'This doctor briefing is no longer available. It may have expired or been revoked.'
        }
      />
    );
  }

  return <SharedBriefingView data={data} token={token} />;
}
