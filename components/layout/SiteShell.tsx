import * as React from "react";
import { CartProvider } from "@/components/cart/CartProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { FestiveBanner } from "@/components/layout/FestiveBanner";

/** Public layout shell: providers, skip link, navbar, main, footer. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-paper text-ink">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <CartProvider>
        <ToastProvider>
          <FestiveBanner />
          <Navbar />
          <main id="main-content" className="flex flex-1 flex-col">
            {children}
          </main>
          <Footer />
        </ToastProvider>
      </CartProvider>
    </div>
  );
}
