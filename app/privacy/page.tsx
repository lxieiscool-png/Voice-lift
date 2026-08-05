import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Reel",
  description: "How Reel collects, uses, and protects your data.",
};

const UPDATED = "July 27, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to Reel</Link>
      <h1 className="mt-4 text-3xl font-black tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="prose-legal mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <p>Reel (&quot;Reel,&quot; &quot;we,&quot; &quot;us&quot;) provides AI-assisted sports coaching. This policy explains what we collect, how we use it, and the choices you have. By using Reel you agree to this policy.</p>

        <Section title="Who can use Reel & children's privacy">
          <p>Reel is used by athletes of many ages, including minors. If you are under 18, you may use Reel only with the involvement and permission of a parent or legal guardian. If you are under 13, a parent or guardian must create and manage the account and provide consent on your behalf, consistent with the Children&apos;s Online Privacy Protection Act (COPPA).</p>
          <p>We do not knowingly collect personal information from a child under 13 without verifiable parental consent. A parent or guardian may review, request deletion of, or refuse further collection of their child&apos;s information at any time by contacting us at <a href="mailto:privacy@getreel.org">privacy@getreel.org</a>.</p>
        </Section>

        <Section title="What we collect">
          <ul>
            <li><strong>Account info:</strong> your email address (via Google sign-in) and any profile details you add (name, sport, team, jersey).</li>
            <li><strong>Video &amp; images:</strong> when you analyze film, your video is <strong>processed on your own device</strong> — the video file itself is never uploaded to us. Only still frames extracted in your browser are sent for analysis, and those frames are deleted after processing. For full-game background analysis, frames are held briefly in private storage and then deleted. One low-resolution thumbnail per game may be retained to display your library.</li>
            <li><strong>Usage data:</strong> counts of analyses you run, so we can apply plan limits.</li>
            <li><strong>Payment info:</strong> if you subscribe to Reel Pro, payment is handled by Stripe. We do not receive or store your card number.</li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul>
            <li>To provide the analysis, coaching, drills, and features you request.</li>
            <li>To operate your account, apply plan limits, and process subscriptions.</li>
            <li>To maintain, secure, and improve the service.</li>
          </ul>
          <p>We do <strong>not</strong> sell your personal information, and we do not use your film to advertise to you.</p>
        </Section>

        <Section title="Service providers we share with">
          <p>To run Reel, limited data is processed by trusted providers acting on our behalf:</p>
          <ul>
            <li><strong>OpenAI</strong> — analyzes the video frames you submit. Per OpenAI&apos;s API terms, this data is not used to train their models and is retained only briefly for abuse monitoring.</li>
            <li><strong>Supabase</strong> — database, authentication, and storage.</li>
            <li><strong>Stripe</strong> — payment processing for Reel Pro.</li>
            <li><strong>Vercel</strong> — website hosting.</li>
          </ul>
          <p>We share data with these providers only as needed to operate the service, and never with other Reel users.</p>
        </Section>

        <Section title="Face blur">
          <p>Reel offers an optional, on-device face-blur feature for drill clips. When enabled, faces are blurred in your browser before any frame is sent. It is best-effort — reliable on close-up clips, less so on wide footage — and we recommend verifying results.</p>
        </Section>

        <Section title="Your choices &amp; rights">
          <p>You may access, correct, or delete your data, or request a copy, by emailing <a href="mailto:privacy@getreel.org">privacy@getreel.org</a>. Depending on where you live (e.g., California/CCPA, EU/UK GDPR), you may have additional rights, including the right to opt out of sale (we do not sell data) and to request deletion. Deleting your account removes your saved analyses.</p>
        </Section>

        <Section title="Data retention &amp; security">
          <p>We keep account and analysis data until you delete it or your account. Video frames are deleted after analysis. We use industry-standard measures (encryption in transit, row-level access controls) to protect your data, though no system is perfectly secure.</p>
        </Section>

        <Section title="Changes">
          <p>We may update this policy; material changes will be reflected by the date above. Contact us at <a href="mailto:privacy@getreel.org">privacy@getreel.org</a> with any questions.</p>
        </Section>
      </div>

      <FooterLinks />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold text-foreground">{title}</h2>
      <div className="space-y-2 text-muted-foreground [&_a]:text-blue-400 [&_a]:underline [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5">{children}</div>
    </section>
  );
}

function FooterLinks() {
  return (
    <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
      <Link href="/" className="hover:text-foreground">Home</Link>
      <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
      <Link href="/accessibility" className="hover:text-foreground">Accessibility</Link>
    </div>
  );
}
