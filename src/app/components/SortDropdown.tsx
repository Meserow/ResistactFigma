import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export type SortBy = "popular" | "newest" | "az";

/**
 * Compact, inline Sort dropdown — meant to live inside a results banner so
 * the sort control sits next to "Showing N actions" rather than off in a
 * separate corner of the navbar. Borderless / transparent styling so it
 * reads as a clickable text affordance rather than a button.
 *
 * Optionally carries the "Show completed acts" toggle in the same menu
 * (with a divider above it) — same content as the navbar's old sort menu,
 * just relocated.
 */
export function SortDropdown({
  sortBy,
  onSortChange,
  showDone,
  onShowDoneChange,
  completedCount,
}: {
  sortBy: SortBy;
  onSortChange: (next: SortBy) => void;
  showDone?: boolean;
  onShowDoneChange?: (next: boolean) => void;
  completedCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click — keeps menu interactions feeling normal.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const label = sortBy === "popular" ? "Popular" : sortBy === "newest" ? "Newest" : "A–Z";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-['Poppins',sans-serif] font-medium transition-colors whitespace-nowrap ${
          sortBy !== "popular" ? "text-[#23297e]" : "text-gray-600 hover:text-[#23297e]"
        }`}
      >
        <span className="text-gray-400 text-[10px] uppercase tracking-widest font-semibold">Sort</span>
        <span>{label}</span>
        <ChevronDown size={12} className={`text-[#5a5a5a] transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-48 bg-white border border-gray-100 rounded-2xl shadow-xl py-1.5 z-50">
          {(["popular", "newest", "az"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => { onSortChange(opt); setOpen(false); }}
              className={`w-full text-left px-4 py-2 font-['Poppins',sans-serif] text-sm transition-colors flex items-center justify-between ${
                sortBy === opt
                  ? "text-[#23297e] font-semibold bg-[#23297e]/5"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {opt === "popular" ? "Popular" : opt === "newest" ? "Newest" : "A–Z"}
              {sortBy === opt && <span className="w-1.5 h-1.5 rounded-full bg-[#23297e]" />}
            </button>
          ))}
          {/* Show completed acts — only when the user has completions. Sits
              under a divider so it visually separates from sort order. */}
          {onShowDoneChange && (completedCount ?? 0) > 0 && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { onShowDoneChange(!showDone); }}
                className={`w-full text-left px-4 py-2 font-['Poppins',sans-serif] text-sm transition-colors flex items-center justify-between gap-2 ${
                  showDone
                    ? "text-[#23297e] font-semibold bg-[#23297e]/5"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${showDone ? "bg-[#23297e] border-[#23297e]" : "border-gray-300"}`}>
                    {showDone && <X size={10} className="text-white rotate-45" strokeWidth={3} />}
                  </span>
                  Show completed acts
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
