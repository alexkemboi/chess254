import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { currentUser } from "@/server/auth";
import { materialAccess, publishedMaterialWhere } from "@/server/learning";

export const dynamic = "force-dynamic";

/** Permission-checked download for lesson files and PGNs. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const material = await prisma.learningMaterial.findFirst({ where: publishedMaterialWhere({ slug }) });
  if (!material) return new NextResponse("Not found", { status: 404 });
  const user = await currentUser();
  const access = await materialAccess(material, user);
  if (!access.canDownload) return new NextResponse(access.reason ?? "Forbidden", { status: 403 });

  const filename = material.slug.replace(/[^a-z0-9-]/g, "");
  const mediaId = material.fileUrl?.match(/^\/media\/([a-z0-9]+)$/)?.[1];
  if (mediaId) {
    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return new NextResponse("Not found", { status: 404 });
    const ext = media.mimeType === "application/pdf" ? "pdf" : media.mimeType.includes("pgn") ? "pgn" : "bin";
    return new NextResponse(new Uint8Array(media.data), {
      headers: { "Content-Type": media.mimeType, "Content-Disposition": `attachment; filename="${filename}.${ext}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  if (material.fileUrl) return NextResponse.redirect(new URL(material.fileUrl, request.url));
  if (material.pgn) {
    return new NextResponse(material.pgn, { headers: { "Content-Type": "application/x-chess-pgn; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.pgn"`, "Cache-Control": "private, no-store" } });
  }
  return new NextResponse("Not found", { status: 404 });
}
