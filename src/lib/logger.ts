/**
 * Tiny logging shim. Debug/info are silenced in production builds so the
 * console isn't spammed; warnings and errors always surface.
 */
const DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

export const logger = {
  debug: (...args: unknown[]) => {
    if (DEV) console.debug(...args);
  },
  info: (...args: unknown[]) => {
    if (DEV) console.info(...args);
  },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
