"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SETTING_DEFINITIONS, type SettingKey } from "@/lib/settings/keys";
import type { ApiResponse } from "@/types/api";

const inputCls =
  "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-brand-700";

/**
 * Store settings form. Shows stored OVERRIDES as values and the
 * environment default as the placeholder — an untouched field sends ""
 * which clears nothing (no row), a cleared field deletes the row, and a
 * typed field upserts. All validation is server-side; the form only
 * mirrors the error message.
 */
export function SettingsForm({
  overrides,
  defaults,
}: {
  overrides: Partial<Record<SettingKey, string>>;
  defaults: Record<SettingKey, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Partial<Record<SettingKey, string>>>(
    () => ({ ...overrides }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = (await res.json()) as ApiResponse<{ saved: SettingKey[] }>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert tone="error" title="Could not save settings">
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert tone="success" title="Settings saved">
          Overrides now apply to new invoices, quotations and payment
          instructions.
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {SETTING_DEFINITIONS.map((def) => {
          const active = (values[def.key] ?? "") !== "";
          return (
            <div key={def.key} className="flex flex-col gap-1.5">
              <label
                htmlFor={`setting-${def.key}`}
                className="text-sm font-semibold text-zinc-800"
              >
                {def.label}
              </label>
              <input
                id={`setting-${def.key}`}
                type={def.type === "number" ? "number" : def.type === "email" ? "email" : "text"}
                inputMode={def.type === "number" ? "numeric" : undefined}
                min={def.min}
                max={def.max}
                maxLength={def.maxLength}
                value={values[def.key] ?? ""}
                placeholder={defaults[def.key] || "unset"}
                onChange={(e) => {
                  setSaved(false);
                  setValues((prev) => ({ ...prev, [def.key]: e.target.value }));
                }}
                className={inputCls}
              />
              <p className="text-xs text-zinc-500">
                {def.hint}
                {active
                  ? ` Override active — clear the field to revert to ${defaults[def.key] || "the built-in default"}.`
                  : defaults[def.key]
                    ? ` Default: ${defaults[def.key]}`
                    : " No default set."}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={submit} loading={busy}>
          Save settings
        </Button>
        <p role="status" className="text-sm text-zinc-600">
          {busy ? "Saving…" : saved ? "Saved." : ""}
        </p>
      </div>
    </div>
  );
}
