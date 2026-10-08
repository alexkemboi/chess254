import { submitInquiry } from "@/app/actions";

export function InquiryForm({ selectedPlan, heading = "Send a note" }: { selectedPlan?: string; heading?: string }) {
  return <form action={submitInquiry} className="contact-form">
    <label>Your name<input name="name" minLength={2} maxLength={100} required autoComplete="name"/></label>
    <label>Email address<input name="email" type="email" maxLength={254} required autoComplete="email"/></label>
    <label>Phone number <span>(optional)</span><input name="phone" type="tel" maxLength={40} autoComplete="tel"/></label>
    <label>Subject<input name="subject" defaultValue={selectedPlan ? `Membership enquiry: ${selectedPlan}` : ""} minLength={2} maxLength={160} required/></label>
    <label>Message<textarea name="message" minLength={10} maxLength={5000} required rows={5} defaultValue={selectedPlan ? `I’m interested in the ${selectedPlan} membership. Please share the next steps.` : ""}/></label>
    <button className="button" type="submit">{heading} <span aria-hidden="true">↗</span></button>
  </form>;
}
