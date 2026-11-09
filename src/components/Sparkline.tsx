import { useId } from "react";

interface Props {
  data: number[];
  color: string;
  height?: number;
  max?: number;
  secondary?: number[];
  secondaryMax?: number;
}

/** A quiet, explicit-color SVG chart; no CSS-variable color resolution in SVG attributes. */
export default function Sparkline({ data, color, height = 54, max = 100, secondary, secondaryMax }: Props) {
  const id = useId().replace(/:/g, "");
  const n = data.length;
  const width = 300;
  const pad = 3;
  const safeMax = max > 0 ? max : 100;
  const x = (i: number, length: number) => (i / Math.max(length - 1, 1)) * width;
  const y = (value: number, upper: number) => height - pad - (Math.min(Math.max(value, 0), upper) / upper) * (height - pad * 2);
  const path = (values: number[], upper: number) => values.map((value, i) => `${i === 0 ? "M" : "L"}${x(i, values.length).toFixed(1)},${y(value, upper).toFixed(1)}`).join(" ");
  const line = n > 1 ? path(data, safeMax) : "";
  const area = line ? `${line} L${width},${height} L0,${height} Z` : "";
  const secondaryLine = secondary && secondary.length > 1 ? path(secondary, secondaryMax ?? safeMax) : "";

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="#465266" strokeOpacity="0.24" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {area && <path d={area} fill={`url(#area-${id})`} />}
      {secondaryLine && <path d={secondaryLine} fill="none" stroke="#8792a5" strokeOpacity="0.55" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
      {line && <path d={line} fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {line && <circle cx={width - 1} cy={y(data[n - 1], safeMax)} r="2.5" fill={color} />}
    </svg>
  );
}
