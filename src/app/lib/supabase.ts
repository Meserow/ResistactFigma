import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "/utils/supabase/info";

// Singleton Supabase client for frontend auth
export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
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
