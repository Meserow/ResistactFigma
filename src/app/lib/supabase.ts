import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "/utils/supabase/info";

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
