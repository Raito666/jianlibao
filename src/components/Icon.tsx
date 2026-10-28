import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
      <path d="M9 21v-7h6v7" />
    </>
  ),
  dumbbell: (
    <>
      <path d="m6.5 6.5 11 11M3 8l5-5m8 18 5-5M1.5 6.5l5-5m11 21 5-5M5 4l3 3m9 10 3 3M4 5l3 3m10 9 3 3" />
      <path d="m8 5 11 11M5 8l11 11" />
    </>
  ),
  plans: (
    <>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 2v4m8-4v4M4 10h16m-12 4h3m-3 3h6" />
    </>
  ),
  book: (
    <>
      <path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1m0-15c3-2 6-2 10-1v15c-4-1-7-1-10 1Zm0 0v15" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v17h17M8 15l4-5 4 2 5-7" />
      <path d="M17 5h4v4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  settings: (
    <>
      <path d="m10 2-.6 2.3-2.1 1.2L5 5l-2 3.5 1.7 1.8v2.4L3 14.5 5 18l2.3-.5 2.1 1.2L10 21h4l.6-2.3 2.1-1.2 2.3.5 2-3.5-1.7-1.8v-2.4L21 8.5 19 5l-2.3.5-2.1-1.2L14 2Z" />
      <circle cx="12" cy="11.5" r="3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  up: <path d="m5 15 7-7 7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  play: <path d="m8 4 13 8-13 8Z" />,
  pause: (
    <>
      <path d="M7 4v16M17 4v16" />
    </>
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3m-10 3h3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.8 14a9 9 0 0 1-10.8-10.8A9 9 0 1 0 20.8 14Z" />,
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  edit: (
    <>
      <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  light: (
    <>
      <path d="M8 15a6 6 0 1 1 8 0l-1 2H9ZM9 20h6m-5 3h4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  alert: (
    <>
      <path d="m12 3 10 18H2Z" />
      <path d="M12 9v5m0 3v.1" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 6a8 8 0 0 1 13 2M4.9 16a8 8 0 0 0 13 2" />
    </>
  ),
  undo: (
    <>
      <path d="M8 4 3 9l5 5M3 9h11a7 7 0 0 1 0 14" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  save: (
    <>
      <path d="M4 3h13l4 4v14H3V3Zm3 0v6h9V3M7 21v-8h10v8" />
    </>
  ),
  folder: <path d="M3 5h7l2 3h9v12H3Z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0" />
      <circle cx="12" cy="20" r=".7" />
    </>
  ),
};

const aliases: Record<string, string> = {
  today: 'home',
  training: 'dumbbell',
  exercises: 'dumbbell',
  library: 'book',
  progress: 'chart',
  history: 'calendar',
  me: 'user',
  profile: 'user',
  'arrow-right': 'arrow',
  'arrow-left': 'back',
  'chevron-right': 'chevron',
  x: 'close',
  timer: 'clock',
  reset: 'refresh',
  skip: 'chevron',
  'bar-chart': 'chart',
  'check-circle': 'check',
  delete: 'trash',
  backup: 'download',
  restore: 'upload',
  pencil: 'edit',
  warning: 'alert',
};

export default function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {paths[aliases[name] ?? name] ?? paths.dumbbell}
    </svg>
  );
}
