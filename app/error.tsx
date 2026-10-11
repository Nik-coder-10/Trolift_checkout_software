"use client";

import { useEffect } from "react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

function extractReferenceId(error: Error): string | null {
  if ("referenceId" in error && typeof (error as { referenceId: unknown }).referenceId === "string") {
    return (error as { referenceId: string }).referenceId;
  }
  if ("digest" in error && typeof (error as { digest: unknown }).digest === "string") {
    return (error as { digest: string }).digest;
  }
  return null;
}

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] Route error:", error);
  }, [error]);

  const referenceId = extractReferenceId(error);

  return (
    <Container>
      <div role="alert" className="flex flex-col items-start gap-3 py-10">
        <h1 className="text-xl font-bold text-zinc-900">Something went wrong.</h1>
        <p className="max-w-md text-sm text-zinc-500">
          Please try again. If the problem persists, contact Trolift support.
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
