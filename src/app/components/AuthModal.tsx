import { useEffect, useRef, useState } from "react";
import { X, Eye, EyeOff, Loader2, CheckCircle2, Clock, Flame, Mail, Zap, ArrowRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

function Turnstile({ onToken }: { onToken: (t: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        "error-callback": () => onTokenRef.current(null),
        "expired-callback": () => onTokenRef.current(null),
      });
    };
    if (window.turnstile) {
      render();
    } else {
      const SCRIPT_ID = "cf-turnstile-script";
      let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (!script) {
        script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
      }
    };
  }, []);

  return <div ref={containerRef} className="flex justify-center" />;
}

interface AuthModalProps {
  onClose: () => void;
  onApproval: (approval: UserApproval) => void;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function AuthModal({ onClose, onApproval }: AuthModalProps) {
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postRegState, setPostRegState] = useState<"verify-email" | "pending" | "approved" | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [pendingSignUp, setPendingSignUp] = useState(false);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [emailConsent, setEmailConsent] = useState(false);

  const resetCaptcha = () => { setCaptchaToken(null); setCaptchaKey(k => k + 1); };

  async function fetchApproval(accessToken: string): Promise<UserApproval | null> {
    try {
      const res = await fetch(`${API}/auth/status`, {
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not verify account status."); return null; }
      return data.approval as UserApproval;
    } catch {
      setError("Network error checking account status.");
      return null;
    }
  }

  // ── Step 1: Continue with email ──────────────────────────────────────────
  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setStep("password");
  }

  // ── Step 2: Smart sign-in / sign-up ─────────────────────────────────────
  // Try sign-in first. If "Invalid login credentials" and a name was
  // provided, treat this as a new user and attempt sign-up instead.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (TURNSTILE_SITE_KEY && !captchaToken) { setError("Please complete the CAPTCHA."); return; }
    setLoading(true);
    try {
      // Attempt sign-in first
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captchaToken ? { captchaToken } : undefined,
      });

      if (!signInErr) {
        const approval = await fetchApproval(signInData.session!.access_token);
        if (approval) { onApproval(approval); onClose(); }
        return;
      }

      const isCredErr = signInErr.message.toLowerCase().includes("invalid login credentials");

      // Credentials wrong AND name provided → sign-up, but require a deliberate
      // second submit so autofill or typos don't silently trigger account creation.
      if (isCredErr && name.trim()) {
        if (!pendingSignUp) {
          setPendingSignUp(true);
          setError("Incorrect password. If you're new here, click Continue again to create your account.");
          resetCaptcha();
          return;
        }
        // Second submit — user confirmed they want to sign up.
        if (password.length < 6) { setError("Password must be at least 6 characters."); resetCaptcha(); return; }
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: name.trim(), full_name: name.trim(), emailConsent },
            emailRedirectTo: window.location.origin,
            ...(captchaToken ? { captchaToken } : {}),
          },
        });
        if (signUpErr) { setError(signUpErr.message); resetCaptcha(); return; }
        setPendingSignUp(false);
        if (signUpData.session) {
          onClose();
        } else {
          setPostRegState("verify-email");
        }
        return;
      }

      // Credentials wrong, no name → nudge them to fill in name if new
      if (isCredErr) {
        setError("Incorrect password. New here? Enter your name above to create your account.");
      } else {
        setError(signInErr.message);
      }
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  }

  // ── OAuth ────────────────────────────────────────────────────────────────
  async function handleOAuth(provider: "google") {
    setOauthLoading(provider);
    setError(null);
    try {
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (oauthErr) setError(oauthErr.message);
    } finally {
      setOauthLoading(null);
    }
  }

  // ── Post-register screens ────────────────────────────────────────────────
  if (postRegState === "verify-email") {
    return (
      <Backdrop onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-4 px-2 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
            <Mail size={32} className="text-[#23297e]" />
          </div>
          <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-xl">Check your email</h2>
          <p className="font-['Poppins',sans-serif] text-gray-500 text-sm leading-relaxed max-w-xs">
            We sent a confirmation link to <span className="font-semibold text-gray-700">{email}</span>. Click it to finish creating your account, then come back here to sign in.
          </p>
          <button onClick={onClose} className="mt-2 px-8 py-2.5 bg-[#23297e] text-white rounded-xl font-['Poppins',sans-serif] font-semibold text-sm hover:bg-[#1a2060] transition-colors">
            Got it
          </button>
        </div>
      </Backdrop>
    );
  }

  if (postRegState === "pending") {
    return (
      <Backdrop onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-4 px-2 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock size={32} className="text-amber-500" />
          </div>
          <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-xl">You're in the queue 🎉</h2>
          <p className="font-['Poppins',sans-serif] text-gray-500 text-sm leading-relaxed max-w-xs">
            Your application is in — we review every founding member personally and will approve you shortly. Browse the full action catalog while you wait.
          </p>
          <button onClick={onClose} className="mt-2 px-8 py-2.5 bg-[#23297e] text-white rounded-xl font-['Poppins',sans-serif] font-semibold text-sm hover:bg-[#1a2060] transition-colors">
            Got it, let me browse
          </button>
        </div>
      </Backdrop>
    );
  }

  if (postRegState === "approved") {
    return (
      <Backdrop onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-4 px-2 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-green-500" />
          </div>
          <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-xl">Welcome to ResistAct!</h2>
          <p className="font-['Poppins',sans-serif] text-gray-500 text-sm">You're all set. Signing you in…</p>
        </div>
      </Backdrop>
    );
  }

  // ── Step 1: Email ────────────────────────────────────────────────────────
  if (step === "email") {
    return (
      <Backdrop onClose={onClose}>
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Flame size={20} className="text-[#fd8e33]" strokeWidth={2.5} />
            <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-[17px] leading-tight">
              Apply for founding access
            </h2>
          </div>
          <p className="font-['Poppins',sans-serif] text-gray-400 text-[13px] leading-snug">
            We're building this with a founding cohort. No tracking, no donation asks, no list you can't escape.
          </p>
        </div>

        {/* Google */}
        <div className="mb-4">
          <button
            onClick={() => handleOAuth("google")}
            disabled={!!oauthLoading}
            className="w-full flex items-center justify-center gap-3 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] font-medium text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            {oauthLoading === "google" ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="font-['Poppins',sans-serif] text-xs text-gray-400">or with email</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        <form onSubmit={handleContinue} className="space-y-3">
          <div>
            <label className="block font-['Poppins',sans-serif] text-sm font-semibold text-gray-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@example.com"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#fd8e33]/30 focus:border-[#fd8e33] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={!email.trim()}
            className="w-full py-3 bg-[#fd8e33] hover:bg-[#d96612] disabled:opacity-50 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-full transition-colors flex items-center justify-center gap-2"
          >
            Continue
            <ArrowRight size={16} />
          </button>
        </form>

        <p className="mt-4 text-center font-['Poppins',sans-serif] text-[13px] text-gray-400">
          Already with us? Click Google or enter your email and{" "}
          <span className="font-bold text-gray-600">we'll recognize you.</span>
        </p>
      </Backdrop>
    );
  }

  // ── Step 2: Password (+ optional name for new users) ────────────────────
  return (
    <Backdrop onClose={onClose}>
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Flame size={20} className="text-[#fd8e33]" strokeWidth={2.5} />
          <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-[22px] leading-tight">
            Join the Resistance
          </h2>
        </div>
        <button
          onClick={() => { setStep("email"); setError(null); }}
          className="font-['Poppins',sans-serif] text-[12px] text-gray-400 hover:text-[#fd8e33] transition-colors flex items-center gap-1"
        >
          ← {email}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Name — optional, only needed for new users */}
        <div>
          <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-500 mb-1">
            Your name <span className="font-normal italic text-gray-400">(new members only)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setPendingSignUp(false); }}
            placeholder="Jane Doe"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#fd8e33]/30 focus:border-[#fd8e33] transition-colors"
          />
        </div>

        {/* Password */}
        <div>
          <label className="block font-['Poppins',sans-serif] text-sm font-semibold text-gray-700 mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setPendingSignUp(false); }}
              required
              autoFocus
              placeholder="••••••••"
              className="w-full px-4 py-3 pr-11 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#fd8e33]/30 focus:border-[#fd8e33] transition-colors"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {TURNSTILE_SITE_KEY && (
          <div className="pt-1">
            <Turnstile key={captchaKey} onToken={setCaptchaToken} />
          </div>
        )}

        {/* Email consent — only shown for new accounts (name filled in) */}
        {name.trim() && (
          <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={emailConsent}
              onChange={e => setEmailConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-[#fd8e33] shrink-0 cursor-pointer"
            />
            <span className="font-['Poppins',sans-serif] text-xs text-gray-500 leading-snug">
              Yes, ResistAct can email me about new actions, updates, and resistance news.{" "}
              <span className="text-gray-400 italic">No spam — unsubscribe anytime.</span>
            </span>
          </label>
        )}

        {error && (
          <p className="font-['Poppins',sans-serif] text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || (!!TURNSTILE_SITE_KEY && !captchaToken)}
          className="w-full py-3 bg-[#fd8e33] hover:bg-[#d96612] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-full transition-colors flex items-center justify-center gap-2 mt-1"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          Continue
          {!loading && <ArrowRight size={16} />}
        </button>
      </form>

      <p className="mt-3 text-center font-['Poppins',sans-serif] text-[11px] text-gray-400 leading-relaxed">
        Returning? Leave the name blank and just enter your password.
      </p>
    </Backdrop>
  );
}

// ─── Backdrop ────────────────────────────────────────────────────────────────
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}
