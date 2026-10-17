import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, Section, SUPPORT_EMAIL } from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Refund Policy | Reel",
  description: "How cancellations and refunds work for Reel Pro.",
};

export default function RefundsPage() {
  return (
    <LegalShell title="Refund Policy" updated="October 15, 2026">
      <Section title="The short version">
        <p>Reel Pro is $8 a month and renews automatically. You can cancel anytime, and you keep Pro until the end of the month you paid for. We don&apos;t refund partial months, but we always fix billing mistakes.</p>
      </Section>

      <Section title="Cancelling">
        <p>Go to Settings → Manage subscription. You can cancel there in a couple of clicks, with no email or call needed. You won&apos;t be charged again, and Pro stays active until your current billing month ends. Deleting your account also cancels your subscription right away.</p>
      </Section>

      <Section title="When we refund">
        <ul>
          <li>You were charged twice, or charged the wrong amount.</li>
          <li>You were charged after you cancelled.</li>
          <li>A problem on our side kept Pro from working for a significant part of your billing month.</li>
        </ul>
      </Section>

      <Section title="When we don't">
        <p>We don&apos;t refund the unused part of a month after you cancel, or a month you didn&apos;t use. The Free plan is always available if you&apos;d rather not pay.</p>
      </Section>

      <Section title="How to ask">
        <p>Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> within 30 days of the charge, with the email you sign in with and the date of the charge. Approved refunds go back to your original payment method through Stripe and usually arrive within 5 to 10 business days.</p>
        <p>This policy doesn&apos;t limit any rights you have under consumer protection law. See also our <Link href="/terms">Terms of Service</Link>.</p>
      </Section>
    </LegalShell>
  );
}
