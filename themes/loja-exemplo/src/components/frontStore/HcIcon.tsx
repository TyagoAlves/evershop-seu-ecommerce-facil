import React from 'react';

const PATHS: Record<string, React.ReactNode> = {
  droplet: (
    <>
      <path d="M12 2.7S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.7 12 2.7z" />
      <path d="M9 15a3 3 0 0 0 3 3" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  paint: (
    <>
      <rect x="3" y="4" width="13" height="6" rx="1" />
      <path d="M7 10v7a2 2 0 0 0 4 0v-7" />
      <path d="M16 6h5v3h-5z" />
    </>
  ),
  toolbox: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </>
  ),
  wrench: (
    <path d="M21 4a6 6 0 0 1-8 8L5 20l-1-1 8-8a6 6 0 0 1 8-8l-4 4 2 2 3-5z" />
  ),
  truck: (
    <>
      <rect x="2" y="6" width="12" height="10" rx="1" />
      <path d="M14 9h4l3 3v4h-7z" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  star: (
    <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3z" />
  ),
  check: <path d="m4 12 5 5L20 6" />,
  phone: (
    <path d="M6.6 3h3l1.5 4-2 1.4a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3z" />
  ),
  pin: (
    <>
      <path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  whatsapp: (
    <>
      <path d="M20.5 11.6a8.4 8.4 0 0 1-12.3 7.4L3.5 20.5l1.5-5A8.4 8.4 0 1 1 20.5 11.6z" />
      <path d="M9 9c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .6.5l.6 1.4c.1.3 0 .5-.1.7l-.4.5c.2.4.5.8.9 1.2s.8.7 1.2.9l.5-.4c.2-.2.4-.2.7-.1l1.4.6c.3.1.5.4.5.7v.5c0 .3-.2.6-.5.7-.5.2-1 .3-1.5.2A8.5 8.5 0 0 1 8 12.6c-.1-.5 0-1 .2-1.5z" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />
};

export function HcIcon({
  name,
  className = 'le-icon'
}: {
  name: keyof typeof PATHS | string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {PATHS[name] ?? PATHS.check}
    </svg>
  );
}
