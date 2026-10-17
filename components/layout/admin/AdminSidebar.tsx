import Link from "next/link";

export interface AdminNavItem {
  label: string;
  href: string;
  /** Simple glyph identifier for the inline icon. */
  icon: "dashboard" | "box" | "users" | "orders" | "payments" | "ticket" | "truck" | "settings";
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", icon: "dashboard" },
  { label: "Products", href: "/admin/products", icon: "box" },
  { label: "Customers", href: "/admin/customers", icon: "users" },
  { label: "Orders", href: "/admin/orders", icon: "orders" },
  { label: "Payments", href: "/admin/payments", icon: "payments" },
  { label: "Coupons", href: "/admin/coupons", icon: "ticket" },
  { label: "Delivery", href: "/admin/delivery", icon: "truck" },
  { label: "Settings", href: "/admin/settings", icon: "settings" },
];

function Icon({ name }: { name: AdminNavItem["icon"] }) {
  const paths: Record<AdminNavItem["icon"], string> = {
    dashboard: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z",
    box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
    users: "M8 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.5-5 5-5s5 2 5 5M16 8a3 3 0 010 6M18 15c2 .8 3 2.4 3 5",
    orders: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
    payments: "M3 7h18v10H3zM3 10h18M7 15h4",
    ticket: "M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4z",
    truck: "M2 6h12v10H2zM14 10h4l4 4v2h-8M6 19a1.8 1.8 0 100-3.6A1.8 1.8 0 006 19zM18 19a1.8 1.8 0 100-3.6A1.8 1.8 0 0018 19z",
    settings: "M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h3M17 12h3M12 4v3M12 17v3",
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={paths[name]} />
    </svg>
  );
}

/** Admin sidebar nav (desktop static, mobile drawer — see AdminShell). */
export function AdminSidebar({
  activeHref,
  onNavigate,
}: {
  activeHref: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Admin">
      <p className="px-3 pt-1 pb-2 text-[11px] font-bold tracking-[0.14em] text-zinc-500 uppercase">
        Manage
      </p>
      <ul className="flex flex-col gap-0.5">
        {ADMIN_NAV.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold ${
                  active
                    ? "bg-brand-800 text-white"
                    : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
