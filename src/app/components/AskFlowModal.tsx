import React, { useRef, useState } from "react";
import {
  X, Loader2, Megaphone, Upload,
  Ban, DollarSign, Bike, Newspaper, Calendar, Share2, Hammer, PenLine, Users,
  HandHeart, Home, HardHat, Sparkles, Briefcase, Heart, Mail, GraduationCap,
  Smile, Volume2, Palette, Handshake, Send, Brain, Lightbulb, Mailbox,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";
import { LOCATION_OPTIONS } from "../lib/locations";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

// ─── Category data ─────────────────────────────────────────────────────────────
const CATEGORIES: { name: string; icon: LucideIcon; color: string }[] = [
  { name: "Act of Kindness",            icon: Handshake,      color: "#127f05" },
  { name: "Art/Performance Art",        icon: Palette,        color: "#896312" },
  { name: "Boost",                      icon: Volume2,        color: "#8a00e6" },
  { name: "Boycott",                    icon: Ban,            color: "#23297e" },
  { name: "Crafting",                   icon: Hammer,         color: "#c34e00" },
  { name: "Email Campaign",             icon: Mail,           color: "#e44b4b" },
  { name: "Flash Mob",                  icon: Users,          color: "#ff00d5" },
  { name: "Funding",                    icon: DollarSign,     color: "#127f05" },
  { name: "Housing",                    icon: Home,           color: "#896312" },
  { name: "Join a Group",               icon: HandHeart,      color: "#0891b2" },
  { name: "Labor",                      icon: HardHat,        color: "#127f05" },
  { name: "Letter to Editor",           icon: Send,           color: "#c34e00" },
  { name: "Letter Writing",             icon: Mailbox,        color: "#2d7a6b" },
  { name: "Meeting",                    icon: Calendar,       color: "#23297e" },
  { name: "Mental Health",              icon: Brain,          color: "#ff00d5" },
  { name: "News Story",                 icon: Newspaper,      color: "#896312" },
  { name: "Personal Commitment",        icon: Heart,          color: "#23297e" },
  { name: "Petition",                   icon: PenLine,        color: "#05737f" },
  { name: "Prayer",                     icon: Sparkles,       color: "#8a00e6" },
  { name: "Professional Skills",        icon: Briefcase,      color: "#126d89" },
  { name: "Protest",                    icon: Megaphone,      color: "#23297e" },
  { name: "Social Media",               icon: Share2,         color: "#e44b4b" },
  { name: "Spread Positivity",          icon: Smile,          color: "#8a00e6" },
  { name: "Training",                   icon: GraduationCap,  color: "#126d89" },
  { name: "Transportation",             icon: Bike,           color: "#126d89" },
  { name: "Other",                      icon: Lightbulb,      color: "#767574" },
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Form state
  const [formTitle,       setFormTitle]       = useState("");
  const [formDesc,        setFormDesc]        = useState("");
  const [formSponsor,     setFormSponsor]     = useState("");
  const [formLink,        setFormLink]        = useState("");
  const [formLocation,    setFormLocation]    = useState("");
  const [formVettingInfo, setFormVettingInfo] = useState("");
  const [formImageUrl,    setFormImageUrl]    = useState("");
  const [formImageContain, setFormImageContain] = useState(false);
  const [createLoading,   setCreateLoading]   = useState(false);
  const [formError,       setFormError]       = useState<string | null>(null);
  const [uploading,       setUploading]       = useState(false);
  const [uploadError,     setUploadError]     = useState<string | null>(null);
  const submittingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Pick an image file (jpg/png/webp/gif).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image too large (max 5 MB).");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/actions/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? `Upload failed (${res.status}).`);
        return;
      }
      setFormImageUrl(data.url);
    } catch (err) {
      console.error("Image upload error:", err);
      setUploadError("Network error during upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const isLoggedIn = !!approval;
  const isApproved = approval?.status === "approved";
  const selectedCat = CATEGORIES.find((c) => c.name === selectedCategory);

  async function handleCreateAsk() {
    if (submittingRef.current) return;
    if (!isLoggedIn) { onLoginRequired(); return; }
    if (!selectedCategory) {
      setFormError("Pick a category."); return;
    }
    if (!formTitle.trim() || !formDesc.trim() || !formLink.trim() || !formImageUrl.trim()) {
      setFormError("Title, description, link, and header image are required."); return;
    }
    submittingRef.current = true;
    setFormError(null);
    setCreateLoading(true);
    try {
      const isOnline = formLocation === "Online";
      let res: Response;
      try {
        res = await fetch(`${API}/actions/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            title: formTitle.trim(), description: formDesc.trim(),
            category: selectedCategory!, categoryColor: selectedCat?.color ?? "#23297e",
            location: isOnline ? undefined : formLocation || undefined,
            isOnline,
            actionType: isOnline ? "Online" : "In Person Group",
            sponsor: formSponsor.trim() || undefined,
            link: formLink.trim() || undefined,
            vettingInfo: formVettingInfo.trim() || undefined,
            spotsTotal: "Unlimited",
            topImageUrl: formImageUrl.trim() || null,
            imageContain: formImageContain,
          }),
        });
      } catch (networkErr) {
        console.error("AskFlow: network error", networkErr);
        setFormError("Network error — please check your connection and try again.");
        return;
      }
      let data: any = {};
      try { data = await res.json(); } catch { /* empty body */ }
      if (!res.ok) {
        setFormError(data.error ?? `Failed to post (HTTP ${res.status}). Try refreshing and signing in again.`);
        return;
      }
      if (!data.card) {
        setFormError("Server returned a success but no card data. Please try again.");
        return;
      }
      if (onNewCard) onNewCard(data.card);
      onClose();
    } finally {
      setCreateLoading(false);
      submittingRef.current = false;
    }
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <Overlay onClose={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <p className="font-['Poppins',sans-serif] font-semibold text-[11px] uppercase tracking-[0.14em] text-[#fd8e33]">
              Make an ASK
            </p>
            <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-lg leading-tight mt-0.5">
              Add an Action
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <>
              {/* Body — scrollable */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

                {/* Section: The ask */}
                <Section
                  title="What's your ask?"
                  hint="Make it clear and compelling — this is the headline people will see."
                >
                  <Field label="Category" required>
                    <select
                      value={selectedCategory ?? ""}
                      onChange={(e) => setSelectedCategory(e.target.value || null)}
                      className={inputCls}
                      style={selectedCat ? { color: selectedCat.color, fontWeight: 600 } : undefined}
                    >
                      <option value="">— select a category —</option>
                      {CATEGORIES.map(({ name }) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </Field>

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
                  <Field label="Location" required>
                    <select
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">— select —</option>
                      {LOCATION_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Link" required>
                    <input
                      type="url" value={formLink}
                      onChange={(e) => setFormLink(e.target.value)}
                      placeholder="https://…"
                      className={inputCls}
                    />
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

                  <Field label="Header image" required>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-1.5 px-3 py-2 bg-[#23297e] hover:bg-[#1a2060] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
                      >
                        {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {uploading ? "Uploading…" : "Upload from computer"}
                      </button>
                      <span className="font-['Poppins',sans-serif] text-[11px] text-gray-400">or paste a URL ↓</span>
                    </div>
                    <input
                      type="url" value={formImageUrl}
                      onChange={(e) => setFormImageUrl(e.target.value)}
                      placeholder="https://… (optional)"
                      className={inputCls}
                    />
                    {formImageUrl.trim() && (
                      <div className="mt-2 relative h-24 rounded-xl overflow-hidden bg-gray-50 border border-gray-200">
                        <img
                          src={formImageUrl.trim()}
                          alt="Header preview"
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
                        />
                      </div>
                    )}
                    {uploadError && (
                      <p className="mt-1.5 font-['Poppins',sans-serif] text-[11px] text-red-500">{uploadError}</p>
                    )}
                    <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                      <input
                        type="checkbox" checked={formImageContain}
                        onChange={(e) => setFormImageContain(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#fd8e33]"
                      />
                      <span className="font-['Poppins',sans-serif] text-[12.5px] text-gray-600">
                        Fit logo inside header (don't crop)
                      </span>
                    </label>
                    <p className="mt-1 font-['Poppins',sans-serif] text-[11px] text-gray-400">
                      Optional. Upload a file (max 5 MB) or paste a URL. Turn on "Fit logo" for org banners; leave off for photos.
                    </p>
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
                {isLoggedIn && isApproved && (() => {
                  const missing: string[] = [];
                  if (!selectedCategory) missing.push("Category");
                  if (!formTitle.trim()) missing.push("Title");
                  if (!formDesc.trim()) missing.push("Description");
                  if (!formLink.trim()) missing.push("Link");
                  if (!formImageUrl.trim()) missing.push("Header image");
                  return missing.length > 0 ? (
                    <p className="text-[12px] text-amber-600 font-['Poppins',sans-serif] mb-2 text-center">
                      Fill {missing.join(", ")} to enable Post.
                    </p>
                  ) : null;
                })()}
                <button
                  onClick={() => {
                    if (!isLoggedIn) { onLoginRequired(); return; }
                    if (!isApproved) return;
                    handleCreateAsk();
                  }}
                  disabled={
                    createLoading ||
                    (isLoggedIn && (!isApproved || !selectedCategory || !formTitle.trim() || !formDesc.trim() || !formLink.trim() || !formImageUrl.trim()))
                  }
                  className="w-full py-3.5 bg-[#fd8e33] hover:bg-[#e07a28] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-['Poppins',sans-serif] font-bold text-sm rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  {createLoading ? (
                    <><Loader2 size={16} className="animate-spin" /> Posting…</>
                  ) : !isLoggedIn ? (
                    <><Megaphone size={16} /> Sign in to make an ASK</>
                  ) : !isApproved ? (
                    <><Megaphone size={16} /> Pending approval</>
                  ) : (
                    <><Megaphone size={16} /> Post my ASK</>
                  )}
                </button>
              </div>
            </>
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
