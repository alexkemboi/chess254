import { Plus } from "lucide-react";

export function FaqList({ faqs }: { faqs: { id: string; question: string; answer: string }[] }) {
  return (
    <div className="divide-y divide-border rounded-3xl border border-border bg-surface">
      {faqs.map((f) => (
        <details key={f.id} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
            {f.question}
            <Plus className="size-5 shrink-0 text-brand-ink transition-transform duration-300 group-open:rotate-45" />
          </summary>
          <p className="mt-3 max-w-3xl whitespace-pre-line leading-relaxed text-muted">{f.answer}</p>
        </details>
      ))}
    </div>
  );
}
