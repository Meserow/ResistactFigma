/**
 * AdminUserDetail — drawer that shows everything an admin would want to know
 * about a single user: who they are, what tier they're at, how their activity
 * breaks down by category, and a reverse-chronological timeline of their most
 * recent actions.
 *
 * Backed by GET /admin/users/:id/activity which returns the user's approval
 * record + completion totals + 50-action timeline (with each action's title
 * resolved server-side).
 */
import { useEffect, useState } from "react";
import { X, Loader2, ExternalLink } from "lucide-react";
import { projectId } from "/utils/supabase/info";
import type { UserApproval } from "../lib/supabase";
import { getUserTier, TIERS } from "../lib/tiers";
import { TierIcon } from "./TierBadge";
import { UserAvatar } from "./UserAvatar";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-9eb1ae04`;

interface TimelineItem {
  actionId: number;
  category: string;
  completedAt: string;
  title: string;
  targetUrl?: string | null;
}

interface ActivityResponse {
  user: UserApproval;
  total: number;
  byCategory: Record<string, number>;
  completedIds: number[];
  lastActiveAt: string | null;
  timeline: TimelineItem[];
}

interface AdminUserDetailProps {
  userId: string;
  accessToken: string;
  onClose: () => void;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000)              return "just now";
  if (diffMs < 3600_000)            return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000)          return `${Math.floor(diffMs / 3600_000)}h ago`;
  if (diffMs < 7 * 86_400_000)      return `${Math.floor(diffMs / 86_400_000)}d ago`;
  if (diffMs < 30 * 86_400_000)     return `${Math.floor(diffMs / (7 * 86_400_000))}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AdminUserDetail({ userId, accessToken, onClose }: AdminUserDetailProps) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API}/admin/users/${userId}/activity`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(body.error ?? "Failed to load activity."); return; }
        setData(body);
      } catch {
        if (!cancelled) setError("Network error loading activity.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, accessToken]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tierInfo = data ? getUserTier(data.total) : null;

  // Sorted category breakdown — largest first for quick scanning.
  const categoryBreakdown = data
    ? Object.entries(data.byCategory).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60] flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="User dashboard"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold">User dashboard</p>
            <h2 className="font-['Poppins',sans-serif] font-bold text-[#23297e] text-lg leading-tight mt-0.5 truncate">
              {data?.user?.name ?? "Loading…"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[#23297e]" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="font-['Poppins',sans-serif] text-sm text-red-500">{error}</p>
          </div>
        ) : !data ? null : (
          <>
            {/* Identity row */}
            <div className="px-5 py-4 flex items-center gap-4 border-b border-gray-100">
              <UserAvatar
                name={data.user.name}
                avatar={data.user.avatar}
                sizeClasses="w-14 h-14"
              />
              <div className="flex-1 min-w-0">
                <p className="font-['Poppins',sans-serif] text-sm text-gray-700 truncate">{data.user.email}</p>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500 font-['Poppins',sans-serif] flex-wrap">
                  <span className="font-semibold uppercase">{data.user.status}</span>
                  {data.user.isAdmin && <><span className="text-gray-300">·</span><span className="font-bold text-[#23297e]">Admin</span></>}
                  <span className="text-gray-300">·</span>
                  <span>joined {new Date(data.user.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                </div>
              </div>
            </div>

            {/* Tier + total — the headline numbers */}
            {tierInfo && (
              <div className="px-5 py-5 border-b border-gray-100">
                <div className="flex items-center gap-4">
                  <div
                    className="flex items-center justify-center w-16 h-16 rounded-full shrink-0"
                    style={{
                      background: tierInfo.tier.color,
                      boxShadow: `0 0 0 4px white, 0 6px 18px ${tierInfo.tier.glowColor}66`,
                    }}
                  >
                    <TierIcon tier={tierInfo.tier} size={32} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="font-['Poppins',sans-serif] font-extrabold text-3xl tabular-nums" style={{ color: tierInfo.tier.color }}>
                        {data.total}
                      </p>
                      <p className="font-['Poppins',sans-serif] text-sm text-gray-500">
                        action{data.total === 1 ? "" : "s"} · <strong style={{ color: tierInfo.tier.color }}>{tierInfo.tier.name}</strong>
                      </p>
                    </div>
                    <p className="font-['Poppins',sans-serif] text-xs text-gray-500 mt-0.5">
                      {data.lastActiveAt
                        ? <>Last active <strong>{formatRelative(data.lastActiveAt)}</strong></>
                        : <>Never marked an action done</>}
                    </p>
                    {/* Tier ladder progress */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] font-['Poppins',sans-serif] uppercase tracking-wider font-semibold mb-1">
                        <span style={{ color: tierInfo.tier.color }}>{tierInfo.tier.name}</span>
                        <span className="text-gray-400">{tierInfo.nextTier?.name ?? "Top tier"}</span>
                      </div>
                      <div className="relative h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${tierInfo.progressPct}%`,
                            background: `linear-gradient(90deg, ${tierInfo.tier.color}, ${tierInfo.nextTier?.color ?? tierInfo.tier.color})`,
                          }}
                        />
                      </div>
                      {tierInfo.actionsToNext != null && tierInfo.nextTier && (
                        <p className="font-['Poppins',sans-serif] text-[10px] text-gray-500 mt-1">
                          {tierInfo.actionsToNext} more to {tierInfo.nextTier.name}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Category breakdown */}
            {categoryBreakdown.length > 0 && (
              <div className="px-5 py-4 border-b border-gray-100">
                <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">By category</p>
                <div className="flex flex-wrap gap-1.5">
                  {categoryBreakdown.map(([cat, count]) => (
                    <span
                      key={cat}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-50 border border-gray-100 font-['Poppins',sans-serif] text-[11px] text-gray-700"
                    >
                      <span className="font-semibold">{cat}</span>
                      <span className="font-bold text-[#23297e]">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Activity timeline — last 50 completions, newest first */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-['Poppins',sans-serif] text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Recent activity</p>
                {data.timeline.length > 0 && (
                  <p className="font-['Poppins',sans-serif] text-[10px] text-gray-400">
                    showing last {data.timeline.length}
                  </p>
                )}
              </div>
              {data.timeline.length === 0 ? (
                <p className="font-['Poppins',sans-serif] text-sm text-gray-400 italic py-4 text-center">
                  No activity yet.
                </p>
              ) : (
                <ul className="divide-y divide-gray-50 max-h-80 overflow-y-auto -mx-5">
                  {data.timeline.map((item) => (
                    <li key={`${item.actionId}-${item.completedAt}`} className="px-5 py-2.5 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-['Poppins',sans-serif] font-semibold text-sm text-gray-800 truncate">
                          {item.title}
                        </p>
                        <p className="font-['Poppins',sans-serif] text-[11px] text-gray-500 mt-0.5">
                          {item.category} · {formatRelative(item.completedAt)}
                        </p>
                      </div>
                      {item.targetUrl && (
                        <a
                          href={item.targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 mt-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-[#23297e]"
                          aria-label="Open action"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
