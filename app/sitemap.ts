import { MetadataRoute } from "next";

const BASE = "https://www.getreel.org";
const LEGAL = ["/privacy", "/terms", "/refunds", "/cookies", "/accessibility"];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    ...LEGAL.map(path => ({ url: `${BASE}${path}`, lastModified: new Date("2026-10-15"), changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
