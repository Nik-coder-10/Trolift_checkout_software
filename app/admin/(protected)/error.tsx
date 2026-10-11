"use client";

import { useEffect } from "react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] Admin error:", error);
  }, [error]);

  const referenceId =
    "digest" in error && typeof error.digest === "string"
      ? error.digest
      : "referenceId" in error && typeof (error as { referenceId: unknown }).referenceId === "string"
        ? (error as { referenceId: string }).referenceId
        : null;

  return (
    <Container>
      <div role="alert" className="flex flex-col items-start gap-3 py-10">
        <h1 className="text-xl font-bold text-zinc-900">Admin panel unavailable.</h1>
        <p className="max-w-md text-sm text-zinc-500">
          Something went wrong while loading the admin panel. Please try again.
        </p>
        {referenceId && (
          <p className="text-xs text-zinc-400">
            Reference: <span className="font-mono">{referenceId}</span>
          </p>
        )}
        <Button onClick={reset} variant="secondary">
          Try again
        </Button>
      </div>
    </Container>
  );
}
