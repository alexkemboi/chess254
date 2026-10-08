import "server-only";
import { prisma } from "@/server/db";
import { UserError } from "@/server/errors";

/**
 * Storage abstraction. The default driver stores files in PostgreSQL (served by
 * /media/[id]) so uploads work on any host; an object-storage driver can be
 * added behind the same interface using the STORAGE_* variables.
 */
export interface StorageDriver {
  put(file: { name: string; type: string; data: Buffer }, actorId: string): Promise<string>;
}

const MAX_BYTES = 8 * 1024 * 1024;

const SIGNATURES: { type: string; test: (b: Buffer) => boolean }[] = [
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { type: "image/gif", test: (b) => b.subarray(0, 4).toString() === "GIF8" },
  { type: "application/pdf", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

function sniff(data: Buffer, name: string) {
  const hit = SIGNATURES.find((s) => s.test(data));
  if (hit) return hit.type;
  if (/\.pgn$/i.test(name) && !data.includes(0)) return "application/x-chess-pgn";
  return null;
}

class DatabaseDriver implements StorageDriver {
  async put(file: { name: string; type: string; data: Buffer }, actorId: string) {
    const media = await prisma.media.create({
      data: { filename: file.name.replace(/[^\w.\- ]/g, "").slice(0, 120) || "upload", mimeType: file.type, size: file.data.length, data: new Uint8Array(file.data), createdBy: actorId },
    });
    return `/media/${media.id}`;
  }
}

const driver: StorageDriver = new DatabaseDriver();

export async function storeUpload(file: File, actorId: string, accept: "image" | "document" | "any" = "image") {
  if (file.size === 0) throw new UserError("The file is empty.");
  if (file.size > MAX_BYTES) throw new UserError("Files must be 8 MB or smaller.");
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniff(data, file.name);
  if (!type) throw new UserError("Unsupported file type.");
  if (accept === "image" && !type.startsWith("image/")) throw new UserError("Please upload a JPEG, PNG, WebP or GIF image.");
  if (accept === "document" && type.startsWith("image/")) throw new UserError("Please upload a PDF or PGN file.");
  return driver.put({ name: file.name, type, data }, actorId);
}
