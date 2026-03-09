import React, { useState } from "react";
import { X, ChevronLeft, Check, Loader2, CheckCircle2 } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";
import askPersonImg from "figma:asset/d06c5b16d92e1a52be9ade580dea6c66dabb478c.png";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

// ─── Category data ─────────────────────────────────────────────────────────────
const CATEGORIES_LEFT = [
  { name: "Boycott",        emoji: "🚫" },
  { name: "Protest",        emoji: "✊" },
  { name: "Funding",        emoji: "💰" },
  { name: "Transportation", emoji: "🚲" },
  { name: "News Story",     emoji: "📰" },
  { name: "Meeting",        emoji: "📋" },
  { name: "Social Media",   emoji: "📣" },
  { name: "Crafting",       emoji: "🔨" },
  { name: "Petition",       emoji: "✍️" },
  { name: "Flash Mob",      emoji: "👥" },
  { name: "Housing",        emoji: "🏠" },
  { name: "Labor",          emoji: "👤" },
  { name: "Prayer",         emoji: "🙏" },
];

const CATEGORIES_RIGHT = [
  { name: "Professional Skills",       emoji: "💼" },
  { name: "Personal Committment",      emoji: "❤️" },
  { name: "Email Campaign",            emoji: "📧" },
  { name: "Training/Education",        emoji: "🎓" },
  { name: "Spread Positivity",         emoji: "👍" },
  { name: "Boost/Repost/Make Noise",   emoji: "📢" },
  { name: "Art Piece/Performance Art", emoji: "🎨" },
  { name: "Act of Kindness",           emoji: "🤝" },
  { name: "Boost Underreported Facts", emoji: "🔎" },
  { name: "Letter to the Editor",      emoji: "✉️" },
  { name: "Fight Depression/Anxiety",  emoji: "💙" },
  { name: "Other...",                  emoji: "💡" },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Boycott": "#23297e", "Protest": "#23297e", "Funding": "#127f05",
  "Transportation": "#126d89", "News Story": "#896312", "Meeting": "#23297e",
  "Social Media": "#e44b4b", "Crafting": "#c34e00", "Petition": "#05737f",
  "Flash Mob": "#ff00d5", "Housing": "#896312", "Labor": "#127f05",
  "Prayer": "#8a00e6", "Professional Skills": "#126d89",
  "Personal Committment": "#23297e", "Email Campaign": "#e44b4b",
  "Training/Education": "#126d89", "Spread Positivity": "#8a00e6",
  "Boost/Repost/Make Noise": "#8a00e6", "Art Piece/Performance Art": "#896312",
  "Act of Kindness": "#127f05", "Boost Underreported Facts": "#05737f",
  "Letter to the Editor": "#c34e00", "Fight Depression/Anxiety": "#ff00d5",
  "Other...": "#767574",
};

const INPUT_CLS =
  "w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface AskFlowModalProps {
  accessToken: string | null;
  approval: UserApproval | null;
  onClose: () => void;
  onLoginRequired: () => void;
  onNewCard?: (card: any) => void;
}

// ─── Main component ────────────────────────────────────────────────────────────
export function AskFlowModal({
  accessToken, approval, onClose, onLoginRequired, onNewCard,
}: AskFlowModalProps) {
  const [view, setView] = useState<"category" | "form">("category");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Create-form state
  const [formTitle,       setFormTitle]       = useState("");
  const [formDesc,        setFormDesc]        = useState("");
  const [formSponsor,     setFormSponsor]     = useState("");
  const [formLink,        setFormLink]        = useState("");
  const [formLocation,    setFormLocation]    = useState("");
  const [formIsOnline,    setFormIsOnline]    = useState(false);
  const [formSpots,       setFormSpots]       = useState("10");
  const [formUnlimited,   setFormUnlimited]   = useState(false);
  const [formVettingInfo, setFormVettingInfo] = useState("");
  const [createLoading,   setCreateLoading]   = useState(false);
  const [createSuccess,   setCreateSuccess]   = useState(false);
  const [formError,       setFormError]       = useState<string | null>(null);

  const isLoggedIn = !!approval;
  const isApproved = approval?.status === "approved";

  async function handleCreateAsk() {
    if (!isLoggedIn) { onLoginRequired(); return; }
    if (!formTitle.trim() || !formDesc.trim()) {
      setFormError("Title and description are required."); return;
    }
    setFormError(null);
    setCreateLoading(true);
    try {
      const res = await fetch(`${API}/actions/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          title: formTitle.trim(), description: formDesc.trim(),
          category: selectedCategory!, categoryColor: CATEGORY_COLORS[selectedCategory!] ?? "#23297e",
          location: formIsOnline ? undefined : formLocation.trim() || undefined,
          isOnline: formIsOnline,
          actionType: formIsOnline ? "Online" : "In Person Group",
          sponsor: formSponsor.trim() || undefined,
          link: formLink.trim() || undefined,
          vettingInfo: formVettingInfo.trim() || undefined,
          spotsTotal: formUnlimited ? "Unlimited" : (Number(formSpots) || 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "Failed to post ASK."); return; }
      setCreateSuccess(true);
      if (onNewCard) onNewCard(data.card);
      setTimeout(onClose, 2500);
    } finally {
      setCreateLoading(false);
    }
  }

  // ── Create-form step ────────────────────────────────────────────────────────
  if (view === "form") {
    return (
      <Overlay onClose={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
          {/* Header */}
          <div className="bg-[#23297e] px-5 py-4 flex items-center gap-3">
            <button
              onClick={() => setView("category")}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-['Poppins',sans-serif] font-bold text-white text-base">Make an ASK</p>
              <p className="font-['Poppins',sans-serif] text-white/70 text-xs truncate">
                Category: <span className="font-semibold text-white">{selectedCategory}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 text-white shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          {createSuccess ? (
            <div className="p-8 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-green-500" />
              </div>
              <h3 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-lg">Your ASK is live!</h3>
              <p className="font-['Poppins',sans-serif] text-gray-500 text-sm">
                Your action has been posted and is now visible to all resistors.
              </p>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <Field label="Title *">
                <input
                  type="text" value={formTitle} maxLength={80}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Give your ASK a clear, compelling title"
                  className={INPUT_CLS}
                />
              </Field>

              <Field label="Description *">
                <textarea
                  rows={3} value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Describe what you need help with and why it matters…"
                  className={`${INPUT_CLS} resize-none`}
                />
              </Field>

              <Field label="Sponsor">
                <input
                  type="text" value={formSponsor}
                  onChange={(e) => setFormSponsor(e.target.value)}
                  placeholder="Organization or person sponsoring this action"
                  className={INPUT_CLS}
                />
              </Field>

              <Field label="Link">
                <input
                  type="url" value={formLink}
                  onChange={(e) => setFormLink(e.target.value)}
                  placeholder="https://…"
                  className={INPUT_CLS}
                />
              </Field>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input type="checkbox" checked={formIsOnline}
                  onChange={(e) => setFormIsOnline(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#23297e]"
                />
                <span className="font-['Poppins',sans-serif] text-sm font-semibold text-gray-700">
                  Online / virtual — no physical location needed
                </span>
              </label>

              {!formIsOnline && (
                <Field label="Location">
                  <input type="text" value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    placeholder="City, State  (e.g. Austin, TX)"
                    className={INPUT_CLS}
                  />
                </Field>
              )}

              <Field label="Spots needed">
                <div className="flex items-center gap-3">
                  <input type="number" value={formSpots} min="1"
                    onChange={(e) => setFormSpots(e.target.value)}
                    disabled={formUnlimited}
                    className={`${INPUT_CLS} w-28 disabled:opacity-40`}
                  />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={formUnlimited}
                      onChange={(e) => setFormUnlimited(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#23297e]"
                    />
                    <span className="font-['Poppins',sans-serif] text-sm text-gray-600">Unlimited</span>
                  </label>
                </div>
              </Field>

              <Field label="Vetting Info">
                <textarea
                  rows={3} value={formVettingInfo}
                  onChange={(e) => setFormVettingInfo(e.target.value)}
                  placeholder="In order to publish your act, we need to vet your organization, link, plan, etc. to be sure it is not an effort by maga to undermine our efforts. Please provide as much detail as you can, including phone numbers, charities, other info that we can confirm your effort with."
                  className={`${INPUT_CLS} resize-none text-gray-500 italic placeholder:not-italic`}
                />
              </Field>

              {formError && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 font-['Poppins',sans-serif]">
                  {formError}
                </p>
              )}

              <button
                onClick={handleCreateAsk}
                disabled={createLoading}
                className="w-full py-3 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 mt-1"
              >
                {createLoading ? <Loader2 size={16} className="animate-spin" /> : <span>🏃</span>}
                Make an ASK…
              </button>
            </div>
          )}
        </div>
      </Overlay>
    );
  }

  // ── Category selection step ─────────────────────────────────────────────────
  return (
    <Overlay onClose={onClose}>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[660px] overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
        >
          <X size={15} />
        </button>

        <div className="flex gap-5 p-6 pr-12 items-start">
          {/* Left: icon + label */}
          <div className="shrink-0 w-[120px]">
            {/* person-with-X icon */}
            <img
              src={askPersonImg}
              alt="Ask icon"
              className="w-12 h-12 mb-3"
              style={{ filter: "brightness(0) saturate(100%) invert(17%) sepia(94%) saturate(547%) hue-rotate(212deg) brightness(97%) contrast(97%)" }}
            />
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#fd8e33] text-[14px] leading-snug">
              Have an ASK idea? What category does it fall into?
            </h2>
          </div>

          {/* Right: two-column radio list */}
          <div className="flex-1 grid grid-cols-[2fr_3fr] gap-x-4 gap-y-[4px] [&_span]:font-normal">
            <RadioCol
              categories={CATEGORIES_LEFT}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
            />
            <RadioCol
              categories={CATEGORIES_RIGHT}
              selected={selectedCategory}
              onSelect={setSelectedCategory}
            />
          </div>
        </div>

        {/* Make an ASK button */}
        <div className="flex justify-end px-6 pb-5">
          <button
            onClick={() => {
              if (!isLoggedIn) { onLoginRequired(); return; }
              if (!isApproved || !selectedCategory) return;
              setView("form");
            }}
            disabled={isLoggedIn && !selectedCategory}
            className={`flex items-center gap-2.5 bg-[#23297e] rounded-xl px-5 py-2.5 font-['Poppins',sans-serif] font-bold text-white text-sm shadow-sm transition-all ${
              isLoggedIn && !selectedCategory ? "opacity-40 cursor-not-allowed" : "hover:bg-[#1a2060] cursor-pointer"
            }`}
          >
            {/* person icon */}
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
              <circle cx="12" cy="7" r="4" />
              <path d="M20 21a8 8 0 00-16 0h16z" />
            </svg>
            {!isLoggedIn
              ? "Sign in to make an ASK…"
              : !isApproved
              ? "Pending approval…"
              : "Make an ASK…"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-600 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function RadioCol({
  categories, selected, onSelect,
}: { categories: { name: string; emoji: string }[]; selected: string | null; onSelect: (n: string) => void }) {
  return (
    <div className="space-y-[4px]">
      {categories.map(({ name, emoji }) => (
        <label key={name} className="flex items-center gap-2 cursor-pointer group">
          <input
            type="radio" name="ask-category" value={name}
            checked={selected === name} onChange={() => onSelect(name)}
            className="w-3.5 h-3.5 accent-[#fd8e33] shrink-0"
          />
          <span className="font-['Poppins',sans-serif] text-gray-800 text-[12px] leading-tight whitespace-nowrap group-hover:text-[#fd8e33] transition-colors">
            {name} <span className="opacity-70">{emoji}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}