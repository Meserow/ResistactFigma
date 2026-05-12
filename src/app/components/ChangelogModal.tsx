import { useEffect } from "react";
import { X } from "lucide-react";
import { CHANGELOG } from "../data/changelog";

interface ChangelogModalProps {
  onClose: () => void;
}

export function ChangelogModal({ onClose }: ChangelogModalProps) {
  // Esc to close + body scroll lock, matching the other modals' pattern.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-7 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-[#23297e]"
        >
          <X size={18} />
        </button>

        <h2 className="font-['Poppins',sans-serif] text-[24px] font-bold text-[#23297e] leading-tight mb-1">
          What's new
        </h2>
        <p className="font-['Poppins',sans-serif] text-sm text-gray-600 mb-5">
          A running log of every release. Newest at the top.
        </p>

        {CHANGELOG.map((entry) => (
          <article key={entry.version} className="mb-7 last:mb-0">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2 pb-2 border-b border-gray-200">
              <h3 className="font-['Poppins',sans-serif] text-lg font-bold text-[#23297e]">
                v{entry.version}
              </h3>
              <span className="font-['Poppins',sans-serif] text-xs font-medium uppercase tracking-wider text-gray-500">
                {entry.date}
              </span>
              <span className="font-['Poppins',sans-serif] text-sm text-gray-700 leading-tight">
                — {entry.title}
              </span>
            </header>

            {entry.sections.map((section, i) => (
              <section key={i} className="mb-3 last:mb-0">
                <h4 className="font-['Poppins',sans-serif] text-[13px] font-bold text-[#23297e] mb-1">
                  {section.heading}
                </h4>
                <ul className="space-y-1 pl-4 list-disc marker:text-[#fd8e33]">
                  {section.items.map((item, j) => (
                    <li
                      key={j}
                      className="font-['Poppins',sans-serif] text-[13px] text-gray-700 leading-relaxed"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}
