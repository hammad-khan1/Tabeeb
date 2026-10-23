import type { RamadanScoreItem, RamadanProvenance } from "../../../drizzle/schema";
import type { RiskItem } from "@/services/ramadan/constants";
import type { AlertMessage } from "@/services/ramadan/glucose-rules";
import type { PendingInput, FilledInput } from "@/services/ramadan/auto-fill";
import type { ScoreResult } from "@/services/ramadan/risk-score";
import type { City } from "@/services/ramadan/prayer-times";

export { RequestError, request, postJson, fetcher } from "@/lib/http-client";

// ── Response shapes ─────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  year: number;
  ramadanStart: string;
  ramadanEnd: string;
  city: string | null;
  intendsToFast: boolean | null;
  riskScore: number | null;
  riskBand: "low" | "moderate" | "high" | null;
  scoreItems: RamadanScoreItem[] | null;
  doctorConfirmed: boolean | null;
  doctorPlanDocumentId: string | null;
  caregiverName: string | null;
  caregiverPhone: string | null;
}

export interface PlanResponse {
  plan: Plan | null;
  hasDiabetes: boolean;
  estimatedDates: { year: number; start: string; end: string } | null;
  cities: City[];
}

export interface RiskResponse {
  riskItems: RiskItem[];
  result: ScoreResult;
  items: RamadanScoreItem[];
  pending: PendingInput[];
  filled: FilledInput[];
}

export interface Reminder {
  kind: "medicine" | "glucose_check" | "sehri" | "iftar";
  slot: "sehri" | "midday" | "pre_iftar" | "iftar" | "post_iftar" | "bedtime";
  at: string;
  label: string;
  medicationId?: string;
  active: boolean;
}

export interface Reading {
  id: string;
  valueMgDl: number | null;
  symptoms: string[] | null;
  alertLevel: "none" | "low" | "high" | "symptom";
  loggedAt: string;
  fastBrokenAt: string | null;
}

export interface TodayResponse {
  date: string;
  inRamadan: boolean;
  city: string | null;
  sehriEnds: string;
  iftar: string;
  tomorrowSehriEnds: string;
  reminders: Reminder[];
  unscheduled: Array<{
    medicationId: string;
    name: string;
    frequency: string | null;
    reason: "awaiting_doctor_plan" | "falls_in_fast" | "timing_unclear";
  }>;
  askDoctor: boolean;
  doctorPlanDocumentId: string | null;
  readings: Reading[];
}

export interface ConfirmableReading {
  value: number;
  unit: "mg_dl" | "mmol_l";
  valueMgDl: number;
}

export type GlucoseResponse =
  | {
      status: "logged";
      log: { id: string; valueMgDl: number | null; alertLevel: Reading["alertLevel"]; loggedAt: string };
      alert: AlertMessage | null;
      caregiverNotified: boolean;
    }
  | {
      status: "needs_confirmation";
      reading: ConfirmableReading;
      provisionalAlert: AlertMessage | null;
    };

export type { AlertMessage, RamadanProvenance };

/** HH:mm in Pakistan time, whatever the device's zone. */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
