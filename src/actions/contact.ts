"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/audit";
import { alertAdmins } from "@/server/notifications";

export async function contactAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const data = parseForm(
      z.object({
        name: z.string().trim().min(2, "Enter your name").max(120),
        email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
        phone: z.string().trim().max(30).optional().transform((v) => v || null),
        subject: z.string().trim().min(2, "Add a subject").max(160),
        message: z.string().trim().min(10, "Tell us a little more").max(5000),
        website: z.string().max(0, "Spam detected").optional(), // honeypot
      }),
      formData,
    );
    if (!(await rateLimit(`contact:${await clientIp()}`, 5, 3600))) throw new UserError("Too many messages. Please try again later.");
    const { website: _honeypot, ...record } = data;
    void _honeypot;
    const inquiry = await prisma.contactInquiry.create({ data: record });
    await alertAdmins("New contact message", `${data.name}: ${data.subject}`, `/admin/inquiries?id=${inquiry.id}`);
    return { ok: true, message: "Thanks! The team will get back to you soon." };
  });
}
