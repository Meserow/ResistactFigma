import React, { useMemo, useState } from "react";
import { X, ChevronLeft, Loader2, CheckCircle2, Search, Megaphone } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

// ─── Category data ─────────────────────────────────────────────────────────────
const CATEGORIES: { name: string; emoji: string; color: string }[] = [
  { name: "Boycott",                    emoji: "🚫",  color: "#23297e" },
  { name: "Protest",                    emoji: "✊",  color: "#23297e" },
  { name: "Funding",                    emoji: "💰",  color: "#127f05" },
  { name: "Transportation",             emoji: "🚲",  color: "#126d89" },
  { name: "News Story",                 emoji: "📰",  color: "#896312" },
  { name: "Meeting",                    emoji: "📋",  color: "#23297e" },
  { name: "Social Media",               emoji: "📣",  color: "#e44b4b" },
  { name: "Crafting",                   emoji: "🔨",  color: "#c34e00" },
  { name: "Petition",                   emoji: "✍️",  color: "#05737f" },
  { name: "Flash Mob",                  emoji: "👥",  color: "#ff00d5" },
  { name: "Housing",                    emoji: "🏠",  color: "#896312" },
  { name: "Labor",                      emoji: "👷",  color: "#127f05" },
  { name: "Prayer",                     emoji: "🙏",  color: "#8a00e6" },
  { name: "Professional Skills",        emoji: "💼",  color: "#126d89" },
  { name: "Personal Committment",       emoji: "❤️",  color: "#23297e" },
  { name: "Email Campaign",             emoji: "📧",  color: "#e44b4b" },
  { name: "Training/Education",         emoji: "🎓",  color: "#126d89" },
  { name: "Spread Positivity",          emoji: "👍",  color: "#8a00e6" },
  { name: "Boost/Repost/Make Noise",    emoji: "📢",  color: "#8a00e6" },
  { name: "Art Piece/Performance Art",  emoji: "🎨",  color: "#896312" },
  { name: "Act of Kindness",            emoji: "🤝",  color: "#127f05" },
  { name: "Boost Underreported Facts",  emoji: "🔎",  color: "#05737f" },
  { name: "Letter to the Editor",       emoji: "✉️",  color: "#c34e00" },
  { name: "Fight Depression/Anxiety",   emoji: "💙",  color: "#ff00d5" },
  { name: "Other…",                     emoji: "💡",  color: "#767574" },
];

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
  const [search, setSearch] = useState("");

  // Form state
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
  const selectedCat = CATEGORIES.find((c) => c.name === selectedCategory);

  const filteredCats = useMemo(() => {
    if (!search.trim()) return CATEGORIES;
    const q = search.trim().toLowerCase();
    return CATEGORIES.filter((c) => c.name.toLowerCase().includes(q));
  }, [search]);

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
          category: selectedCategory!, categoryColor: selectedCat?.color ?? "#23297e",
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

  // ── Form step ───────────────────────────────────────────────────────────────
  if (view === "form") {
    return (
      <Overlay onClose={onClose}>
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-gray-100">
            <button
              onClick={() => setView("category")}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors shrink-0"
              aria-label="Back to categories"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-lg leading-tight">
                Make an ASK
              </h2>
              {selectedCat && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[14px] leading-none">{selectedCat.emoji}</span>
                  <span
                    className="font-['Poppins',sans-serif] font-semibold text-[12px] uppercase tracking-wider"
                    style={{ color: selectedCat.color }}
                  >
                    {selectedCat.name}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 shrink-0"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {createSuccess ? (
            <div className="p-10 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
                <CheckCircle2 size={36} className="text-green-500" />
              </div>
              <h3 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-xl">Your ASK is live!</h3>
              <p className="font-['Poppins',sans-serif] text-gray-500 text-sm max-w-[320px]">
                Your action has been posted and is now visible to the resistance community.
              </p>
            </div>
          ) : (
            <>
              {/* Body — scrollable */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

                {/* Section: The ask */}
                <Section
                  title="What's your ask?"
                  hint="Make it clear and compelling — this is the headline people will see."
                >
                  <Field label="Title" required>
                    <input
                      type="text" value={formTitle} maxLength={80}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. March on the Capitol on July 4th"
                      className={inputCls}
                    />
                    <Counter value={formTitle} max={80} />
                  </Field>

                  <Field label="Description" required>
                    <textarea
                      rows={4} value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      placeholder="Describe what you need help with and why it matters…"
                      className={`${inputCls} resize-none`}
                    />
                  </Field>
                </Section>

                {/* Section: Logistics */}
                <Section title="Logistics">
                  <Toggle
                    checked={formIsOnline}
                    onChange={setFormIsOnline}
                    label="Online or virtual"
                    sub="No physical meeting place needed"
                  />

                  {!formIsOnline && (
                    <Field label="Location">
                      <input
                        type="text" value={formLocation}
                        onChange={(e) => setFormLocation(e.target.value)}
                        placeholder="City, State (e.g. Austin, TX)"
                        className={inputCls}
                      />
                    </Field>
                  )}

                  <Field label="People needed">
                    <div className="flex items-center gap-3">
                      <input
                        type="number" value={formSpots} min={1}
                        onChange={(e) => setFormSpots(e.target.value)}
                        disabled={formUnlimited}
                        className={`${inputCls} w-32 disabled:opacity-40 disabled:cursor-not-allowed`}
                      />
                      <Toggle
                        checked={formUnlimited}
                        onChange={setFormUnlimited}
                        label="Unlimited"
                        compact
                      />
                    </div>
                  </Field>
                </Section>

                {/* Section: Optional details */}
                <Section title="Optional details">
                  <Field label="Sponsor">
                    <input
                      type="text" value={formSponsor}
                      onChange={(e) => setFormSponsor(e.target.value)}
                      placeholder="Organization or person sponsoring this action"
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Link">
                    <input
                      type="url" value={formLink}
                      onChange={(e) => setFormLink(e.target.value)}
                      placeholder="https://…"
                      className={inputCls}
                    />
                  </Field>
                </Section>

                {/* Section: Verification */}
                <Section
                  title="Help us verify"
                  hint="So we can be sure this isn't a bad-faith effort, share contact info, links, or anything that helps confirm it's real."
                >
                  <Field label="Vetting info">
                    <textarea
                      rows={3} value={formVettingInfo}
                      onChange={(e) => setFormVettingInfo(e.target.value)}
                      placeholder="Phone numbers, sponsoring orgs, references, anything we can check…"
                      className={`${inputCls} resize-none`}
                    />
                  </Field>
                </Section>

                {formError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 font-['Poppins',sans-serif]">
                    {formError}
                  </p>
                )}
              </div>

              {/* Sticky footer */}
              <div className="border-t border-gray-100 px-6 py-4 bg-white">
                <button
                  onClick={handleCreateAsk}
                  disabled={createLoading || !formTitle.trim() || !formDesc.trim()}
                  className="w-full py-3.5 bg-[#fd8e33] hover:bg-[#e07a28] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-['Poppins',sans-serif] font-bold text-sm rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  {createLoading ? (
                    <><Loader2 size={16} className="animate-spin" /> Posting…</>
                  ) : (
                    <><Megaphone size={16} /> Post my ASK</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </Overlay>
    );
  }

  // ── Category step ───────────────────────────────────────────────────────────
  return (
    <Overlay onClose={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-['Poppins',sans-serif] font-semibold text-[11px] uppercase tracking-[0.14em] text-[#fd8e33]">
              Make an ASK
            </p>
            <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-2xl leading-tight mt-0.5">
              Add an Act to the Resistance
            </h2>
            <p className="font-['Poppins',sans-serif] text-gray-500 text-sm mt-1.5">
              Pick the category that fits best.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pb-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text" value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories…"
              className="w-full pl-10 pr-3.5 py-2.5 bg-gray-50 border border-gray-100 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#fd8e33]/30 focus:border-[#fd8e33] focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Category chips — scrollable */}
        <div className="px-6 pb-5 overflow-y-auto">
          {filteredCats.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-6 text-center font-['Poppins',sans-serif]">
              No categories match "{search}".
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filteredCats.map(({ name, emoji, color }) => {
                const selected = selectedCategory === name;
                return (
                  <button
                    key={name}
                    onClick={() => setSelectedCategory(name)}
                    className={`group flex items-center gap-2 px-3.5 py-2.5 rounded-xl border-2 text-left transition-all ${
                      selected
                        ? "border-transparent shadow-sm"
                        : "border-gray-100 hover:border-gray-200 bg-white"
                    }`}
                    style={
                      selected
                        ? { backgroundColor: `${color}12`, borderColor: color }
                        : undefined
                    }
                  >
                    <span className="text-[18px] leading-none shrink-0">{emoji}</span>
                    <span
                      className="font-['Poppins',sans-serif] font-semibold text-[12.5px] leading-tight"
                      style={{ color: selected ? color : "#374151" }}
                    >
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 bg-white flex items-center justify-between gap-3">
          <p className="text-[12px] text-gray-400 font-['Poppins',sans-serif] hidden sm:block">
            {selectedCategory ? "Ready when you are →" : "Pick a category to continue"}
          </p>
          <button
            onClick={() => {
              if (!isLoggedIn) { onLoginRequired(); return; }
              if (!isApproved || !selectedCategory) return;
              setView("form");
            }}
            disabled={isLoggedIn && (!isApproved || !selectedCategory)}
            className="ml-auto flex items-center gap-2 bg-[#fd8e33] hover:bg-[#e07a28] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-2xl px-5 py-2.5 font-['Poppins',sans-serif] font-bold text-sm shadow-sm transition-colors"
          >
            <Megaphone size={16} />
            {!isLoggedIn
              ? "Sign in to make an ASK"
              : !isApproved
              ? "Pending approval"
              : "Continue"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Sub-components & helpers ──────────────────────────────────────────────────
const inputCls =
  "w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#fd8e33]/30 focus:border-[#fd8e33] transition-colors";

function Section({
  title, hint, children,
}: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-[15px] leading-tight">
          {title}
        </h3>
        {hint && (
          <p className="font-['Poppins',sans-serif] text-[12.5px] text-gray-500 mt-1 leading-relaxed">
            {hint}
          </p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-['Poppins',sans-serif] text-[12px] font-semibold text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-[#fd8e33] ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <p className="text-right text-[11px] text-gray-400 mt-1 font-['Poppins',sans-serif]">
      {value.length}/{max}
    </p>
  );
}

function Toggle({
  checked, onChange, label, sub, compact,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-3 w-full text-left ${compact ? "" : "p-3 rounded-xl border border-gray-100 hover:border-gray-200"}`}
    >
      <span
        className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${
          checked ? "bg-[#fd8e33]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
      <span className="flex-1">
        <span className="block font-['Poppins',sans-serif] font-semibold text-[13px] text-gray-800 leading-tight">
          {label}
        </span>
        {sub && (
          <span className="block font-['Poppins',sans-serif] text-[11.5px] text-gray-500 mt-0.5 leading-tight">
            {sub}
          </span>
        )}
      </span>
    </button>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl flex justify-center" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
