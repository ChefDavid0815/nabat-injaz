export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <svg viewBox="0 0 48 56" aria-hidden="true">
        <path
          d="M23 4C4 16 2 38 23 49c21-11 19-33 0-45Z M23 5v44 M8 20l15 17 15-17 M12 11l11 15 11-15 M39 28q8-9 0-18 M43 33q13-13 0-27"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && <span>NABAT</span>}
    </span>
  );
}
