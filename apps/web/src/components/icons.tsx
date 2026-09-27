/** Íconos de trazo propios (sin dependencias); decorativos, siempre acompañados de texto. */
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'icon', 'aria-hidden': true } as const;

export const HomeIcon = () => (
  <svg {...base}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </svg>
);

export const TransferIcon = () => (
  <svg {...base}>
    <path d="M4 8h14l-4-4" />
    <path d="M20 16H6l4 4" />
  </svg>
);

export const ExitIcon = () => (
  <svg {...base}>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
    <path d="M10 16l-4-4 4-4" />
    <path d="M6 12h10" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base} className="check" strokeWidth={1.6}>
    <circle cx="12" cy="12" r="10" />
    <path d="m7.5 12.5 3 3 6-6.5" />
  </svg>
);

export const ChatIcon = () => (
  <svg {...base}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9h8M8 12h5" />
  </svg>
);
