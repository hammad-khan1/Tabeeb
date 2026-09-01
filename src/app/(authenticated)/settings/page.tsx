"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import useSWR from "swr";
import {
  Settings as SettingsIcon,
  User,
  Globe,
  ShieldAlert,
  Stethoscope,
  X,
  Plus,
  Save,
  Loader2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface UserData {
  id: string;
  email: string;
  name: string | null;
  preferredLanguage: string;
  knownAllergies: string[];
  knownConditions: string[];
}

export default function SettingsPage() {
  const { user: clerkUser } = useUser();
  const { data: userData, isLoading, mutate: mutateUser } = useSWR<UserData>(
    "/api/settings",
    fetcher,
    { revalidateOnFocus: false }
  );

  const [language, setLanguage] = useState("en");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [newAllergy, setNewAllergy] = useState("");
  const [newCondition, setNewCondition] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Delete
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // Initialize from loaded data
  useEffect(() => {
    if (userData) {
      setLanguage(userData.preferredLanguage ?? "en");
      setAllergies(userData.knownAllergies ?? []);
      setConditions(userData.knownConditions ?? []);
    }
  }, [userData]);

  const addAllergy = () => {
    const val = newAllergy.trim();
    if (val && !allergies.includes(val)) {
      setAllergies([...allergies, val]);
      setNewAllergy("");
    }
  };

  const removeAllergy = (item: string) => {
    setAllergies(allergies.filter((a) => a !== item));
  };

  const addCondition = () => {
    const val = newCondition.trim();
    if (val && !conditions.includes(val)) {
      setConditions([...conditions, val]);
      setNewCondition("");
    }
  };

  const removeCondition = (item: string) => {
    setConditions(conditions.filter((c) => c !== item));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferredLanguage: language,
          knownAllergies: allergies,
          knownConditions: conditions,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save settings");
      }
      await mutateUser();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    if (deleteConfirm !== "DELETE") return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/settings", { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Delete failed");
      }
      window.location.href = "/";
    } catch {
      setIsDeleting(false);
    }
  };

  const handleKeyDownAllergy = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addAllergy();
    }
  };

  const handleKeyDownCondition = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCondition();
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your profile and preferences.
        </p>
      </div>

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input
              value={clerkUser?.fullName ?? userData?.name ?? ""}
              disabled
              className="bg-muted"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Managed by your account provider.
            </p>
          </div>
          <div>
            <Label>Email</Label>
            <Input
              value={clerkUser?.primaryEmailAddress?.emailAddress ?? userData?.email ?? ""}
              disabled
              className="bg-muted"
            />
          </div>
        </CardContent>
      </Card>

      {/* Language Preference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4" />
            Language Preference
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {[
              { value: "en", label: "English" },
              { value: "ur", label: "Urdu" },
              { value: "mixed", label: "Mixed" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLanguage(opt.value)}
                className={`flex-1 rounded-lg border-2 p-3 text-center text-sm font-medium transition-colors ${
                  language === opt.value
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-muted-foreground/50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            This affects how Tabeeb communicates with you and processes
            multilingual documents.
          </p>
        </CardContent>
      </Card>

      {/* Known Allergies */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4" />
            Known Allergies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newAllergy}
              onChange={(e) => setNewAllergy(e.target.value)}
              onKeyDown={handleKeyDownAllergy}
              placeholder="Add an allergy (e.g., Penicillin)"
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={addAllergy}>
              <Plus className="size-4" />
            </Button>
          </div>
          {allergies.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {allergies.map((allergy) => (
                <Badge key={allergy} variant="secondary" className="gap-1 pr-1">
                  {allergy}
                  <button
                    type="button"
                    onClick={() => removeAllergy(allergy)}
                    className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No allergies recorded.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Known Conditions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="size-4" />
            Known Conditions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newCondition}
              onChange={(e) => setNewCondition(e.target.value)}
              onKeyDown={handleKeyDownCondition}
              placeholder="Add a condition (e.g., Hypertension)"
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={addCondition}>
              <Plus className="size-4" />
            </Button>
          </div>
          {conditions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {conditions.map((condition) => (
                <Badge key={condition} variant="secondary" className="gap-1 pr-1">
                  {condition}
                  <button
                    type="button"
                    onClick={() => removeCondition(condition)}
                    className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No conditions recorded.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Saving...
            </>
          ) : saveSuccess ? (
            <>
              <CheckCircle2 className="mr-2 size-4 text-emerald-500" />
              Saved
            </>
          ) : (
            <>
              <Save className="mr-2 size-4" />
              Save Preferences
            </>
          )}
        </Button>
        {saveError && (
          <span className="text-sm text-red-600">{saveError}</span>
        )}
      </div>

      <Separator />

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-700">
            <AlertTriangle className="size-4" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Permanently delete all your documents, extracted data, and health
            records. This action cannot be undone.
          </p>
          <Button
            variant="destructive"
            className="mt-4"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="mr-2 size-4" />
            Delete All Data
          </Button>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All Data</DialogTitle>
            <DialogDescription>
              This will permanently delete all your documents, extracted data,
              medical history, and insights. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">
              Type <span className="font-mono">DELETE</span> to confirm:
            </p>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteConfirm("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={deleteConfirm !== "DELETE" || isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 size-4" />
                  Delete Everything
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
