import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="font-display text-[9rem] font-black leading-none text-brand">404</div>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight">That square is empty.</h1>
        <p className="mt-3 text-muted">The page you’re looking for has moved or never existed.</p>
        <div className="mt-8 flex justify-center gap-2">
          <Button asChild><Link href="/">Back to the clubhouse</Link></Button>
          <Button asChild variant="secondary"><Link href="/search">Search</Link></Button>
        </div>
      </div>
    </main>
  );
}
