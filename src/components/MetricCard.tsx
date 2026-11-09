import type { CSSProperties, ReactNode } from "react";
import Sparkline from "./Sparkline";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";

interface Props {
  label: string;
  value: string;
  animValue?: number;
  format?: (value: number) => string;
  unit?: string;
  color: string;
  data: number[];
  max?: number;
  sub?: ReactNode;
  secondary?: { data: number[]; max?: number };
  primary?: boolean;
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
  primary = false,
  footer,
}: Props) {
  const animated = useAnimatedNumber(animValue ?? 0);
  const shown = animValue != null && format ? format(animated) : value;

  const style = { "--metric-color": color, borderColor: `${color}${primary ? "66" : "38"}` } as CSSProperties;
  return (
    <section className={`metric-panel${primary ? " metric-primary" : ""}`} style={style} aria-label={`${label} ${shown}${unit ?? ""}`}>
      <div className="metric-head">
        <h3 className="metric-label">{label}</h3>
        {sub != null && <span className="metric-sub">{sub}</span>}
      </div>
      <div className="metric-value-row">
        <span className="num metric-value">{shown}</span>
        {unit && <span className="metric-unit num">{unit}</span>}
      </div>
      <Sparkline data={data} color={color} height={54} max={max} secondary={secondary?.data} secondaryMax={secondary?.max} />
      {footer && <div className="metric-footer">{footer}</div>}
    </section>
  );
}
