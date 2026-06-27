/** CN listed banks publish prior-calendar-year annual reports mostly by end of April. */
export const CN_BANK_ANNUAL_REPORT_READY_MONTH = 4;

export function parseFunnelQuarter(quarter: string): { year: number; q: number } {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) {
    throw new Error(`Invalid funnel quarter: ${quarter}`);
  }
  return {
    year: Number.parseInt(match[1]!, 10),
    q: Number.parseInt(match[2]!, 10),
  };
}

/**
 * Latest bank disclosure fiscal year available for a funnel run.
 *
 * Uses both the funnel quarter and wall-clock `now`:
 * - Quarter YYYY-Qn implies screening through that quarter; latest complete FY is YYYY - 1.
 * - Before April, FY (calYear - 1) may still be publishing — use calYear - 2.
 * - From April onward, FY (calYear - 1) is the latest published cycle.
 *
 * Returns min(quarterImplied, nowImplied) so historical quarter reruns never scrape future FYs.
 */
export function deriveBankDisclosureFiscalYear(
  quarter: string,
  now: Date = new Date()
): number {
  const { year: quarterYear } = parseFunnelQuarter(quarter);
  const fromQuarter = quarterYear - 1;

  const calYear = now.getFullYear();
  const month = now.getMonth() + 1;
  const fromNow =
    month >= CN_BANK_ANNUAL_REPORT_READY_MONTH ? calYear - 1 : calYear - 2;

  return Math.min(fromQuarter, fromNow);
}
