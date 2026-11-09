import { coreColor, type CoreType } from "../types";

export default function CoreBars({ cores, coreTypes = [], height = 50, gap = 5, showNumbers = false }: { cores: number[]; coreTypes?: CoreType[]; height?: number; gap?: number; showNumbers?: boolean }) {
  if (!cores.length) return <div className="core-empty" style={{ height }}>暂无核心数据</div>;
  const indexed = cores.map((pct, index) => ({ pct, index, type: coreTypes[index] ?? "P" }));
  const topologyAvailable = coreTypes.length > 0 && coreTypes.length === cores.length;
  const hybrid = topologyAvailable && coreTypes.includes("E") && coreTypes.includes("P");
  const groups = hybrid ? [
    { type: "P" as const, name: "性能核", entries: indexed.filter((core) => core.type === "P") },
    { type: "E" as const, name: "能效核", entries: indexed.filter((core) => core.type === "E") },
  ] : [{ type: "P" as const, name: topologyAvailable ? "性能核" : "逻辑核", entries: indexed }];

  return (
    <div className="core-groups" aria-label={hybrid ? "按性能核与能效核分组的实时负载" : "逻辑核实时负载"}>
      {groups.map((group) => (
        <div className={`core-group ${group.type.toLowerCase()}`} style={{ flex: group.entries.length }} key={group.type}>
          <div className="core-group-label"><strong>{group.name} {group.type}</strong><span>{group.entries.length} 线程</span></div>
          <div className="core-bars" style={{ height: showNumbers ? height + 18 : height, gap }}>
            {group.entries.map(({ pct, index }) => (
              <div key={index} className="core-bar-slot" title={`${group.name} · 逻辑核 ${index} · ${Math.round(pct)}%`}>
                <div className="core-bar-track"><div className="core-bar-fill" style={{ height: `${Math.max(pct > 0 ? 3 : 0, Math.min(100, pct))}%`, background: coreColor(pct, group.type) }} /></div>
                {showNumbers && <span className="core-bar-num num">{index % 2 === 0 || group.entries.length <= 12 ? index : ""}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
