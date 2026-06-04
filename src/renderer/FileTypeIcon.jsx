function GenericFileIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true">
      <path
        d="M4 2.5h5.2L12.5 5.8V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function PythonIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path
        fill="#3776AB"
        d="M15.885 2.1c-7.1 0-6.651 3.073-6.651 3.073v3.193h6.752v.478H3.641S1 8.611 1 15.779c0 7.168 2.309 6.905 2.309 6.905h2.777v-3.372s-.099-2.309 2.405-2.309h4.138s2.356.038 2.356-2.286V5.374S22.966 2.1 15.885 2.1zM12.001 4.626a1.047 1.047 0 1 1-.002 2.095 1.047 1.047 0 0 1 .002-2.095z"
      />
      <path
        fill="#FFD43B"
        d="M16.085 29.902c7.1 0 6.651-3.073 6.651-3.073v-3.193h-6.752v-.478h12.345S31 23.391 31 16.223c0-7.168-2.309-6.905-2.309-6.905h-2.777v3.372s.099 2.309-2.405 2.309h-4.138s-2.356-.038-2.356 2.286v7.479s-.623 3.136-7.015 3.136zm3.884-2.526a1.047 1.047 0 1 1 .002-2.095 1.047 1.047 0 0 1-.002 2.095z"
      />
    </svg>
  );
}

function JavascriptIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect width="16" height="16" rx="2" fill="#F7DF1E" />
      <path
        fill="#323330"
        d="M10.6 12.1c.3.5.7.9 1.4.9.6 0 1-.3 1-.8 0-1.1-2.7-.9-2.7-3.5 0-1.4 1.2-2.4 2.9-2.4 1.2 0 2 .3 2.6 1.1l-1.1 1c-.2-.4-.5-.6-1-.6-.5 0-.8.3-.8.7 0 1 .2.9 2.7 1.1 1.5.1 2.7.8 2.7 2.5 0 1.5-1.2 2.6-3.1 2.6-1.7 0-2.9-.8-3.4-1.9l1.2-.8zM6.4 12.2l1.2-.8c.2.5.5.9 1.1.9.5 0 .8-.2.8-.7V4.8H9.5v6.8c0 1.4-.8 2-2 2-1.1 0-1.7-.5-2.1-1.4z"
      />
    </svg>
  );
}

function TypescriptIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect width="16" height="16" rx="2" fill="#3178C6" />
      <path
        fill="#fff"
        d="M10.6 12.1c.3.5.7.9 1.4.9.6 0 1-.3 1-.8 0-1.1-2.7-.9-2.7-3.5 0-1.4 1.2-2.4 2.9-2.4 1.2 0 2 .3 2.6 1.1l-1.1 1c-.2-.4-.5-.6-1-.6-.5 0-.8.3-.8.7 0 1 .2.9 2.7 1.1 1.5.1 2.7.8 2.7 2.5 0 1.5-1.2 2.6-3.1 2.6-1.7 0-2.9-.8-3.4-1.9l1.2-.8zM6.4 12.2l1.2-.8c.2.5.5.9 1.1.9.5 0 .8-.2.8-.7V4.8H9.5v6.8c0 1.4-.8 2-2 2-1.1 0-1.7-.5-2.1-1.4z"
      />
    </svg>
  );
}

function CssIcon({ size = 14 }) {
  return (
    <span className="composer-file-type-icon-css" aria-hidden="true">
      #
    </span>
  );
}

function ImageIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
      <path
        d="M2 11l3.2-3.2 2.3 2.3L11.5 6 14 8.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICON_BY_EXT = {
  py: PythonIcon,
  js: JavascriptIcon,
  jsx: JavascriptIcon,
  mjs: JavascriptIcon,
  cjs: JavascriptIcon,
  ts: TypescriptIcon,
  tsx: TypescriptIcon,
  css: CssIcon,
  scss: CssIcon,
  less: CssIcon,
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  gif: ImageIcon,
  webp: ImageIcon,
  svg: ImageIcon,
  ico: ImageIcon,
};

export function FileTypeIcon({ name, size = 14 }) {
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  const Icon = ICON_BY_EXT[ext] || GenericFileIcon;
  return <Icon size={size} />;
}
