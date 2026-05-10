import React, { useEffect, useRef, useState } from "react";
import {
  X, Loader2, Megaphone, Upload,
  Ban, DollarSign, Bike, Newspaper, Calendar, Share2, Hammer, PenLine, Users,
  HandHeart, Home, HardHat, Sparkles, Briefcase, Heart, Mail, GraduationCap,
  Smile, Volume2, Palette, Handshake, Send, Brain, Lightbulb, Mailbox,
  Flame, Laugh, VenetianMask, Sunrise, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";
import { LOCATION_OPTIONS } from "../lib/locations";
import { categoryToneDefault, type VulnerableGroup, type TimeBucket } from "../lib/matcher";
import { ToneRangeSlider } from "./ToneSlider";
import { InvolvementPicker } from "./InvolvementPicker";

type ToneVec = { anger: number; comedy: number; subversion: number; hope: number; energy: number };

const TONE_FIELDS: { key: keyof ToneVec; label: string; Icon: LucideIcon; desc: string }[] = [
  { key: "anger",      label: "Angry",      Icon: Flame,         desc: "Confrontational, serious efforts" },
  { key: "comedy",     label: "Funny",      Icon: Laugh,         desc: "Mockery, irreverence, prank" },
  { key: "subversion", label: "Subversive", Icon: VenetianMask,  desc: "Disruptive, off the beaten path" },
  { key: "hope",       label: "Hope",       Icon: Sunrise,       desc: "Uplifting, optimistic, building" },
  { key: "energy",     label: "Energy",     Icon: Zap,           desc: "Physical/emotional fired-up demand on the user" },
];

const GROUP_OPTIONS: { value: VulnerableGroup; label: string }[] = [
  { value: "immigrant",  label: "Immigrant (documented, undocumented, mixed status family)" },
  { value: "lgbtq",      label: "LGBTQIA+ / Trans" },
  { value: "repro",      label: "Seeking or providing reproductive care" },
  { value: "disabled",   label: "Disabled / chronically ill / medically challenged" },
  { value: "fedWorker",  label: "Federal worker / contractor" },
  { value: "journalist", label: "Journalist / researcher" },
  { value: "woman",      label: "Woman" },
];

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
  const [involvement, setInvolvement] = useState<TimeBucket>("30min");
  const [tone, setTone] = useState<ToneVec>({ anger: 1, comedy: 1, subversion: 1, hope: 1, energy: 1 });
  /** Tracks whether the user has manually adjusted the sliders. If false, the
   * tone vector follows the category default whenever category changes. */
  const [toneEdited, setToneEdited] = useState(false);
  const [amplifiesGroups, setAmplifiesGroups] = useState<VulnerableGroup[]>([]);
  const [createLoading,   setCreateLoading]   = useState(false);
  const [formError,       setFormError]       = useState<string | null>(null);
  const [uploading,       setUploading]       = useState(false);
  const [uploadError,     setUploadError]     = useState<string | null>(null);
  /** Wizard step. Step count depends on auth state: a logged-out user gets an
   * extra "Create an account" step at the end. */
  const [step, setStep] = useState(0);
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

  /** Wizard step layout. The 4 form steps are always present; logged-out
   * users get an extra "Create an account" step at the end. */
  const totalSteps = isLoggedIn ? 4 : 5;
  const isLastStep = step === totalSteps - 1;
  const isAuthStep = !isLoggedIn && step === 4;

  const STEP_TITLES = ["What's your ask?", "Logistics", "Tone & audience", "Header & details", "Create an account"];

  // If a user signs in while sitting on the auth step (step 4), the auth step
  // no longer renders and totalSteps shrinks to 4. Drop them on the final
  // form step (3) so they can hit "Post my ASK" without a confusing empty
  // body.
  useEffect(() => {
    if (step > totalSteps - 1) setStep(totalSteps - 1);
  }, [step, totalSteps]);

  /** Per-step requirements. Returns the list of missing field labels. */
  function missingForStep(s: number): string[] {
    const m: string[] = [];
    if (s === 0) {
      if (!selectedCategory) m.push("Category");
      if (!formTitle.trim()) m.push("Title");
      if (!formDesc.trim()) m.push("Description");
    } else if (s === 1) {
      if (!formLocation) m.push("Location");
      if (!formLink.trim()) m.push("Link");
    } else if (s === 3) {
      if (!formImageUrl.trim()) m.push("Header image");
    }
    return m;
  }
  const missingNow = missingForStep(step);
  const canAdvance = missingNow.length === 0;

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
      // Map the picker's TimeBucket to the human-readable timeCommitment string
      // the matcher's `timeBucketFor` already understands. The "5min" level also
      // sets quickAction so the Quick Actions filter picks it up.
      const TIME_COMMITMENT: Record<TimeBucket, string> = {
        "5min":     "< 1 hour",
        "30min":    "< 1 hour",
        "1hr":      "1 hour",
        "fewHours": "1–3 hours",
        "fullDay":  "Full day",
        "ongoing":  "Ongoing",
      };
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
            timeCommitment: TIME_COMMITMENT[involvement],
            quickAction: involvement === "5min" ? true : undefined,
            sponsor: formSponsor.trim() || undefined,
            link: formLink.trim() || undefined,
            vettingInfo: formVettingInfo.trim() || undefined,
            spotsTotal: "Unlimited",
            topImageUrl: formImageUrl.trim() || null,
            imageContain: formImageContain,
            // Send the full 5-dim tone vector as an override only when the
            // submitter actually moved a slider away from the category default.
            // Otherwise the matcher will fall through to the category baseline.
            toneOverride: toneEdited ? tone : undefined,
            amplifiesGroups: amplifiesGroups.length > 0 ? amplifiesGroups : undefined,
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
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
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

        {/* Progress dots */}
        <div className="px-6 pt-3 pb-1 shrink-0 flex justify-center gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-8 bg-[#fd8e33]" : i < step ? "w-1.5 bg-[#fd8e33]" : "w-1.5 bg-gray-300"
              }`}
            />
          ))}
        </div>

        <>
              {/* Body — scrollable */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

                {/* ── Step 0: The ask ───────────────────────────────────── */}
                {step === 0 && (
                <Section
                  title="What's your ask?"
                  hint="Make it clear and compelling — this is the headline people will see."
                >
                  <Field label="Category" required>
                    <select
                      value={selectedCategory ?? ""}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        setSelectedCategory(next);
                        // Pre-populate tone sliders with the category's defaults until the
                        // submitter manually edits them. Once edited, we leave them alone.
                        if (next && !toneEdited) {
                          const d = categoryToneDefault(next);
                          setTone({ anger: d.anger, comedy: d.comedy, subversion: d.subversion, hope: d.hope, energy: d.energy });
                        }
                      }}
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
                )}

                {/* ── Step 1: Logistics ─────────────────────────────────── */}
                {step === 1 && (
                <Section
                  title="Logistics"
                  hint="Where this lives, what it links to, and how much commitment it takes."
                >
                  <Field label="How much does this action ask of people?">
                    <InvolvementPicker
                      value={involvement}
                      onChange={setInvolvement}
                      variant="plan"
                    />
                  </Field>

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
                )}

                {/* ── Step 2: Tone & audience ───────────────────────────── */}
                {step === 2 && (
                <>
                <Section
                  title="Tone of this action"
                  hint="How would you describe the type of action this is? Helps us match it to people looking for the right vibe today."
                >
                  <div className="space-y-3.5">
                    {TONE_FIELDS.map(({ key, label, Icon, desc }) => (
                      <div key={key}>
                        <div className="flex items-center mb-1.5">
                          <Icon size={15} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                          <strong className="font-['Poppins',sans-serif] font-semibold text-sm text-[#23297e]">
                            {label}
                          </strong>
                          <span className="ml-2 font-['Poppins',sans-serif] text-xs text-gray-500">
                            {desc}
                          </span>
                        </div>
                        <ToneRangeSlider
                          value={tone[key]}
                          onChange={(v) => {
                            setTone({ ...tone, [key]: v });
                            setToneEdited(true);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </Section>

                {/* Section: Group affinity */}
                <Section
                  title="Who does this especially help?"
                  hint="Pick any groups whose voice this action particularly amplifies. Optional — leave empty if it's broad."
                >
                  <div className="space-y-1.5">
                    {GROUP_OPTIONS.map(({ value, label }) => {
                      const checked = amplifiesGroups.includes(value);
                      return (
                        <label
                          key={value}
                          className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg px-2 py-1.5 hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setAmplifiesGroups(
                                e.target.checked
                                  ? [...amplifiesGroups, value]
                                  : amplifiesGroups.filter((g) => g !== value)
                              );
                            }}
                            className="mt-0.5 w-4 h-4 rounded accent-[#fd8e33] shrink-0"
                          />
                          <span className="font-['Poppins',sans-serif] text-[13px] text-gray-700 leading-snug">
                            {label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Section>
                </>
                )}

                {/* ── Step 3: Header + verification ─────────────────────── */}
                {step === 3 && (
                <>
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
                </>
                )}

                {/* ── Step 4 (anonymous only): Create an account ────────── */}
                {isAuthStep && (
                  <div className="text-center py-6">
                    <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-2xl mb-2">
                      You're almost there!
                    </h3>
                    <p className="font-['Poppins',sans-serif] text-sm text-gray-600 max-w-md mx-auto mb-6">
                      Create an account or sign in to publish your action. We'll keep
                      the form filled in — just come back here once you're signed in.
                    </p>
                    <button
                      type="button"
                      onClick={onLoginRequired}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-[#fd8e33] hover:bg-[#e07a28] text-white font-['Poppins',sans-serif] font-bold text-sm rounded-2xl transition-colors shadow-sm"
                    >
                      Sign in or create account
                    </button>
                    <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mt-4">
                      Your action gets reviewed before it goes live.
                    </p>
                  </div>
                )}

                {formError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 font-['Poppins',sans-serif]">
                    {formError}
                  </p>
                )}
              </div>

              {/* Sticky footer — wizard nav */}
              <div className="border-t border-gray-100 px-6 py-4 bg-white">
                {!canAdvance && !isAuthStep && (
                  <p className="text-[12px] text-amber-600 font-['Poppins',sans-serif] mb-2 text-center">
                    Fill {missingNow.join(", ")} to continue.
                  </p>
                )}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0 || createLoading}
                    className="px-4 py-2.5 font-['Poppins',sans-serif] text-sm font-semibold text-gray-600 hover:text-[#23297e] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Back
                  </button>
                  <span className="ml-auto font-['Poppins',sans-serif] text-[11px] text-gray-400">
                    Step {step + 1} of {totalSteps} · {STEP_TITLES[step]}
                  </span>
                  {/* Right action: Next / Post / (auth step has no right button — its own button is in the body) */}
                  {!isLastStep ? (
                    <button
                      type="button"
                      onClick={() => setStep((s) => Math.min(totalSteps - 1, s + 1))}
                      disabled={!canAdvance}
                      className="ml-3 px-5 py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors"
                    >
                      Next
                    </button>
                  ) : isAuthStep ? null : (
                    <button
                      type="button"
                      onClick={() => { if (!isApproved) return; handleCreateAsk(); }}
                      disabled={createLoading || !isApproved || missingForStep(0).length > 0 || missingForStep(1).length > 0 || missingForStep(3).length > 0}
                      className="ml-3 px-5 py-2.5 bg-[#fd8e33] hover:bg-[#e07a28] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center gap-2"
                    >
                      {createLoading ? (
                        <><Loader2 size={14} className="animate-spin" /> Posting…</>
                      ) : !isApproved ? (
                        <><Megaphone size={14} /> Pending approval</>
                      ) : (
                        <><Megaphone size={14} /> Post my ASK</>
                      )}
                    </button>
                  )}
                </div>
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
      <div className="w-full max-w-3xl flex justify-center" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
