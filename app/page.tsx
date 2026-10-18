import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";
import { Hero } from "@/components/home/Hero";
import { ProofBand } from "@/components/home/ProofBand";
import { FeaturedProducts } from "@/components/home/FeaturedProducts";
import { TrustSection } from "@/components/home/TrustSection";
import { ContactCTA } from "@/components/home/ContactCTA";

export const metadata: Metadata = {
  title: "Trolift Solutions — Material-Handling Equipment, Ordered Simply",
  description:
    "Ladders, platform trolleys and material-handling equipment with transparent B2B pricing, GST invoicing and pan-India delivery.",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProofBand />
      <Container className="flex flex-col gap-12 py-10 sm:py-14">
        <FeaturedProducts />
        <TrustSection />
        <ContactCTA />
      </Container>
    </>
  );
}
