import { type CSSProperties, type ReactNode, useCallback } from "react";
import Sparkline from "./Sparkline";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";

interface Props {
  label: string;
  /** static preformatted value (used when no animation is wanted) */
  value: string;
  /** numeric target for the rolling-digit animation */
  animValue?: number;
  /** formats the animated number for display */
  format?: (v: number) => string;
  unit?: string;
  color: string;
  data: number[];
  max?: number;
  sub?: ReactNode;
  secondary?: { data: number[]; max?: number };
  big?: boolean;
  /** let the sparkline stretch to fill remaining card height (HUD cards) */
  autoSpark?: boolean;
  /** stagger index for the entrance animation */
  index?: number;
  footer?: ReactNode;
}

export default function MetricCard({
  label,
  value,
  animValue,
  format,
  unit,
  color,
  data,
  max = 100,
  sub,
  secondary,
  big = false,
  autoSpark = false,
  index = 0,
  footer,
}: Props) {
  const animated = useAnimatedNumber(animValue ?? 0);
  const shown =
    animValue != null && format ? format(animated) : value;

  // spotlight: track the pointer in CSS vars (Aceternity technique, CSS-only)
  const onMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  const style = { "--card-index": index } as CSSProperties;

  return (
    <div
      className={`${big ? "dash-card" : "metric-card"}${autoSpark ? " metric-card-fill" : ""}`}
      style={style}
      onMouseMove={big ? onMove : undefined}
    >
      <div className="metric-head">
        <span className="label" style={{ color }}>
          {label}
        </span>
        {sub != null && <span className="metric-sub">{sub}</span>}
      </div>
      <div>
        <span className={`num metric-value`} style={{ color }}>
          {shown}
        </span>
        {unit && <span className="metric-unit num">{unit}</span>}
      </div>
      <div className={big ? "spark" : autoSpark ? "spark-fill" : undefined}>
        <Sparkline
          data={data}
          color={color}
          height={autoSpark && !big ? "100%" : big ? 64 : 38}
          max={max}
          secondary={secondary?.data}
          secondaryMax={secondary?.max}
        />
      </div>
      {footer}
    </div>
  );
}
