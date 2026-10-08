import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function GalleryPage() {
  const images = await prisma.galleryImage.findMany({ where: { visible: true }, orderBy: [{ featured: "desc" }, { position: "asc" }] }).catch(() => []);
  return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><Link href="/" className="arrow-link">← Home</Link></header><section className="subhero"><div className="section-kicker">THE CLUBHOUSE IN MOTION</div><h1>Good moves.<br/><span>Good company.</span></h1><p>Moments from around the Chess254 community.</p></section><section className="subcontent single-content">{images.length ? <div className="gallery-grid">{images.map((image) => <figure key={image.id}><div className="gallery-photo"><Image src={image.imageUrl} alt={image.title} fill sizes="(max-width: 700px) 100vw, 33vw"/></div><figcaption>{image.title}<span>{image.category}</span></figcaption></figure>)}</div> : <div className="empty-state"><span>▧</span><h3>No gallery images yet</h3><p>Club moments will appear here when they’re added.</p></div>}</section></main>;
}
