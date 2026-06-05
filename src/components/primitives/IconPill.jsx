// IconPill — friendlier action with icon + label. Uses theme tokens via
// Tailwind utilities (bg-surface, border-line, text-ink, text-accent).
export function IconPill({ icon, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 pl-3 pr-3.5 py-[9px] rounded-full cursor-pointer
                 bg-surface text-ink border border-line
                 font-sans text-[12.5px] font-medium tracking-[0.005em]
                 shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
    >
      <span className="inline-flex text-accent">{icon}</span>
      {children}
    </button>
  );
}
