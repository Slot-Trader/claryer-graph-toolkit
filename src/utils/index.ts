import { randomUUID } from 'node:crypto';

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** "Launch Date!" → "launch-date" */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/**
 * Finds `@handle` mentions in text that match a known person id or first name (case-insensitive).
 * Returns matching person ids.
 */
export function detectMentions(text: string, people: { id: string; name: string }[]): string[] {
  const handles = [...text.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((m) => m[1]!.toLowerCase());
  if (handles.length === 0) return [];
  const found: string[] = [];
  for (const person of people) {
    const firstName = person.name.split(/\s+/)[0]?.toLowerCase();
    if (handles.includes(person.id.toLowerCase()) || (firstName && handles.includes(firstName))) {
      found.push(person.id);
    }
  }
  return found;
}

/** Truncates a string to `max` characters, appending an ellipsis marker when cut. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
