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
  title: "Reel — Free AI Sports Coaching for Every Athlete",
  description: "Upload your game film and get instant AI coaching. Reel analyzes every player, grades every decision, and builds a personalized practice plan. Free for every athlete.",
  keywords: [
    "sports coaching app",
    "AI sports coach",
    "game film analysis",
    "free sports coaching",
    "basketball film analysis",
    "soccer film analysis",
    "football film analysis",
    "athlete practice plan",
    "sports decision making",
    "youth sports coaching",
    "free coaching app",
    "Reel app",
  ],
  authors: [{ name: "Reel" }],
  creator: "Reel",
  metadataBase: new URL("https://getreelapp.vercel.app"),
  alternates: {
    canonical: "https://getreelapp.vercel.app",
  },
  openGraph: {
    type: "website",
    url: "https://getreelapp.vercel.app",
    title: "Reel — Free AI Sports Coaching for Every Athlete",
    description: "Upload your game film and get instant AI coaching. Reel analyzes every player, grades every decision, and builds a personalized practice plan. Free for every athlete.",
    siteName: "Reel",
  },
  twitter: {
    card: "summary_large_image",
    title: "Reel — Free AI Sports Coaching for Every Athlete",
    description: "Upload your game film and get instant AI coaching. Free for every athlete, everywhere.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
