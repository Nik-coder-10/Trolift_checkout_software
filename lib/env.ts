/**
 * Typed, validated access to environment variables.
 *
 * - `publicEnv`  — safe for the browser (NEXT_PUBLIC_* only).
 * - `serverEnv`  — server-only; throws a clear error if a required
 *   secret is missing instead of failing silently downstream.
 *
 * Never import serverEnv (or anything that imports it) from client
 * components. The Supabase service-role key and the owner UPI id stay
 * on the server.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
        `See .env.example and copy it to .env.local.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const publicEnv = {
  siteUrl: optional("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),
  supabaseUrl: optional("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: optional("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
} as const;

/** Call only inside server code (Route Handlers / Server Components). */
export function serverEnv() {
  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    ownerUpiId: optional("OWNER_UPI_ID"),
    ownerUpiPayeeName: optional("OWNER_UPI_PAYEE_NAME"),
    /** IANA timezone used for business-day boundaries (dashboards, reports). */
    businessTimezone: optional("BUSINESS_TIMEZONE", "Asia/Kolkata"),
  } as const;
}

/** True when the minimum Supabase config is present (lets UI degrade). */
export function hasSupabaseConfig(): boolean {
  return (
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") !== "" &&
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "") !== ""
  );
}
