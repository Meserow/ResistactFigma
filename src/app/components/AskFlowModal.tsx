import React, { useEffect, useRef, useState } from "react";
import logoImg from "../../assets/6f09d83b1b948a5a0a2a9e7558c073db252c1f59.png";
import {
  X, Loader2, Megaphone, Upload, Clock,
  Ban, DollarSign, Bike, Newspaper, Calendar, Share2, Hammer, PenLine, Users,
  HandHeart, Home, HardHat, Sparkles, Briefcase, Heart, Mail, GraduationCap,
  Smile, Volume2, Palette, Handshake, Send, Brain, Lightbulb,
  Flame, Laugh, VenetianMask, Sunrise, Zap, ShoppingCart, HandHelping,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import { supabase, type UserApproval } from "../lib/supabase";
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
  const [uploading,        setUploading]        = useState(false);
  const [uploadError,      setUploadError]      = useState<string | null>(null);
  /** Wizard step. Logged-in users see 3 steps; logged-out get a 4th auth gate. */
  const [step, setStep] = useState(0);
  const submittingRef = useRef(false);
  const fileInputRef  = useRef<HTMLInputElement>(null);

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
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? accessToken;
      if (!token) {
        setUploadError("Sign in to upload images, or paste an image URL instead.");
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/actions/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
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
      if (!formLocation)        m.push("Location");
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
    if (!formLocation) { setFormError("Location is required."); return; }
    submittingRef.current = true;
    setFormError(null);
    setCreateLoading(true);
    try {
      // "Remote" is the single canonical location-agnostic value. A Remote
      // act carries BOTH location:"Remote" AND isOnline:true so every filter
      // path (location dropdown, Remote pill, isLocationAgnostic) agrees.
      // (Previously this compared against "Online" — which was never a form
      // option — so isOnline was always false and Remote acts came in with
      // location:"Remote", isOnline:false, breaking the state filter.)
      const isOnline = formLocation === "Remote";
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
                <Field label="Location" required>
                  <select
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    className={selectCls(formLocation)}
                  >
                    <option value="">— select —</option>
                    {LOCATION_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === "From Home" ? "From Home (not online)" : opt}
                      </option>
                    ))}
                  </select>
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
            {isImageStep && (
              <Section
                title="Header Image"
                hint="A great photo makes your action stand out. Upload one or paste a URL."
              >
                <Field label="Header image" required>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
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
                      className="flex items-center gap-1.5 px-3 py-2 bg-[#ed6624] hover:bg-[#c2521b] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-semibold text-xs rounded-lg transition-colors"
                    >
                      {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      {uploading ? "Uploading…" : "Upload from computer"}
                    </button>
                    <span className="font-['Poppins',sans-serif] text-[11px] text-gray-400">or paste a URL ↓</span>
                    <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox" checked={formImageContain}
                        onChange={(e) => setFormImageContain(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-[#ed6624]"
                      />
                      <span className="font-['Poppins',sans-serif] text-[11.5px] text-gray-500">
                        Fit logo (don't crop)
                      </span>
                    </label>
                  </div>
                  <input
                    type="url" value={formImageUrl} autoComplete="off"
                    onChange={(e) => setFormImageUrl(e.target.value)}
                    placeholder="https://… (paste any image URL)"
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
      onClick={onClose}
    >
      <div className="w-full max-w-3xl flex justify-center" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
