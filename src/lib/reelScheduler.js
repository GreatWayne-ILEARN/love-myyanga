/**
 * Client-side reel schedule runner — invokes sendReelNow when member schedule is due.
 * Runs while the app is open (SPA). Schedule prefs sync to localStorage via reelStore.
 * Server cron can be added later via profiles.notification_list + edge worker.
 */
import { loadReelPrefs, saveReelPrefs, loadReelInbox } from "./reelStore.js";
import { sendReelNow } from "./reelEngine.js";

const DAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const TICK_MS = 60_000;
let timer = null;
let running = false;

function parseHm(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}

function minutesNow(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function dayId(d) {
  return DAY_IDS[d.getDay()];
}

function inQuietHours(now, sched) {
  const start = parseHm(sched.quiet_start || "22:00");
  const end = parseHm(sched.quiet_end || "07:00");
  const cur = minutesNow(now);
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}

function minDaysBetween(frequency) {
  if (frequency === "daily") return 1;
  if (frequency === "biweekly") return 14;
  return 7;
}

/** True when schedule window matches and frequency interval elapsed. */
export function isScheduleDue(prefs, now = new Date()) {
  const sched = prefs.schedule || {};
  if (inQuietHours(now, sched)) return false;

  const days = sched.days || ["fri", "sat"];
  if (!days.includes(dayId(now))) return false;

  const target = parseHm(sched.time_local || "18:00");
  const cur = minutesNow(now);
  // Deliver from scheduled minute through 30 minutes after (tolerates tab sleep / missed ticks)
  if (cur < target || cur > target + 30) return false;

  const last = prefs.lastScheduledDelivery;
  if (last) {
    const elapsedDays = (now.getTime() - new Date(last).getTime()) / 86_400_000;
    if (elapsedDays < minDaysBetween(sched.frequency || "weekly") - 0.05) return false;
  }

  return true;
}

/** Deliver once when member saves schedule and inbox is empty (immediate proof of life). */
export async function deliverWelcomeReelIfNeeded() {
  const prefs = loadReelPrefs();
  if (loadReelInbox().length > 0) return null;
  const { reel, results } = await sendReelNow({ title: "Welcome to MyYanga Reels" });
  saveReelPrefs({ lastScheduledDelivery: new Date().toISOString(), welcomeDelivered: true });
  return { reel, results, welcome: true };
}

export async function runScheduledReelDelivery() {
  if (running) return null;
  const prefs = loadReelPrefs();
  if (!isScheduleDue(prefs)) return null;

  running = true;
  try {
    const { reel, results } = await sendReelNow({ title: "Your scheduled MyYanga reel" });
    saveReelPrefs({ lastScheduledDelivery: new Date().toISOString() });
    if (typeof window !== "undefined") {
      window.__toast?.(`Scheduled reel delivered (${reel.panes?.length || 0} looks)`);
    }
    return { reel, results };
  } catch (e) {
    console.error("[reelScheduler] delivery failed", e);
    return null;
  } finally {
    running = false;
  }
}

export function startReelScheduler() {
  if (typeof window === "undefined") return;
  if (timer) return;

  const tick = () => runScheduledReelDelivery().catch(() => {});
  tick();
  timer = window.setInterval(tick, TICK_MS);
}

export function stopReelScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
