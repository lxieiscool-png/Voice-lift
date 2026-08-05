import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Accessibility — Reel",
  description: "Reel's commitment to an accessible experience.",
};

const UPDATED = "July 27, 2026";

export default function AccessibilityPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to Reel</Link>
      <h1 className="mt-4 text-3xl font-black tracking-tight text-foreground">Accessibility Statement</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {UPDATED}</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground">
        <Section title="Our commitment">
          <p>Reel is committed to making our product usable by as many people as possible, including people with disabilities. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA as a practical standard, and we treat accessibility as an ongoing effort rather than a one-time task.</p>
        </Section>

        <Section title="What we do">
          <ul>
            <li>Semantic HTML and headings so screen readers can navigate the page.</li>
            <li>Keyboard-operable controls and visible focus for interactive elements.</li>
            <li>Light and dark themes, with color choices chosen for readable contrast.</li>
            <li>Text alternatives and labels for meaningful icons and controls.</li>
          </ul>
        </Section>

        <Section title="Known limitations">
          <p>Reel is a small, fast-moving product, and some areas may not yet fully meet every guideline — for example, complex data views and the video-analysis interface. We are actively working to improve these, and we prioritize fixes based on user feedback.</p>
        </Section>

        <Section title="Tell us if something isn't working">
          <p>If you have trouble using any part of Reel because of a disability, or you have suggestions to make it more accessible, please contact us at <a href="mailto:support@getreel.org" className="text-blue-400 underline">support@getreel.org</a>. Include the page and what you were trying to do, and we&apos;ll work to help and to fix the issue.</p>
        </Section>
      </div>

      <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
        <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold text-foreground">{title}</h2>
      <div className="space-y-2 text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5">{children}</div>
    </section>
  );
}
