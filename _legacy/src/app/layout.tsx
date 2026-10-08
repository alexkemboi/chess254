import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess254 Clubhouse",
  description: "A home for chess, learning and community in Westlands, Nairobi.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
