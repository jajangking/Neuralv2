type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconCpu = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
    <rect x="10" y="10" width="4" height="4" rx="1" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </svg>
);

export const IconPulse = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2 12h4l2.5-7 4 14L15 12h7" />
  </svg>
);

export const IconRadar = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 12l5-4" />
  </svg>
);

export const IconRefresh = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 11a8 8 0 1 0-2.4 5.7" />
    <path d="M20 4v7h-7" />
  </svg>
);

export const IconNetwork = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="4" cy="7" r="2" />
    <circle cx="4" cy="17" r="2" />
    <circle cx="20" cy="12" r="2" />
    <path d="M6 7.5 18 11M6 16.5 18 13" />
  </svg>
);

export const IconFlag = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M5 21V4M5 5h11l-2 3.5L16 12H5" />
  </svg>
);

export const IconBrush = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 20c3 .5 5-1 5-3.5S6.5 13 5 13s-3 1.5-3 4 .5 3 2 3Z" />
    <path d="M9 15 20 4a2 2 0 0 0-3-3L6 12" />
  </svg>
);

export const IconSteering = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v6M3.5 15.5 9 13M20.5 15.5 15 13" />
  </svg>
);

export const IconCheck = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 12.5 9 17.5 20 6.5" />
  </svg>
);

export const IconAlert = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.3v.2" />
  </svg>
);