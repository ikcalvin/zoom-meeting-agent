import { format, parse, isBefore, addDays } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

const JAMAICA_TZ = "America/Jamaica";

/**
 * Get the current time in Jamaica timezone.
 */
export function nowInJamaica(): Date {
  return toZonedTime(new Date(), JAMAICA_TZ);
}

/**
 * Convert a UTC Date to Jamaica timezone for display.
 */
export function toJamaicaTime(utcDate: Date): Date {
  return toZonedTime(utcDate, JAMAICA_TZ);
}

/**
 * Convert a Jamaica local time to UTC.
 * Use this when creating Zoom meetings — Zoom expects UTC or timezone-aware times.
 */
export function fromJamaicaTime(jamaicaDate: Date): Date {
  return fromZonedTime(jamaicaDate, JAMAICA_TZ);
}

/**
 * Format a date for display in Jamaica timezone.
 * Example: "Thu, May 1 at 2:00 PM"
 */
export function formatJamaicaTime(utcDate: Date | string): string {
  const date =
    typeof utcDate === "string" ? new Date(utcDate) : utcDate;
  const jamaicaDate = toZonedTime(date, JAMAICA_TZ);
  return format(jamaicaDate, "EEE, MMM d 'at' h:mm a");
}

/**
 * Format a date as ISO 8601 for Zoom API.
 * Zoom accepts: "2025-03-15T10:00:00Z"
 */
export function toZoomIso(utcDate: Date): string {
  return utcDate.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Check if a given Jamaica-local time has already passed today.
 * Returns { isPast: true, suggestedTime: tomorrow same time } if so.
 */
export function checkPastTime(jamaicaDate: Date): {
  isPast: boolean;
  suggestedTime?: Date;
  suggestedTimeFormatted?: string;
} {
  const now = nowInJamaica();

  if (isBefore(jamaicaDate, now)) {
    const tomorrow = addDays(jamaicaDate, 1);
    return {
      isPast: true,
      suggestedTime: tomorrow,
      suggestedTimeFormatted: format(tomorrow, "EEE, MMM d 'at' h:mm a"),
    };
  }

  return { isPast: false };
}

/**
 * Check if two meeting times overlap.
 * Assumes each meeting is `durationMinutes` long (default 60).
 */
export function timesConflict(
  existingStartUtc: Date | string,
  newStartUtc: Date | string,
  durationMinutes: number = 60
): boolean {
  const existing =
    typeof existingStartUtc === "string"
      ? new Date(existingStartUtc)
      : existingStartUtc;
  const newStart =
    typeof newStartUtc === "string" ? new Date(newStartUtc) : newStartUtc;

  const existingEnd = new Date(
    existing.getTime() + durationMinutes * 60 * 1000
  );
  const newEnd = new Date(newStart.getTime() + durationMinutes * 60 * 1000);

  // Two intervals overlap if one starts before the other ends
  return newStart < existingEnd && existing < newEnd;
}

export { JAMAICA_TZ };
