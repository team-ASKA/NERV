/**
 * Firebase ID-token verification.
 *
 * The ingestion endpoints write to a user's data and read their documents, so
 * they cannot take a `userId` from the request body — anyone could then enqueue
 * work against another account or poll someone else's parse. The client sends
 * the Firebase ID token it already holds; this verifies it.
 *
 * No new dependency: `firebase-admin` is a large package that exists mostly to
 * do what the sixty lines below do — fetch Google's signing certificates,
 * check an RS256 signature, and validate the standard claims.
 */

import { X509Certificate, createVerify, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/**
 * The project id is public (it ships in the client Firebase config), so either
 * name is fine to read here.
 */
function projectId(): string {
  return process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID ?? '';
}

/**
 * Escape hatch for local development against an unconfigured project. Must be
 * set explicitly: the default is to reject, so an incomplete deploy fails
 * closed rather than accepting whatever `userId` a caller claims.
 */
function allowUnverified(): boolean {
  return process.env.ALLOW_UNVERIFIED_AUTH === 'true';
}

// ---------------------------------------------------------------------------
// Certificate cache
// ---------------------------------------------------------------------------

let certCache: { keys: Record<string, string>; expiresAt: number } | null = null;

async function signingKeys(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.keys;

  const response = await fetch(CERT_URL);
  if (!response.ok) throw new Error(`Could not fetch Google signing certificates (${response.status}).`);

  const keys = (await response.json()) as Record<string, string>;
  // Honour Google's cache directive; these rotate roughly daily.
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  certCache = { keys, expiresAt: Date.now() + Math.max(300, maxAge) * 1000 };
  return keys;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

interface TokenHeader {
  alg?: string;
  kid?: string;
}

interface TokenPayload {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export interface VerifiedUser {
  uid: string;
  email?: string;
}

export class AuthError extends Error {}

export async function verifyIdToken(token: string): Promise<VerifiedUser> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token.');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = decodeSegment<TokenHeader>(headerB64);
  const payload = decodeSegment<TokenPayload>(payloadB64);
  if (!header || !payload) throw new AuthError('Malformed token.');
  if (header.alg !== 'RS256') throw new AuthError('Unexpected token algorithm.');
  if (!header.kid) throw new AuthError('Token has no key id.');

  const project = projectId();
  if (!project) throw new AuthError('FIREBASE_PROJECT_ID is not configured on the server.');

  const keys = await signingKeys();
  const cert = keys[header.kid];
  if (!cert) throw new AuthError('Token was signed with an unknown key.');

  const publicKey = new X509Certificate(cert).publicKey;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  if (!verifier.verify(publicKey, Buffer.from(signatureB64, 'base64url'))) {
    throw new AuthError('Token signature is invalid.');
  }

  const now = Math.floor(Date.now() / 1000);
  // 60s of slack absorbs ordinary clock skew without meaningfully widening the
  // window an expired token stays usable.
  if (typeof payload.exp !== 'number' || payload.exp < now - 60) throw new AuthError('Token has expired.');
  if (typeof payload.iat === 'number' && payload.iat > now + 60) throw new AuthError('Token is not yet valid.');

  const expectedIss = `https://securetoken.google.com/${project}`;
  if (payload.iss !== expectedIss) throw new AuthError('Token issuer does not match this project.');

  // Constant-time compare on the audience: it is attacker-influenced and
  // compared against a secret-adjacent constant.
  const aud = Buffer.from(payload.aud ?? '');
  const expected = Buffer.from(project);
  if (aud.length !== expected.length || !timingSafeEqual(aud, expected)) {
    throw new AuthError('Token audience does not match this project.');
  }

  if (!payload.sub) throw new AuthError('Token has no subject.');

  return { uid: payload.sub, email: payload.email };
}

/**
 * Development-only identity, read from the body or the query string so GET
 * endpoints (which have no body) work too. Returns null unless
 * ALLOW_UNVERIFIED_AUTH is explicitly enabled.
 */
function unverifiedUser(req: VercelRequest): VerifiedUser | null {
  if (!allowUnverified()) return null;

  const fromBody = (req.body as { userId?: unknown } | undefined)?.userId;
  if (typeof fromBody === 'string' && fromBody.length > 0) return { uid: fromBody };

  const fromQuery = req.query?.userId;
  const claimed = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (typeof claimed === 'string' && claimed.length > 0) return { uid: claimed };

  return null;
}

/**
 * Resolve the caller, or respond 401 and return null.
 *
 * Handlers should `const user = await requireUser(req, res); if (!user) return;`
 */
export async function requireUser(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VerifiedUser | null> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    const dev = unverifiedUser(req);
    if (dev) return dev;
    res.status(401).json({ error: 'Sign in to continue.' });
    return null;
  }

  try {
    return await verifyIdToken(token);
  } catch (err) {
    const dev = unverifiedUser(req);
    if (dev) return dev;
    const message = err instanceof AuthError ? err.message : 'Could not verify your session.';
    res.status(401).json({ error: message });
    return null;
  }
}
