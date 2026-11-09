interface Props {
  pct: number;
  size?: number;
  width?: number;
  color?: string;
  track?: string;
}

/** Small progress ring (SVG, round caps, one soft glow). */
export default function Ring({
  pct,
  size = 22,
  width = 3,
  color = "#82a9ff",
  track = "#303b4c",
}: Props) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  return (
    <svg width={size} height={size} style={{ flex: "none", display: "block" }} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={width} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${(c * clamped) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
      />
    </svg>
  );
}
