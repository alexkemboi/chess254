/**
 * Initial event records. Each event is created only when no event with its
 * slug exists (including archived or deleted ones), so re-running on every
 * deploy never duplicates or overwrites what admins have edited since.
 *
 *   npm run db:seed:events
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const EAT = "+03:00"; // Africa/Nairobi
const at = (date: string, time: string) => new Date(`${date}T${time}:00${EAT}`);

const HOLIDAY_CAMP_WEEKS = [
  { label: "Week 1", start: "2026-11-02", end: "2026-11-06", due: "2026-10-26" },
  { label: "Week 2", start: "2026-11-09", end: "2026-11-13", due: "2026-11-02" },
  { label: "Week 3", start: "2026-11-16", end: "2026-11-20", due: "2026-11-09" },
  { label: "Week 4", start: "2026-11-23", end: "2026-11-27", due: "2026-11-16" },
  { label: "Week 5", start: "2026-11-30", end: "2026-12-04", due: "2026-11-23" },
  { label: "Week 6", start: "2026-12-07", end: "2026-12-11", due: "2026-11-30" },
];

const HOLIDAY_CAMP_FIELDS = [
  { key: "child_name", label: "Child’s full name", type: "text", required: true, section: "Child’s information", role: "participantName" },
  { key: "child_age", label: "Child’s age", type: "number", required: true, section: "Child’s information" },
  { key: "school", label: "School name", type: "text", section: "Child’s information" },
  { key: "experience", label: "Chess experience", type: "select", required: true, section: "Child’s information", options: ["Never played", "Beginner", "Intermediate", "Advanced"] },
  { key: "attended_before", label: "Has your child attended a MiniChess camp or academy before?", type: "select", section: "Child’s information", options: ["Yes", "No"] },
  {
    key: "weeks",
    label: "Select the weeks and attendance package for your child",
    type: "sessions",
    required: true,
    section: "Camp attendance and fees",
    help: "Choose Half Day or Full Day for each week your child will attend — packages can differ from week to week. Lunch and paid recreational activities are not included.",
  },
  {
    key: "afternoon_activities",
    label: "Which afternoon activities would your child be interested in?",
    type: "checkboxes",
    section: "Afternoon activity interests",
    options: ["Additional chess lessons/practice", "Scrabble and board games", "Darts (KSh 100/game)", "Pool (KSh 100/game)", "Fun Zone (KSh 500/3-hour session)", "Bowling (KSh 800/game)"],
    help: "Just tell us what interests your child — nothing here is booked or charged now. Activities depend on timetable, suitability and availability.",
  },
  { key: "afternoon_programme", label: "What is your preferred afternoon programme?", type: "select", section: "Afternoon activity interests", options: ["Mostly chess", "Mix of chess and other activities", "Mostly recreational activities", "Let my child decide"] },
  { key: "schedule_first", label: "Would you like the afternoon activity schedule before booking paid electives?", type: "select", section: "Afternoon activity interests", options: ["Yes", "No"] },
  { key: "parent_name", label: "Parent/guardian full name", type: "text", required: true, section: "Parent / guardian details", role: "contactName" },
  { key: "parent_phone", label: "WhatsApp/mobile number", type: "phone", required: true, section: "Parent / guardian details", role: "contactPhone" },
  { key: "parent_email", label: "Email address", type: "email", required: true, section: "Parent / guardian details", role: "contactEmail" },
  { key: "emergency_name", label: "Emergency contact name", type: "text", required: true, section: "Parent / guardian details" },
  { key: "emergency_phone", label: "Emergency contact phone number", type: "phone", required: true, section: "Parent / guardian details" },
  { key: "authorised_collector", label: "Name and phone number of person authorised to collect your child", type: "text", required: true, section: "Parent / guardian details" },
  {
    key: "health_notes",
    label: "Does your child have allergies, medical conditions, disabilities or special requirements we should know about?",
    type: "textarea",
    section: "Health and safety",
    sensitive: true,
    help: "Only shared with authorised camp staff, and used only for your child’s care and safety.",
  },
  { key: "photo_consent", label: "Do you consent to photographs/videos of your child being used for MiniChess Kenya promotional purposes?", type: "select", required: true, section: "Health and safety", options: ["Yes, I consent", "No, I do not consent"] },
  { key: "payment_method", label: "Preferred payment method", type: "select", section: "Payment and confirmation", options: ["M-Pesa", "Bank transfer", "Other"], role: "paymentMethod" },
  { key: "paid_already", label: "Have you already paid?", type: "select", section: "Payment and confirmation", options: ["Yes", "No, please send payment instructions"], role: "declaredPaid" },
  {
    key: "payment_reference",
    label: "Payment reference number",
    type: "text",
    section: "Payment and confirmation",
    showIf: "paid_already=Yes",
    role: "paymentReference",
    help: "We check every payment before marking it as paid.",
  },
  {
    key: "declaration",
    label: "I confirm I am the child’s parent or legal guardian. I understand that camp fees must be paid at least 7 days before each selected week; lunch and paid electives are excluded; and registration is confirmed only after payment verification.",
    type: "checkbox",
    required: true,
    section: "Payment and confirmation",
  },
];

/** Wizard step and section per question (step 4 "Review & payment" also shows the booking summary). */
const HOLIDAY_CAMP_LAYOUT: Record<string, [string, string]> = {
  child_name: ["Child information", ""], child_age: ["Child information", ""], school: ["Child information", ""], experience: ["Child information", ""], attended_before: ["Child information", ""],
  weeks: ["Choose camp weeks", ""], afternoon_activities: ["Choose camp weeks", "Optional afternoon interests"], afternoon_programme: ["Choose camp weeks", "Optional afternoon interests"], schedule_first: ["Choose camp weeks", "Optional afternoon interests"],
  parent_name: ["Parent & safety", "Parent / guardian"], parent_phone: ["Parent & safety", "Parent / guardian"], parent_email: ["Parent & safety", "Parent / guardian"],
  emergency_name: ["Parent & safety", "Emergency contact & pickup"], emergency_phone: ["Parent & safety", "Emergency contact & pickup"], authorised_collector: ["Parent & safety", "Emergency contact & pickup"],
  health_notes: ["Parent & safety", "Health and safety"], photo_consent: ["Parent & safety", "Health and safety"],
  payment_method: ["Review & payment", "Payment"], paid_already: ["Review & payment", "Payment"], payment_reference: ["Review & payment", "Payment"], declaration: ["Review & payment", "Declaration"],
};

const HOLIDAY_CAMP: Prisma.EventCreateInput = {
  title: "MiniChess Holiday Camp",
  slug: "minichess-holiday-camp",
  type: "TRAINING_CAMP",
  status: "PUBLISHED",
  featured: true,
  registrationMode: "FORM",
  excerpt: "Six exciting weeks of chess, learning, friendship and fun at TRM Mall — 2 November to 11 December 2026. Half Day or Full Day, week by week.",
  description: [
    "Welcome to the **MiniChess Holiday Camp** at TRM Mall! Join us for six exciting weeks of chess, learning, friendship and fun.",
    "Mornings focus on **structured chess training**, while afternoons offer continued chess or a choice of recreational activities. Select the weeks and attendance packages that suit your child.",
    "## Fees",
    "- **Half Day:** KSh 4,500 per week\n- **Full Day:** KSh 6,500 per week",
    "Lunch and paid recreational activities are not included. Camp fees must be paid **at least 7 days before each selected week**.",
  ].join("\n\n"),
  startsAt: at("2026-11-02", "08:00"),
  endsAt: at("2026-12-11", "17:00"),
  venueNote: "TRM Mall, Nairobi",
  price: 4500,
  currency: "KES",
  registrationOpen: true,
  onlinePayment: true,
  sessionLabel: "Week",
  minSessions: 1,
  registrationIntro: "Half Day: **KSh 4,500 per week** • Full Day: **KSh 6,500 per week**. Lunch and paid recreational activities are not included. Camp fees must be paid at least 7 days before each selected week.",
  submitLabel: "Register for Holiday Camp",
  confirmationMessage:
    "Thank you for registering for the MiniChess Holiday Camp! We have received your child’s registration. Our team will contact you with payment instructions, your booking summary and confirmation of attendance. Please complete payment at least 7 days before each selected camp week. We look forward to welcoming your child to TRM Mall!\n\n— MiniChess Kenya | Chess254",
  paymentInstructions: "Our team will contact you with M-Pesa and bank transfer payment details. Please quote your registration ID as the payment reference — your child’s place is confirmed once we have verified the payment.",
  formFields: HOLIDAY_CAMP_FIELDS.map((f) => ({ ...f, step: HOLIDAY_CAMP_LAYOUT[f.key][0], section: HOLIDAY_CAMP_LAYOUT[f.key][1] })) as unknown as Prisma.InputJsonValue,
  seoTitle: "MiniChess Holiday Camp 2026 — TRM Mall, Nairobi",
  seoDescription: "Six-week chess holiday camp for children at TRM Mall, Nairobi (2 Nov – 11 Dec 2026). Half Day KSh 4,500 or Full Day KSh 6,500 per week.",
  sessions: {
    create: HOLIDAY_CAMP_WEEKS.map((w, position) => ({ label: w.label, startsAt: at(w.start, "08:00"), endsAt: at(w.end, "17:00"), paymentDeadline: at(w.due, "23:59"), position })),
  },
  packages: {
    create: [
      { name: "Half Day", price: 4500, description: "Morning structured chess training", position: 0 },
      { name: "Full Day", price: 6500, description: "Morning training plus afternoon chess or activities (paid electives and lunch excluded)", position: 1 },
    ],
  },
};

export async function seedEvents(prisma: PrismaClient) {
  for (const event of [HOLIDAY_CAMP]) {
    const existing = await prisma.event.findUnique({ where: { slug: event.slug }, select: { id: true } });
    if (existing) {
      console.log(`Event "${event.title}" already exists (${existing.id}) — left unchanged.`);
      continue;
    }
    const created = await prisma.event.create({ data: event, include: { sessions: true, packages: true } });
    console.log(`Created event "${created.title}" (${created.id}) with ${created.sessions.length} sessions and ${created.packages.length} packages.`);
  }
}

// Run directly: `tsx prisma/seed-events.ts`
if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-events.ts")) {
  const prisma = new PrismaClient();
  seedEvents(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
