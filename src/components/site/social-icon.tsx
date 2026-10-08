import { Facebook, Globe, Instagram, Linkedin, MessageCircle, Music2, Twitter, Youtube } from "lucide-react";

const ICONS: Record<string, typeof Globe> = {
  instagram: Instagram,
  facebook: Facebook,
  twitter: Twitter,
  x: Twitter,
  youtube: Youtube,
  linkedin: Linkedin,
  tiktok: Music2,
  whatsapp: MessageCircle,
};

export function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  const Icon = ICONS[platform.toLowerCase()] ?? Globe;
  return <Icon className={className} />;
}
