/**
 * FactShareModal — turn a fact card into a paste-ready comment for someone
 * else's social media post.
 *
 * UX premise: users see MAGA-aligned posts in their feed and want to push
 * back factually without writing from scratch. This modal gives them three
 * pre-formatted versions sized for different platforms, each with a one-click
 * copy. It does NOT post anywhere — the user pastes the comment themselves.
 *
 * Variants:
 *   • Short        ~≤280 chars  → X, Bluesky
 *   • Conversational ~≤500 chars → Threads, LinkedIn, Reddit
 *   • With receipts  longer     → IG long captions, Facebook, blog comments
 */
import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import type { FactCard as FactCardData } from "../data/factCards";

interface FactShareModalProps {
  card: FactCardData;
  color: string;
  onClose: () => void;
}

interface Variant {
  key: "short" | "conversational" | "receipts";
  label: string;
  fits: string;
  text: string;
}

function buildVariants(card: FactCardData): Variant[] {
  const src = card.sourceUrl?.trim();
  const proofBullets = (card.proof ?? "")
    .split("\n")
    .map((b) => b.replace(/^[•\-]\s*/, "").trim())
    .filter(Boolean);

  // Short — punchy correction + bare URL. Aimed at X (280) / Bluesky (300).
  const short = src
    ? `Actually — ${card.response} ${src}`
    : `Actually — ${card.response}`;

  // Conversational — adds a Socratic ask-back. Threads (500), LinkedIn, Reddit.
  const conversational = [
    card.response,
    card.askBack ? `Honest question — ${card.askBack}` : "",
    src ? `Source: ${src}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Receipts — full rebuttal with 2 strongest bullets. IG long, FB, blog.
  const receiptsBody = proofBullets.slice(0, 3).map((b) => `• ${b}`).join("\n");
  const receipts = [
    card.response,
    receiptsBody ? `Here's the actual evidence:\n${receiptsBody}` : "",
    src ? `Source: ${src}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { key: "short",          label: "Short",          fits: "Fits X · Bluesky",                  text: short },
    { key: "conversational", label: "Conversational", fits: "Fits Threads · LinkedIn · Reddit",  text: conversational },
    { key: "receipts",       label: "With receipts",  fits: "Fits Instagram · Facebook · long",  text: receipts },
  ];
}

export function FactShareModal({ card, color, onClose }: FactShareModalProps) {
  const variants = buildVariants(card);
  const [copied, setCopied] = useState<string | null>(null);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      // Fallback: select-and-prompt
      window.prompt("Copy this comment:", text);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share fact as a comment"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-base leading-tight">
              Share as a comment
            </h2>
            <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 mt-0.5 leading-snug">
              Pick a version and paste it as a reply on someone else's post.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Claim recap so the user remembers which fact they're pasting */}
        <div className="px-5 pt-3 pb-1">
          <p className="font-['Poppins',sans-serif] text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Responding to:
          </p>
          <p className="font-['Poppins',sans-serif] text-xs text-gray-600 italic leading-snug">
            "{card.claim}"
          </p>
        </div>

        {/* Variants */}
        <div className="px-5 py-3 space-y-3 overflow-y-auto">
          {variants.map(({ key, label, fits, text }) => {
            const len = text.length;
            const justCopied = copied === key;
            return (
              <div
                key={key}
                className="rounded-xl border border-gray-200 overflow-hidden"
              >
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                  <div className="min-w-0">
                    <p className="font-['Poppins',sans-serif] font-semibold text-[12px]" style={{ color }}>
                      {label}
                    </p>
                    <p className="font-['Poppins',sans-serif] text-[10px] text-gray-500 leading-tight">
                      {fits}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-['Poppins',sans-serif] text-[10px] text-gray-400 tabular-nums">
                      {len} chars
                    </span>
                    <button
                      onClick={() => copyText(key, text)}
                      aria-label={`Copy ${label} version`}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-[11px] transition-all ${
                        justCopied
                          ? "bg-emerald-500 text-white"
                          : "bg-[#fd8e33] hover:bg-[#e07a28] text-white shadow-sm"
                      }`}
                    >
                      {justCopied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={2.5} />}
                      {justCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                <pre className="px-3 py-2.5 font-['Poppins',sans-serif] text-xs text-gray-800 whitespace-pre-wrap break-words leading-snug bg-white">
                  {text}
                </pre>
              </div>
            );
          })}
        </div>

        {/* Source URL row — quick copy of just the link */}
        {card.sourceUrl && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-['Poppins',sans-serif] text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Source
              </p>
              <p className="font-['Poppins',sans-serif] text-[11px] text-gray-600 truncate">
                {card.sourceUrl}
              </p>
            </div>
            <button
              onClick={() => copyText("source", card.sourceUrl!)}
              className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg font-['Poppins',sans-serif] font-bold text-[11px] transition-all ${
                copied === "source"
                  ? "bg-emerald-500 text-white"
                  : "bg-white hover:bg-gray-100 text-gray-700 border border-gray-200"
              }`}
            >
              {copied === "source" ? <Check size={12} strokeWidth={3} /> : <Copy size={12} strokeWidth={2.5} />}
              {copied === "source" ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
