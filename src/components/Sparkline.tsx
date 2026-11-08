import { useId, type CSSProperties } from "react";

interface Props {
  data: number[];
  color: string;
  /** px number, or CSS size like "100%" to fill a flexed container */
  height?: number | string;
  max?: number;
  /** optional dashed overlay (e.g. busiest core under the CPU line) */
  secondary?: number[];
  secondaryMax?: number;
}

/**
 * Minimal SVG area sparkline, crafted per DESIGN.md:
 * vertical-gradient stroke, fading area fill, one restrained glow,
 * breathing endpoint dot, 85% saturation guide on percentage scales.
 */
export default function Sparkline({
  data,
  color,
  height = 42,
  max = 100,
  secondary,
  secondaryMax,
}: Props) {
  const gid = useId();
  const sid = useId();
  const n = data.length;
  // viewBox needs a numeric height; CSS size (e.g. "100%") only styles the element.
  const innerH = typeof height === "number" ? height : 42;
  if (n < 2) return <div style={{ height }} />;

  const W = 300;
  const pad = 2;
  const y = (v: number, m: number) =>
    innerH - pad - (Math.min(Math.max(v, 0), m) / m) * (innerH - pad * 2);
  const x = (i: number, len: number) => (i / (len - 1)) * W;

  const line = data.map((v, i) => `${x(i, n).toFixed(1)},${y(v, max).toFixed(1)}`).join(" L");
  const area = `M${line} L${W},${innerH} L0,${innerH} Z`;
  const lastX = x(n - 1, n);
  const lastY = y(data[n - 1], max);

  let secondPath: string | null = null;
  if (secondary && secondary.length > 1) {
    const m = secondaryMax ?? max;
    secondPath = `M${secondary
      .map((v, i) => `${x(i, secondary.length).toFixed(1)},${y(v, m).toFixed(1)}`)
      .join(" L")}`;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${innerH}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: height as CSSProperties["height"], display: "block" }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        {/* vertical gradient stroke: full strength at the crest, dimmer at the base */}
        <linearGradient id={sid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      {/* saturation guide at 85% — only meaningful on percentage scales */}
      {max === 100 && (
        <line
          x1="0"
          x2={W}
          y1={y(85, max)}
          y2={y(85, max)}
          stroke="hsl(0 95% 66% / 0.72)"
          strokeDasharray="3 4"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {secondPath && (
        <path
          d={secondPath}
          fill="none"
          stroke="rgba(226,232,240,0.30)"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={`M${line}`}
        fill="none"
        stroke={`url(#${sid})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 4px ${color}55)` }}
      />
      <circle cx={lastX} cy={lastY} r="6" fill={color} opacity="0.22" />
      <circle
        className="spark-dot"
        cx={lastX}
        cy={lastY}
        r="3.2"
        fill={color}
        style={{ filter: `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}
