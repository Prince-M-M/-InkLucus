import { periodFor, type Period } from "./homepage";

const DAY = 86_400_000;

export const REPORT_PERIODS = [
  ["fortnight", "This two-week period"],
  ["lastFortnight", "Last two-week period"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["ytd", "This year"],
  ["all", "All time"],
] as const;
export type ReportPeriodKey = (typeof REPORT_PERIODS)[number][0];

export function reportPeriod(key: string | undefined, now = new Date()): { key: ReportPeriodKey; label: string } & Period {
  const k = (REPORT_PERIODS.find(([x]) => x === key)?.[0] ?? "30d") as ReportPeriodKey;
  const label = REPORT_PERIODS.find(([x]) => x === k)![1];
  const end = new Date(now.getTime() + 1);
  switch (k) {
    case "fortnight": return { key: k, label, ...periodFor(now) };
    case "lastFortnight": { const cur = periodFor(now); return { key: k, label, ...periodFor(new Date(cur.start.getTime() - 1)) }; }
    case "90d": return { key: k, label, start: new Date(now.getTime() - 90 * DAY), end };
    case "ytd": return { key: k, label, start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), end };
    case "all": return { key: k, label, start: new Date(0), end };
    default: return { key: k, label, start: new Date(now.getTime() - 30 * DAY), end };
  }
}
