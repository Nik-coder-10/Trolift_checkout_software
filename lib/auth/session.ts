import { createClient } from "@/lib/supabase/server";

/**
 * Auth helpers for server code.
 * Admin rights come from public.profiles.is_admin, flipped only via the
 * service-role key (no public UPDATE policy exists — see 0006_rls.sql).
 */
export async function getSessionUser() {
  // Fail closed: an unreachable/misconfigured backend (or any client
  // construction failure) means "no authenticated user", never a 500
  // that could mask the authorization decision. requireUser() then
  // yields a clean 401 and the admin layout its sign-in gate.
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return null;
  }
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) return null;
    return user;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    const { AppError } = await import("@/lib/api/errors");
    throw new AppError("UNAUTHORIZED", "Please sign in to continue.", 401);
  }
  return user;
}

/** True when the session user has profiles.is_admin = true. */
export async function isAdmin(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (error) return false;
    const row = data as { is_admin: boolean } | null;
    return row?.is_admin === true;
  } catch {
    return false;
  }
}

export async function requireAdmin() {
  const user = await requireUser();
  // Reuse the user from requireUser() instead of calling getSessionUser() again
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      const { AppError } = await import("@/lib/api/errors");
      throw new AppError("FORBIDDEN", "You do not have access to this resource.", 403);
    }
    const row = data as { is_admin: boolean } | null;
    if (row?.is_admin !== true) {
      const { AppError } = await import("@/lib/api/errors");
      throw new AppError(
        "FORBIDDEN",
        "You do not have access to this resource.",
        403,
      );
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AppError") throw e;
    const { AppError } = await import("@/lib/api/errors");
    throw new AppError("FORBIDDEN", "You do not have access to this resource.", 403);
  }
  return user;
}
