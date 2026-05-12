import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { VulnerableGroup } from "../lib/matcher";
import { GROUP_SECTIONS, GROUP_LABELS } from "../lib/groups";

interface GroupsDropdownProps {
  value: VulnerableGroup[];
  onToggle: (g: VulnerableGroup) => void;
  onClear: () => void;
  /** Override the placeholder when nothing is selected. */
  placeholder?: string;
  /** Start with the sectioned list open so users see all options without
   * an extra click. Used in MatchMe where the picker is the focus of the
   * step; left false in Add-an-Action where the picker is one field of many. */
  defaultOpen?: boolean;
}

/** Sectioned multi-select used in MatchMe (asking the user about themselves)
 * and Add-an-Action (asking the planner who an action especially helps). */
export function GroupsDropdown({ value, onToggle, onClear, placeholder = "Select any that apply", defaultOpen = false }: GroupsDropdownProps) {
  const [open, setOpen] = useState(defaultOpen);
  const count = value.length;
  return (
    <div>
      {/* Toggle area — uses a div instead of <button> so chip buttons can sit
       * inside without nesting interactive elements. Click anywhere on the
       * empty space (or the chevron) opens / closes the panel; clicks on a
       * chip's X stop propagation to remove an individual selection. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 font-['Poppins',sans-serif] text-sm transition-colors hover:border-gray-400 cursor-pointer min-h-[44px]"
      >
        {count === 0 ? (
          <span className="italic text-gray-400 px-1">{placeholder}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
            {value.map((g) => {
              const label = GROUP_LABELS[g] ?? g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(g);
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-[#fd8e33]/10 px-2.5 py-1 font-['Poppins',sans-serif] text-[12px] font-medium text-[#23297e] hover:bg-[#fd8e33]/20"
                  title="Remove"
                >
                  {label}
                  <X size={12} />
                </button>
              );
            })}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-['Poppins',sans-serif] text-[12px] font-medium text-gray-500 hover:text-[#23297e]"
            >
              Clear
            </button>
          </div>
        )}
        <ChevronDown
          size={16}
          className={`text-gray-500 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </div>

      {open && (
        <div
          className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-300 bg-white p-3"
          onClick={(e) => e.stopPropagation()}
        >
          {GROUP_SECTIONS.map((section) => (
            <div key={section.title} className="mb-3 last:mb-0">
              <h4 className="font-['Poppins',sans-serif] text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                {section.title}
              </h4>
              <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {section.options.map((opt) => {
                  const checked = value.includes(opt.value);
                  return (
                    <li key={opt.value}>
                      <label
                        className={`flex items-start gap-2 rounded-md px-1.5 py-1 cursor-pointer hover:bg-gray-50 ${
                          checked ? "text-[#23297e] font-semibold" : "text-gray-700"
                        }`}
                      >
                        <span
                          className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            checked ? "border-[#fd8e33] bg-[#fd8e33]" : "border-gray-400"
                          }`}
                          aria-hidden="true"
                        >
                          {checked && <span className="text-[10px] leading-none text-white">✓</span>}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggle(opt.value)}
                          className="sr-only"
                        />
                        <span className="font-['Poppins',sans-serif] text-sm leading-snug">{opt.label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
