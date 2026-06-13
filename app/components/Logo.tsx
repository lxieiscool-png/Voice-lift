// Reel wordmark — bold, sleek, minimal
// Use size="sm" in the nav, size="lg" on the landing hero

export default function Logo({ size = "md", className = "" }: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const configs = {
    sm: { width: 72,  height: 22, fontSize: 20, ls: 4,  barY: 20, barH: 1.5, barW: 68  },
    md: { width: 96,  height: 28, fontSize: 26, ls: 5,  barY: 25, barH: 1.5, barW: 90  },
    lg: { width: 160, height: 46, fontSize: 42, ls: 10, barY: 42, barH: 2,   barW: 152 },
  };
  const c = configs[size];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${c.width} ${c.height}`}
      width={c.width}
      height={c.height}
      className={className}
      aria-label="Reel"
    >
      <text
        x="2"
        y={c.barY - 2}
        fontFamily="'Arial Black', 'Helvetica Neue', Impact, sans-serif"
        fontSize={c.fontSize}
        fontWeight="900"
        letterSpacing={c.ls}
        fill="white"
      >
        REEL
      </text>
      <rect x="2" y={c.barY} width={c.barW} height={c.barH} fill="white" opacity="0.3" rx={c.barH / 2} />
    </svg>
  );
}
