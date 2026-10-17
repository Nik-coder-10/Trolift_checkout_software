"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { AdminCoupon } from "@/lib/admin/coupons";
import type { ApiResponse } from "@/types/api";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
  })}`;
}

/** Create/edit redeem-code dialog (code, rupee discount, window, flags). */
export function CouponDialog({
  coupon,
  onClose,
}: {
  coupon: AdminCoupon | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState(coupon?.code ?? "");
  const [discountRupees, setDiscountRupees] = useState(
    coupon ? String(coupon.discountPaise / 100) : "",
  );
  const [firstOrderOnly, setFirstOrderOnly] = useState(
    coupon?.firstOrderOnly ?? false,
  );
  const [isActive, setIsActive] = useState(coupon?.isActive ?? true);
  const [validFrom, setValidFrom] = useState(toLocalInput(coupon?.validFrom ?? null));
  const [validUntil, setValidUntil] = useState(toLocalInput(coupon?.validUntil ?? null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        coupon ? `/api/admin/coupons/${coupon.id}` : "/api/admin/coupons",
        {
          method: coupon ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            discountRupees: Number(discountRupees),
            firstOrderOnly,
            isActive,
            validFrom: validFrom === "" ? null : new Date(validFrom).toISOString(),
            validUntil: validUntil === "" ? null : new Date(validUntil).toISOString(),
          }),
        },
      );
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={coupon ? `Edit ${coupon.code}` : "New redeem code"}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={busy}>
            Save code
          </Button>
        </>
      }
    >
      {error ? (
        <Alert tone="error" title="Could not save">
          {error}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-3">
        <Input
          label="Code"
          value={code}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Input
          label="Discount (₹)"
          type="number"
          min={1}
          step="0.01"
          value={discountRupees}
          onChange={(e) => setDiscountRupees(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Valid from (optional)"
            type="datetime-local"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <Input
            label="Valid until (optional)"
            type="datetime-local"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-800">
          <input
            type="checkbox"
            checked={firstOrderOnly}
            onChange={(e) => setFirstOrderOnly(e.target.checked)}
            className="h-4 w-4 accent-brand-800"
          />
          First-time buyers only (matched by mobile number)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-800">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-brand-800"
          />
          Active
        </label>
      </div>
    </Modal>
  );
}

/** One-click activate/deactivate for a redeem code. */
function CouponToggle({ coupon }: { coupon: AdminCoupon }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/coupons/${coupon.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: coupon.code,
          discountRupees: coupon.discountPaise / 100,
          firstOrderOnly: coupon.firstOrderOnly,
          isActive: !coupon.isActive,
          validFrom: coupon.validFrom,
          validUntil: coupon.validUntil,
        }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <Alert tone="error" title="Action failed">{error}</Alert>;
  }
  return (
    <Button
      size="sm"
      variant={coupon.isActive ? "secondary" : "primary"}
      onClick={() => void run()}
      loading={busy}
    >
      {coupon.isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}

function validity(coupon: AdminCoupon): string {
  const from = coupon.validFrom ? formatDate(coupon.validFrom) : null;
  const until = coupon.validUntil ? formatDate(coupon.validUntil) : null;
  if (from && until) return `${from} – ${until}`;
  if (until) return `Until ${until}`;
  if (from) return `From ${from}`;
  return "No expiry";
}

/** Redeem codes section: list + create/edit dialog + activate toggles. */
export function CouponManager({ coupons }: { coupons: AdminCoupon[] }) {
  const [editing, setEditing] = useState<AdminCoupon | "new" | null>(null);

  return (
    <section aria-label="Redeem codes" className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-zinc-900">Redeem codes</h2>
          <p className="mt-1 text-sm text-zinc-600">
            One code per order. The server re-checks every code when an order
            is placed — this list is the source of truth.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          + New redeem code
        </Button>
      </div>
      {editing ? (
        <CouponDialog
          coupon={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {coupons.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No redeem codes yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {coupons.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-900">
                  {c.code}{" "}
                  <span className="font-normal text-zinc-500">
                    · {money(c.discountPaise)} off
                  </span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2">
                  {c.isActive ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="neutral">Inactive</Badge>
                  )}
                  {c.firstOrderOnly ? (
                    <Badge tone="neutral">First order only</Badge>
                  ) : null}
                  <span className="text-xs text-zinc-500">{validity(c)}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="inline-flex h-9 cursor-pointer items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  Edit
                </button>
                <CouponToggle coupon={c} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        Expired codes are rejected at checkout even while marked active.
      </p>
    </section>
  );
}
