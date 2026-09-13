import clsx, { type ClassValue } from 'clsx';

/**
 * Merge conditional class names. Thin wrapper over `clsx` so components have a
 * single, consistent helper (and a place to add tailwind-merge later if needed).
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
