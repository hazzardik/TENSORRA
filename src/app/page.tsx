import Link from "next/link";
import InstallAppButton from "@/components/install-app-button";

export default function LandingPage() {
  return (
    <main className="landingShell">
      <nav className="landingNav">
        <Link className="landingBrand" href="/"><span className="tensorMark">T</span><strong>TENSORRA</strong></Link>
        <div className="landingNavActions"><Link href="/login">Sign in</Link><Link className="navPrimary" href="/app">Open TENSORRA</Link></div>
      </nav>

      <section className="landingHero">
        <div className="landingGlow" />
        <p className="eyebrow">AGENTIC AI · PRIVATE MEMORY · REASONING</p>
        <h1>Intelligence that adapts<br />to the way you think.</h1>
        <p className="landingLead">TENSORRA combines variable-depth reasoning, live web research, Python execution, private document search and long-term memory in one AI workspace.</p>
        <div className="landingCtas"><Link className="heroPrimary" href="/app">Start using TENSORRA</Link><InstallAppButton /></div>
        <div className="heroStatus"><span><i /> Auto reasoning</span><span><i /> Web tools</span><span><i /> Private RAG</span><span><i /> Cross-platform</span></div>
      </section>

      <section className="featureGrid">
        <article><span className="featureIndex">01</span><h2>Reasoning depth</h2><p>Auto, Fast, Balanced, Deep and Max. TENSORRA routes each request to the right model and reasoning effort.</p></article>
        <article><span className="featureIndex">02</span><h2>Tools, not just text</h2><p>Browser search and Python code execution let the model verify current facts and solve computational tasks.</p></article>
        <article><span className="featureIndex">03</span><h2>Your private knowledge</h2><p>Upload PDFs and text files. TENSORRA retrieves only the passages relevant to the current question.</p></article>
        <article><span className="featureIndex">04</span><h2>Long-term memory</h2><p>Useful goals, preferences and constraints survive between conversations without stuffing every chat into the prompt.</p></article>
      </section>

      <section className="architectureBand">
        <div><p className="eyebrow">TENSORRA CORE</p><h2>One product. Replaceable intelligence underneath.</h2></div>
        <div className="architectureFlow"><span>Interface</span><b>→</b><span>Core</span><b>→</b><span>Memory</span><b>→</b><span>Tools</span><b>→</b><span>Models</span></div>
      </section>

      <footer className="landingFooter"><span>© 2026 TENSORRA</span><span>Web · iOS · Android · Desktop</span></footer>
    </main>
  );
}
