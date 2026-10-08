"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const inquirySchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  phone: z.string().trim().max(40).optional(),
  subject: z.string().trim().min(2).max(160),
  message: z.string().trim().min(10).max(5000),
});

export async function submitInquiry(formData: FormData) {
  const result = inquirySchema.safeParse({
    name: formData.get("name"), email: formData.get("email"), phone: formData.get("phone") || undefined,
    subject: formData.get("subject"), message: formData.get("message"),
  });
  if (!result.success) redirect("/contact?result=invalid");
  try {
    await prisma.contactInquiry.create({ data: result.data });
  } catch {
    redirect("/contact?result=unavailable");
  }
  redirect("/contact?result=sent");
}
