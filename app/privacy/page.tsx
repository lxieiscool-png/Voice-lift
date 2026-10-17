import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, Section, OPERATOR, LOCATION, PRIVACY_EMAIL } from "../components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | Reel",
  description: "How Reel collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="October 15, 2026">
      <p>Reel (&quot;Reel,&quot; &quot;we,&quot; &quot;us&quot;) is an AI film-analysis and coaching app for athletes. It is operated by {OPERATOR}, an individual based in {LOCATION}. This policy explains what we collect, why, who helps us process it, and what you can do about it. Questions: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.</p>

      <Section title="Children and teens">
        <p><strong>You must be 13 or older to create a Reel account.</strong> When anyone signs in for the first time, we ask their birth month and year. We keep only whether they are 13 or older, not the date. If someone is under 13, we delete the sign-in and everything attached to it right away.</p>
        <p>A parent or guardian may create an account in their own name and use it to analyze their child&apos;s film. If you are 13 to 17, you may use Reel only with a parent or guardian&apos;s permission.</p>
        <p>If you believe a child under 13 has given us personal information, email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> and we will delete it.</p>
      </Section>

      <Section title="What we collect">
        <ul>
          <li><strong>Account:</strong> your email address and name from Google sign-in, and profile details you choose to add (first name, sport, team, position, jersey number, jersey colour), plus the &quot;13 or older&quot; confirmation.</li>
          <li><strong>Film you submit:</strong> for an <strong>uploaded file</strong> or <strong>screen capture</strong>, your browser turns the video into still frames and only those frames are sent for analysis. The video file itself never leaves your device. For a <strong>YouTube link</strong>, Google&apos;s Gemini API reads the public video directly.</li>
          <li><strong>Analysis results:</strong> grades, written feedback, timelines and box scores. These describe players by jersey number and colour. Reel does not use facial recognition and does not try to identify anyone by face.</li>
          <li><strong>Game thumbnails:</strong> one still image per analyzed game, so your Library shows a picture. It is stored under a random, unguessable file name. Anyone with the exact link could open it, but it is not listed or searchable anywhere.</li>
          <li><strong>Teams:</strong> team details and any roster names and jersey numbers you enter.</li>
          <li><strong>Drill checks:</strong> the text feedback from each check. Drill video frames are analyzed and not stored.</li>
          <li><strong>Coach chat:</strong> your messages are sent to our AI provider to write a reply. We do not store chat history on our servers.</li>
          <li><strong>Usage counts</strong> (how many analyses you have run this month), so plan limits work.</li>
          <li><strong>Abuse protection:</strong> a one-way hash of your IP address, used to cap free use for people without an account and to rate-limit requests. We never store the IP address itself.</li>
          <li><strong>Payments:</strong> handled entirely by Stripe. We never see or store your card number. We keep your Stripe customer ID so we can match your subscription to your account.</li>
        </ul>
        <p>We don&apos;t ask for anything Reel doesn&apos;t use.</p>
      </Section>

      <Section title="Other people in your film">
        <p>Game film usually shows other players, often minors. Only upload footage you have the right to share. Reel refers to players by jersey number and colour, and you control whether any game is kept or deleted.</p>
      </Section>

      <Section title="How we use it">
        <ul>
          <li>To run the analysis, coaching, drills, stats and other features you ask for.</li>
          <li>To run your account, apply plan limits and process subscriptions.</li>
          <li>To keep the service secure, prevent abuse and fix problems.</li>
        </ul>
        <p>We do <strong>not</strong> sell or &quot;share&quot; your personal information (as California law defines those terms), we show no ads, and we don&apos;t use your film to train AI models.</p>
      </Section>

      <Section title="Companies that process data for us">
        <p>These providers process data only to run Reel, under their own security and privacy terms:</p>
        <ul>
          <li><strong>OpenAI</strong>: analyzes frames and writes coaching text. Under OpenAI&apos;s API terms, this data isn&apos;t used to train their models and is kept only briefly for abuse monitoring.</li>
          <li><strong>Google (Gemini API)</strong>: analyzes frames and reads public YouTube videos you link. We use the paid tier, under which submitted data isn&apos;t used to train Google&apos;s models.</li>
          <li><strong>Google (YouTube)</strong>: the Film Room plays linked videos in YouTube&apos;s privacy-enhanced embedded player.</li>
          <li><strong>Supabase</strong>: database, sign-in and file storage.</li>
          <li><strong>Inngest</strong>: runs full-game analyses in the background so you can close the tab.</li>
          <li><strong>Stripe</strong>: payments for Reel Pro.</li>
          <li><strong>Vercel</strong>: hosts the website.</li>
          <li><strong>jsDelivr</strong>: serves the open-source face-blur model files, only when you turn on face blur. Like any website, it receives your IP address when it delivers them.</li>
        </ul>
      </Section>

      <Section title="Cookies and email">
        <p>We use only the cookies needed to keep you signed in, and no advertising or analytics trackers. Details are in our <Link href="/cookies">Cookie Policy</Link>.</p>
        <p>We don&apos;t send marketing email. Stripe sends payment receipts. If we ever send newsletters or promotions, they will be opt-in and every one will have an unsubscribe link.</p>
      </Section>

      <Section title="Face blur">
        <p>Drill checks offer optional face blur that runs in your browser before any frame is sent. It is best-effort: reliable on close-up clips, less so on wide footage. Please check the preview before submitting.</p>
      </Section>

      <Section title="Your choices and rights">
        <ul>
          <li><strong>Delete your account:</strong> Settings → Delete account. It immediately deletes your account, games, teams, drill checks and images, and cancels any subscription.</li>
          <li><strong>Delete a single game:</strong> use its ⋮ menu in your Library.</li>
          <li><strong>Get a copy:</strong> Settings → Export History.</li>
          <li><strong>Correct your profile:</strong> Settings.</li>
          <li><strong>Anything else</strong> (access, correction or deletion requests, or a question): email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. We reply within 30 days.</li>
        </ul>
        <p>Depending on where you live (for example California under the CCPA, or the EU/UK under the GDPR), you may have further rights, such as to know, access, correct, delete or port your data, and to not be treated differently for using them. We honor these requests for everyone, wherever you live.</p>
      </Section>

      <Section title="How long we keep data">
        <ul>
          <li>Account, analyses, teams and thumbnails: until you delete them or your account.</li>
          <li>Game frames sent for background analysis: deleted when the analysis finishes.</li>
          <li>Hashed-IP rate-limit counters: about a day. Hashed-IP guest usage counts: by calendar month.</li>
          <li>Payment records: kept by Stripe as tax and accounting law requires.</li>
          <li>Our database provider&apos;s backups may hold deleted data for a short time before it is overwritten.</li>
        </ul>
      </Section>

      <Section title="Security">
        <p>Data is encrypted in transit, and each account&apos;s data is locked to that account at the database level. Server keys are never sent to your browser. No system is perfectly secure, but we take reasonable measures to protect your information.</p>
      </Section>

      <Section title="Changes">
        <p>If we change this policy, we&apos;ll update the date above. For material changes, we&apos;ll also make a reasonable effort to let you know in the app.</p>
      </Section>
    </LegalShell>
  );
}
