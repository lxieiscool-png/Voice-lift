import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Reel",
  description: "The terms for using Reel.",
};

const UPDATED = "July 27, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to Reel</Link>
      <h1 className="mt-4 text-3xl font-black tracking-tight text-foreground">Terms of Service</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <Section title="1. Acceptance">
          <p>By accessing or using Reel, you agree to these Terms. If you do not agree, do not use Reel.</p>
        </Section>

        <Section title="2. Eligibility & minors">
          <p>If you are under 18, you may use Reel only with the permission and supervision of a parent or legal guardian, who agrees to these Terms on your behalf. If you are under 13, a parent or guardian must set up and control the account. Parents and guardians are responsible for their child&apos;s use of Reel.</p>
        </Section>

        <Section title="3. What Reel is — and isn't">
          <p>Reel provides AI-generated sports analysis, feedback, and practice suggestions for informational and educational purposes. <strong>It is not professional coaching, medical, physical-therapy, training, or health advice.</strong> AI feedback can be incomplete or wrong. Always use common sense, proper supervision, and appropriate safety precautions when training, and consult a qualified professional for injuries or health concerns. You are responsible for how you use the feedback.</p>
        </Section>

        <Section title="4. Your content">
          <p>You keep ownership of the film and content you submit. You grant Reel a limited license to process it solely to provide the service to you (see our <Link href="/privacy" className="text-blue-400 underline">Privacy Policy</Link>). You confirm you have the right to upload any footage you submit, and that doing so does not violate anyone else&apos;s rights or privacy.</p>
        </Section>

        <Section title="5. Acceptable use">
          <p>You agree not to: upload unlawful, harassing, or infringing content; upload footage of people without appropriate permission; attempt to break, overload, reverse-engineer, or gain unauthorized access to the service; or misuse the AI features. We may suspend or terminate accounts that violate these Terms.</p>
        </Section>

        <Section title="6. Subscriptions & billing">
          <p>Reel offers a free tier with monthly limits and a paid plan, Reel Pro. Paid subscriptions are billed monthly through Stripe and renew automatically until cancelled. To cancel or request a refund, contact <a href="mailto:support@getreel.org" className="text-blue-400 underline">support@getreel.org</a>. Prices and plan limits may change with notice.</p>
        </Section>

        <Section title="7. No warranty">
          <p>Reel is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of any kind, express or implied, including accuracy, fitness for a particular purpose, or uninterrupted availability.</p>
        </Section>

        <Section title="8. Limitation of liability">
          <p>To the fullest extent permitted by law, Reel and its operators will not be liable for any indirect, incidental, or consequential damages, or for any injury, loss, or damages arising from your use of the service or reliance on its output. Our total liability for any claim will not exceed the amount you paid us in the 12 months before the claim.</p>
        </Section>

        <Section title="9. Termination">
          <p>You may stop using Reel and delete your account at any time. We may suspend or terminate access for violations of these Terms or to protect the service.</p>
        </Section>

        <Section title="10. Changes & contact">
          <p>We may update these Terms; the date above reflects the latest version. Continued use after changes means you accept them. Questions? Email <a href="mailto:support@getreel.org" className="text-blue-400 underline">support@getreel.org</a>.</p>
        </Section>
      </div>

      <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
        <Link href="/accessibility" className="hover:text-foreground">Accessibility</Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold text-foreground">{title}</h2>
      <div className="space-y-2 text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </section>
  );
}
