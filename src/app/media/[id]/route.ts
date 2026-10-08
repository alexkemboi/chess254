import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { materialAccess } from "@/server/learning";

export const dynamic = "force-dynamic";

/** Serves uploaded media. Files attached to members-only lessons stay behind the access check. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const media = await prisma.media.findUnique({ where: { id } });
  if (!media) return new NextResponse("Not found", { status: 404 });

  const restricted = await prisma.learningMaterial.findFirst({ where: { fileUrl: `/media/${id}`, access: "MEMBERS" } });
  if (restricted) {
    const access = await materialAccess(restricted, await currentUser());
    if (!access.canDownload && !access.canView) return new NextResponse("Forbidden", { status: 403 });
  }
  const inline = media.mimeType.startsWith("image/");
  return new NextResponse(new Uint8Array(media.data), {
    headers: {
      "Content-Type": media.mimeType,
      "Content-Length": String(media.size),
      "Cache-Control": restricted ? "private, no-store" : "public, max-age=31536000, immutable",
      "Content-Disposition": inline ? "inline" : `attachment; filename="${media.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
