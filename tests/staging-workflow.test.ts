import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

vi.mock("server-only", () => ({}));

import { checkRateLimit, denyIfLimited, resetRateLimits, routeLimit } from "@/lib/rate-limit/index";

const REPO = join(__dirname, "..");

function routeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (name === "route.ts") {
        out.push(full);
      }
    }
  };
  walk(join(REPO, "app", "api"));
  return out.sort();
}

describe("rate-limit route coverage (static contract)", () => {
  it("every API route except /api/health enforces a budget", () => {
    const missing: string[] = [];
    for (const file of routeFiles()) {
      const rel = file.replace(`${REPO}${sep}`, "");
      if (rel === join("app", "api", "health", "route.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes("denyIfLimited") || !src.includes("checkRateLimit")) {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every exported handler call site passes an explicit category", () => {
    // denyIfLimited("category", ...) — a bare call with no category
    // string would silently share one bucket.
    const bad: string[] = [];
    for (const file of routeFiles()) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/denyIfLimited\(\s*(?:"([^"]*)"|([A-Za-z_$][\w$]*))/g)) {
        if (m[1] === undefined || m[1] === "") bad.push(`${file}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("admin sign-in attempts are budgeted through the auth category", () => {
    const src = readFileSync(join(REPO, "lib", "auth", "actions.ts"), "utf8");
    expect(src).toContain('checkRateLimit(');
    expect(src).toContain('"auth"');
    const policy = routeLimit("auth");
    expect(policy.limit).toBeGreaterThan(0);
    expect(policy.limit).toBeLessThanOrEqual(10);
    expect(policy.onBackendError).toBe("closed");
  });

  it("auth budget is env-overridable for the staging suite", () => {
    process.env.RATE_LIMIT_AUTH_PER_MIN = "1000";
    try {
      expect(routeLimit("auth").limit).toBe(1000);
    } finally {
      delete process.env.RATE_LIMIT_AUTH_PER_MIN;
    }
  });

  it("staging webServer raises the auth budget like every other bucket", () => {
    const src = readFileSync(join(REPO, "playwright.staging.config.ts"), "utf8");
    expect(src).toContain("RATE_LIMIT_AUTH_PER_MIN");
  });

  it(".env.example documents the auth budget variable (name only)", () => {
    const src = readFileSync(join(REPO, ".env.example"), "utf8");
    const line = src.split("\n").find((l) => l.startsWith("RATE_LIMIT_AUTH_PER_MIN"));
    expect(line).toBe("RATE_LIMIT_AUTH_PER_MIN=");
  });
});

describe("admin budget enforcement", () => {
  it("admin mutations share a generous budget, then 429 with Retry-After", async () => {
    resetRateLimits();
    try {
      const limit = routeLimit("admin").limit;
      expect(limit).toBeGreaterThanOrEqual(100);
      const req = () => new Request("http://localhost/x", { method: "POST" });
      for (let i = 0; i < limit; i++) {
        expect((await checkRateLimit(req(), "admin")).allowed).toBe(true);
      }
      const denied = await denyIfLimited("admin", await checkRateLimit(req(), "admin"));
      expect(denied?.status).toBe(429);
      expect(denied?.headers.get("Retry-After")).toMatch(/^\d+$/);
    } finally {
      resetRateLimits();
    }
  });

  it("auth budget trips fast under a login flood", async () => {
    resetRateLimits();
    try {
      const limit = routeLimit("auth").limit;
      const req = () => new Request("http://localhost/admin/login", { method: "POST" });
      for (let i = 0; i < limit; i++) {
        expect((await checkRateLimit(req(), "auth")).allowed).toBe(true);
      }
      const denied = await denyIfLimited("auth", await checkRateLimit(req(), "auth"));
      expect(denied?.status).toBe(429);
    } finally {
      resetRateLimits();
    }
  });
});

describe("staging workflow safety (static contract)", () => {
  const workflow = () => readFileSync(join(REPO, ".github", "workflows", "staging-e2e.yml"), "utf8");

  it("is manual-dispatch only", () => {
    const src = workflow();
    expect(src).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(src).not.toMatch(/^\s+(push|pull_request|schedule|workflow_call):/m);
  });

  it("targets loopback services only — no remote URLs, no secrets", () => {
    const src = workflow();
    expect(src).toContain("127.0.0.1");
    expect(src).not.toMatch(/secrets\./);
    expect(src).not.toMatch(/https:\/\/[A-Za-z0-9]/);
  });

  it("has no dead fork guard", () => {
    // No `if:` condition may reference repository_owner (the old
    // no-op). Mentions inside explanatory comments are fine.
    const conditions = workflow()
      .split("\n")
      .filter((l) => l.trim().startsWith("if:"));
    expect(conditions.join("\n")).not.toContain("repository_owner");
  });

  it("boots the disposable stack, migrates, seeds, and cleans up", () => {
    const src = workflow();
    expect(src).toContain("supabase start");
    expect(src).toContain("supabase db reset");
    // Defensive: `db reset` on some CLI versions caps at a stale
    // version and skips the newest file — `migration up` plus the
    // parity check below close that hole.
    expect(src).toContain("supabase migration up");
    expect(src).toContain("supabase stop");
  });

  it("fails closed: stack health verified before browsers launch", () => {
    const src = workflow();
    expect(src).toMatch(/curl -fsS http:\/\/127\.0\.0\.1:54321/);
  });

  it("fails closed: applied migrations must match the tree", () => {
    const src = workflow();
    expect(src).toContain("schema_migrations");
    expect(src).toContain('test "$tree_max" = "$db_max"');
  });

  it("never prints secrets, tokens, or connection strings", () => {
    const src = workflow();
    for (const line of src.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      expect(trimmed).not.toMatch(/echo .*\$(ANON_KEY|SERVICE_ROLE_KEY|TOKEN|SECRET)/);
    }
    // The human-readable `supabase status` prints local dev keys; only
    // the machine-readable `-o env` form (piped through grep into
    // shell variables, never echoed) may appear in run steps.
    for (const line of src.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      if (trimmed.includes("supabase status")) {
        expect(trimmed).toContain("-o env");
      }
    }
  });

  it("bounds the run and keeps failure artifacts", () => {
    const src = workflow();
    expect(src).toMatch(/timeout-minutes:\s*\d+/);
    expect(src).toContain("upload-artifact");
  });
});

describe("staging production guards (live config behavior)", () => {
  // Invoke the Playwright CLI JS directly with node: no shell, no npx
  // shim (Windows cannot execFile extensionless shims), no network.
  // `--list` loads the config (running every guard) without launching
  // browsers or the webServer.
  const CLI = join(REPO, "node_modules", "@playwright", "test", "cli.js");
  function listConfig(env: Record<string, string>): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      // execFile rejects non-string env values (EINVAL) — scrub first.
      // (ProcessEnv requires NODE_ENV in its type; the loop below
      // always copies it when present, the cast covers when absent.)
      const cleanEnv = {} as NodeJS.ProcessEnv;
      for (const [k, v] of Object.entries({ ...process.env, ...env })) {
        if (typeof v === "string") cleanEnv[k] = v;
      }
      execFile(
        process.execPath,
        [CLI, "test", "--config=playwright.staging.config.ts", "--list"],
        {
          cwd: REPO,
          env: cleanEnv,
          timeout: 180_000,
        },
        (error: Error | null, stdout: string, stderr: string) => {
          // execFile errors on non-zero exit; the guard output is what matters.
          // Playwright prints config-load failures on stdout, so combine both.
          resolve({ code: error ? (error as { code?: number }).code ?? 1 : 0, output: `${stdout}\n${stderr}` });
        },
      );
    });
  }

  it("B1 refuses without STAGING_E2E_ENABLED=1", async () => {
    const r = await listConfig({ STAGING_E2E_ENABLED: "" });
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("STAGING_E2E_ENABLED is not 1");
  }, 200_000);

  it("B2 refuses a non-loopback STAGING_BASE_URL", async () => {
    const r = await listConfig({
      STAGING_E2E_ENABLED: "1",
      STAGING_BASE_URL: "https://staging.example.com",
      STAGING_SUPABASE_URL: "http://127.0.0.1:54321",
      STAGING_SUPABASE_ANON_KEY: "x",
      STAGING_SERVICE_ROLE_KEY: "y",
    });
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("STAGING_BASE_URL must be loopback");
  }, 200_000);

  it("B3 refuses a non-loopback STAGING_SUPABASE_URL", async () => {
    const r = await listConfig({
      STAGING_E2E_ENABLED: "1",
      STAGING_BASE_URL: "http://127.0.0.1:3100",
      STAGING_SUPABASE_URL: "https://prod.supabase.co",
      STAGING_SUPABASE_ANON_KEY: "x",
      STAGING_SERVICE_ROLE_KEY: "y",
    });
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("STAGING_SUPABASE_URL must be loopback");
  }, 200_000);

  it("B4 refuses when a required key is missing", async () => {
    const r = await listConfig({
      STAGING_E2E_ENABLED: "1",
      STAGING_BASE_URL: "http://127.0.0.1:3100",
      STAGING_SUPABASE_URL: "http://127.0.0.1:54321",
      STAGING_SUPABASE_ANON_KEY: "",
      STAGING_SERVICE_ROLE_KEY: "y",
    });
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("Missing required env var STAGING_SUPABASE_ANON_KEY");
  }, 200_000);
});
