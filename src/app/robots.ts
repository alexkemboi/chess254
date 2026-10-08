import type { MetadataRoute } from "next";
import { siteUrl } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/dashboard", "/coach", "/pay", "/invoices", "/api", "/media", "/verify-email", "/reset-password"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
