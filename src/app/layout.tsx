import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { getAllSettings, siteUrl } from "@/server/settings";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Inter_Tight({ subsets: ["latin"], weight: ["600", "700", "800", "900"], variable: "--font-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-mono", display: "swap" });

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

export const viewport: Viewport = { themeColor: "#050506", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { brand } = await getAllSettings();
  return (
    <html lang="en" className={`dark ${inter.variable} ${display.variable} ${mono.variable}`} style={{ "--brand": brand.primaryColor } as React.CSSProperties}>
      <body className="min-h-dvh">
        {children}
        <Toaster theme="dark" position="top-center" richColors closeButton toastOptions={{ style: { background: "#121418", border: "1px solid rgb(255 255 255 / .1)" } }} />
      </body>
    </html>
  );
}
