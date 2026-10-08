"use server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { runAction, parseForm, UserError, type ActionResult } from "@/server/errors";
import { assertCoach, coachMemberIds } from "@/server/coach";
import { audit } from "@/server/audit";
import { cancelBooking } from "@/server/booking";
import { getSettings } from "@/server/settings";
import { emailNotifications, notify } from "@/server/notifications";
import { isValidClock, minutesOf, zonedTimeToUtc } from "@/lib/time";

const id = z.string().min(1).max(40);
const windowSchema = z.object({ weekday: z.number().int().min(0).max(6), startTime: z.string().refine(isValidClock), endTime: z.string().refine(isValidClock) }).refine((w) => minutesOf(w.startTime) < minutesOf(w.endTime), { message: "End time must be after start time" });

export async function saveAvailabilityAction(windowsJson: string): Promise<ActionResult> {
  return runAction(async () => {
    const { user, coach } = await assertCoach();
    const windows = z.array(windowSchema).max(70).parse(JSON.parse(windowsJson));
    for (let d = 0; d < 7; d++) {
      const day = windows.filter((w) => w.weekday === d).sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
      for (let i = 1; i < day.length; i++) if (minutesOf(day[i].startTime) < minutesOf(day[i - 1].endTime)) throw new UserError("Time windows on the same day overlap.");
    }
    const previous = await prisma.coachAvailability.findMany({ where: { coachId: coach.id }, select: { weekday: true, startTime: true, endTime: true } });
    await prisma.$transaction([
      prisma.coachAvailability.deleteMany({ where: { coachId: coach.id } }),
      prisma.coachAvailability.createMany({ data: windows.map((w) => ({ ...w, coachId: coach.id })) }),
    ]);
    await audit({ actorId: user.id, action: "coach.availability_update", entity: "CoachProfile", entityId: coach.id, previous, next: windows });
    return { ok: true, message: "Availability saved. The booking calendar is updated." };
  });
}

export async function addTimeOffAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { user, coach } = await assertCoach();
    const { timezone } = await getSettings("general");
    const data = parseForm(
      z.object({ startDate: z.string().date(), startTime: z.string().refine(isValidClock).default("00:00"), endDate: z.string().date(), endTime: z.string().refine(isValidClock).default("23:59"), reason: z.string().trim().max(200).optional() }),
      formData,
    );
    const startsAt = zonedTimeToUtc(data.startDate, data.startTime || "00:00", timezone);
    const endsAt = zonedTimeToUtc(data.endDate, data.endTime || "23:59", timezone);
    if (endsAt <= startsAt) throw new UserError("The end must be after the start.", { endDate: "End must be after start" });
    const clashes = await prisma.booking.count({ where: { coachId: coach.id, status: { in: ["CONFIRMED", "PENDING"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
    const record = await prisma.coachTimeOff.create({ data: { coachId: coach.id, startsAt, endsAt, reason: data.reason || null } });
    await audit({ actorId: user.id, action: "coach.time_off_add", entity: "CoachTimeOff", entityId: record.id, next: { startsAt, endsAt } });
    return { ok: true, message: clashes ? `Blocked. Note: ${clashes} existing booking(s) fall in this period — manage them under Sessions.` : "Time blocked." };
  });
}

export async function removeTimeOffAction(timeOffId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { user, coach } = await assertCoach();
    const { count } = await prisma.coachTimeOff.deleteMany({ where: { id: id.parse(timeOffId), coachId: coach.id } });
    if (!count) throw new UserError("Not found.");
    await audit({ actorId: user.id, action: "coach.time_off_remove", entity: "CoachTimeOff", entityId: timeOffId });
    return { ok: true, message: "Time off removed." };
  });
}

export async function updateSessionAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { user, coach } = await assertCoach();
    const data = parseForm(z.object({ status: z.enum(["CONFIRMED", "COMPLETED", "NO_SHOW"]), coachNotes: z.string().trim().max(5000).optional() }), formData);
    const booking = await prisma.booking.findFirst({ where: { id: id.parse(bookingId), coachId: coach.id } });
    if (!booking) throw new UserError("Session not found.");
    if (!["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(booking.status)) throw new UserError("Only confirmed sessions can be updated.");
    if (data.status !== "CONFIRMED" && booking.startsAt > new Date()) throw new UserError("You can mark a session complete once it has started.");
    await prisma.booking.update({ where: { id: booking.id }, data: { status: data.status, coachNotes: data.coachNotes || null } });
    if (data.status !== booking.status) await prisma.bookingStatusHistory.create({ data: { bookingId: booking.id, status: data.status, actorId: user.id, note: "Updated by coach" } });
    await audit({ actorId: user.id, action: "booking.coach_update", entity: "Booking", entityId: booking.id, previous: { status: booking.status }, next: { status: data.status } });
    return { ok: true, message: "Session updated." };
  });
}

export async function coachCancelSessionAction(bookingId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { user, coach } = await assertCoach();
    const reason = z.string().trim().min(3, "Give the member a reason").max(300).parse(formData.get("reason"));
    const booking = await prisma.booking.findFirst({ where: { id: id.parse(bookingId), coachId: coach.id } });
    if (!booking) throw new UserError("Session not found.");
    const result = await cancelBooking(booking.id, { id: user.id, asStaff: true }, reason);
    await emailNotifications([result.notificationId]);
    await audit({ actorId: user.id, action: "booking.cancel", entity: "Booking", entityId: booking.id, previous: { status: booking.status }, next: { status: "CANCELLED", reason } });
    return { ok: true, message: result.paid ? "Cancelled. Admins have been notified to arrange the refund." : "Session cancelled." };
  });
}

export async function createAssignmentAction(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { user, coach } = await assertCoach();
    const { timezone } = await getSettings("general");
    const data = parseForm(
      z.object({
        memberId: id,
        title: z.string().trim().min(3).max(160),
        instructions: z.string().trim().max(5000).optional(),
        materialId: z.string().max(40).optional().transform((v) => v || null),
        dueDate: z.union([z.literal(""), z.string().date()]).optional(),
      }),
      formData,
    );
    if (!(await coachMemberIds(coach.id)).includes(data.memberId)) throw new UserError("You can only assign work to members you coach.");
    if (data.materialId && !(await prisma.learningMaterial.findFirst({ where: { id: data.materialId, deletedAt: null } }))) throw new UserError("Material not found.");
    const assignment = await prisma.learningAssignment.create({
      data: { coachId: coach.id, memberId: data.memberId, title: data.title, instructions: data.instructions || null, materialId: data.materialId, dueAt: data.dueDate ? zonedTimeToUtc(data.dueDate, "23:59", timezone) : null },
    });
    const n = await notify({ userId: data.memberId, type: "LEARNING_ASSIGNED", title: "New assignment", body: `${user.name} set you: ${data.title}`, link: "/dashboard/assignments" });
    await emailNotifications([n.id]);
    await audit({ actorId: user.id, action: "assignment.create", entity: "LearningAssignment", entityId: assignment.id });
    return { ok: true, message: "Assignment sent." };
  });
}

export async function reviewAssignmentAction(assignmentId: string, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { user, coach } = await assertCoach();
    const { feedback } = parseForm(z.object({ feedback: z.string().trim().min(2, "Write some feedback").max(5000) }), formData);
    const a = await prisma.learningAssignment.findFirst({ where: { id: id.parse(assignmentId), coachId: coach.id } });
    if (!a) throw new UserError("Assignment not found.");
    await prisma.learningAssignment.update({ where: { id: a.id }, data: { feedback, status: "REVIEWED", reviewedAt: new Date() } });
    const n = await notify({ userId: a.memberId, type: "ASSIGNMENT_REVIEWED", title: "Feedback from your coach", body: `${user.name} reviewed "${a.title}".`, link: "/dashboard/assignments" });
    await emailNotifications([n.id]);
    return { ok: true, message: "Feedback sent." };
  });
}

export async function cancelAssignmentAction(assignmentId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { coach } = await assertCoach();
    const { count } = await prisma.learningAssignment.updateMany({ where: { id: id.parse(assignmentId), coachId: coach.id, status: { not: "REVIEWED" } }, data: { status: "CANCELLED" } });
    if (!count) throw new UserError("Assignment not found.");
    return { ok: true, message: "Assignment withdrawn." };
  });
}
