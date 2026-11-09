interface IconProps {
  name: "dashboard" | "expand" | "collapse" | "close" | "copy" | "check" | "play" | "arrow";
  size?: number;
}

export default function Icon({ name, size = 16 }: IconProps) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    expand: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 15l6-6M9 9h6v6" /></>,
    collapse: <path d="M5 12h14" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    check: <path d="M5 12l4 4L19 6" />,
    play: <path d="M8 5l11 7-11 7V5z" fill="currentColor" stroke="none" />,
    arrow: <path d="M9 5l7 7-7 7" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-symbol" width="24" height="24" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M3 15h5l3-8 5 14 3-6h6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
