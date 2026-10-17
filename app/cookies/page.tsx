import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, Section } from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Cookie Policy | Reel",
  description: "The cookies and browser storage Reel uses.",
};

export default function CookiesPage() {
  return (
    <LegalShell title="Cookie Policy" updated="October 15, 2026">
      <Section title="The short version">
        <p>Reel uses only what it needs to work: a sign-in cookie, plus a few settings saved in your browser. We don&apos;t use advertising cookies, analytics trackers or cross-site tracking, and we don&apos;t sell or share browsing data.</p>
      </Section>

      <Section title="Cookies Reel sets">
        <ul>
          <li><strong>Sign-in cookies</strong> (named <code>sb-…-auth-token</code>, from our sign-in provider Supabase). These keep you signed in, are set only after you sign in, and are removed when you sign out. Reel can&apos;t work for signed-in users without them, so they are strictly necessary and don&apos;t need consent.</li>
        </ul>
      </Section>

      <Section title="Settings saved in your browser">
        <p>These are stored in your browser&apos;s local storage, never sent to advertisers, and you can clear them at any time:</p>
        <ul>
          <li>Your profile and a copy of your Library, so the app loads fast.</li>
          <li>Your light/dark theme choice.</li>
          <li>Whether you&apos;ve seen the welcome tour and the cookie notice.</li>
          <li>Answers you typed during sign-up, kept only until your account is created.</li>
        </ul>
      </Section>

      <Section title="Other services">
        <ul>
          <li><strong>Stripe:</strong> when you go to checkout or manage your subscription, you&apos;re on Stripe&apos;s own pages, which use cookies for security and fraud prevention under <a href="https://stripe.com/cookie-settings" target="_blank" rel="noreferrer">Stripe&apos;s cookie policy</a>.</li>
          <li><strong>Google sign-in:</strong> signing in happens on Google&apos;s pages, under Google&apos;s policies.</li>
          <li><strong>YouTube:</strong> the Film Room uses YouTube&apos;s privacy-enhanced player (youtube-nocookie.com), which doesn&apos;t set YouTube cookies until you play a video.</li>
        </ul>
      </Section>

      <Section title="Your choices">
        <p>You can block or delete cookies and local storage in your browser settings. If you block the sign-in cookie, you can still try Reel without an account, but you won&apos;t be able to sign in. More about your data is in our <Link href="/privacy">Privacy Policy</Link>.</p>
      </Section>
    </LegalShell>
  );
}
