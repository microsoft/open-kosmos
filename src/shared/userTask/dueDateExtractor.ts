// ─── Due Date Extraction Utilities ────────────────────────────────────────
//
// Deterministic fallback for extracting due dates from text when LLM fails.
// Used as post-processing for create_user_task tool.

/**
 * Extract a due date from text using regex patterns.
 * Returns YYYY-MM-DD format or null if no date found.
 *
 * Supports:
 * - Explicit dates: "5/30", "May 30", "2026-05-30", "30th May"
 * - Relative days: "by Friday", "next Monday", "this Thursday"
 * - Shorthand: "EOD", "EOD Thursday", "end of day", "by end of week"
 * - Relative periods: "next week", "in 3 days", "tomorrow"
 */
export function extractDueDateFromText(
  text: string,
  referenceDate: Date = new Date()
): string | null {
  if (!text || typeof text !== 'string') return null;

  const normalizedText = text.toLowerCase();

  // 1. Explicit ISO date: YYYY-MM-DD
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const date = new Date(y, m, d);
    if (date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
      return isoMatch[0];
    }
  }

  // 2. Explicit date: MM/DD or M/D (US format)
  const usDateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (usDateMatch) {
    const month = parseInt(usDateMatch[1], 10);
    const day = parseInt(usDateMatch[2], 10);
    let year = usDateMatch[3] ? parseInt(usDateMatch[3], 10) : referenceDate.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      // Reject impossible dates (e.g. 2/31 → Date normalizes to March)
      if (date.getMonth() !== month - 1 || date.getDate() !== day) {
        // fall through to other patterns
      } else {
        // If no explicit year and date is in the past, assume next year
        if (!usDateMatch[3] && date < referenceDate) {
          date.setFullYear(date.getFullYear() + 1);
        }
        return formatDate(date);
      }
    }
  }

  // 3. Explicit date: "May 30", "May 30th", "30th May", "30 May"
  const monthNames: Record<string, number> = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };

  const monthDayMatch = normalizedText.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
  );
  if (monthDayMatch) {
    const month = monthNames[monthDayMatch[1].toLowerCase()];
    const day = parseInt(monthDayMatch[2], 10);
    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(referenceDate.getFullYear(), month, day);
      if (date.getMonth() !== month || date.getDate() !== day) {
        // Invalid date (e.g. Feb 31), skip
      } else {
        // If the date is in the past, assume next year
        if (date < referenceDate) {
          date.setFullYear(date.getFullYear() + 1);
        }
        return formatDate(date);
      }
    }
  }

  const dayMonthMatch = normalizedText.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b/i
  );
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1], 10);
    const month = monthNames[dayMonthMatch[2].toLowerCase()];
    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(referenceDate.getFullYear(), month, day);
      if (date.getMonth() !== month || date.getDate() !== day) {
        // Invalid date, skip
      } else {
        if (date < referenceDate) {
          date.setFullYear(date.getFullYear() + 1);
        }
        return formatDate(date);
      }
    }
  }

  // 4. Day of week: "by Friday", "next Monday", "this Thursday"
  const dayOfWeekNames: Record<string, number> = {
    sunday: 0, sun: 0,
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
  };

  const dayOfWeekMatch = normalizedText.match(
    /\b(by|on|next|this|due|before)\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/i
  );
  if (dayOfWeekMatch) {
    const prefix = dayOfWeekMatch[1].toLowerCase();
    const targetDay = dayOfWeekNames[dayOfWeekMatch[2].toLowerCase()];
    if (targetDay !== undefined) {
      const isNext = prefix === 'next';
      const isThis = prefix === 'this';
      return formatDate(getNextDayOfWeek(referenceDate, targetDay, isNext, isThis));
    }
  }

  // Also match "EOD Thursday" pattern - EOD with a day name
  const eodDayMatch = normalizedText.match(
    /\b(eod|end of day)\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/i
  );
  if (eodDayMatch) {
    const targetDay = dayOfWeekNames[eodDayMatch[2].toLowerCase()];
    if (targetDay !== undefined) {
      // "EOD Thursday" = this Thursday, allow same week
      return formatDate(getNextDayOfWeek(referenceDate, targetDay, false, true));
    }
  }

  // 5. EOD / end of day (today)
  if (/\b(eod|end of day|end-of-day)\b/i.test(normalizedText) && !eodDayMatch) {
    return formatDate(referenceDate);
  }

  // 6. Tomorrow
  if (/\btomorrow\b/i.test(normalizedText)) {
    const tomorrow = new Date(referenceDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }

  // 7. End of week / by end of week
  if (/\b(end of week|by end of week|end-of-week|eow)\b/i.test(normalizedText)) {
    return formatDate(getEndOfWeek(referenceDate));
  }

  // 8. Next week
  if (/\bnext week\b/i.test(normalizedText)) {
    const nextWeek = new Date(referenceDate);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return formatDate(nextWeek);
  }

  // 9. In X days
  const inDaysMatch = normalizedText.match(/\bin\s+(\d+)\s+days?\b/i);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10);
    const future = new Date(referenceDate);
    future.setDate(future.getDate() + days);
    return formatDate(future);
  }

  return null;
}

/**
 * Format a Date object as YYYY-MM-DD string.
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the next occurrence of a specific day of week.
 * - isNext: skip the current week entirely (for "next Monday")
 * - isThis: allow returning a day in the current week even if it's today or in the past
 *           (for "this Thursday" or "EOD Thursday")
 */
function getNextDayOfWeek(
  referenceDate: Date,
  targetDay: number,
  isNext: boolean,
  isThis: boolean = false
): Date {
  const result = new Date(referenceDate);
  const currentDay = result.getDay();
  let daysUntil = targetDay - currentDay;

  if (isThis) {
    // "this Thursday" - if it's still in the future this week, use it
    // If it's today or in the past, we still use this week's day (could be today)
    if (daysUntil < 0) {
      // Day is in the past this week, go to next week
      daysUntil += 7;
    }
    // daysUntil >= 0 means it's today or later this week
  } else if (daysUntil <= 0) {
    // Default: target day is today or in the past this week, go to next week
    daysUntil += 7;
  }

  if (isNext && daysUntil <= 7) {
    // "next Monday" means the Monday after this coming one
    daysUntil += 7;
  }

  result.setDate(result.getDate() + daysUntil);
  return result;
}

/**
 * Get end of current week (Friday).
 */
function getEndOfWeek(referenceDate: Date): Date {
  const result = new Date(referenceDate);
  const currentDay = result.getDay();
  // Friday is day 5
  let daysUntilFriday = 5 - currentDay;
  if (daysUntilFriday < 0) {
    // It's Saturday (6) or Sunday (0), go to next Friday
    daysUntilFriday += 7;
  }
  result.setDate(result.getDate() + daysUntilFriday);
  return result;
}
