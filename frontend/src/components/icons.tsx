// Энгийн шугаман дүрсүүд (24×24, currentColor)
type P = { size?: number };

const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const IconHome = ({ size = 16 }: P) =>
  svg(size, <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>);

export const IconMountain = ({ size = 16 }: P) =>
  svg(size, <><path d="M3 20l6-10 4 6 3-4 5 8z" /><path d="M14 6l2 2 3-3" /></>);

export const IconChart = ({ size = 16 }: P) =>
  svg(size, <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>);

export const IconBuilding = ({ size = 16 }: P) =>
  svg(size, <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></>);

export const IconDashboard = ({ size = 16 }: P) =>
  svg(size, <><circle cx="12" cy="13" r="8" /><path d="M12 13l4-4" /><path d="M8 17h8" /></>);

export const IconPin = ({ size = 16 }: P) =>
  svg(size, <><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>);

export const IconAlert = ({ size = 16 }: P) =>
  svg(size, <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.5" /></>);

export const IconTable = ({ size = 16 }: P) =>
  svg(size, <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M3 15h18M9 4v16" /></>);

export const IconLink = ({ size = 16 }: P) =>
  svg(size, <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>);

export const IconDatabase = ({ size = 16 }: P) =>
  svg(size, <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" /><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" /><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" /></>);
export const IconSearch = ({ size = 16 }: P) => svg(size, <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>);

// ---------------------------------------------------------------- хэлтсийн дүрс

export const IconLayers = ({ size = 16 }: P) =>
  svg(size, <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17.5l9 5 9-5" opacity=".5" /></>);

export const IconNetwork = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <circle cx="12" cy="8" r="1.6" />
      <path d="M9 21l3-11 3 11M10 17h4" />
      <path d="M8.5 4.5a5 5 0 000 7M15.5 4.5a5 5 0 010 7" />
      <path d="M5.5 2a9 9 0 000 12M18.5 2a9 9 0 010 12" opacity=".6" />
    </>,
  );

export const IconDrill = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <path d="M7.5 19L12 3l4.5 16" />
      <path d="M9.6 12h4.8M10.6 7.5h2.8M9 16l6-4M15 16l-6-4" />
      <path d="M4 19h16" />
      <path d="M12 19v2.5" />
    </>,
  );

export const IconLeaf = ({ size = 16 }: P) =>
  svg(size, <><path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z" /><path d="M5 19l8-8" /></>);

export const IconSprout = ({ size = 16 }: P) =>
  svg(size, <><path d="M12 21v-9" /><path d="M12 12c0-4-3-6-7-6 0 4 3 6 7 6z" /><path d="M12 10c0-4 3-6 7-6 0 4-3 6-7 6z" /><path d="M8 21h8" /></>);

export const IconShield = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <path d="M4 16.5a8 8 0 0116 0" />
      <path d="M10 9V5h4v4" />
      <path d="M2.5 16.5h19V19h-19z" />
    </>,
  );

export const IconGear = ({ size = 16 }: P) =>
  svg(
    size,
    <>
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="12" cy="12" r="6.2" />
      <path
        d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1"
        strokeWidth={2.6}
      />
    </>,
  );

const DEPT_ICONS: Record<string, (p: P) => JSX.Element> = {
  GMH: IconLayers, // Геологи, маркшейдер
  COM: IconNetwork, // Холбоо шугамын байгууламж
  GHE: IconDrill, // Геологи хайгуулын экспедици
  BOH: IconLeaf, // Байгаль орчин, ногоон хөгжил
  NHT: IconSprout, // Ногоон хөгжлийн төслийн нэгж
  HSE: IconShield, // ХАБЭА
  MEC: IconGear, // Механик
};

/** Хэлтсийн дүрс — өнгөт дэвсгэртэй жижиг хайрцагт. Өнгө нь CSS хувьсагч (--dc) — идэвхтэй/идэвхгүй байдлыг CSS шийднэ */
export function DeptIcon({ code, color, size = 16 }: { code: string; color: string; size?: number }) {
  const Icon = DEPT_ICONS[code] ?? IconBuilding;
  return (
    <span
      className="dept-icon"
      style={{ "--dc": color, width: size + 10, height: size + 10 } as React.CSSProperties}
    >
      <Icon size={size} />
    </span>
  );
}
