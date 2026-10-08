import Link from "next/link";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function LearnPage() {
  const materials = await prisma.learningMaterial.findMany({ where: { published: true }, include: { category: true }, orderBy: { createdAt: "desc" } }).catch(() => []);
  return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><Link href="/" className="arrow-link">← Home</Link></header><section className="subhero"><div className="section-kicker">CHESS ACADEMY</div><h1>Learn the<br/><span>game.</span></h1><p>Lessons and learning resources curated by the club.</p></section><section className="subcontent single-content">{materials.length ? <div className="plan-grid">{materials.map((material) => <article className="plan-card" key={material.id}><div className="plan-top"><span>{material.category.name}</span></div><h3>{material.title}</h3><p>{material.summary}</p><span className="material-type">{material.type.toLowerCase()}</span></article>)}</div> : <div className="empty-state"><span>♘</span><h3>No learning materials yet</h3><p>Lessons and resources will appear here when the club publishes them.</p></div>}</section></main>;
}
