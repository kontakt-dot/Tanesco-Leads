/** Zeitraum-Filter: Kurzwahl („heute“, „gestern“, „7“, „30“) oder von/bis als JJJJ-MM-TT (deutsche Zeit, bis einschließlich). */
export type CallPeriod = { period?: "heute" | "gestern" | "7" | "30" | "alle" | null; from?: string | null; to?: string | null };
function berlinDayStart(day: string): Date { const [y, m, d] = day.split("-").map(Number); const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); const offsetMinutes = (new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Berlin" })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60_000; return new Date(guess.getTime() - offsetMinutes * 60_000); }
export function callPeriodRange(input: CallPeriod | undefined, now = new Date()): { from: Date | null; to: Date | null } {
  if (!input) return { from: null, to: null };
  const today = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }); const dayMs = 86_400_000;
  if (input.from || input.to) { const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? berlinDayStart(input.from) : null; const to = input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? new Date(berlinDayStart(input.to).getTime() + dayMs) : null; return { from, to }; }
  const start = berlinDayStart(today);
  if (input.period === "heute") return { from: start, to: null };
  if (input.period === "gestern") return { from: new Date(start.getTime() - dayMs), to: start };
  if (input.period === "7") return { from: new Date(start.getTime() - 6 * dayMs), to: null };
  if (input.period === "30") return { from: new Date(start.getTime() - 29 * dayMs), to: null };
  return { from: null, to: null };
}
