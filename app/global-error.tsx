"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const referenceId =
    "digest" in error && typeof error.digest === "string"
      ? error.digest
      : "referenceId" in error && typeof (error as { referenceId: unknown }).referenceId === "string"
        ? (error as { referenceId: string }).referenceId
        : null;

  return (
    <html lang="en">
      <body>
        <div
          role="alert"
          style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}
        >
          <h1>Something went wrong.</h1>
          <p>Please reload the page. If the problem persists, contact support.</p>
          {referenceId && (
            <p style={{ fontSize: 12, color: "#666" }}>
              Reference: <span style={{ fontFamily: "monospace" }}>{referenceId}</span>
            </p>
          )}
          <button onClick={reset} style={{ marginTop: 12 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
