import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "/utils/supabase/info";

// Snapshot of an email-link callback in the URL hash, taken BEFORE createClient
// runs. auth-js clears window.location.hash once it has exchanged the tokens,
// and it announces a password-reset link with a PASSWORD_RECOVERY event fired
// from a timer after a network round-trip — late enough that a listener can
// miss it. App reads this so the "choose a new password" screen can't be
// skipped. `linkExpired` is Supabase's code for a used or expired email link.
function readAuthLinkHash() {
  if (typeof window === "undefined") return { recovery: false, linkExpired: false };
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    recovery: p.get("type") === "recovery" && !!p.get("access_token"),
    linkExpired: p.get("error_code") === "otp_expired",
  };
}
export const authLinkAtLoad = readAuthLinkHash();

// Singleton Supabase client for frontend auth.
//
// flowType: 'implicit' — we deliberately avoid PKCE here. PKCE inserts an
// async crypto.subtle.digest() call between the user's click on the Google
// sign-in button and the cross-origin redirect to Supabase's authorize
// endpoint. Safari (macOS + iOS) drops the user-gesture token across that
// async hop intermittently, which surfaces as "the first click does nothing,
// only the second works." Implicit flow constructs the redirect URL
// synchronously, so the navigation fires within the original gesture.
// Tradeoff: the OAuth access token briefly appears in the URL fragment on
// callback. Acceptable for this site's risk profile.
export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      flowType: "implicit",
    },
  }
);

// Whether auth-js rejected the reset link it found at load (stale, already
// used, offline). getSession waits for auth-js to finish with the URL, and the
// hash is cleared only on success, so tokens still present mean rejection.
// Computed once here — before App strips the hash — so App and the
// set-password form read the same answer and the form never updates the
// password on some other session that's already signed in.
export const recoveryLinkRejected: Promise<boolean> = authLinkAtLoad.recovery
  ? supabase.auth.getSession()
      .then(() => /(^#|&)access_token=/.test(window.location.hash))
      .catch(() => true) // fail closed: show "expired" rather than act on an unknown session
  : Promise.resolve(false);

export type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];

export interface UserApproval {
  userId: string;
  email: string;
  name: string;
  avatar?: string | null;
  status: "pending" | "approved" | "rejected";
  isAdmin: boolean;
  provider: string;
  createdAt: string;
  approvedAt?: string;
  /** Total "I did this" completions — populated by the /admin/users endpoint
   *  for the admin panel. Undefined elsewhere. */
  totalActions?: number;
  /** ISO timestamp of the user's most recent completion. Null if they've
   *  never marked anything done. Populated by /admin/users. */
  lastActiveAt?: string | null;
  /** Whether the user opted in to receive emails at registration. */
  emailConsent?: boolean | null;
}
