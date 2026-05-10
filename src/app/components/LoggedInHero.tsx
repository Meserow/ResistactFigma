import { useEffect, useState } from "react";
import { HeroPills } from "./HeroPills";

interface LoggedInHeroProps {
  userId: string;
  name: string;
  newActionsToday: number;
  onMatchClick?: () => void;
  onAskClick?: () => void;
}

interface StreakState {
  count: number;
  lastVisit: string;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aDate = Date.UTC(ay, am - 1, ad);
  const bDate = Date.UTC(by, bm - 1, bd);
  return Math.round((bDate - aDate) / 86_400_000);
}

function readStreak(userId: string): StreakState | null {
  try {
    const raw = localStorage.getItem(`resistact_streak_${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.count === "number" && typeof parsed?.lastVisit === "string") return parsed;
  } catch {}
  return null;
}

function writeStreak(userId: string, s: StreakState) {
  try {
    localStorage.setItem(`resistact_streak_${userId}`, JSON.stringify(s));
  } catch {}
}

export function LoggedInHero({ userId, name, newActionsToday, onMatchClick, onAskClick }: LoggedInHeroProps) {
  const [streak, setStreak] = useState(1);
  const [isFirstVisit, setIsFirstVisit] = useState(false);

  useEffect(() => {
    const today = todayKey();
    const prev = readStreak(userId);
    let next: StreakState;
    if (!prev) {
      next = { count: 1, lastVisit: today };
      setIsFirstVisit(true);
    } else if (prev.lastVisit === today) {
      next = prev;
    } else {
      const gap = daysBetween(prev.lastVisit, today);
      next = gap === 1 ? { count: prev.count + 1, lastVisit: today } : { count: 1, lastVisit: today };
    }
    writeStreak(userId, next);
    setStreak(next.count);
  }, [userId]);

  const firstName = name.split(/\s+/)[0] || name;
  const greeting = isFirstVisit ? "Welcome" : "Welcome back";
  const subline =
    newActionsToday > 0
      ? `${newActionsToday} new action${newActionsToday === 1 ? "" : "s"} today.`
      : "";

  return (
    <div className="bg-gradient-to-b from-white to-[#faf6f0] border-b border-[#f0e8de]">
      <div className="max-w-[880px] mx-auto px-5 py-6 text-center">
        <p className="font-['Poppins',sans-serif] text-[#23297e] text-[20px] md:text-[24px] font-bold leading-[1.2] m-0">
          {greeting}, {firstName}.{" "}
          <em className="italic font-semibold text-[#fd8e33]">Day {streak}.</em>
        </p>
        <p className="mt-1 font-['Poppins',sans-serif] text-sm text-gray-600 m-0">
          {subline}{" "}
          <strong className="font-bold text-[#23297e]">Pick one. <span className="text-[#fd8e33]">Do it.</span> Share it.</strong>{" "}
          <em className="italic text-gray-600">Come back tomorrow.</em>
        </p>

        <div className="mt-4">
          <HeroPills onMatchClick={onMatchClick} onAskClick={onAskClick} />
        </div>
      </div>
    </div>
  );
}
