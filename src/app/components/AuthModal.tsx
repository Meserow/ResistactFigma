import { useState } from "react";
import { X, Eye, EyeOff, Loader2, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "../lib/supabase";
import { projectId, publicAnonKey } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

interface AuthModalProps {
  onClose: () => void;
  onApproval: (approval: UserApproval) => void;
  onDemoLogin?: (approval: UserApproval, fakeToken: string) => void;
}

// ─── Social login icons ───────────────────────────────────────────────────────
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

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function AuthModal({ onClose, onApproval, onDemoLogin }: AuthModalProps) {
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "facebook" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postRegState, setPostRegState] = useState<"pending" | "approved" | null>(null);

  const clearError = () => setError(null);

  // ── Fetch approval status after any successful sign-in ──
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

  // ── Email sign-in ──
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    setLoading(true);
    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) { setError(signInErr.message); return; }
      const approval = await fetchApproval(data.session!.access_token);
      if (approval) { onApproval(approval); onClose(); }
    } finally {
      setLoading(false);
    }
  }

  // ── Email registration ──
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setLoading(true);
    try {
      // Create user server-side (auto email-confirm)
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${publicAnonKey}` },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Registration failed."); return; }

      // Now sign in to get a session
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) { setError(signInErr.message); return; }

      const approval = data.approval as UserApproval;
      setPostRegState(approval.status === "approved" ? "approved" : "pending");
      onApproval(approval);

      if (approval.status === "approved") {
        setTimeout(() => onClose(), 2000);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── OAuth ──
  async function handleOAuth(provider: "google" | "facebook") {
    setOauthLoading(provider);
    clearError();
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

  // ── Post-register state screens ──
  if (postRegState === "pending") {
    return (
      <Backdrop onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-4 px-2 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock size={32} className="text-amber-500" />
          </div>
          <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-xl">Account pending approval</h2>
          <p className="font-['Poppins',sans-serif] text-gray-500 text-sm leading-relaxed max-w-xs">
            Thanks for joining ResistAct! Your account is under review. We'll approve it shortly — browse all current acts while you wait.
          </p>
          <button
            onClick={onClose}
            className="mt-2 px-8 py-2.5 bg-[#23297e] text-white rounded-xl font-['Poppins',sans-serif] font-semibold text-sm hover:bg-[#1a2060] transition-colors"
          >
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

  return (
    <Backdrop onClose={onClose}>
      {/* Tabs */}
      <div className="flex border-b border-gray-100 mb-6 -mx-6 px-6">
        {(["signin", "register"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); clearError(); }}
            className={`flex-1 pb-3 font-['Poppins',sans-serif] font-semibold text-sm transition-colors border-b-2 -mb-px ${
              tab === t
                ? "text-[#23297e] border-[#23297e]"
                : "text-gray-400 border-transparent hover:text-gray-600"
            }`}
          >
            {t === "signin" ? "Sign In" : "Create Account"}
          </button>
        ))}
      </div>

      {/* Social buttons */}
      <div className="space-y-2.5 mb-5">
        <button
          onClick={() => handleOAuth("google")}
          disabled={!!oauthLoading}
          className="w-full flex items-center justify-center gap-3 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] font-medium text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {oauthLoading === "google" ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </button>
        <button
          onClick={() => handleOAuth("facebook")}
          disabled={!!oauthLoading}
          className="w-full flex items-center justify-center gap-3 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] font-medium text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {oauthLoading === "facebook" ? <Loader2 size={18} className="animate-spin" /> : <FacebookIcon />}
          Continue with Facebook
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-px bg-gray-100" />
        <span className="font-['Poppins',sans-serif] text-xs text-gray-400">or with email</span>
        <div className="flex-1 h-px bg-gray-100" />
      </div>

      {/* Form */}
      <form onSubmit={tab === "signin" ? handleSignIn : handleRegister} className="space-y-3">
        {tab === "register" && (
          <div>
            <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-600 mb-1">Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Jane Doe"
              className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]"
            />
          </div>
        )}

        <div>
          <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-600 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]"
          />
        </div>

        <div>
          <label className="block font-['Poppins',sans-serif] text-xs font-semibold text-gray-600 mb-1">Password</label>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 pr-10 border border-gray-200 rounded-xl font-['Poppins',sans-serif] text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#23297e]/30 focus:border-[#23297e]"
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="font-['Poppins',sans-serif] text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-[#fd8e33] hover:bg-[#e07a28] disabled:opacity-60 text-white font-['Poppins',sans-serif] font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 mt-1"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          {tab === "signin" ? "Sign In" : "Create Account"}
        </button>
      </form>

      {tab === "register" && (
        <p className="mt-4 text-center font-['Poppins',sans-serif] text-xs text-gray-400 leading-relaxed">
          New accounts require admin approval before posting. Browsing and reacting is always free.
        </p>
      )}

      {/* ── Demo simulation ── */}
      <div className="mt-5 pt-4 border-t border-dashed border-gray-200">
        <p className="text-center font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-300 mb-2.5 font-semibold">
          Demo / simulation
        </p>
        <button
          type="button"
          onClick={() => {
            const ellenApproval: UserApproval = {
              userId: "sim-ellen-escarcega",
              email: "ellen@meserow.com",
              name: "Ellen Escarcega",
              avatar: null,
              status: "approved",
              isAdmin: true,
              provider: "email",
              createdAt: new Date().toISOString(),
            };
            onDemoLogin?.(ellenApproval, "demo-token-sim");
            onClose();
          }}
          className="w-full py-2.5 border border-dashed border-[#23297e]/40 rounded-xl font-['Poppins',sans-serif] text-xs font-semibold text-[#23297e] hover:bg-[#23297e]/5 transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-base">✊</span>
          Simulate login as Ellen (Admin)
        </button>
      </div>
    </Backdrop>
  );
}

// ─── Shared backdrop wrapper ──────────────────────────────────────────────────
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <h2 className="font-['Poppins',sans-serif] font-bold text-gray-900 text-lg leading-tight">
              Join the Resistance
            </h2>
            <p className="font-['Poppins',sans-serif] text-gray-400 text-xs mt-0.5">
              ResistAct — Grassroots action platform
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-500 shrink-0 ml-3 mt-0.5"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}