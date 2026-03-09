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
}
