import Link from "next/link";
import { InquiryForm } from "@/app/components/InquiryForm";
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><Link href="/" className="arrow-link">← Home</Link></header><section className="subhero"><div className="section-kicker">GET IN TOUCH</div><h1>Let’s<br/><span>talk chess.</span></h1><p>Questions about the clubhouse, coaching, or membership? Send a note to the team.</p></section><section className="subcontent single-content"><div className="form-panel">{result === "sent" && <div className="notice success">Your message has been sent to the club.</div>}{result === "invalid" && <div className="notice">Please check the form and try again.</div>}{result === "unavailable" && <div className="notice">The message could not be saved right now. Please try again later.</div>}<InquiryForm/></div></section></main>;
}
