import "./dotGridAnimator.css";

const DIMENSION = 4;
const DOT_RADIUS_CENTER = 1.25;
const DOT_SPACING = 4;
const DOT_RADIUS = 1.125;
const DOT_INDICES = Array.from({ length: DIMENSION * DIMENSION }, (_, i) => i + 1);
const VIEWBOX_SIZE = DOT_RADIUS_CENTER * 2 + DOT_SPACING * (DIMENSION - 1);

function DotGrid({ className = "", size = "sm", "aria-label": ariaLabel, static: isStatic = false }) {
  return (
    <span
      className={`session-dot-grid${isStatic ? " session-dot-grid--static" : ""}${
        className ? ` ${className}` : ""
      }`}
      data-size={size}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <svg
        className="session-dot-grid__svg"
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        role="presentation"
        focusable="false"
      >
        {DOT_INDICES.map((dotIndex) => {
          const row = Math.floor((dotIndex - 1) / DIMENSION);
          const col = (dotIndex - 1) % DIMENSION;
          return (
            <circle
              key={dotIndex}
              className="session-dot-grid__dot"
              data-dot-index={dotIndex}
              cx={DOT_RADIUS_CENTER + col * DOT_SPACING}
              cy={DOT_RADIUS_CENTER + row * DOT_SPACING}
              r={DOT_RADIUS}
            />
          );
        })}
      </svg>
    </span>
  );
}

export function DotGridAnimator(props) {
  return <DotGrid {...props} />;
}

export function DotGridIcon(props) {
  return <DotGrid {...props} static />;
}

export function SingleDotIcon({ className = "", size = "xs" }) {
  return (
    <span
      className={`session-single-dot${className ? ` ${className}` : ""}`}
      data-size={size}
      aria-hidden="true"
    >
      <svg
        className="session-single-dot__svg"
        viewBox="0 0 12 12"
        role="presentation"
        focusable="false"
      >
        <circle cx="6" cy="6" r="3.25" fill="currentColor" fillOpacity="0.35" />
        <circle
          cx="6"
          cy="6"
          r="3.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
      </svg>
    </span>
  );
}
