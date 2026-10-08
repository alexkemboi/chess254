import "server-only";
import type { FieldDef } from "@/lib/fields";
import type { SettingsGroup } from "@/server/settings";

export const SETTINGS_FORMS: Record<SettingsGroup, { title: string; description: string; fields: FieldDef[] }> = {
  general: { title: "General", description: "Club name, tagline, public URL, timezone and currency.", fields: [
    { name: "siteName", label: "Club name", type: "text", required: true },
    { name: "tagline", label: "Tagline", type: "text" },
    { name: "siteUrl", label: "Public site URL", type: "url", help: "Used in emails, sitemaps and canonical links." },
    { name: "timezone", label: "Timezone", type: "text", help: "IANA name, e.g. Africa/Nairobi" },
    { name: "currency", label: "Default currency", type: "text" },
  ] },
  brand: { title: "Brand", description: "Logo wordmark, brand colour and default imagery.", fields: [
    { name: "logoText", label: "Logo text", type: "text" },
    { name: "logoAccent", label: "Logo accent", type: "text", help: "Shown in the brand colour, e.g. 254" },
    { name: "primaryColor", label: "Brand colour", type: "color", span: 2 },
    { name: "heroImage", label: "Default hero image", type: "image", span: 2 },
    { name: "ogImage", label: "Default social sharing image", type: "image", span: 2 },
  ] },
  contact: { title: "Contact details", description: "Shown in the footer and on the contact page.", fields: [
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone", type: "text" },
    { name: "whatsapp", label: "WhatsApp number", type: "text" },
    { name: "contactIntro", label: "Contact page intro", type: "textarea", span: 2 },
  ] },
  booking: { title: "Booking rules", description: "Defaults for every session type (each type can override notice, advance window and cancellation).", fields: [
    { name: "slotIntervalMinutes", label: "Slot interval (minutes)", type: "number" },
    { name: "minNoticeHours", label: "Minimum notice (hours)", type: "number" },
    { name: "maxAdvanceDays", label: "Booking window (days ahead)", type: "number" },
    { name: "cancellationHours", label: "Free cancellation until (hours before)", type: "number" },
    { name: "holdMinutes", label: "Payment hold (minutes)", type: "number", help: "How long an unpaid slot or seat is reserved." },
    { name: "maxActiveBookingsPerMember", label: "Max upcoming bookings per member", type: "number" },
    { name: "cancellationPolicy", label: "Cancellation policy", type: "textarea", span: 2 },
  ] },
  membership: { title: "Membership", description: "Renewal reminders and joining copy.", fields: [
    { name: "renewalReminderDays", label: "Expiry reminder (days before)", type: "number" },
    { name: "allowEarlyRenewal", label: "Allow early renewal (adds a period on top)", type: "switch" },
    { name: "joinIntro", label: "Joining intro text", type: "textarea", span: 2 },
  ] },
  payments: { title: "Payments & tax", description: "Tax, order expiry and invoice numbering. M-Pesa credentials live in Payment settings.", fields: [
    { name: "taxRatePercent", label: "Tax rate (%)", type: "number" },
    { name: "taxLabel", label: "Tax label", type: "text" },
    { name: "taxInclusive", label: "Prices include tax", type: "switch" },
    { name: "orderExpiryMinutes", label: "Unpaid order expiry (minutes)", type: "number" },
    { name: "invoicePrefix", label: "Invoice prefix", type: "text" },
    { name: "invoiceFooter", label: "Invoice footer", type: "textarea", span: 2 },
  ] },
  notifications: { title: "Notifications", description: "Outbound channels and reminder timing.", fields: [
    { name: "emailEnabled", label: "Send emails", type: "switch" },
    { name: "smsEnabled", label: "Send SMS (when a provider is installed)", type: "switch" },
    { name: "bookingReminderHours", label: "Session & event reminder (hours before)", type: "number" },
    { name: "adminAlertEmail", label: "Admin alert email", type: "email", help: "Refund alerts and new contact messages." },
  ] },
  email: { title: "Email sender", description: "Sender identity. SMTP credentials are set in the environment or Payment settings → credentials.", fields: [
    { name: "fromName", label: "From name", type: "text" },
    { name: "fromEmail", label: "From email", type: "email" },
    { name: "replyTo", label: "Reply-to", type: "email" },
  ] },
  seo: { title: "SEO", description: "Defaults for titles, descriptions and social cards.", fields: [
    { name: "defaultTitle", label: "Default title", type: "text", span: 2 },
    { name: "titleTemplate", label: "Title template", type: "text", help: "%s is replaced by the page title" },
    { name: "twitterHandle", label: "X / Twitter handle", type: "text" },
    { name: "defaultDescription", label: "Default description", type: "textarea", span: 2 },
    { name: "keywords", label: "Keywords", type: "text", span: 2, help: "Comma separated" },
  ] },
  events: { title: "Events", description: "Event registration policy.", fields: [
    { name: "cancellationHours", label: "Members can cancel until (hours before)", type: "number" },
    { name: "showPastEvents", label: "Show past events publicly", type: "switch" },
  ] },
  community: { title: "Community", description: "Who can post and the guidelines shown to members.", fields: [
    { name: "enabled", label: "Community enabled", type: "switch" },
    { name: "requireMembershipToPost", label: "Only active members can start posts", type: "switch" },
    { name: "guidelines", label: "Community guidelines", type: "textarea", span: 2 },
  ] },
};
