import type { LaunchStats } from "../adapters/types.js";
import type { Finding } from "./model.js";

// Launch-health thresholds. These are widely used industry rules of thumb, not platform limits,
// and they're stated in every finding so a team can judge them. Gmail's bulk-sender guidance asks
// senders to stay under a 0.3% spam rate and ideally under 0.1%.
export const THRESHOLDS = {
  bounce: { warn: 0.02, fail: 0.05 },
  unsubscribe: { warn: 0.005, fail: 0.01 },
  spam: { warn: 0.001, fail: 0.003 },
  delivery: { warn: 0.95 },
};

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export function evaluateHealth(s: LaunchStats): {
  verdict: "healthy" | "watch" | "act now" | "no data";
  findings: Finding[];
  rates: Record<string, string>;
} {
  const findings: Finding[] = [];
  const rates: Record<string, string> = {};
  if (!s.sent) {
    return {
      verdict: "no data",
      findings: [
        {
          checkId: "launch.no-sends",
          severity: "warn",
          message: `Nothing has been sent in the ${s.period}. If this should be live, check the schedule, the audience size and that it's switched on.`,
        },
      ],
      rates,
    };
  }
  const base = s.delivered && s.delivered > 0 ? s.delivered : s.sent;
  const rate = (n: number | undefined, d: number) => (n === undefined ? undefined : n / d);

  const checks: [string, number | undefined, { warn: number; fail?: number }, string][] = [
    ["bounce", rate(s.bounces, s.sent), THRESHOLDS.bounce, "Bounce rate"],
    ["unsubscribe", rate(s.unsubscribes, base), THRESHOLDS.unsubscribe, "Unsubscribe rate"],
    ["spam", rate(s.spamReports, base), THRESHOLDS.spam, "Spam complaint rate"],
  ];
  for (const [key, r, t, label] of checks) {
    if (r === undefined) continue;
    rates[key] = pct(r);
    if (t.fail !== undefined && r >= t.fail) {
      findings.push({ checkId: `launch.${key}-high`, severity: "fail", message: `${label} is ${pct(r)} (act above ${pct(t.fail)}).` });
    } else if (r >= t.warn) {
      findings.push({ checkId: `launch.${key}-high`, severity: "warn", message: `${label} is ${pct(r)} (watch above ${pct(t.warn)}).` });
    }
  }
  if (s.delivered !== undefined) {
    const d = s.delivered / s.sent;
    rates.delivery = pct(d);
    if (d < THRESHOLDS.delivery.warn)
      findings.push({
        checkId: "launch.delivery-low",
        severity: "warn",
        message: `Only ${pct(d)} of sends were delivered (watch below ${pct(THRESHOLDS.delivery.warn)}).`,
      });
  }
  if (s.uniqueOpens !== undefined) rates.uniqueOpen = pct(s.uniqueOpens / base);
  if (s.uniqueClicks !== undefined) rates.uniqueClick = pct(s.uniqueClicks / base);

  const verdict = findings.some((f) => f.severity === "fail") ? "act now" : findings.length ? "watch" : "healthy";
  return { verdict, findings, rates };
}
