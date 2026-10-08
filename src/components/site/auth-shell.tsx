import { Img } from "@/components/ui/img";
import { getAllSettings } from "@/server/settings";

export async function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  const { brand, general } = await getAllSettings();
  return (
    <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl lg:grid-cols-2">
      <div className="flex items-center px-4 py-14 sm:px-10">
        <div className="mx-auto w-full max-w-md animate-fade-up">
          <h1 className="display text-5xl">{title}</h1>
          {subtitle && <div className="mt-3 text-muted">{subtitle}</div>}
          <div className="mt-9">{children}</div>
        </div>
      </div>
      <div className="relative m-4 hidden overflow-hidden rounded-[2rem] border border-border lg:block">
        {brand.heroImage ? <Img src={brand.heroImage} alt={general.siteName} fill sizes="50vw" className="object-cover" priority /> : <div className="checker absolute inset-0" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
        <div className="absolute bottom-10 left-10 right-10">
          <div className="font-display text-5xl font-black tracking-tight">{general.siteName}</div>
          {general.tagline && <div className="mt-2 text-lg text-brand">{general.tagline}</div>}
        </div>
      </div>
    </div>
  );
}
