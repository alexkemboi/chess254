import Link from "next/link";
import type { ContentStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/rbac";
import { getSettings } from "@/server/settings";
import { PageHeader, EmptyState, Table, THead, TH, TR, TD } from "@/components/ui/misc";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Label, Select, Textarea } from "@/components/ui/input";
import { ActionButton, FormDialog } from "@/components/admin/admin-ui";
import { FilterSelect, SearchBox } from "@/components/admin/list-tools";
import { moderateCommentAction, moderatePostAction, resolveReportAction } from "@/actions/admin";
import { formatDateTime, humanize } from "@/lib/format";
import { truncate } from "@/lib/utils";

export const metadata = { title: "Moderation" };

export default async function Moderation({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; q?: string }> }) {
  const actor = await requirePermission("community.moderate", "/admin/moderation");
  const sp = await searchParams;
  const tab = sp.tab === "posts" ? "posts" : sp.tab === "comments" ? "comments" : "reports";
  const { timezone } = await getSettings("general");
  const canSuspend = await can(actor.role, "users.manage");
  const statusFilter = ["VISIBLE", "HIDDEN", "REMOVED"].includes(sp.status ?? "") ? (sp.status as ContentStatus) : undefined;
  const q = sp.q?.trim().slice(0, 80);
  const tabLink = (t: string) => `/admin/moderation?tab=${t}`;
  const tabClass = (t: string) => `rounded-full border px-4 py-2 text-sm ${tab === t ? "border-brand bg-brand text-black" : "border-border text-muted"}`;

  const [reports, posts, comments, openCount] = await Promise.all([
    tab === "reports" ? prisma.communityReport.findMany({ where: { status: "OPEN" }, include: { reporter: { select: { name: true } }, post: { include: { author: { select: { id: true, name: true } } } }, comment: { include: { author: { select: { id: true, name: true } }, post: { select: { id: true, title: true } } } } }, orderBy: { createdAt: "asc" }, take: 100 }) : [],
    tab === "posts" ? prisma.communityPost.findMany({ where: { ...(statusFilter ? { status: statusFilter } : {}), ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) }, include: { author: { select: { id: true, name: true } }, _count: { select: { reports: { where: { status: "OPEN" } } } } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    tab === "comments" ? prisma.communityComment.findMany({ where: { ...(statusFilter ? { status: statusFilter } : {}), ...(q ? { body: { contains: q, mode: "insensitive" } } : {}) }, include: { author: { select: { id: true, name: true } }, post: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    prisma.communityReport.count({ where: { status: "OPEN" } }),
  ]);

  return (
    <div>
      <PageHeader title="Community moderation" description="Review reports, hide or remove content and suspend members who break the guidelines." />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={tabLink("reports")} className={tabClass("reports")}>Reports {openCount > 0 && <span className="ml-1 rounded-full bg-black/20 px-1.5 text-xs">{openCount}</span>}</Link>
        <Link href={tabLink("posts")} className={tabClass("posts")}>Posts</Link>
        <Link href={tabLink("comments")} className={tabClass("comments")}>Comments</Link>
        {tab !== "reports" && (
          <>
            <span className="mx-2 h-6 w-px bg-border" />
            <SearchBox placeholder="Search…" defaultValue={q} />
            <FilterSelect name="status" label="Any status" value={sp.status} options={["VISIBLE", "HIDDEN", "REMOVED"].map((s) => ({ value: s, label: s.toLowerCase() }))} />
          </>
        )}
      </div>

      {tab === "reports" && (reports.length === 0 ? <EmptyState title="No open reports" description="The community is behaving. 🎉" /> : (
        <div className="grid gap-3">
          {reports.map((r) => {
            const target = r.comment ?? r.post;
            const author = r.comment?.author ?? r.post?.author;
            const postId = r.comment?.post.id ?? r.post?.id;
            return (
              <div key={r.id} className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="warning">{r.comment ? "Comment" : "Post"}</Badge>
                  <span>reported by <b>{r.reporter.name}</b></span>
                  <span className="text-muted">· {formatDateTime(r.createdAt, timezone)}</span>
                  {target && <StatusBadge status={target.status} />}
                </div>
                <p className="mt-2 text-sm"><span className="text-muted">Reason:</span> {r.reason}</p>
                {target && (
                  <blockquote className="mt-3 rounded-xl border-l-2 border-warning bg-surface-2 p-3 text-sm">
                    {r.post && <div className="font-semibold">{r.post.title}</div>}
                    <div className="whitespace-pre-line text-muted">{truncate(r.comment?.body ?? r.post?.body ?? "", 600)}</div>
                    {author && <div className="mt-2 text-xs">by <Link href={`/admin/users/${author.id}`} className="text-brand">{author.name}</Link>{postId && <> · <Link href={`/community/${postId}`} className="text-brand" target="_blank">open thread</Link></>}</div>}
                  </blockquote>
                )}
                <div className="mt-4">
                  <FormDialog trigger="Resolve" title="Resolve report" action={resolveReportAction.bind(null, r.id)} submitLabel="Close report">
                    <Label htmlFor={`o-${r.id}`}>Outcome</Label>
                    <Select id={`o-${r.id}`} name="outcome" defaultValue="RESOLVED"><option value="RESOLVED">Action taken</option><option value="DISMISSED">Dismiss — no violation</option></Select>
                    <Label htmlFor={`t-${r.id}`}>Content</Label>
                    <Select id={`t-${r.id}`} name="takeDown" defaultValue="none"><option value="none">Leave visible</option><option value="hide">Hide</option><option value="remove">Remove</option></Select>
                    {canSuspend && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="suspendAuthor" value="true" className="size-4 accent-[var(--brand)]" />Suspend the author</label>}
                    <Label htmlFor={`n-${r.id}`}>Note</Label><Textarea id={`n-${r.id}`} name="resolution" />
                  </FormDialog>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {tab === "posts" && (posts.length === 0 ? <EmptyState title="No posts" /> : (
        <Table>
          <THead><tr><TH>Post</TH><TH>Author</TH><TH>Kind</TH><TH>Posted</TH><TH>Status</TH><TH /></tr></THead>
          <tbody>
            {posts.map((p) => (
              <TR key={p.id}>
                <TD><Link href={`/community/${p.id}`} target="_blank" className="hover:text-brand">{p.title}</Link>{p._count.reports > 0 && <Badge variant="warning" className="ml-2">{p._count.reports} reports</Badge>}{p.pinned && <Badge className="ml-2">pinned</Badge>}</TD>
                <TD><Link href={`/admin/users/${p.author.id}`} className="hover:text-brand">{p.author.name}</Link></TD>
                <TD>{humanize(p.kind)}</TD>
                <TD className="text-muted">{formatDateTime(p.createdAt, timezone)}</TD>
                <TD><StatusBadge status={p.status} /></TD>
                <TD className="whitespace-nowrap text-right">
                  {p.status === "VISIBLE" ? (
                    <>
                      <ActionButton action={moderatePostAction.bind(null, p.id, p.pinned ? "unpin" : "pin")} variant="ghost">{p.pinned ? "Unpin" : "Pin"}</ActionButton>
                      <ActionButton action={moderatePostAction.bind(null, p.id, "hide")} variant="ghost">Hide</ActionButton>
                      <ActionButton action={moderatePostAction.bind(null, p.id, "remove")} variant="ghost" confirm="Remove this post?">Remove</ActionButton>
                    </>
                  ) : <ActionButton action={moderatePostAction.bind(null, p.id, "restore")} variant="ghost">Restore</ActionButton>}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      ))}

      {tab === "comments" && (comments.length === 0 ? <EmptyState title="No comments" /> : (
        <Table>
          <THead><tr><TH>Comment</TH><TH>Author</TH><TH>On</TH><TH>Status</TH><TH /></tr></THead>
          <tbody>
            {comments.map((c) => (
              <TR key={c.id}>
                <TD className="max-w-md"><span className="line-clamp-2">{c.body}</span></TD>
                <TD><Link href={`/admin/users/${c.author.id}`} className="hover:text-brand">{c.author.name}</Link></TD>
                <TD><Link href={`/community/${c.post.id}`} target="_blank" className="text-muted hover:text-brand">{truncate(c.post.title, 40)}</Link></TD>
                <TD><StatusBadge status={c.status} /></TD>
                <TD className="text-right">{c.status === "VISIBLE" ? <ActionButton action={moderateCommentAction.bind(null, c.id, "hide")} variant="ghost">Hide</ActionButton> : <ActionButton action={moderateCommentAction.bind(null, c.id, "restore")} variant="ghost">Restore</ActionButton>}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      ))}
    </div>
  );
}
