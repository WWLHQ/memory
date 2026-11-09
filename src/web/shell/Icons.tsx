// 壳层图标：定稿里的线性图标集，按需内联渲染（不引入外部图标库、不依赖网络）。
import type { JSX } from 'react';
import type { IconName } from './views.ts';

const PATHS: Record<IconName, JSX.Element> = {
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" /></>,
  db: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 9h18M9 9v11M15 9v11M3 14.5h18" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  warn: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5M12 17h.01" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 7-2.6" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4.5 4.5" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
  book: <><path d="M4 4h7v16H4zM13 4h7v16h-7z" /><path d="M6.5 8h2M15.5 8h2" /></>,
  list: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h.01M10.5 9h6.5M7 13h.01M10.5 13h6.5M7 17h.01M10.5 17h4" /></>,
  shield: <><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6L12 3Z" /><path d="m9 12 2 2 4-4" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  play: <><path d="m7 4 13 8-13 8V4Z" /></>,
  play2: <><path d="m7 4 13 8-13 8V4Z" /></>,
  sync: <><path d="M4 12a8 8 0 0 1 13.7-5.7L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15" /><path d="M4 20v-5h5" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" /></>,
  agent: <><rect x="5" y="8" width="14" height="10" rx="2" /><path d="M12 4v4M9 13h.01M15 13h.01M2 12v3M22 12v3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.3" /><path d="M20 4v7h-7" /></>,
  export: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 14h18" /></>,
  fold: <><path d="M4 5h16M4 12h16M4 19h10" /><path d="m17 17 3 3-3 3" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V4H4v12h4" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v11h14V9M10 13h4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M17 5l2 2M14.5 7.5l2 2" /></>,
  check: <><path d="m4 12 5 5L20 6" /></>,
  scale: <><path d="M12 4v16M7 20h10M3 8h18" /><path d="M5 8l-2.5 5h5L5 8Z" /><path d="M19 8l-2.5 5h5L19 8Z" /><path d="M2.5 13a2.5 2.5 0 0 0 5 0M16.5 13a2.5 2.5 0 0 0 5 0" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8h.01M12 11v5" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01" /></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  broken: <><path d="M11 13.5a4 4 0 0 0 4.7.5l2-2" /><path d="M13 10.5a4 4 0 0 0-4.7-.5l-2 2" /><path d="m3.5 3.5 17 17" /></>,
  ring: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 7.4 4.9" /></>,
  system: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  moon: <><path d="M20 15.2A8.2 8.2 0 1 1 8.8 4a6.5 6.5 0 0 0 11.2 11.2Z" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  chev: <><path d="m9 5 7 7-7 7" /></>,
  caret: <><path d="m6 9 6 6 6-6" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  folder: <><path d="M4 5h6l2 2h8v12H4z" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></>,
  dot: <><circle cx="12" cy="12" r="3.5" /></>,
  save: <><path d="M5 4h11l3 3v13H5V4Z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
  undo: <><path d="M9 7 4 12l5 5" /><path d="M4 12h9a6 6 0 0 1 6 6" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  pen: <><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M13.5 5.5l4 4" /></>,
  'eye-off': <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.4" /><path d="M6.2 7.6C4.4 9 3 12 3 12s4 6 9 6a9.9 9.9 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
