/**
 * Node adapter for pdf.js.
 *
 * pdf.js ships browser-shaped types and expects DOM globals that Node 20 does
 * not provide, and its Node entry point differs between releases. Rather than
 * let that uncertainty leak into the extractors, the whole surface is narrowed
 * to the handful of calls we actually make and pinned behind one lazy loader.
 * If pdf.js changes shape, exactly this file needs editing.
 */

import { createRequire } from 'node:module';
import { logger } from '../config.js';

// ---------------------------------------------------------------------------
// The narrow slice of pdf.js we use
// ---------------------------------------------------------------------------

export interface TextItem {
  str?: string;
  /** [a, b, c, d, e, f] — e is x, f is y in PDF user space. */
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PdfPage {
  getTextContent(options?: { includeMarkedContent?: boolean }): Promise<{ items: unknown[] }>;
  getViewport(options: { scale: number }): Viewport;
  render(options: { canvasContext: unknown; viewport: Viewport }): { promise: Promise<void> };
  cleanup(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfjsModule {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

/** Resolve a file inside pdfjs-dist without assuming a layout. */
function resolveInPdfjs(relative: string): string | null {
  try {
    return require.resolve(`pdfjs-dist/${relative}`);
  } catch {
    return null;
  }
}

let cached: Promise<PdfjsModule> | null = null;

/**
 * Install the DOM globals pdf.js reaches for during rendering. @napi-rs/canvas
 * provides real implementations, so this is not a shim — it is wiring the
 * native canvas into the places pdf.js expects browser APIs.
 */
async function installGlobals(): Promise<void> {
  const canvas = await import('@napi-rs/canvas');
  const g = globalThis as Record<string, unknown>;
  const candidates: Array<[string, unknown]> = [
    ['DOMMatrix', (canvas as unknown as Record<string, unknown>).DOMMatrix],
    ['Path2D', (canvas as unknown as Record<string, unknown>).Path2D],
    ['ImageData', (canvas as unknown as Record<string, unknown>).ImageData],
  ];
  for (const [name, impl] of candidates) {
    if (impl && g[name] === undefined) g[name] = impl;
  }
}

export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;

  cached = (async () => {
    await installGlobals();

    // The legacy build is the one that runs outside a bundler.
    const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;

    const workerSrc = resolveInPdfjs('legacy/build/pdf.worker.mjs');
    if (workerSrc) {
      mod.GlobalWorkerOptions.workerSrc = workerSrc;
    } else {
      logger.warn('pdf.js worker not resolvable; falling back to the in-process fake worker');
    }

    return mod;
  })();

  return cached;
}

/** Path to pdf.js's bundled standard fonts, if present. */
function standardFontDataUrl(): string | undefined {
  const probe = resolveInPdfjs('standard_fonts/FoxitSans.pfb');
  if (!probe) return undefined;
  return probe.slice(0, probe.lastIndexOf('standard_fonts') + 'standard_fonts'.length + 1);
}

/**
 * Open a document with everything scripting-related switched off.
 *
 * A resume is an untrusted file uploaded by a stranger. `isEvalSupported` and
 * embedded JS are attack surface with no upside here, and `disableFontFace`
 * keeps font handling inside pdf.js rather than the native canvas.
 */
export async function openDocument(bytes: Uint8Array): Promise<PdfDocument> {
  const pdfjs = await loadPdfjs();
  const fonts = standardFontDataUrl();

  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer, so hand it a copy.
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
    ...(fonts ? { standardFontDataUrl: fonts } : {}),
  });

  return task.promise;
}
