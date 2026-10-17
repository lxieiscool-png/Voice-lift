import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, Section, OPERATOR, LOCATION, SUPPORT_EMAIL } from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service | Reel",
  description: "The terms for using Reel.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="October 15, 2026">
      <Section title="1. Who we are, and accepting these terms">
        <p>Reel is operated by {OPERATOR}, {LOCATION} (&quot;Reel,&quot; &quot;we,&quot; &quot;us&quot;). By using Reel you agree to these Terms and to our <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree, please don&apos;t use Reel.</p>
      </Section>

      <Section title="2. Eligibility and minors">
        <p>You must be <strong>13 or older</strong> to create an account. If you are 13 to 17, you may use Reel only with a parent or guardian&apos;s permission, and they agree to these Terms on your behalf. A parent or guardian may create an account in their own name to analyze their child&apos;s film, and is responsible for that use.</p>
      </Section>

      <Section title="3. What Reel is, and isn't">
        <p>Reel gives AI-generated sports analysis, stats, feedback and practice suggestions for informational and educational purposes. <strong>It is not professional coaching, medical, physical-therapy, training or health advice.</strong> AI output can be incomplete or wrong. Grades, box scores and stats are estimates made from film, not official scorekeeping. Use common sense and proper supervision when training, and see a qualified professional about injuries or health concerns. You are responsible for how you use the feedback.</p>
      </Section>

      <Section title="4. Your content">
        <p>You keep ownership of the film and content you submit. You give Reel a limited license to process it only to provide the service to you. You confirm you have the right to submit any footage, including footage showing other people, and that doing so doesn&apos;t violate anyone&apos;s rights or privacy.</p>
      </Section>

      <Section title="5. Acceptable use">
        <p>Don&apos;t upload unlawful, harassing, sexual or infringing content. Don&apos;t upload footage of people without appropriate permission. Don&apos;t try to break, overload, scrape, reverse-engineer or get unauthorized access to Reel, or get around plan limits. We may suspend or end accounts that break these rules.</p>
      </Section>

      <Section title="6. Plans, billing and cancellation">
        <ul>
          <li><strong>Free plan:</strong> no card needed, with the monthly limits shown on our pricing.</li>
          <li><strong>Reel Pro:</strong> $8 per month (USD), billed through Stripe. <strong>It renews automatically every month until you cancel.</strong> There are no setup fees or hidden charges.</li>
          <li><strong>Cancel anytime</strong> in Settings → Manage subscription. Pro stays active until the end of the month you&apos;ve paid for, and you won&apos;t be charged again.</li>
          <li><strong>Refunds:</strong> see our <Link href="/refunds">Refund Policy</Link>. In short: no refunds for partial months, but billing mistakes are always refunded.</li>
          <li>If we change the price, we&apos;ll tell you before your next renewal, and you can cancel before it takes effect.</li>
        </ul>
      </Section>

      <Section title="7. Ending your account">
        <p>You can delete your account at any time in Settings → Delete account. This deletes your data as described in the Privacy Policy and cancels any subscription. We may suspend or end access for violations of these Terms or to protect the service.</p>
      </Section>

      <Section title="8. No warranty">
        <p>Reel is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of any kind, express or implied, including accuracy, fitness for a particular purpose, or uninterrupted availability.</p>
      </Section>

      <Section title="9. Limitation of liability">
        <p>To the fullest extent the law allows, Reel and its operator are not liable for indirect, incidental or consequential damages, or for any injury, loss or damage arising from your use of the service or reliance on its output. Our total liability for any claim is limited to what you paid us in the 12 months before the claim. Nothing in these Terms limits rights you have under consumer protection law that can&apos;t be waived.</p>
      </Section>

      <Section title="10. Governing law">
        <p>These Terms are governed by the laws of the State of California, USA, without regard to conflict-of-law rules. Before filing any claim, please contact us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> so we can try to resolve it informally.</p>
      </Section>

      <Section title="11. Changes and contact">
        <p>If we update these Terms, we&apos;ll change the date above. Using Reel after a change means you accept the updated Terms. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </LegalShell>
  );
}
