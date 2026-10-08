import Link from "next/link";
import { getHomeContent, settingText } from "@/lib/content";
export default async function AboutPage() {
  const { settings } = await getHomeContent();
  return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><Link href="/" className="arrow-link">← Home</Link></header><section className="subhero"><div className="section-kicker">{settingText(settings, "club.location", "")}</div><h1>More than<br/><span>a game.</span></h1><p>{settingText(settings, "club.name", "Chess254")} is a clubhouse for people who want to play, learn, and belong. Come as you are, find your level, and make the next move together.</p><Link href="/join" className="button">Ask about membership <span>↗</span></Link></section></main>;
}
