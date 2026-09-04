"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocale } from "@/components/providers/locale-provider";

/**
 * Route-level error boundary. Without one, an unhandled render error anywhere in the
 * tree blanked the entire app with no way back.
 *
 * The copy deliberately reassures about the records themselves: a patient who sees a
 * crash on a medical app will assume their documents are gone.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();

  useEffect(() => {
    console.error("[UI] unhandled render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-semibold">{t("error.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("error.body")}</p>
          </div>

          <Button onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("action.retry")}
          </Button>

          {/* The digest is what correlates this crash with the server logs. */}
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
