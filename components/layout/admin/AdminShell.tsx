"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AdminHeader } from "@/components/layout/admin/AdminHeader";
import { AdminSidebar } from "@/components/layout/admin/AdminSidebar";

/**
 * Authenticated admin shell: static sidebar on desktop (lg+), slide-in
 * drawer with overlay on mobile/tablet. Escape closes the drawer.
 */
export function AdminShell({
  title,
  subtitle,
  activeHref,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Defaults to the current pathname. */
  activeHref?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = activeHref ?? pathname;
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer ]);

  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white p-3 lg:block">
        <div className="flex items-center gap-2 px-3 py-2">
          <Image
            src="/images/logo-transparent.png"
            alt="Trolift Admin"
            width={110}
            height={34}
            className="h-8 w-auto object-contain"
          />
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 uppercase">
            Admin
          </span>
        </div>
        <AdminSidebar activeHref={current} />
      </aside>

      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-brand-950/60"
            onClick={() => setDrawer(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-white p-3 shadow-xl">
            <div className="flex items-center justify-between px-1 py-1">
              <div className="flex items-center gap-2 px-2">
                <Image
                  src="/images/logo-transparent.png"
                  alt="Trolift Admin"
                  width={110}
                  height={34}
                  className="h-8 w-auto object-contain"
                />
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 uppercase">
                  Admin
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close admin navigation"
                className="cursor-pointer rounded p-2 text-zinc-600 hover:bg-zinc-100"
              >
                <span aria-hidden className="block text-lg leading-none">×</span>
              </button>
            </div>
            <AdminSidebar activeHref={current} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader
          title={title}
          subtitle={subtitle}
          onMenu={() => setDrawer(true)}
          actions={actions}
        />
        <main className="flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
