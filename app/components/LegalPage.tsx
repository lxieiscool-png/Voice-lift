import Link from "next/link";

// Shared layout for the legal pages: same width, type and footer, so every
// policy links to every other one and to the operator's details.
export const OPERATOR = "Lucas Xie";
export const LOCATION = "California, USA";
export const SUPPORT_EMAIL = "support@getreel.org";
export const PRIVACY_EMAIL = "privacy@getreel.org";

const LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/refunds", label: "Refund Policy" },
  { href: "/cookies", label: "Cookie Policy" },
  { href: "/accessibility", label: "Accessibility" },
];

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back to Reel</Link>
      <h1 className="mt-4 font-display text-3xl tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: {updated}</p>
      <div className="mt-8 space-y-7 text-sm leading-relaxed text-foreground">{children}</div>
      <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/" className="hover:text-foreground">Home</Link>
          {LINKS.map(l => <Link key={l.href} href={l.href} className="hover:text-foreground">{l.label}</Link>)}
        </nav>
        <p className="mt-4">Reel is operated by {OPERATOR}, {LOCATION}. Contact: <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2 hover:text-foreground">{SUPPORT_EMAIL}</a></p>
      </footer>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg text-foreground">{title}</h2>
      <div className="space-y-2 text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">{children}</div>
    </section>
  );
}
