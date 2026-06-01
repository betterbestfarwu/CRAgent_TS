export function ComposerContextRing({ percent = 0, className = "", onClick, buttonRef }) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`composer-context-ring${className ? ` ${className}` : ""}`}
      title={`${clamped}% context used`}
      aria-label={`Context ${clamped}%`}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle
          className="composer-context-ring-track"
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          strokeWidth="2"
        />
        <circle
          className="composer-context-ring-progress"
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 10 10)"
        />
      </svg>
      <span className="composer-context-ring-label">{clamped}%</span>
    </button>
  );
}
