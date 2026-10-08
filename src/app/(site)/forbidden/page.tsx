import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Container } from "@/components/site/cards";
import { EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied", robots: { index: false } };

export default function Forbidden() {
  return (
    <Container className="py-24">
      <EmptyState icon={<ShieldX />} title="You don't have access to that page" description="If you think this is a mistake, ask a club administrator to check your role." action={<Button asChild><Link href="/dashboard">Go to my dashboard</Link></Button>} />
    </Container>
  );
}
