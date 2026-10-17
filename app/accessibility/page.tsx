import type { Metadata } from "next";
import { LegalShell, Section, SUPPORT_EMAIL } from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Accessibility | Reel",
  description: "Reel's commitment to an accessible experience.",
};

export default function AccessibilityPage() {
  return (
    <LegalShell title="Accessibility Statement" updated="October 15, 2026">
      <Section title="Our commitment">
        <p>We want Reel to work for as many people as possible, including people with disabilities. We use the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA as our working standard, and we treat accessibility as ongoing work rather than a one-time task.</p>
      </Section>

      <Section title="What we do">
        <ul>
          <li>Semantic HTML and headings, so screen readers can navigate pages.</li>
          <li>Keyboard access: every control, including expandable stat rows, can be reached with Tab and used with Enter or Space. A &quot;Skip to content&quot; link and a visible focus outline help keyboard users.</li>
          <li>Text and background colours checked against the WCAG AA contrast ratio, in both light and dark themes.</li>
          <li>Text alternatives for meaningful images, and labels for icon-only buttons and form fields.</li>
        </ul>
      </Section>

      <Section title="Known limitations">
        <p>Some areas may not yet fully meet every guideline, especially video playback in the Film Room (which uses YouTube&apos;s player) and dense stat tables on small screens. We&apos;re working on these and prioritize fixes based on feedback.</p>
      </Section>

      <Section title="Tell us if something isn't working">
        <p>If anything in Reel is hard to use because of a disability, or you have suggestions, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Tell us the page and what you were trying to do, and we&apos;ll help and work on a fix.</p>
      </Section>
    </LegalShell>
  );
}
