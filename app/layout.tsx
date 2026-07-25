import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Reel",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  title: "Reel — Your AI Sports Coach",
  description: "Upload your game film and get real coaching, not just stats. Reel grades every decision, tells you what to work on, and checks your form as you drill it. Try it free.",
  keywords: [
    "sports coaching app",
    "AI sports coach",
    "game film analysis",
    "basketball film analysis",
    "soccer film analysis",
    "volleyball film analysis",
    "athlete practice plan",
    "sports decision making",
    "youth sports coaching",
    "drill form feedback",
    "solo practice drills",
    "Reel app",
  ],
  authors: [{ name: "Reel" }],
  creator: "Reel",
  metadataBase: new URL("https://www.getreel.org"),
  alternates: {
    canonical: "https://www.getreel.org",
  },
  openGraph: {
    type: "website",
    url: "https://www.getreel.org",
    title: "Reel — Your AI Sports Coach",
    description: "Upload your game film and get real coaching, not just stats. Reel grades every decision, tells you what to work on, and checks your form as you drill it. Try it free.",
    siteName: "Reel",
  },
  twitter: {
    card: "summary_large_image",
    title: "Reel — Your AI Sports Coach",
    description: "Upload your game film and get real coaching, not just stats. Try it free.",
  },
  verification: {
    google: "zYn7Xjg_65vBObtAPhQmFlGGVBuHzddXgizGs3IyD3g",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the saved theme before paint to avoid a flash. Defaults to dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('reel-theme');var d=t?t==='dark':true;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
