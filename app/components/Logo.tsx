// Reel mark + wordmark. Three bars that step down into a play button: game
// film (▶) and the numbers Reel pulls out of it, with the last bar in court
// orange. Drawn in theme tokens, so it inverts correctly in dark mode.

export function ReelMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <rect x="1" y="1" width="38" height="38" rx="11" className="fill-foreground" />
      <rect x="12" y="11" width="4.2" height="18" rx="2.1" className="fill-background" />
      <rect x="18.6" y="14" width="4.2" height="12" rx="2.1" className="fill-background" opacity={0.8} />
      <rect x="25.2" y="17" width="4.2" height="6" rx="2.1" className="fill-court" />
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
