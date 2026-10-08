export type SettingType = "text" | "textarea" | "email" | "tel" | "url" | "number" | "boolean" | "image" | "select";

export type SettingDefinition = {
  key: string;
  label: string;
  type: SettingType;
  help?: string;
  options?: { value: string; label: string }[];
  /** Operational default only. Business content never has a code default. */
  default?: string | number | boolean;
};

export type SettingGroup = { key: string; label: string; description: string; settings: SettingDefinition[] };

export const SETTING_GROUPS: SettingGroup[] = [
  {
    key: "club", label: "Clubhouse", description: "Identity and contact details shown across the website, emails, invoices and SMS.",
    settings: [
      { key: "club.name", label: "Club name", type: "text" },
      { key: "club.tagline", label: "Tagline", type: "text" },
      { key: "club.location", label: "Location label", type: "text", help: "Short label, e.g. a neighbourhood and city." },
      { key: "club.address", label: "Street address", type: "textarea" },
      { key: "club.phone", label: "Phone number", type: "tel" },
      { key: "club.whatsapp", label: "WhatsApp number", type: "tel" },
      { key: "club.contactEmail", label: "Contact email", type: "email" },
      { key: "club.mapUrl", label: "Map link", type: "url", help: "Link to the clubhouse on a map service." },
      { key: "club.foundedLabel", label: "Founding label", type: "text", help: "Small vertical label on the homepage hero." },
      { key: "club.footerNote", label: "Footer note", type: "textarea" },
      { key: "club.logoMark", label: "Logo symbol", type: "text", default: "♞" },
    ],
  },
  {
    key: "seo", label: "SEO", description: "Defaults used when a page has no SEO fields of its own.",
    settings: [
      { key: "site.url", label: "Public site URL", type: "url", help: "Used for canonical URLs, the sitemap and links in emails/SMS." },
      { key: "seo.titleTemplate", label: "Title template", type: "text", help: "Use %s for the page title.", default: "%s · Chess254" },
      { key: "seo.defaultTitle", label: "Default title", type: "text" },
      { key: "seo.defaultDescription", label: "Default description", type: "textarea" },
      { key: "seo.ogImage", label: "Default social image", type: "image" },
      { key: "seo.keywords", label: "Keywords", type: "text", help: "Comma separated." },
    ],
  },
  {
    key: "commerce", label: "Shop & checkout", description: "How orders, pickup, invoices and stock behave.",
    settings: [
      { key: "commerce.currency", label: "Currency", type: "text", default: "KES" },
      { key: "commerce.guestCheckout", label: "Allow guest checkout for products", type: "boolean", default: true },
      { key: "commerce.pickupEnabled", label: "Offer clubhouse pickup", type: "boolean", default: true },
      { key: "commerce.pickupLabel", label: "Pickup option name", type: "text" },
      { key: "commerce.pickupInstructions", label: "Pickup instructions", type: "textarea" },
      { key: "commerce.deliveryEnabled", label: "Offer delivery", type: "boolean", default: true },
      { key: "commerce.orderHoldMinutes", label: "Payment window (minutes)", type: "number", default: 30, help: "Stock, seats and coaching slots are held for this long while the customer pays." },
      { key: "commerce.orderPrefix", label: "Order number prefix", type: "text", default: "C254" },
      { key: "commerce.invoicePrefix", label: "Invoice number prefix", type: "text", default: "INV" },
      { key: "commerce.lowStockDefault", label: "Default low-stock threshold", type: "number", default: 3 },
      { key: "commerce.invoiceFooter", label: "Invoice footer", type: "textarea" },
      { key: "commerce.taxNote", label: "Tax note on invoices", type: "text" },
      { key: "commerce.returnsPolicy", label: "Returns policy summary", type: "textarea" },
    ],
  },
  {
    key: "booking", label: "Coaching & events", description: "Booking windows and reminders.",
    settings: [
      { key: "booking.leadHours", label: "Minimum notice for coaching bookings (hours)", type: "number", default: 12 },
      { key: "booking.horizonDays", label: "How far ahead customers can book (days)", type: "number", default: 30 },
      { key: "booking.slotStepMinutes", label: "Slot interval (minutes)", type: "number", default: 30 },
      { key: "booking.reminderHours", label: "Send reminders this many hours before", type: "number", default: 24 },
      { key: "membership.expiryReminderDays", label: "Membership expiry reminder (days before)", type: "number", default: 7 },
    ],
  },
  {
    key: "notifications", label: "Notifications", description: "Channel switches and where staff alerts go.",
    settings: [
      { key: "notifications.smsEnabled", label: "Send SMS notifications", type: "boolean", default: true },
      { key: "notifications.emailEnabled", label: "Send email notifications", type: "boolean", default: true },
      { key: "notifications.adminEmail", label: "Staff alert email", type: "email" },
      { key: "notifications.adminPhone", label: "Staff alert phone", type: "tel" },
    ],
  },
  {
    key: "home", label: "Homepage extras", description: "Small pieces of homepage copy not covered by sections.",
    settings: [
      { key: "home.verticalLabel", label: "Hero vertical label", type: "text" },
      { key: "home.closingKicker", label: "Closing kicker", type: "text" },
      { key: "home.closingHeading", label: "Closing heading", type: "text" },
      { key: "home.closingHighlight", label: "Closing heading highlight", type: "text" },
      { key: "home.closingBody", label: "Closing body", type: "textarea" },
      { key: "home.closingCtaLabel", label: "Closing button label", type: "text" },
      { key: "home.closingCtaHref", label: "Closing button link", type: "text" },
    ],
  },
];

export const SETTING_DEFINITIONS = Object.fromEntries(SETTING_GROUPS.flatMap((g) => g.settings.map((s) => [s.key, s]))) as Record<string, SettingDefinition>;
