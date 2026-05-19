import { useState } from "react";
import { X, Check, Loader2, CheckCircle2, Mail, MessageSquare, Share2 } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

type NotifFreq = "immediate" | "daily" | "weekly";

interface NotifPrefs {
  email: boolean;
  emailFreq: Set<NotifFreq>;
  sms: boolean;
  smsFreq: Set<NotifFreq>;
  socialMedia: boolean;
  anonymous: boolean;
}

interface JoinACTersModalProps {
  accessToken: string | null;
  approval: UserApproval | null;
  onClose: () => void;
  onLoginRequired: () => void;
}

export function JoinACTersModal({
  accessToken, approval, onClose, onLoginRequired,
}: JoinACTersModalProps) {
  const [prefs, setPrefs] = useState<NotifPrefs>({
    email: false, emailFreq: new Set(),
    sms: false, smsFreq: new Set(),
    socialMedia: false, anonymous: false,
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  function toggleFreq(type: "email" | "sms", freq: NotifFreq) {
    setPrefs((p) => {
      const s = new Set(p[`${type}Freq`]);
      s.has(freq) ? s.delete(freq) : s.add(freq);
      return { ...p, [`${type}Freq`]: s };
    });
  }

  async function handleJoin() {
    if (!approval) { onLoginRequired(); return; }
    setLoading(true);
    try {
      await fetch(`${API}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          email: prefs.email, emailFreq: [...prefs.emailFreq],
          sms: prefs.sms, smsFreq: [...prefs.smsFreq],
          socialMedia: prefs.socialMedia, anonymous: prefs.anonymous,
        }),
      });
      setSuccess(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[#ed6624] rounded-2xl shadow-2xl w-full max-w-[560px] overflow-hidden"
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/15 hover:bg-black/25 text-white transition-colors"
        >
          <X size={15} />
        </button>

        <div className="flex gap-5 p-6 pr-12 items-start">
          {/* Left: icon + label */}
          <div className="shrink-0 w-[120px]">
            <div className="flex gap-1.5 mb-3">
              {/* star + person icons */}
              <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
              </svg>
              {/* person */}
              <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="7" r="4" />
                <path d="M20 21a8 8 0 10-16 0h16z" />
              </svg>
            </div>
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-[14px] leading-snug">
              How can we contact you about matching ACTs?
            </h2>
          </div>

          {/* Right: checkboxes */}
          <div className="flex-1 space-y-3.5">
            {/* Email */}
            <CheckRow
              label="Email" icon={<Mail size={14} />}
              checked={prefs.email}
              onChange={(v) => setPrefs((p) => ({ ...p, email: v }))}
            >
              {prefs.email && (
                <FreqRow selected={prefs.emailFreq} onToggle={(f) => toggleFreq("email", f)} />
              )}
            </CheckRow>

            {/* SMS */}
            <CheckRow
              label="Text Message" icon={<MessageSquare size={14} />}
              checked={prefs.sms}
              onChange={(v) => setPrefs((p) => ({ ...p, sms: v }))}
            >
              {prefs.sms && (
                <FreqRow selected={prefs.smsFreq} onToggle={(f) => toggleFreq("sms", f)} />
              )}
            </CheckRow>

            {/* Social Media */}
            <CheckRow
              label="Social Media" icon={<Share2 size={14} />}
              checked={prefs.socialMedia}
              onChange={(v) => setPrefs((p) => ({ ...p, socialMedia: v }))}
            />

            {/* Anonymous */}
            <div>
              <CheckRow
                label="I will return to the website on my own."
                icon={
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-[#23297e]">
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                    <path d="M14 10h2l-4-4-4 4h2v3h4v-3z" opacity="0" />
                  </svg>
                }
                checked={prefs.anonymous}
                onChange={(v) => setPrefs((p) => ({ ...p, anonymous: v }))}
              />
              <p className="ml-6 mt-0.5 font-['Poppins',sans-serif] text-white/80 text-[11px] italic">
                Keep me completely anonymous…
              </p>
            </div>

            {/* Join button */}
            <div className="flex justify-end pt-1">
              {success ? (
                <div className="flex items-center gap-2 bg-white rounded-xl px-5 py-2.5 text-green-600 font-['Poppins',sans-serif] font-bold text-sm">
                  <CheckCircle2 size={16} /> Joined the ACTers!
                </div>
              ) : (
                <button
                  onClick={handleJoin}
                  disabled={loading}
                  className="flex items-center gap-2.5 bg-white hover:bg-gray-50 rounded-xl px-5 py-2.5 font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm shadow-sm transition-colors disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    /* star+person icon */
                    <svg viewBox="0 0 36 24" className="w-[26px] h-[18px]">
                      <polygon points="9,2 11.2,8.2 18,8.2 12.6,11.8 14.8,18 9,14.4 3.2,18 5.4,11.8 0,8.2 6.8,8.2" fill="#23297e" />
                      <circle cx="27" cy="7" r="4" fill="#23297e" />
                      <path d="M35 21a8 8 0 00-16 0h16z" fill="#23297e" />
                    </svg>
                  )}
                  {approval ? "Join the ACTers…" : "Sign in to join…"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function Cbox({ checked, onChange, small }: { checked: boolean; onChange: (v: boolean) => void; small?: boolean }) {
  const sz = small ? "w-3 h-3" : "w-4 h-4";
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`shrink-0 border-2 border-white rounded flex items-center justify-center cursor-pointer transition-colors ${sz} ${checked ? "bg-[#23297e]" : "bg-transparent"}`}
    >
      {checked && <Check size={small ? 7 : 10} className="text-white" strokeWidth={3} />}
    </div>
  );
}

function CheckRow({ label, icon, checked, onChange, children }: {
  label: string; icon?: React.ReactNode;
  checked: boolean; onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <Cbox checked={checked} onChange={onChange} />
        <span className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-sm flex items-center gap-1.5">
          {label} {icon}
        </span>
      </label>
      {children && <div className="ml-6 mt-1.5">{children}</div>}
    </div>
  );
}

function FreqRow({ selected, onToggle }: { selected: Set<string>; onToggle: (f: NotifFreq) => void }) {
  const opts: { key: NotifFreq; label: string }[] = [
    { key: "immediate", label: "As Matches Arrive" },
    { key: "daily",     label: "Daily" },
    { key: "weekly",    label: "Weekly" },
  ];
  return (
    <div className="flex flex-wrap gap-4">
      {opts.map(({ key, label }) => (
        <label key={key} className="flex items-center gap-1.5 cursor-pointer">
          <Cbox small checked={selected.has(key)} onChange={() => onToggle(key)} />
          <span className="font-['Poppins',sans-serif] text-[12px] text-white">{label}</span>
        </label>
      ))}
    </div>
  );
}
