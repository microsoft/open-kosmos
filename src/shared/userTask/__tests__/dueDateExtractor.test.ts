import { describe, it, expect } from 'vitest';
import { extractDueDateFromText } from '../dueDateExtractor';

describe('extractDueDateFromText', () => {
  // Use a fixed reference date for predictable tests: Wednesday, May 13, 2026
  const refDate = new Date(2026, 4, 13); // May 13, 2026 (Wednesday)

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(extractDueDateFromText('', refDate)).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(extractDueDateFromText(null as any, refDate)).toBeNull();
      expect(extractDueDateFromText(undefined as any, refDate)).toBeNull();
    });

    it('returns null for text with no date', () => {
      expect(extractDueDateFromText('Review the budget proposal', refDate)).toBeNull();
      expect(extractDueDateFromText('Send email to team', refDate)).toBeNull();
    });
  });

  describe('ISO date format (YYYY-MM-DD)', () => {
    it('extracts ISO date', () => {
      expect(extractDueDateFromText('Due 2026-05-30', refDate)).toBe('2026-05-30');
      expect(extractDueDateFromText('Meeting on 2026-12-25', refDate)).toBe('2026-12-25');
    });

    it('extracts ISO date embedded in text', () => {
      expect(extractDueDateFromText('The deadline is 2026-06-15 for this task', refDate)).toBe('2026-06-15');
    });

    it('rejects impossible ISO dates', () => {
      expect(extractDueDateFromText('due 2026-02-31', refDate)).toBeNull();
      expect(extractDueDateFromText('due 2026-13-01', refDate)).toBeNull();
      expect(extractDueDateFromText('due 2026-04-31', refDate)).toBeNull();
    });
  });

  describe('US date format (MM/DD or M/D)', () => {
    it('extracts MM/DD format', () => {
      expect(extractDueDateFromText('due 5/30', refDate)).toBe('2026-05-30');
      expect(extractDueDateFromText('by 12/25', refDate)).toBe('2026-12-25');
    });

    it('extracts MM/DD/YYYY format', () => {
      expect(extractDueDateFromText('due 5/30/2026', refDate)).toBe('2026-05-30');
      expect(extractDueDateFromText('by 12/25/27', refDate)).toBe('2027-12-25');
    });

    it('handles single digit month/day', () => {
      // Jan 5 is before May 13 (refDate), so rolls to next year
      expect(extractDueDateFromText('by 1/5', refDate)).toBe('2027-01-05');
    });

    it('rolls past M/D dates to next year', () => {
      // March 1 is before May 13
      expect(extractDueDateFromText('due 3/1', refDate)).toBe('2027-03-01');
      // Dec 25 is after May 13, stays this year
      expect(extractDueDateFromText('due 12/25', refDate)).toBe('2026-12-25');
    });

    it('does not roll forward when explicit year is given', () => {
      expect(extractDueDateFromText('due 1/5/2026', refDate)).toBe('2026-01-05');
    });

    it('rejects impossible dates like 2/31', () => {
      expect(extractDueDateFromText('due 2/31', refDate)).toBeNull();
    });

    it('rejects impossible dates like 4/31', () => {
      expect(extractDueDateFromText('due 4/31', refDate)).toBeNull();
    });
  });

  describe('month name formats', () => {
    it('extracts "Month Day" format', () => {
      expect(extractDueDateFromText('due May 30', refDate)).toBe('2026-05-30');
      expect(extractDueDateFromText('by December 25', refDate)).toBe('2026-12-25');
    });

    it('extracts abbreviated month names', () => {
      expect(extractDueDateFromText('due Jan 15', refDate)).toBe('2027-01-15'); // next year since Jan < May
      expect(extractDueDateFromText('by Dec 1', refDate)).toBe('2026-12-01');
    });

    it('extracts "Month Dayth" format with ordinal suffix', () => {
      expect(extractDueDateFromText('due May 30th', refDate)).toBe('2026-05-30');
      expect(extractDueDateFromText('by June 1st', refDate)).toBe('2026-06-01');
      expect(extractDueDateFromText('on July 2nd', refDate)).toBe('2026-07-02');
      expect(extractDueDateFromText('by August 3rd', refDate)).toBe('2026-08-03');
    });

    it('extracts "Day Month" format', () => {
      expect(extractDueDateFromText('due 30th May', refDate)).toBe('2026-05-30');
      expect(extractDueDateFromText('by 25 December', refDate)).toBe('2026-12-25');
    });

    it('handles past dates by assuming next year', () => {
      // May 1 is before May 14 (refDate), so it should be next year
      expect(extractDueDateFromText('due May 1', refDate)).toBe('2027-05-01');
      // January is before May, so next year
      expect(extractDueDateFromText('due January 10', refDate)).toBe('2027-01-10');
    });

    it('rejects impossible month-name dates like Feb 30', () => {
      expect(extractDueDateFromText('due Feb 30', refDate)).toBeNull();
    });
  });

  describe('day of week patterns', () => {
    it('extracts "by Friday" (same week)', () => {
      // Wednesday May 13 -> Friday May 15
      expect(extractDueDateFromText('by Friday', refDate)).toBe('2026-05-15');
    });

    it('extracts "by Monday" (next week since Monday < Wednesday)', () => {
      // Wednesday May 13 -> Monday May 18 (skips to next week)
      expect(extractDueDateFromText('by Monday', refDate)).toBe('2026-05-18');
    });

    it('extracts "next Friday"', () => {
      // Wednesday May 13 -> next Friday May 22 (skips this Friday May 15)
      expect(extractDueDateFromText('next Friday', refDate)).toBe('2026-05-22');
    });

    it('extracts "this Thursday"', () => {
      // Wednesday May 13 -> Thursday May 14
      expect(extractDueDateFromText('this Thursday', refDate)).toBe('2026-05-14');
    });

    it('extracts abbreviated day names', () => {
      expect(extractDueDateFromText('by Fri', refDate)).toBe('2026-05-15');
      expect(extractDueDateFromText('by Mon', refDate)).toBe('2026-05-18');
    });

    it('extracts "due Tuesday"', () => {
      // Wednesday May 13 -> Tuesday May 19
      expect(extractDueDateFromText('due Tuesday', refDate)).toBe('2026-05-19');
    });
  });

  describe('EOD patterns', () => {
    it('extracts "EOD" as today', () => {
      expect(extractDueDateFromText('Need this EOD', refDate)).toBe('2026-05-13');
    });

    it('extracts "end of day" as today', () => {
      expect(extractDueDateFromText('Finish by end of day', refDate)).toBe('2026-05-13');
    });

    it('extracts "EOD Thursday"', () => {
      // Wednesday May 13 -> Thursday May 14
      expect(extractDueDateFromText('EOD Thursday', refDate)).toBe('2026-05-14');
    });

    it('extracts "EOD Friday"', () => {
      expect(extractDueDateFromText('complete EOD Friday', refDate)).toBe('2026-05-15');
    });
  });

  describe('relative time patterns', () => {
    it('extracts "tomorrow"', () => {
      expect(extractDueDateFromText('due tomorrow', refDate)).toBe('2026-05-14');
    });

    it('extracts "end of week" as Friday', () => {
      expect(extractDueDateFromText('by end of week', refDate)).toBe('2026-05-15');
    });

    it('extracts "next week"', () => {
      expect(extractDueDateFromText('finish next week', refDate)).toBe('2026-05-20');
    });

    it('extracts "in X days"', () => {
      expect(extractDueDateFromText('complete in 3 days', refDate)).toBe('2026-05-16');
      expect(extractDueDateFromText('due in 7 days', refDate)).toBe('2026-05-20');
      expect(extractDueDateFromText('in 1 day', refDate)).toBe('2026-05-14');
    });
  });

  describe('real-world examples from #695', () => {
    it('extracts deadline from Teams message context', () => {
      const text = 'Follow up with Bo on budget review - he needs the numbers by Friday';
      expect(extractDueDateFromText(text, refDate)).toBe('2026-05-15');
    });

    it('extracts deadline from email context', () => {
      const text = 'Review Q3 proposal — Alice mentioned it\'s due 5/30';
      expect(extractDueDateFromText(text, refDate)).toBe('2026-05-30');
    });

    it('extracts deadline from calendar prep context', () => {
      const text = 'Prepare slides for the board meeting on May 20th';
      expect(extractDueDateFromText(text, refDate)).toBe('2026-05-20');
    });

    it('extracts EOD deadline', () => {
      const text = 'Send updated contract to legal - they need it EOD Thursday';
      // Wednesday May 13 -> Thursday May 14
      expect(extractDueDateFromText(text, refDate)).toBe('2026-05-14');
    });
  });
});
