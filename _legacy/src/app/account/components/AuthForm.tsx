import Link from "next/link";

type Props = { title: React.ReactNode; children: React.ReactNode; notice?: string; error?: string };
export function AuthFrame({ title, children, notice, error }: Props) {
  return <main className="subpage"><header className="subnav"><Link href="/" className="brand"><span className="brand-mark">♞</span>CHESS<span className="cyan">254</span></Link><Link href="/" className="arrow-link">← Clubhouse</Link></header><section className="subhero"><div className="section-kicker">MEMBER ACCOUNT</div><h1>{title}</h1><p>Access your Chess254 account and clubhouse services.</p></section><section className="subcontent single-content"><div className="form-panel">{notice && <div className="notice success">{notice}</div>}{error && <div className="notice">{error}</div>}{children}</div></section></main>;
}

export function AuthLinks({ children }: { children: React.ReactNode }) {
  return <div className="auth-links">{children}</div>;
}
