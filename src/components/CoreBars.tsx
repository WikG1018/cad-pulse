import { coreColor, type CoreType } from "../types";
import { useLanguage } from "../i18n";

export default function CoreBars({ cores, coreTypes = [], height = 50, gap = 5, showNumbers = false }: { cores: number[]; coreTypes?: CoreType[]; height?: number; gap?: number; showNumbers?: boolean }) {
  const { t } = useLanguage();
  if (!cores.length) return <div className="core-empty" style={{ height }}>{t.cores.empty}</div>;
  const indexed = cores.map((pct, index) => ({ pct, index, type: coreTypes[index] ?? "P" }));
  const topologyAvailable = coreTypes.length > 0 && coreTypes.length === cores.length;
  const hybrid = topologyAvailable && coreTypes.includes("E") && coreTypes.includes("P");
  const groups = hybrid ? [
    { type: "P" as const, name: t.cores.performance, entries: indexed.filter((core) => core.type === "P") },
    { type: "E" as const, name: t.cores.efficiency, entries: indexed.filter((core) => core.type === "E") },
  ] : [{ type: "P" as const, name: topologyAvailable ? t.cores.performance : t.cores.logical, entries: indexed }];

  return (
    <div className="core-groups" aria-label={hybrid ? t.cores.groupAria : t.cores.genericAria}>
      {groups.map((group) => (
        <div className={`core-group ${group.type.toLowerCase()}`} style={{ flex: group.entries.length }} key={group.type}>
          <div className="core-group-label"><strong>{group.name} {hybrid ? group.type : ""}</strong><span>{group.entries.length} {t.cores.threads}</span></div>
          <div className="core-bars" style={{ height: showNumbers ? height + 18 : height, gap }}>
            {group.entries.map(({ pct, index }) => (
              <div key={index} className="core-bar-slot" title={`${group.name} · ${t.cores.logicalCore} ${index} · ${Math.round(pct)}%`}>
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
