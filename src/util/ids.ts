import { randomBytes, createHash } from 'node:crypto';

/** Short, filesystem-safe, time-sortable id: <base36 time>-<random>. */
export function newId(): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return `${time}-${rand}`;
}

export function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/** Turns an arbitrary title into a safe, short folder/file name fragment. */
export function slugify(text: string, max = 48): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return slug || 'untitled';
}
