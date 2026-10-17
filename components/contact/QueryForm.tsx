"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { contactConfig } from "@/config/contact";
import {
  CONTACT_MESSAGE_MAX,
  CONTACT_MESSAGE_MIN,
} from "@/lib/contact/validation";

/**
 * Contact-form column: name + optional callback number + query.
 *
 * Deliberately NO email field — the query is delivered to our own
 * inbox and we call the visitor back on the number they left (or
 * none). Client validation mirrors `validateContactQuery` so the
 * usual mistake is caught before a round-trip; the server still has
 * the final word and its field errors are surfaced verbatim.
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
  if (phone.trim() !== "" && !/^[6-9]\d{9}$/.test(digits)) {
    errors.phone = "Enter a valid 10-digit Indian mobile number.";
  }
  const trimmed = message.trim();
  if (trimmed.length < CONTACT_MESSAGE_MIN) {
    errors.message = `Please describe your query in at least ${CONTACT_MESSAGE_MIN} characters.`;
  } else if (trimmed.length > CONTACT_MESSAGE_MAX) {
    errors.message = `Keep your query under ${CONTACT_MESSAGE_MAX} characters.`;
  }
  return errors;
}

export function QueryForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, message, company }),
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
        setMessage("");
        return;
      }

      setStatus("error");
      setFormError(
        failure?.message ??
          "We could not send your query right now. Please call us instead.",
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
          Thanks — your query is with us.
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          It landed straight in our inbox and we will get back to you. Need a
          quicker answer? Call us:
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
          Send another query
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Send us a query"
      className="rounded-lg border border-zinc-200 bg-white p-6"
    >
      <h2 className="text-xl font-extrabold tracking-tight text-zinc-900">
        Send us your query
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-zinc-600">
        It goes straight to our team&apos;s inbox — no email address needed.
        Leave a number and we will call you back.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        <div>
          <label className={LABEL} htmlFor="contact-name">
            Your name
          </label>
          <input
            id="contact-name"
            name="name"
            className={`mt-1 ${INPUT}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={100}
            required
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? "contact-name-error" : undefined}
          />
          {fieldErrors.name ? (
            <span className={ERROR} id="contact-name-error">
              {fieldErrors.name}
            </span>
          ) : null}
        </div>

        <div>
          <label className={LABEL} htmlFor="contact-phone">
            Phone number{" "}
            <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="contact-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            className={`mt-1 ${INPUT}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="+91 98765 43210"
            aria-invalid={fieldErrors.phone ? true : undefined}
            aria-describedby={fieldErrors.phone ? "contact-phone-error" : undefined}
          />
          {fieldErrors.phone ? (
            <span className={ERROR} id="contact-phone-error">
              {fieldErrors.phone}
            </span>
          ) : null}
        </div>

        <div>
          <label className={LABEL} htmlFor="contact-message">
            Your query
          </label>
          <textarea
            id="contact-message"
            name="message"
            rows={6}
            className={`mt-1 resize-y py-2 ${INPUT}`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={CONTACT_MESSAGE_MAX}
            placeholder="Equipment, quantity, delivery pincode — whatever you need quoted."
            required
            aria-invalid={fieldErrors.message ? true : undefined}
            aria-describedby={fieldErrors.message ? "contact-message-error" : undefined}
          />
          {fieldErrors.message ? (
            <span className={ERROR} id="contact-message-error">
              {fieldErrors.message}
            </span>
          ) : null}
        </div>

        {/* Honeypot: hidden from people, tempting for bots. */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="contact-company">Company</label>
          <input
            id="contact-company"
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
          {sending ? "Sending…" : "Send query"}
        </button>
      </div>
    </form>
  );
}
