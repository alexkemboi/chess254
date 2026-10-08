import Link from "next/link";
import { requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { Container } from "@/components/site/cards";
import { NewPostForm } from "@/components/site/community-ui";

export const metadata = { title: "New post", robots: { index: false } };

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireUser("/community/new");
  const { kind } = await searchParams;
  const { guidelines } = await getSettings("community");
  return (
    <Container className="max-w-2xl py-12 sm:py-16">
      <Link href="/community" className="text-sm text-muted hover:text-foreground">← Community</Link>
      <h1 className="display mt-6 text-5xl">Start a post.</h1>
      {guidelines && <p className="mt-3 text-muted">{guidelines}</p>}
      <div className="mt-8 rounded-3xl border border-border bg-surface p-6 sm:p-8"><NewPostForm defaultKind={kind} /></div>
    </Container>
  );
}
