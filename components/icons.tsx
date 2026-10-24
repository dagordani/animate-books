type P = { className?: string };
const base = (className = "h-5 w-5") => ({
  className,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const PlayIcon = ({ className }: P) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </svg>
);
export const PauseIcon = ({ className }: P) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
);
export const PrevIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M18 18 10 12l8-6v12ZM6 6v12" />
  </svg>
);
export const NextIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m6 18 8-6-8-6v12ZM18 6v12" />
  </svg>
);
export const MicIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const StopIcon = ({ className }: P) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
export const SendIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const SpeakerIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);
export const ReplayIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
  </svg>
);
export const CloseIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
