/**
 * Every notification the platform can send. Template wording lives in the
 * database (NotificationTemplate) and is edited in the CMS; the defaults below
 * are only used to create the initial editable rows.
 */
export type NotificationKey =
  | "account.registered" | "account.verify_email" | "account.phone_otp" | "account.password_reset"
  | "payment.success" | "payment.failed"
  | "order.confirmed" | "order.status_updated" | "order.shipped" | "order.delivered" | "order.ready_for_pickup"
  | "invoice.issued"
  | "membership.activated" | "membership.expiring" | "membership.expired"
  | "booking.confirmed" | "booking.reminder"
  | "event.registered" | "event.reminder"
  | "admin.new_order" | "admin.payment_attention"
  | "promo.campaign";

export type TemplateDefault = { key: NotificationKey; name: string; description: string; variables: string[]; sms?: string; email?: { subject: string; body: string } };

export const TEMPLATE_DEFAULTS: TemplateDefault[] = [
  { key: "account.registered", name: "Welcome", description: "Sent after a customer creates an account.", variables: ["name", "clubName", "link"],
    sms: "Welcome to {{clubName}}, {{name}}! Your account is ready: {{link}}",
    email: { subject: "Welcome to {{clubName}}", body: "Hi {{name}},\n\nYour {{clubName}} account is ready. You can manage memberships, orders, bookings and events from your account.\n\n{{link}}" } },
  { key: "account.verify_email", name: "Email verification", description: "Link to confirm an email address.", variables: ["name", "clubName", "link"],
    email: { subject: "Confirm your email for {{clubName}}", body: "Hi {{name}},\n\nPlease confirm your email address by opening the link below. It expires in 24 hours.\n\n{{link}}" } },
  { key: "account.phone_otp", name: "Phone verification code", description: "One-time code to verify a phone number.", variables: ["code", "clubName"],
    sms: "Your {{clubName}} verification code is {{code}}. It expires in 10 minutes. Don't share it." },
  { key: "account.password_reset", name: "Password reset", description: "Password reset link.", variables: ["name", "clubName", "link"],
    sms: "{{clubName}}: a password reset was requested for your account. Open {{link}} within 1 hour. Ignore this if it wasn't you.",
    email: { subject: "Reset your {{clubName}} password", body: "Hi {{name}},\n\nWe received a request to reset your password. Open the link below within 1 hour.\n\n{{link}}\n\nIf you didn't ask for this, you can ignore this email." } },
  { key: "payment.success", name: "Payment received", description: "Sent when an M-Pesa payment is verified.", variables: ["name", "amount", "orderNumber", "receipt", "clubName", "link"],
    sms: "{{clubName}}: we received {{amount}} for order {{orderNumber}}. M-Pesa ref {{receipt}}. Thank you, {{name}}!",
    email: { subject: "Payment received for order {{orderNumber}}", body: "Hi {{name}},\n\nWe've received your payment of {{amount}} (M-Pesa reference {{receipt}}) for order {{orderNumber}}.\n\n{{{orderTable}}}\n\nView your order and receipt: {{link}}" } },
  { key: "payment.failed", name: "Payment not completed", description: "Sent when an M-Pesa payment fails or is cancelled.", variables: ["name", "amount", "orderNumber", "reason", "clubName", "link"],
    sms: "{{clubName}}: your payment of {{amount}} for order {{orderNumber}} was not completed ({{reason}}). Try again: {{link}}",
    email: { subject: "Payment not completed for order {{orderNumber}}", body: "Hi {{name}},\n\nYour payment of {{amount}} for order {{orderNumber}} was not completed: {{reason}}.\n\nYou can try again while your order is still held: {{link}}" } },
  { key: "order.confirmed", name: "Order confirmed", description: "Sent for paid orders that include products.", variables: ["name", "orderNumber", "amount", "fulfilment", "clubName", "link"],
    sms: "{{clubName}}: order {{orderNumber}} is confirmed. We'll let you know when it's {{fulfilment}}. Track it: {{link}}",
    email: { subject: "Order {{orderNumber}} confirmed", body: "Hi {{name}},\n\nThanks for your order. We're preparing it now and will update you when it's {{fulfilment}}.\n\n{{{orderTable}}}\n\nTrack your order: {{link}}" } },
  { key: "order.status_updated", name: "Order status update", description: "General order status changes.", variables: ["name", "orderNumber", "status", "note", "clubName", "link"],
    sms: "{{clubName}}: order {{orderNumber}} is now {{status}}. {{note}} {{link}}",
    email: { subject: "Order {{orderNumber}} is {{status}}", body: "Hi {{name}},\n\nYour order {{orderNumber}} is now {{status}}.\n\n{{note}}\n\n{{link}}" } },
  { key: "order.ready_for_pickup", name: "Ready for pickup", description: "Pickup order is ready to collect.", variables: ["name", "orderNumber", "pickupLocation", "clubName", "link"],
    sms: "{{clubName}}: order {{orderNumber}} is ready for pickup at {{pickupLocation}}. Bring your order number.",
    email: { subject: "Order {{orderNumber}} is ready for pickup", body: "Hi {{name}},\n\nYour order {{orderNumber}} is ready to collect at {{pickupLocation}}.\n\n{{link}}" } },
  { key: "order.shipped", name: "Out for delivery", description: "Delivery order has been dispatched.", variables: ["name", "orderNumber", "tracking", "clubName", "link"],
    sms: "{{clubName}}: order {{orderNumber}} is on its way. {{tracking}} {{link}}",
    email: { subject: "Order {{orderNumber}} is on its way", body: "Hi {{name}},\n\nYour order {{orderNumber}} has been dispatched. {{tracking}}\n\n{{link}}" } },
  { key: "order.delivered", name: "Delivered", description: "Delivery completed.", variables: ["name", "orderNumber", "clubName", "link"],
    sms: "{{clubName}}: order {{orderNumber}} has been delivered. Enjoy, {{name}}!",
    email: { subject: "Order {{orderNumber}} delivered", body: "Hi {{name}},\n\nYour order {{orderNumber}} has been delivered. Thank you for shopping with {{clubName}}.\n\n{{link}}" } },
  { key: "invoice.issued", name: "Invoice / receipt", description: "Email with the paid invoice.", variables: ["name", "orderNumber", "invoiceNumber", "amount", "clubName", "link"],
    email: { subject: "Receipt {{invoiceNumber}} for order {{orderNumber}}", body: "Hi {{name}},\n\nHere is your receipt {{invoiceNumber}} for {{amount}}.\n\n{{{orderTable}}}\n\nView or print it any time: {{link}}" } },
  { key: "membership.activated", name: "Membership activated", description: "Membership is active after payment.", variables: ["name", "membership", "expiryDate", "clubName", "link"],
    sms: "{{clubName}}: your {{membership}} membership is active until {{expiryDate}}. Welcome to the table, {{name}}!",
    email: { subject: "Your {{membership}} membership is active", body: "Hi {{name}},\n\nYour {{membership}} membership is now active until {{expiryDate}}.\n\n{{link}}" } },
  { key: "membership.expiring", name: "Membership expiring", description: "Reminder before a membership expires.", variables: ["name", "membership", "expiryDate", "clubName", "link"],
    sms: "{{clubName}}: your {{membership}} membership expires on {{expiryDate}}. Renew here: {{link}}",
    email: { subject: "Your {{membership}} membership expires on {{expiryDate}}", body: "Hi {{name}},\n\nYour {{membership}} membership expires on {{expiryDate}}. Renew to keep your place at the table.\n\n{{link}}" } },
  { key: "membership.expired", name: "Membership expired", description: "Sent when a membership lapses.", variables: ["name", "membership", "clubName", "link"],
    sms: "{{clubName}}: your {{membership}} membership has expired. Renew any time: {{link}}",
    email: { subject: "Your {{membership}} membership has expired", body: "Hi {{name}},\n\nYour {{membership}} membership has expired. We'd love to have you back.\n\n{{link}}" } },
  { key: "booking.confirmed", name: "Coaching booking confirmed", description: "Coaching session confirmed after payment.", variables: ["name", "session", "coach", "bookingDate", "clubName", "link"],
    sms: "{{clubName}}: your {{session}} with {{coach}} is confirmed for {{bookingDate}}.",
    email: { subject: "Booking confirmed: {{session}} on {{bookingDate}}", body: "Hi {{name}},\n\nYour {{session}} with {{coach}} is confirmed for {{bookingDate}}.\n\n{{link}}" } },
  { key: "booking.reminder", name: "Coaching reminder", description: "Reminder before a coaching session.", variables: ["name", "session", "coach", "bookingDate", "clubName"],
    sms: "{{clubName}} reminder: {{session}} with {{coach}} on {{bookingDate}}. See you at the board!",
    email: { subject: "Reminder: {{session}} on {{bookingDate}}", body: "Hi {{name}},\n\nA reminder that your {{session}} with {{coach}} is on {{bookingDate}}." } },
  { key: "event.registered", name: "Event registration confirmed", description: "Event or tournament registration confirmed.", variables: ["name", "event", "eventDate", "location", "clubName", "link"],
    sms: "{{clubName}}: you're registered for {{event}} on {{eventDate}} at {{location}}.",
    email: { subject: "You're registered: {{event}}", body: "Hi {{name}},\n\nYou're registered for {{event}} on {{eventDate}} at {{location}}.\n\n{{link}}" } },
  { key: "event.reminder", name: "Event reminder", description: "Reminder before an event.", variables: ["name", "event", "eventDate", "location", "clubName"],
    sms: "{{clubName}} reminder: {{event}} starts {{eventDate}} at {{location}}.",
    email: { subject: "Reminder: {{event}} on {{eventDate}}", body: "Hi {{name}},\n\n{{event}} starts {{eventDate}} at {{location}}. See you there." } },
  { key: "admin.new_order", name: "Staff: new paid order", description: "Alert to staff when an order is paid.", variables: ["orderNumber", "amount", "customer", "link"],
    sms: "New paid order {{orderNumber}} from {{customer}} for {{amount}}.",
    email: { subject: "New paid order {{orderNumber}}", body: "Order {{orderNumber}} from {{customer}} was paid ({{amount}}).\n\n{{{orderTable}}}\n\n{{link}}" } },
  { key: "admin.payment_attention", name: "Staff: order needs attention", description: "Alert when a paid order could not be fulfilled automatically.", variables: ["orderNumber", "issue", "link"],
    sms: "Order {{orderNumber}} needs attention: {{issue}}",
    email: { subject: "Order {{orderNumber}} needs attention", body: "Order {{orderNumber}} was paid but needs attention:\n\n{{issue}}\n\n{{link}}" } },
  { key: "promo.campaign", name: "Promotional campaign", description: "Used by the campaign sender. Body is written per campaign.", variables: ["name", "clubName", "message"],
    sms: "{{message}}", email: { subject: "News from {{clubName}}", body: "Hi {{name}},\n\n{{message}}" } },
];
