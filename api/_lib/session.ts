/**
 * Re-export shim. The interview contracts now live in `shared/interview.ts`
 * because the BullMQ worker needs the exact same ones to replay interviews
 * offline, and a second copy would drift.
 *
 * Kept as a file (rather than rewriting every handler's import) because this
 * path is what the `api/` tree has always imported, and because `_`-prefixed
 * directories are the only place under `api/` where shared code is safe —
 * Vercel does not turn them into routes.
 */

export * from '../../shared/interview';
