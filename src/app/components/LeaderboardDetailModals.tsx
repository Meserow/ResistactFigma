import { useState } from "react";
import { X, ExternalLink, Flame, Tag, Copy, Check } from "lucide-react";
import type { FactCard } from "../data/factCards";
import type { ReceiptCard } from "./SmacksPage";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { safeHref } from "../lib/safeUrl";

// ─── Shared shell ─────────────────────────────────────────────────────────────
// Backdrop + centered white card, matching the app's other modals (InfoModal,
// CardDetailsModal). Click overlay or the X to close.
function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto"
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/10 hover:bg-black/20 text-[#23297e] transition-colors"
          aria-label="Close"
        >
          <X size={15} />
        </button>
        {children}
      </div>
    </div>
  );
}

// ─── Fact detail — the full myth-buster card behind a Top Facts row ─────────────
export function FactDetailModal({ fact, boosts, onClose }: { fact: FactCard; boosts?: number; onClose: () => void }) {
  return (
    <ModalShell onClose={onClose}>
      <div className="p-6 font-['Poppins',sans-serif]">
        <div className="flex items-center gap-2 mb-3 pr-8">
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-white bg-[#127f05]">
            {fact.category}
          </span>
          <span className="text-gray-400 font-normal text-xs">Fact #{fact.id}</span>
          {typeof boosts === "number" && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-600">
              <Flame size={11} />
              {boosts.toLocaleString()}
            </span>
          )}
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">The claim</p>
        <p className="text-[15px] font-bold text-gray-900 leading-snug mt-0.5 mb-4">{fact.claim}</p>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">The response</p>
        <p className="text-sm text-gray-700 leading-relaxed mt-0.5 mb-4">{fact.response}</p>

        {fact.askBack && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Ask back</p>
            <p className="text-sm text-gray-700 italic leading-relaxed mt-0.5 mb-4">{fact.askBack}</p>
          </>
        )}

        {fact.proof && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Proof</p>
            <p className="text-sm text-gray-700 leading-relaxed mt-0.5 mb-4 whitespace-pre-line">{fact.proof}</p>
          </>
        )}

        {fact.sourceUrl && (
          <a
            href={safeHref(fact.sourceUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#23297e] hover:underline break-all"
          >
            <ExternalLink size={13} className="shrink-0" />
            {fact.sourceUrl}
          </a>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Smack detail — the full receipt/meme behind a Top Smacks row ───────────────
export function SmackDetailModal({ smack, onClose }: { smack: ReceiptCard; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyCaption = () => {
    if (!smack.caption) return;
    navigator.clipboard?.writeText(smack.caption).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => { /* clipboard unavailable — non-critical */ });
  };

  return (
    <ModalShell onClose={onClose}>
      {smack.imageUrl && (
        <ImageWithFallback
          src={smack.imageUrl}
          alt={smack.title || "Smack"}
          className="w-full max-h-[340px] object-contain bg-gray-50 rounded-t-2xl"
        />
      )}
      <div className="p-6 font-['Poppins',sans-serif]">
        <div className="flex items-center gap-2 mb-1 pr-8">
          <span className="text-gray-400 font-normal text-xs">Smack #{smack.id}</span>
          {typeof smack.boosts === "number" && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-600">
              <Flame size={11} />
              {smack.boosts.toLocaleString()}
            </span>
          )}
        </div>

        {smack.title && (
          <p className="text-[15px] font-bold text-gray-900 leading-snug mb-2">{smack.title}</p>
        )}

        {smack.tags?.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {smack.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white bg-[#c2185b]">
                <Tag size={9} />{t}
              </span>
            ))}
          </div>
        )}

        {smack.caption && (
          <div className="mb-4">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{smack.caption}</p>
            <button
              onClick={copyCaption}
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#23297e] hover:underline"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy caption"}
            </button>
          </div>
        )}

        {smack.sourceUrl && (
          <a
            href={safeHref(smack.sourceUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#23297e] hover:underline break-all"
          >
            <ExternalLink size={13} className="shrink-0" />
            {smack.sourceLabel || smack.sourceUrl}
          </a>
        )}
      </div>
    </ModalShell>
  );
}
