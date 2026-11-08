import { coreColor } from "../types";

/**
 * Per-logical-core live bars — the "which core is AutoCAD strangling" view.
 * Bars grow bottom-up; color mirrors the tray ring thresholds.
 */
export default function CoreBars({
  cores,
  height = 34,
  gap = 3,
  showNumbers = false,
}: {
  cores: number[];
  height?: number;
  gap?: number;
  showNumbers?: boolean;
}) {
  if (!cores.length) {
    return <div style={{ height, fontSize: 10, color: "var(--text-faint)" }}>无核心数据</div>;
  }
  return (
    <div
      className="core-bars"
      style={{ height: showNumbers ? height + 14 : height, gap }}
      aria-label="每核负载"
    >
      {cores.map((pct, i) => {
        const h = Math.max(8, Math.min(100, pct));
        return (
          <div key={i} className="core-bar-slot" title={`核 ${i} · ${Math.round(pct)}%`}>
            <div className="core-bar-fill" style={{ height: `${h}%`, background: coreColor(pct) }} />
            {showNumbers && (
              <span className="core-bar-num">{i % 4 === 0 || cores.length <= 12 ? i : ""}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
