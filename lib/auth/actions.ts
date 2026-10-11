"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";

/**
 * Admin auth actions (email + password, Supabase Auth).
 * Admin rights still come from profiles.is_admin — signing in alone
 * grants nothing; the protected layout enforces the role server-side.
 *
 * Sign-in attempts are rate-limited per client IP ("auth" bucket:
 * tight brute-force budget, fail closed) via next/headers. Server
 * actions receive no Request object, so a synthetic one carries the
 * incoming headers for client identification only — no PII is stored.
 */
export async function signInAdmin(formData: FormData): Promise<void> {
  const headerList = await headers();
  const denied = await denyIfLimited(
    "auth",
    await checkRateLimit(
      new Request("http://localhost/admin/login", {
        method: "POST",
        headers: new Headers(headerList),
      }),
      "auth",
    ),
  );
  if (denied) {
    redirect("/admin/login?error=Too%20many%20attempts.%20Try%20again%20shortly.");
  }
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  let errorMessage: string | null = null;
  if (email !== "" && password !== "") {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    errorMessage = error ? "Invalid email or password." : null;
  } else {
    errorMessage = "Enter your email and password.";
  }
  if (errorMessage) {
    redirect(`/admin/login?error=${encodeURIComponent(errorMessage)}`);
  }
  redirect("/admin");
}

export async function signOutAdmin(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
