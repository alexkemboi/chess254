import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Caveat, DM_Sans, Instrument_Serif } from "next/font/google";
import { getAllSettings, siteUrl } from "@/server/settings";
import { ThemedToaster } from "@/components/theme";
import { themeScript } from "@/lib/theme-script";
import "./globals.css";

// Same type system as chess254.vercel.app: Bricolage Grotesque headings, DM Sans body,
// Instrument Serif italic accents and Caveat handwritten notes.
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-dm", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-bricolage", display: "swap" });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-caveat", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { seo, general, brand } = await getAllSettings();
  const base = await siteUrl();
  const title = seo.defaultTitle || general.siteName;
  return {
    metadataBase: new URL(base),
    title: { default: title, template: seo.titleTemplate.includes("%s") ? seo.titleTemplate : `%s · ${general.siteName}` },
    description: seo.defaultDescription || undefined,
    keywords: seo.keywords ? seo.keywords.split(",").map((k) => k.trim()) : undefined,
    applicationName: general.siteName,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: general.siteName, title, description: seo.defaultDescription || undefined, images: brand.ogImage ? [brand.ogImage] : undefined, locale: "en_KE" },
    twitter: { card: "summary_large_image", title, description: seo.defaultDescription || undefined, site: seo.twitterHandle || undefined, images: brand.ogImage ? [brand.ogImage] : undefined },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { brand } = await getAllSettings();
  return (
    <html lang="en" className={`light ${dmSans.variable} ${bricolage.variable} ${instrument.variable} ${caveat.variable}`} style={{ "--brand": brand.primaryColor } as React.CSSProperties} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <ThemedToaster />
      </body>
    </html>
  );
}
