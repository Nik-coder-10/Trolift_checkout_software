export function DiyaIcon({
  size = 14,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path
        className="diya-flame"
        d="M12 3c1.6 1.9 2.4 3.4 2.4 4.7A2.4 2.4 0 0 1 12 10a2.4 2.4 0 0 1-2.4-2.3C9.6 6.4 10.4 4.9 12 3Z"
      />
      <path d="M4.5 14.5h15" />
      <path d="M6.5 14.5c.6 3.3 2.7 5 5.5 5s4.9-1.7 5.5-5" />
    </svg>
  );
}
