import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { getSessionUser, isAdmin } from "@/lib/auth/session";
import { signInAdmin } from "@/lib/auth/actions";

export const metadata: Metadata = {
  title: "Admin Sign In",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Staff sign-in (public route; the protected layout enforces roles). */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Already-signed-in admins skip straight through. Any failure here
  // (e.g. Supabase unlinked) simply renders the form.
  try {
    const user = await getSessionUser();
    if (user && (await isAdmin())) {
      redirect("/admin");
    }
  } catch {
    // Render the form; submission surfaces the configuration error.
  }
  const sp = await searchParams;
  const raw = sp["error"];
  const error = Array.isArray(raw) ? raw[0] : raw;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <Image
            src="/images/logo-transparent.png"
            alt="Trolift Admin"
            width={120}
            height={36}
            className="h-9 w-auto object-contain"
            priority
          />
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 uppercase">
            Admin
          </span>
        </div>
        <h1 className="mt-3 text-xl font-bold text-zinc-900">Staff sign in</h1>
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <form action={signInAdmin} className="mt-4 flex flex-col gap-4">
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
