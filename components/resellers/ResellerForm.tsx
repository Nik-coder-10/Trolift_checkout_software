"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { contactConfig } from "@/config/contact";
import {
  RESELLER_MESSAGE_MAX,
  RESELLER_MESSAGE_MIN,
} from "@/lib/resellers/validation";

/**
 * Reseller-enquiry column: name + required callback number + optional
 * business name + the requirements in their own words. Trade rates are
 * not published per item — this form is how a reseller asks for them.
 *
 * No email field, same as the contact form: the enquiry is delivered
 * to our inbox and we call the number they left. Client validation
 * mirrors `validateResellerEnquiry`; the server still has the final
 * word and its field errors are surfaced verbatim.
 */

type Status = "idle" | "sending" | "sent" | "error";

const INPUT =
  "h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-700";
const LABEL = "block text-sm font-semibold text-zinc-800";
const ERROR = "mt-1 block text-xs font-semibold text-red-600";

function clientErrors(name: string, phone: string, message: string) {
  const errors: Record<string, string> = {};
  if (name.trim().length < 2) errors.name = "Please tell us your name.";
  const digits = phone.trim().replace(/[^\d]/g, "").replace(/^(91|0)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) {
    errors.phone = "Leave a mobile number so we can call you back.";
  }
  const trimmed = message.trim();
  if (trimmed.length < RESELLER_MESSAGE_MIN) {
    errors.message = `Tell us what you need in at least ${RESELLER_MESSAGE_MIN} characters — equipment types, quantities, cities.`;
  } else if (trimmed.length > RESELLER_MESSAGE_MAX) {
    errors.message = `Keep your requirements under ${RESELLER_MESSAGE_MAX} characters.`;
  }
  return errors;
}

export function ResellerForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const sending = status === "sending";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;

    const local = clientErrors(name, phone, message);
    if (Object.keys(local).length > 0) {
      setFieldErrors(local);
      setFormError(null);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setStatus("sending");

    try {
      const res = await fetch("/api/resellers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, business, message, company }),
      });
      const data: unknown = await res.json().catch(() => null);
      const failure =
        typeof data === "object" && data !== null && "error" in data
          ? (data as { error?: { message?: string; details?: unknown } }).error
          : undefined;

      if (res.ok) {
        setStatus("sent");
        setName("");
        setPhone("");
        setBusiness("");
        setMessage("");
        return;
      }

      setStatus("error");
      setFormError(
        failure?.message ??
          "We could not send your enquiry right now. Please call us instead.",
      );
      const details = failure?.details;
      if (details !== null && typeof details === "object") {
        setFieldErrors(details as Record<string, string>);
      }
    } catch {
      const fallback = contactConfig.phones[0]?.display ?? contactConfig.email;
      setStatus("error");
      setFormError(
        `We could not reach the server. Please try again, or call us on ${fallback}.`,
      );
    }
  }

  if (status === "sent") {
    return (
      <div
        aria-live="polite"
        className="rounded-lg border border-zinc-200 bg-white p-6"
      >
        <h2 className="text-xl font-extrabold tracking-tight text-zinc-900">
          Thanks — your requirements are with our sales team.
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          We will call you on the number you left to talk through volumes and
          trade rates. Prefer to call us right now?
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {contactConfig.phones.map((line) => (
            <a
              key={line.tel}
              href={`tel:${line.tel}`}
              className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
            >
              {line.display}
            </a>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 text-sm font-semibold text-brand-700 hover:underline"
        >
          Send another enquiry
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Send a reseller enquiry"
      className="rounded-lg border border-zinc-200 bg-white p-6"
    >
      <h2 className="text-xl font-extrabold tracking-tight text-zinc-900">
        Send us your requirements
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600">
        Tell us what you move and how often — equipment types, quantities,
        cities. Our team calls you back with trade rates; no email address
        needed.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        <div>
          <label className={LABEL} htmlFor="reseller-name">
            Your name
          </label>
          <input
            id="reseller-name"
            name="name"
            className={`mt-1 ${INPUT}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={100}
            required
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? "reseller-name-error" : undefined}
          />
          {fieldErrors.name ? (
            <span className={ERROR} id="reseller-name-error">
              {fieldErrors.name}
            </span>
          ) : null}
        </div>

        <div>
          <label className={LABEL} htmlFor="reseller-phone">
            Mobile number
          </label>
          <input
            id="reseller-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            className={`mt-1 ${INPUT}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="+91 98765 43210"
            required
            aria-invalid={fieldErrors.phone ? true : undefined}
            aria-describedby={fieldErrors.phone ? "reseller-phone-error" : undefined}
          />
          {fieldErrors.phone ? (
            <span className={ERROR} id="reseller-phone-error">
              {fieldErrors.phone}
            </span>
          ) : null}
        </div>

        <div>
          <label className={LABEL} htmlFor="reseller-business">
            Business name{" "}
            <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="reseller-business"
            name="business"
            className={`mt-1 ${INPUT}`}
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
            autoComplete="organization"
            maxLength={120}
            placeholder="Firm / dealership name"
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="reseller-message">
            Your requirements
          </label>
          <textarea
            id="reseller-message"
            name="message"
            rows={6}
            className={`mt-1 resize-y py-2 ${INPUT}`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={RESELLER_MESSAGE_MAX}
            placeholder="Equipment types, monthly quantities, delivery cities — and your GSTIN if you have one."
            required
            aria-invalid={fieldErrors.message ? true : undefined}
            aria-describedby={fieldErrors.message ? "reseller-message-error" : undefined}
          />
          {fieldErrors.message ? (
            <span className={ERROR} id="reseller-message-error">
              {fieldErrors.message}
            </span>
          ) : null}
        </div>

        {/* Honeypot: hidden from people, tempting for bots. */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="reseller-company">Company</label>
          <input
            id="reseller-company"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>

        {formError ? (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
          >
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={sending}
          className="inline-flex h-12 cursor-pointer items-center justify-center rounded-md bg-amber-400 px-6 text-base font-bold text-brand-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send enquiry"}
        </button>
      </div>
    </form>
  );
}
