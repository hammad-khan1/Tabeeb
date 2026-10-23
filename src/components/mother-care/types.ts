import type { getPregnancyView } from "@/services/pregnancy/pregnancy";

/** What a server value looks like after JSON: dates arrive as strings. */
export type Serialized<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<Serialized<U>>
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type PregnancyView = Serialized<Awaited<ReturnType<typeof getPregnancyView>>>;

export interface PregnancySummary {
  id: string;
  motherName: string;
  dueDate: string;
  status: "active" | "delivered" | "ended";
  deliveredOn: string | null;
}

export interface DocumentSummary {
  id: string;
  title: string;
  documentType: string;
  documentDate: string | null;
}

export interface DangerResponse {
  caregiversNotified: number;
  caregiversWithAlerts: number;
  emergency: { url: string; expiresAt: string; qrSvg: string };
}

/** Today in Pakistan, as YYYY-MM-DD. */
export function pakistanToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function displayDate(day: string | null | undefined): string {
  if (!day) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day.slice(0, 10)}T00:00:00Z`)
  );
}
