"use client";

import { useState } from "react";
import { Loader2, MapPin, Moon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";
import { postJson, type Plan, type PlanResponse } from "./api";

/**
 * Step one: does the patient plan to fast, where, and when. The dates arrive
 * pre-filled with an estimate and stay editable, because Ramzan starts on moon sighting.
 */
export function OptInCard({
  data,
  onSaved,
}: {
  data: PlanResponse;
  onSaved: (plan: Plan) => void;
}) {
  const { t, isUrdu } = useLocale();
  const existing = data.plan;

  const initialCity =
    data.cities.find((city) => city.name === existing?.city)?.id ?? data.cities[0]?.id ?? "karachi";
  const [city, setCity] = useState(initialCity);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [start, setStart] = useState(existing?.ramadanStart ?? data.estimatedDates?.start ?? "");
  const [end, setEnd] = useState(existing?.ramadanEnd ?? data.estimatedDates?.end ?? "");
  const [caregiverName, setCaregiverName] = useState(existing?.caregiverName ?? "");
  const [caregiverPhone, setCaregiverPhone] = useState(existing?.caregiverPhone ?? "");
  const [saving, setSaving] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState("");

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => setError(t("ramadan.optIn.locationError"))
    );
  };

  const save = async (intendsToFast: boolean) => {
    setSaving(intendsToFast ? "yes" : "no");
    setError("");
    try {
      const { plan } = await postJson<{ plan: Plan }>("/api/ramadan/plan", {
        ramadanStart: start,
        ramadanEnd: end,
        intendsToFast,
        ...(coords ?? { city }),
        caregiverName: caregiverName.trim() || null,
        caregiverPhone: caregiverPhone.trim() || null,
      });
      onSaved(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your plan.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Moon className="size-5 text-primary" aria-hidden="true" />
          {t("ramadan.optIn.question")}
        </CardTitle>
        {isUrdu ? null : (
          <p className="font-urdu text-lg text-muted-foreground" dir="rtl" lang="ur">
            رمضان آ رہا ہے۔ کیا آپ روزہ رکھنے کا ارادہ رکھتے ہیں؟
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {!data.hasDiabetes && (
          <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {t("ramadan.optIn.noDiabetes")}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="ramadan-city">{t("ramadan.optIn.city")}</Label>
          {coords ? (
            <p className="flex items-center gap-2 text-sm">
              <MapPin className="size-4" aria-hidden="true" />
              {t("ramadan.optIn.locationSet")}
            </p>
          ) : (
            <select
              id="ramadan-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
            >
              {data.cities.map((option) => (
                <option key={option.id} value={option.id}>
                  {isUrdu ? option.nameUr : option.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="link" className="h-auto px-0" onClick={locate}>
            <MapPin className="size-4" aria-hidden="true" />
            {t("ramadan.optIn.useLocation")}
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ramadan-start">{t("ramadan.optIn.start")}</Label>
            <Input id="ramadan-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ramadan-end">{t("ramadan.optIn.end")}</Label>
            <Input id="ramadan-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-11" />
          </div>
          <p className="text-sm text-muted-foreground sm:col-span-2">{t("ramadan.optIn.datesNote")}</p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("ramadan.optIn.caregiver")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="caregiver-name">{t("ramadan.optIn.caregiverName")}</Label>
              <Input id="caregiver-name" value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caregiver-phone">{t("ramadan.optIn.caregiverPhone")}</Label>
              <Input
                id="caregiver-phone"
                type="tel"
                inputMode="tel"
                placeholder="+92 300 1234567"
                value={caregiverPhone}
                onChange={(e) => setCaregiverPhone(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="h-14 flex-1 text-base" onClick={() => save(true)} disabled={saving !== null}>
            {saving === "yes" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {t("ramadan.optIn.yes")}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 flex-1 text-base"
            onClick={() => save(false)}
            disabled={saving !== null}
          >
            {saving === "no" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {t("ramadan.optIn.no")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
