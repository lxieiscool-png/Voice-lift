// Reel mark + wordmark. The mark is a dotted shot arc dropping into a rim —
// the same dot-matrix motif as the landing hero — in a solid disc. Everything
// draws in currentColor / theme tokens, so it works in light and dark.

export function ReelMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const dots = [[7, 18.5], [9, 13.8], [12, 10.6], [15.4, 9.3], [18.6, 10.4]];
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={className} aria-hidden>
      <circle cx="14" cy="14" r="14" className="fill-foreground" />
      {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.25} className="fill-background" opacity={0.45 + i * 0.13} />)}
      <path d="M17.6 14.2h4.6" strokeWidth="1.6" strokeLinecap="round" className="stroke-court" />
      <circle cx="20.6" cy="12.4" r="1.6" className="fill-court" />
    </svg>
  );
}

export default function Logo({ size = "md", className = "" }: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const s = { sm: [26, "text-[17px]"], md: [30, "text-xl"], lg: [44, "text-3xl"] }[size] as [number, string];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="Reel">
      <ReelMark size={s[0]} />
      <span className={`font-display font-medium tracking-tight text-foreground ${s[1]}`}>Reel</span>
    </span>
  );
}
