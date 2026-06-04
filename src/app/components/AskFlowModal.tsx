import React, { useEffect, useRef, useState } from "react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import {
  X, Loader2, Megaphone, Clock,
  Ban, DollarSign, Bike, Newspaper, Calendar, Share2, Hammer, PenLine, Users,
  HandHeart, Home, HardHat, Sparkles, Briefcase, Heart, Mail, GraduationCap,
  Smile, Volume2, Palette, Handshake, Send, Brain, Lightbulb,
  Flame, Laugh, VenetianMask, Sunrise, Zap, ShoppingCart, HandHelping,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import { type UserApproval } from "../lib/supabase";
import { LOCATION_OPTIONS } from "../lib/locations";
import { categoryToneDefault, type VulnerableGroup, type TimeBucket } from "../lib/matcher";
import { ToneRangeSlider } from "./ToneSlider";
import { involvementLevelFor } from "./InvolvementPicker";
import { GroupsDropdown } from "./GroupsDropdown";

type ToneVec = { anger: number; comedy: number; subversion: number; hope: number; energy: number };

const TONE_FIELDS: { key: keyof ToneVec; label: string; Icon: LucideIcon; stops: { label: string; desc: string }[] }[] = [
  { key: "anger",      label: "Angry",      Icon: Flame,        stops: [
    { label: "None",   desc: "Calm, no confrontation" },
    { label: "Low",    desc: "A little edge, stays subtle" },
    { label: "Bold",   desc: "Direct and attention-getting" },
    { label: "High",   desc: "In-the-streets energy" },
  ]},
  { key: "comedy",     label: "Funny",      Icon: Laugh,        stops: [
    { label: "None",         desc: "Straight-faced, serious" },
    { label: "Light",        desc: "A bit of wit" },
    { label: "Irreverent",   desc: "Mockery and mischief" },
    { label: "Full mockery", desc: "Absurdity as resistance" },
  ]},
  { key: "subversion", label: "Subversive", Icon: VenetianMask, stops: [
    { label: "None",    desc: "Conventional approach" },
    { label: "Mild",    desc: "Slightly off the beaten path" },
    { label: "Edgy",    desc: "Disruptive, unconventional" },
    { label: "Radical", desc: "Throw the rulebook out" },
  ]},
  { key: "hope",       label: "Hope",       Icon: Sunrise,      stops: [
    { label: "None",      desc: "Realistic, no rose-tinting" },
    { label: "Some",      desc: "A glimmer of optimism" },
    { label: "Uplifting", desc: "Building and inspiring" },
    { label: "Full hope", desc: "Movement energy, community-first" },
  ]},
  { key: "energy",     label: "Energy",     Icon: Zap,          stops: [
    { label: "Low",     desc: "Low demand on the participant" },
    { label: "Mild",    desc: "A moderate lift" },
    { label: "Engaged", desc: "Requires real showing up" },
    { label: "On fire", desc: "All in, maximum commitment" },
  ]},
];

/** 5-stop time commitment scale — matches EditCardModal and MatchMe style. */
const TIME_STOPS: { key: TimeBucket; title: string; desc: string }[] = [
  { key: "5min",     title: "Just the basics",  desc: "< 5 minutes" },
  { key: "10min",    title: "A few minutes",    desc: "5–10 minutes" },
  { key: "30min",    title: "A little",         desc: "A few hours per month" },
  { key: "fewHours", title: "Regularly",        desc: "A few hours per week" },
  { key: "ongoing",  title: "All in",           desc: "Ongoing organizing" },
];

const TIME_COMMITMENT_MAP: Record<TimeBucket, string> = {
  "5min":     "< 5 minutes",
  "10min":    "5–10 minutes",
  "30min":    "~30 minutes",
  "1hr":      "1 hour",
  "fewHours": "1–3 hours",
  "fullDay":  "Full day",
  "ongoing":  "Ongoing",
};

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

/** Coerce a model-supplied tone value into the 0–3 integer the sliders use. */
const clampTone = (v: unknown): number => Math.max(0, Math.min(3, Math.round(Number(v) || 0)));

// ─── Category data ─────────────────────────────────────────────────────────────
const CATEGORIES: { name: string; icon: LucideIcon; color: string }[] = [
  { name: "Act of Kindness",            icon: Handshake,      color: "#127f05" },
  { name: "Amplify",                    icon: Volume2,        color: "#8a00e6" },
  { name: "Art/Performance Art",        icon: Palette,        color: "#896312" },
  { name: "Boycott",                    icon: Ban,            color: "#23297e" },
  { name: "Crafting",                   icon: Hammer,         color: "#c34e00" },
  { name: "Email Campaign",             icon: Mail,           color: "#e44b4b" },
  { name: "Flash Mob",                  icon: Users,          color: "#ff00d5" },
  { name: "Funding",                    icon: DollarSign,     color: "#127f05" },
  { name: "Housing",                    icon: Home,           color: "#896312" },
  { name: "Join a Group",               icon: HandHeart,      color: "#0891b2" },
  { name: "Labor",                      icon: HardHat,        color: "#127f05" },
  { name: "Letter to Editor",           icon: Send,           color: "#c34e00" },
  { name: "Meeting",                    icon: Calendar,       color: "#23297e" },
  { name: "Mental Health",              icon: Brain,          color: "#ff00d5" },
  { name: "News Story",                 icon: Newspaper,      color: "#896312" },
  { name: "Personal Commitment",        icon: Heart,          color: "#23297e" },
  { name: "Petition",                   icon: PenLine,        color: "#05737f" },
  { name: "Prayer",                     icon: Sparkles,       color: "#8a00e6" },
  { name: "Professional Skills",        icon: Briefcase,      color: "#126d89" },
  { name: "Purchase",                   icon: ShoppingCart,   color: "#b45309" },
  { name: "Protest",                    icon: Megaphone,      color: "#23297e" },
  { name: "Social Media",               icon: Share2,         color: "#e44b4b" },
  { name: "Spread Positivity",          icon: Smile,          color: "#8a00e6" },
  { name: "Training",                   icon: GraduationCap,  color: "#126d89" },
  { name: "Transportation",             icon: Bike,           color: "#126d89" },
  { name: "Volunteer",                  icon: HandHelping,    color: "#4a7c59" },
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
  const [formTitle,        setFormTitle]        = useState("");
  const [formSynopsis,     setFormSynopsis]     = useState(""); // one-line subtitle shown below the title on the card
  const [formDesc,         setFormDesc]         = useState("");
  const [formLink,         setFormLink]         = useState(""); // action URL → sent as targetUrl
  const [formAuthorLink,   setFormAuthorLink]   = useState(""); // org/author homepage
  const [formAuthorName,   setFormAuthorName]   = useState(""); // submitter-supplied author
  const [formAuthorRole,   setFormAuthorRole]   = useState(""); // role / org name
  const [formLocation,     setFormLocation]     = useState("");
  const [formIsOnline,     setFormIsOnline]     = useState(false);
  const [formSponsor,      setFormSponsor]      = useState("");
  const [formVettingInfo,  setFormVettingInfo]  = useState("");
  const [formEventDate,    setFormEventDate]    = useState("");
  const [formImageUrl,     setFormImageUrl]     = useState("");
  const [formImageContain, setFormImageContain] = useState(false);
  const [involvement,      setInvolvement]      = useState<TimeBucket>("30min");
  const [tone, setTone] = useState<ToneVec>({ anger: 1, comedy: 1, subversion: 1, hope: 1, energy: 1 });
  /** True once the user manually moves any tone slider — stops auto-sync from category. */
  const [toneEdited,       setToneEdited]       = useState(false);
  const [amplifiesGroups,  setAmplifiesGroups]  = useState<VulnerableGroup[]>([]);
  const [createLoading,    setCreateLoading]    = useState(false);
  const [formError,        setFormError]        = useState<string | null>(null);
  const [genBanner,        setGenBanner]        = useState(false); // drawing the cartoon banner (last step)
  const [bannerError,      setBannerError]      = useState<string | null>(null);
  /** Wizard step. Logged-in users see 3 steps; logged-out get a 4th auth gate. */
  const [step, setStep] = useState(0);
  const submittingRef = useRef(false);

  // ── "Start from a link" auto-fill (approved members) ──────────────────────────
  // Paste a URL → server drafts every field + draws a banner; we drop the result
  // into the form below, fully editable, then the member reviews and submits.
  const [autoUrl,    setAutoUrl]    = useState("");
  const [autoBusy,   setAutoBusy]   = useState(false);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);
  const [autoError,  setAutoError]  = useState<string | null>(null);
  const autoRef = useRef(false);
  // Source page image from the last auto-fill — passed to banner regeneration so
  // the cartoon can fall back to the page art when the text alone isn't enough.
  const [srcRefImage, setSrcRefImage] = useState<string | null>(null);

  /** Draw (or redraw) the cartoon banner from the act's title + description.
   * Members don't upload their own images — every act gets a brand cartoon. */
  async function handleGenerateBanner() {
    if (!formTitle.trim()) { setBannerError("Add a title first (step 1)."); return; }
    if (!isLoggedIn) { onLoginRequired(); return; }
    setBannerError(null);
    setGenBanner(true);
    try {
      const res = await fetch(`${API}/actions/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ title: formTitle.trim(), description: formDesc.trim(), refImageUrl: srcRefImage || undefined }),
      });
      let data: any = {};
      try { data = await res.json(); } catch { /* empty body */ }
      if (res.ok && data.url) setFormImageUrl(String(data.url));
      else setBannerError(data.error ?? `Couldn't draw a banner (HTTP ${res.status}). Try again.`);
    } catch {
      setBannerError("Network error — try again.");
    } finally {
      setGenBanner(false);
    }
  }

  const isLoggedIn = !!approval;
  const isApproved = approval?.status === "approved";
  const selectedCat = CATEGORIES.find((c) => c.name === selectedCategory);

  // ── Step layout ──────────────────────────────────────────────────────────────
  // Logged-in:  4 steps  (0 = What's the Action, 1 = Details & Vibe, 2 = Optional, 3 = Header Image)
  // Logged-out: 5 steps  (same 3 + auth gate, then Header Image last)
  const imageStep = isLoggedIn ? 3 : 4;
  const totalSteps = isLoggedIn ? 4 : 5;
  const isLastStep = step === totalSteps - 1;
  const isAuthStep = !isLoggedIn && step === 3;
  const isImageStep = step === imageStep;

  const STEP_TITLES = isLoggedIn
    ? ["What's the Act?", "Details & Vibe", "Optional", "Header Image"]
    : ["What's the Act?", "Details & Vibe", "Optional", "Create an Account", "Header Image"];

  // If the user signs in while on the auth step, totalSteps shrinks — drop back.
  useEffect(() => {
    if (step > totalSteps - 1) setStep(totalSteps - 1);
  }, [step, totalSteps]);

  /** Per-step required-field check — returns missing field labels. */
  function missingForStep(s: number): string[] {
    const m: string[] = [];
    if (s === 0) {
      if (!selectedCategory)    m.push("Category");
      if (!formTitle.trim())    m.push("Title");
      if (!formDesc.trim())     m.push("Description");
      if (!formLink.trim())     m.push("Action URL");
    } else if (s === 1) {
      if (!formLocation && !formIsOnline) m.push("Location (or mark it remote)");
    } else if (s === imageStep) {
      if (!formImageUrl.trim()) m.push("Header image");
    }
    return m;
  }
  const missingNow = missingForStep(step);
  const canAdvance = missingNow.length === 0;

  // Normalise involvement → 0–3 index for ToneRangeSlider (same as EditCardModal)
  const tIdx   = Math.max(0, TIME_STOPS.findIndex((l) => l.key === involvementLevelFor(involvement)));
  const tLevel = TIME_STOPS[tIdx];

  async function handleCreateAsk() {
    if (submittingRef.current) return;
    if (!isLoggedIn) { onLoginRequired(); return; }
    if (!selectedCategory) {
      setFormError("Pick a category."); return;
    }
    if (!formTitle.trim() || !formDesc.trim() || !formLink.trim() || !formImageUrl.trim()) {
      setFormError("Title, description, action URL, and header image are required."); return;
    }
    if (!formLocation && !formIsOnline) {
      setFormError("Pick a location, or mark it as doable remotely / from home."); return;
    }
    submittingRef.current = true;
    setFormError(null);
    setCreateLoading(true);
    try {
      // Remote-ness and geography are independent axes now: location holds the
      // state (or nothing), isOnline says whether it can be done from home.
      const isOnline = formIsOnline;
      let res: Response;
      try {
        res = await fetch(`${API}/actions/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            title:          formTitle.trim(),
            synopsis:       formSynopsis.trim()     || undefined,
            description:    formDesc.trim(),
            category:       selectedCategory!,
            categoryColor:  selectedCat?.color ?? "#23297e",
            location:       formLocation || undefined,
            isOnline,
            actionType:     isOnline ? "Online" : "In Person Group",
            timeCommitment: TIME_COMMITMENT_MAP[involvement],
            quickAction:    involvement === "5min" ? true : undefined,
            sponsor:        formSponsor.trim()      || undefined,
            targetUrl:      formLink.trim()         || undefined,
            authorLink:     formAuthorLink.trim()   || undefined,
            authorName:     formAuthorName.trim()   || undefined,
            authorRole:     formAuthorRole.trim()   || undefined,
            vettingInfo:    formVettingInfo.trim()  || undefined,
            eventDate:      formEventDate.trim()    || undefined,
            spotsTotal:     "Unlimited",
            topImageUrl:    formImageUrl.trim()     || null,
            imageContain:   formImageContain,
            toneOverride:   toneEdited ? tone : undefined,
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

  /** Paste-a-link auto-fill: draft every field from the page, then auto-draw the
   * banner. Everything lands editable in the form below; nothing auto-submits. */
  async function handleAutoFill() {
    if (autoRef.current) return;
    const target = autoUrl.trim();
    if (!/^https?:\/\//i.test(target)) {
      setAutoError("Paste a full link starting with http:// or https://"); return;
    }
    if (!isLoggedIn) { onLoginRequired(); return; }
    autoRef.current = true;
    setAutoError(null);
    setAutoBusy(true);
    try {
      // 1) Draft the fields from the page.
      setAutoStatus("Reading the page…");
      let draftRes: Response;
      try {
        draftRes = await fetch(`${API}/actions/from-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ url: target }),
        });
      } catch {
        setAutoError("Network error — check your connection and try again."); return;
      }
      let dData: any = {};
      try { dData = await draftRes.json(); } catch { /* empty body */ }
      if (!draftRes.ok) {
        setAutoError(dData.error ?? `Couldn't read that link (HTTP ${draftRes.status}).`); return;
      }
      const draft = dData.draft ?? {};
      const refImageUrl: string | null = dData.refImageUrl ?? null;
      setSrcRefImage(refImageUrl);

      // Populate the form — everything stays editable.
      setAutoStatus("Filling in your act…");
      if (draft.title)       setFormTitle(String(draft.title).slice(0, 80));
      if (draft.synopsis)    setFormSynopsis(String(draft.synopsis).slice(0, 100));
      if (draft.description) setFormDesc(String(draft.description));
      setFormLink(draft.targetUrl ? String(draft.targetUrl) : target);
      if (draft.authorName)  setFormAuthorName(String(draft.authorName));
      if (draft.authorRole)  setFormAuthorRole(String(draft.authorRole));
      if (typeof draft.isOnline === "boolean") setFormIsOnline(draft.isOnline);
      // Location is geography-only; "Remote"/online lives in the isOnline flag.
      if (draft.location && (LOCATION_OPTIONS as readonly string[]).includes(draft.location)) {
        setFormLocation(draft.location);
      }
      if (draft.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(String(draft.eventDate))) {
        setFormEventDate(String(draft.eventDate));
      }
      // Category → match the picker list (its color flows from there); else Other.
      const matched = CATEGORIES.find((c) => c.name.toLowerCase() === String(draft.category ?? "").toLowerCase());
      const catName = matched?.name ?? "Other";
      setSelectedCategory(catName);
      // Tone — use the model's vector when present, else the category default.
      if (draft.toneOverride && typeof draft.toneOverride === "object") {
        const t = draft.toneOverride;
        setTone({ anger: clampTone(t.anger), comedy: clampTone(t.comedy), subversion: clampTone(t.subversion), hope: clampTone(t.hope), energy: clampTone(t.energy) });
        setToneEdited(true);
      } else {
        const d = categoryToneDefault(catName);
        setTone({ anger: d.anger, comedy: d.comedy, subversion: d.subversion, hope: d.hope, energy: d.energy });
      }

      // 2) Draw the banner automatically. Non-fatal: if it fails or hits the
      // daily cap, the drafted fields stay and the member can upload their own.
      setAutoStatus("Drawing your banner…");
      try {
        const imgRes = await fetch(`${API}/actions/generate-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            title: String(draft.title ?? "").trim(),
            description: String(draft.description ?? "").trim(),
            refImageUrl,
          }),
        });
        let iData: any = {};
        try { iData = await imgRes.json(); } catch { /* empty body */ }
        if (imgRes.ok && iData.url) setFormImageUrl(String(iData.url));
        else if (imgRes.status === 429) setAutoError(iData.error ?? "Daily image limit reached — add a header image yourself below.");
      } catch { /* banner is optional; keep the drafted fields */ }

      setAutoStatus(null);
    } finally {
      setAutoBusy(false);
      autoRef.current = false;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Overlay onClose={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-gray-100">
          <img src={logoImg} alt="" aria-hidden="true" className="w-9 h-9 object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[20px] leading-tight">
              Add an Act
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

        {/* ── Progress dots ── */}
        <div className="px-6 pt-3 pb-1 shrink-0 flex justify-center gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-8 bg-[#ed6624]" : i < step ? "w-1.5 bg-[#ed6624]" : "w-1.5 bg-gray-300"
              }`}
            />
          ))}
        </div>

        <>
          {/* ── Body — scrollable ── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* ── Step 0: What's the Action? ──────────────────────────────── */}
            {step === 0 && (
              <Section
                title="What's the Act?"
                hint="Make it clear and compelling — this is the headline people will see."
              >
                {/* Approved members can paste a link and let us draft the whole
                    card (fields + banner). Everything below stays editable. */}
                {isApproved && (
                  <div className="rounded-xl border border-[#ed6624]/30 bg-[#ed6624]/[0.06] p-3">
                    <label className="flex items-center gap-1.5 font-['Poppins',sans-serif] text-[12px] font-semibold text-[#23297e]">
                      <Sparkles size={13} className="text-[#ed6624]" />
                      Have a link? Let us fill this in for you
                    </label>
                    <p className="mt-0.5 font-['Poppins',sans-serif] text-[11px] text-gray-500">
                      Paste a page about the action — we'll draft the title, details, and a banner. Edit anything before you submit.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="url" value={autoUrl} autoComplete="off" disabled={autoBusy}
                        onChange={(e) => { setAutoUrl(e.target.value); setAutoError(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAutoFill(); } }}
                        placeholder="https://…"
                        className={`${inputCls} flex-1`}
                      />
                      <button
                        type="button" onClick={handleAutoFill}
                        disabled={autoBusy || !autoUrl.trim()}
                        className="shrink-0 px-3 py-2 bg-[#ed6624] hover:bg-[#c2521b] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg inline-flex items-center gap-1.5"
                      >
                        {autoBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                        {autoBusy ? "Working…" : "Auto-fill"}
                      </button>
                    </div>
                    {autoStatus && (
                      <p className="mt-2 font-['Poppins',sans-serif] text-[11px] text-[#23297e] inline-flex items-center gap-1.5">
                        <Loader2 size={12} className="animate-spin" /> {autoStatus}
                      </p>
                    )}
                    {autoError && (
                      <p className="mt-2 font-['Poppins',sans-serif] text-[11px] text-red-600">{autoError}</p>
                    )}
                  </div>
                )}

                <Field label="Title" required>
                  <input
                    type="text" value={formTitle} maxLength={80} autoComplete="off"
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. March on the Capitol on July 4th"
                    className={inputCls}
                  />
                  <Counter value={formTitle} max={80} />
                </Field>

                <Field label="Subtitle">
                  <input
                    type="text" value={formSynopsis} maxLength={100} autoComplete="off"
                    onChange={(e) => setFormSynopsis(e.target.value)}
                    placeholder="One line in plainer language — shows under the title on the card"
                    className={inputCls}
                  />
                  <Counter value={formSynopsis} max={100} />
                </Field>

                <Field label="Category" required>
                  <select
                    value={selectedCategory ?? ""}
                    onChange={(e) => {
                      const next = e.target.value || null;
                      setSelectedCategory(next);
                      if (next && !toneEdited) {
                        const d = categoryToneDefault(next);
                        setTone({ anger: d.anger, comedy: d.comedy, subversion: d.subversion, hope: d.hope, energy: d.energy });
                      }
                    }}
                    className={selectCls(selectedCategory)}
                    style={selectedCat ? { color: selectedCat.color, fontWeight: 600 } : undefined}
                  >
                    <option value="">— select a category —</option>
                    {CATEGORIES.map(({ name }) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Description" required>
                  <textarea
                    rows={4} value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder="Describe what you need help with and why it matters…"
                    className={`${inputCls} resize-none`}
                  />
                </Field>

                <Field label="Action URL" required>
                  <input
                    type="url" value={formLink} autoComplete="off"
                    onChange={(e) => setFormLink(e.target.value)}
                    placeholder="https://… (where people go to take this action)"
                    className={inputCls}
                  />
                </Field>

              </Section>
            )}

            {/* ── Step 1: Details & Vibe ──────────────────────────────────── */}
            {step === 1 && (
              <Section
                title="Details & Vibe"
                hint="Where, how much time, and what energy — helps us match this to the right people."
              >
                <Field label="Location">
                  <select
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    className={selectCls(formLocation)}
                  >
                    <option value="">— select —</option>
                    {LOCATION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  {/* Remote-ness is separate from the state above — an act can
                      be tied to a place AND doable from home. Either a location
                      or this box is required. */}
                  <label className="mt-2 flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formIsOnline}
                      onChange={(e) => setFormIsOnline(e.target.checked)}
                      className="h-4 w-4 accent-[#23297e]"
                    />
                    <span className="font-['Poppins',sans-serif] text-[13px] text-gray-700">
                      Can be done remotely / from home
                    </span>
                  </label>
                </Field>

                {/* Tone & Time — unified section */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-4 space-y-4">
                  <p className="font-['Poppins',sans-serif] text-[13px] font-semibold text-[#23297e]">
                    Tone & Time <span className="font-normal text-gray-400 text-[11px]">— defaults from your category, adjust if off</span>
                  </p>

                  {/* Time commitment */}
                  <div>
                    <div className="flex items-center mb-1.5">
                      <Clock size={14} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                      <strong className="font-['Poppins',sans-serif] font-semibold text-xs text-[#23297e]">Time</strong>
                      <span className="ml-1.5 font-['Poppins',sans-serif] text-[11px] text-gray-500">
                        · <span className="font-medium text-[#ed6624]">{tLevel.title}</span> — {tLevel.desc}
                      </span>
                    </div>
                    <ToneRangeSlider
                      value={tIdx}
                      onChange={(v) => setInvolvement(TIME_STOPS[v].key)}
                      max={4}
                    />
                  </div>

                  {/* Tone sliders — 2-col grid on wider screens */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    {TONE_FIELDS.map(({ key, label, Icon, stops }) => {
                      const stop = stops[tone[key]];
                      return (
                        <div key={key}>
                          <div className="flex items-center mb-1.5">
                            <Icon size={14} strokeWidth={2} className="text-[#23297e] mr-1.5 shrink-0" />
                            <strong className="font-['Poppins',sans-serif] font-semibold text-xs text-[#23297e]">
                              {label}
                            </strong>
                            <span className="ml-1.5 font-['Poppins',sans-serif] text-[11px] text-gray-500 truncate">
                              · <span className="font-medium text-[#ed6624]">{stop.label}</span> — {stop.desc}
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
                      );
                    })}
                  </div>
                </div>

              </Section>
            )}

            {/* ── Step 2: Optional ────────────────────────────────────────── */}
            {step === 2 && !isAuthStep && (
              <Section
                title="Optional"
                hint="Skip this if you like — these fields help us vet and credit your action."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Your name or org">
                    <input
                      type="text" value={formAuthorName} autoComplete="off"
                      onChange={(e) => setFormAuthorName(e.target.value)}
                      placeholder="e.g. NAACP, Indivisible"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Role">
                    <input
                      type="text" value={formAuthorRole} autoComplete="off"
                      onChange={(e) => setFormAuthorRole(e.target.value)}
                      placeholder="e.g. Organizer, Chapter Lead"
                      className={inputCls}
                    />
                  </Field>
                </div>
                <Field label="Your org's website">
                  <input
                    type="url" value={formAuthorLink} autoComplete="off"
                    onChange={(e) => setFormAuthorLink(e.target.value)}
                    placeholder="https://…"
                    className={inputCls}
                  />
                </Field>
                <Field label="Event date">
                  <input
                    type="date" value={formEventDate}
                    onChange={(e) => setFormEventDate(e.target.value)}
                    className={inputCls}
                  />
                  <p className="mt-1 font-['Poppins',sans-serif] text-[11px] text-gray-400">
                    For time-limited events — card is hidden after this date. Leave blank for evergreen actions.
                  </p>
                </Field>

                <Field label="Who does this especially help?">
                  <GroupsDropdown
                    value={amplifiesGroups}
                    onToggle={(g) =>
                      setAmplifiesGroups((prev) =>
                        prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
                      )
                    }
                    onClear={() => setAmplifiesGroups([])}
                  />
                </Field>
                <Field label="Vetting info">
                  <textarea
                    rows={3} value={formVettingInfo}
                    onChange={(e) => setFormVettingInfo(e.target.value)}
                    placeholder="Phone numbers, sponsoring orgs, references, anything we can check…"
                    className={`${inputCls} resize-none`}
                  />
                </Field>
              </Section>
            )}

            {/* ── Step 3 (anonymous only): Create an account ──────────────── */}
            {isAuthStep && (
              <div className="text-center py-6">
                <h3 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-2xl mb-2">
                  Almost there!
                </h3>
                <p className="font-['Poppins',sans-serif] text-sm text-gray-600 max-w-md mx-auto mb-6">
                  Sign in to add your header image and submit your action. Everything you've filled in is saved.
                </p>
                <button
                  type="button"
                  onClick={onLoginRequired}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#ed6624] hover:bg-[#e07a28] text-white font-['Poppins',sans-serif] font-bold text-sm rounded-2xl transition-colors shadow-sm"
                >
                  Sign in or create account
                </button>
                <p className="font-['Poppins',sans-serif] text-[11px] text-gray-400 mt-4">
                  Your action gets reviewed before it goes live.
                </p>
              </div>
            )}

            {/* ── Last step: Header image ──────────────────────────────────── */}
            {/* Members don't upload their own art — every act gets a brand
                cartoon banner, drawn from the title + description. */}
            {isImageStep && (
              <Section
                title="Header Image"
                hint="Every act gets a custom cartoon banner — here's yours."
              >
                <Field label="Header image" required>
                  {formImageUrl.trim() ? (
                    <>
                      <div
                        className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                        style={{ aspectRatio: "3 / 2" }}
                      >
                        <img
                          src={formImageUrl.trim()}
                          alt="Cartoon banner"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleGenerateBanner}
                        disabled={genBanner || !formTitle.trim()}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#23297e]/20 bg-[#23297e]/5 px-3 py-2 font-['Poppins',sans-serif] text-xs font-semibold text-[#23297e] transition-colors hover:bg-[#23297e]/10 disabled:opacity-60"
                      >
                        {genBanner ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                        {genBanner ? "Drawing…" : "Regenerate cartoon"}
                      </button>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
                      <p className="mb-3 font-['Poppins',sans-serif] text-[13px] text-gray-500">
                        We'll draw a custom cartoon banner for your act.
                      </p>
                      <button
                        type="button"
                        onClick={handleGenerateBanner}
                        disabled={genBanner || !formTitle.trim()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#ed6624] px-4 py-2 font-['Poppins',sans-serif] text-xs font-semibold text-white transition-colors hover:bg-[#c2521b] disabled:opacity-60"
                      >
                        {genBanner ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                        {genBanner ? "Drawing your banner…" : "Generate cartoon banner"}
                      </button>
                      {!formTitle.trim() && (
                        <p className="mt-2 font-['Poppins',sans-serif] text-[11px] text-gray-400">Add a title first (step 1).</p>
                      )}
                    </div>
                  )}
                  {bannerError && (
                    <p className="mt-2 font-['Poppins',sans-serif] text-[11px] text-red-500">{bannerError}</p>
                  )}
                </Field>
              </Section>
            )}

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 font-['Poppins',sans-serif]">
                {formError}
              </p>
            )}
          </div>

          {/* ── Sticky footer — wizard nav ── */}
          <div className="border-t border-gray-100 px-6 py-4 bg-white">
            {!canAdvance && !isAuthStep && (
              <p className="text-[12px] text-amber-600 font-['Poppins',sans-serif] mb-2 text-center">
                Fill in {missingNow.join(", ")} to continue.
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
              {isAuthStep ? null : !isLastStep ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(totalSteps - 1, s + 1))}
                  disabled={!canAdvance}
                  className="ml-3 px-5 py-2.5 bg-[#23297e] hover:bg-[#1a2060] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { if (!isApproved) return; handleCreateAsk(); }}
                  disabled={createLoading || !isApproved || missingForStep(0).length > 0 || missingForStep(1).length > 0 || missingForStep(imageStep).length > 0}
                  className="ml-3 px-5 py-2.5 bg-[#ed6624] hover:bg-[#e07a28] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center gap-2"
                >
                  {createLoading ? (
                    <><Loader2 size={14} className="animate-spin" /> Submitting…</>
                  ) : !isApproved ? (
                    <><Megaphone size={14} /> Pending approval</>
                  ) : (
                    <><Megaphone size={14} /> Submit for Review</>
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
const inputBase =
  "w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm focus:outline-none focus:ring-2 focus:ring-[#ed6624]/30 focus:border-[#ed6624] transition-colors";
const inputCls = `${inputBase} text-gray-800 placeholder-gray-400 placeholder:italic`;
const selectCls = (val: string | null | undefined) =>
  `${inputBase} !pr-10 ${val ? "text-gray-800" : "text-gray-400 italic"}`;

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
        {required && <span className="text-[#ed6624] ml-1">*</span>}
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

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      {/* No backdrop-click-to-close: this is a multi-step form, so a stray click
          or drag-release on the dark area shouldn't discard what you've typed.
          Close only via the explicit X / Cancel. */}
      <div className="w-full max-w-3xl flex justify-center">
        {children}
      </div>
    </div>
  );
}
