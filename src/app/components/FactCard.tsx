import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, MessageSquare, MessageSquareQuote } from "lucide-react";
import type { FactCard as FactCardData } from "../data/factCards";
import { FactShareModal } from "./FactShareModal";

// ─── Category colors ──────────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  "Economy":                   "#059669",
  "Immigration":               "#1d4ed8",
  "Crime & Policing":          "#7c3aed",
  "Elections & Democracy":     "#dc2626",
  "Energy & Climate":          "#0891b2",
  "Health & COVID":            "#db2777",
  "Women & Families":          "#e11d48",
  "Work, Wages & Education":   "#d97706",
  "Media & Institutions":      "#475569",
  "Foreign Policy & Security": "#1e3a8a",
  "Taxes":                     "#b45309",
};

// ─── Category images ──────────────────────────────────────────────────────────
const CATEGORY_IMAGES: Record<string, string> = {
  "Economy":                   "/facts/fact-economy.jpg",
  "Immigration":               "/facts/fact-immigration.jpg",
  "Crime & Policing":          "/facts/fact-crime.jpg",
  "Elections & Democracy":     "/facts/fact-elections.jpg",
  "Energy & Climate":          "/facts/fact-energy.jpg",
  "Health & COVID":            "/facts/fact-health.jpg",
  "Women & Families":          "/facts/fact-women.jpg",
  "Work, Wages & Education":   "/facts/fact-work.jpg",
  "Media & Institutions":      "/facts/fact-media.jpg",
  "Foreign Policy & Security": "/facts/fact-foreign.jpg",
  "Taxes":                     "/facts/fact-taxes.jpg",
};

interface FactCardProps {
  card: FactCardData;
  onBoost?: (id: number) => void;
  isBoosted?: boolean;
  boostCount?: number;
}

export function FactCard({ card, onBoost, isBoosted, boostCount = 0 }: FactCardProps) {
  const [proofOpen, setProofOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const color = CATEGORY_COLORS[card.category] ?? "#475569";
  const image = CATEGORY_IMAGES[card.category];

  // Parse proof bullets (split on \n, filter empty lines)
  const bullets = card.proof
    .split("\n")
    .map((b) => b.replace(/^[•\-]\s*/, "").trim())
    .filter(Boolean);

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden flex flex-col h-full border border-gray-100 hover:shadow-lg transition-shadow">

      {/* Category image — short banner with backdrop-blur fill */}
      {image && (
        <div className="relative h-[110px] shrink-0 overflow-hidden">
          {/* Image fills the full banner */}
          <img src={image} alt={card.category}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
          {/* Bottom fade into card */}
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent" />
          {/* Category badge overlaid on image */}
          <div className="absolute top-2.5 left-3">
            <span
              className="inline-block px-2.5 py-0.5 rounded-full text-white font-['Poppins',sans-serif] font-semibold text-[10px] uppercase tracking-wide shadow-sm"
              style={{ backgroundColor: color }}
            >
              {card.category}
            </span>
          </div>
          {/* Card number top-right */}
          <div className="absolute top-2.5 right-3">
            <span className="font-['Poppins',sans-serif] text-[10px] text-white/70 font-medium drop-shadow">
              #{card.id}
            </span>
          </div>
        </div>
      )}

      {/* Category badge — only shown when no image */}
      {!image && (
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <span
          className="inline-block px-2.5 py-0.5 rounded-full text-white font-['Poppins',sans-serif] font-semibold text-[10px] uppercase tracking-wide"
          style={{ backgroundColor: color }}
        >
          {card.category}
        </span>
        <span className="font-['Poppins',sans-serif] text-[10px] text-gray-300 font-medium">
          #{card.id}
        </span>
      </div>
      )}

      {/* MAGA claim */}
      <div className={`px-4 pb-3 ${image ? "pt-3" : ""}`}>
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
          <p className="font-['Poppins',sans-serif] text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1">
            <MessageSquareQuote size={10} className="shrink-0" />
            They claim:
          </p>
          <p className="font-['Poppins',sans-serif] text-xs text-gray-500 italic leading-snug">
            "{card.claim}"
          </p>
        </div>
      </div>

      {/* Fact response */}
      <div className="px-4 pb-3 flex-1">
        <p className="font-['Poppins',sans-serif] text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color }}>
          The truth:
        </p>
        <p className="font-['Poppins',sans-serif] text-sm font-medium text-gray-800 leading-snug">
          {card.response}
        </p>
      </div>

      {/* Ask-back prompt */}
      <div className="px-4 pb-3">
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ backgroundColor: `${color}12` }}
        >
          <p
            className="font-['Poppins',sans-serif] text-[10px] font-bold uppercase tracking-wider mb-1"
            style={{ color }}
          >
            💬 Ask them:
          </p>
          <p className="font-['Poppins',sans-serif] text-xs text-gray-700 leading-snug italic">
            {card.askBack}
          </p>
        </div>
      </div>

      {/* Boost + Reply row */}
      <div className="px-4 pb-3 flex items-center justify-between gap-2">
        <p className="font-['Poppins',sans-serif] font-semibold text-[12px] text-[#de7c2d]">
          🔥 {boostCount.toLocaleString()} boost{boostCount === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-1.5">
          {/* Reply — opens a copy-ready comment for someone else's social post */}
          <button
            onClick={() => setShareOpen(true)}
            aria-label="Share as a comment"
            title="Share as a comment on someone else's post"
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl font-['Poppins',sans-serif] font-bold text-[12px] transition-all bg-white hover:bg-gray-50 text-gray-700 border border-gray-200"
          >
            <MessageSquare size={12} strokeWidth={2.5} />
            Reply
          </button>
          <button
            onClick={() => onBoost?.(card.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl font-['Poppins',sans-serif] font-bold text-[12px] transition-all ${
              isBoosted
                ? "bg-[#fd8e33]/80 text-white"
                : "bg-[#fd8e33] hover:bg-[#e07a28] text-white shadow-sm"
            }`}
          >
            🔥 {isBoosted ? "Boosted!" : "Boost"}
          </button>
        </div>
      </div>

      {shareOpen && (
        <FactShareModal card={card} color={color} onClose={() => setShareOpen(false)} />
      )}

      {/* Proof accordion */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => setProofOpen(!proofOpen)}
          className="w-full flex items-center justify-between px-4 py-2.5 font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <span>Show Evidence</span>
          {proofOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {proofOpen && (
          <div className="space-y-2">
            <div className="px-4 pb-3 space-y-2">
              {bullets.map((bullet, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <p className="font-['Poppins',sans-serif] text-xs text-gray-600 leading-snug">{bullet}</p>
                </div>
              ))}
              {card.sourceUrl && (
                <a
                  href={card.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-['Poppins',sans-serif] text-[10px] font-semibold mt-2 hover:underline"
                  style={{ color }}
                >
                  <ExternalLink size={10} />
                  View source
                </a>
              )}
            </div>
            {card.chartUrl && (
              <iframe
                src={card.chartUrl}
                className="block"
                style={{ height: 520, border: 0, width: 'calc(100% + 30px)', marginLeft: '-6px' }}
                loading="lazy"
                title="Supporting chart"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
