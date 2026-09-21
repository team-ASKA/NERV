/**
 * Vision extraction.
 *
 * Renders pages and has a vision model transcribe them. This is the path for
 * scanned PDFs (no text layer to read) and for long resumes, which are
 * overwhelmingly multi-column — pdf.js flattens those into interleaved
 * nonsense, and a model reading the rendered page does not.
 *
 * Cost control is structural rather than incidental: page count is capped,
 * render width is capped, and every page goes in one request so the model bills
 * a single prompt.
 */

import { createCanvas } from '@napi-rs/canvas';
import { MAX_VLM_PAGES } from '../../../shared/ingestion.js';
import { countWords } from '../../../shared/resumeParse.js';
import { logger } from '../config.js';
import { completeVision } from '../llm/groq.js';
import { openDocument, type PdfDocument } from './pdfjs.js';

/**
 * Render width in pixels. Enough for 8–10pt body text to stay legible after
 * JPEG encoding; larger mostly buys tokens, not accuracy.
 */
const RENDER_WIDTH = 1240;
const JPEG_QUALITY = 88;

const SYSTEM = `You transcribe resume pages into plain text. You are a transcriber, not an analyst.

Rules:
- Reproduce the text exactly as written. Never infer, summarise, correct, translate or invent anything.
- Preserve section headings on their own lines, exactly as they appear (SKILLS, EXPERIENCE, PROJECTS, EDUCATION, and so on).
- Read multi-column layouts one full column at a time, top to bottom, left column first. Do not interleave columns.
- Keep bullet points as lines beginning with "- ".
- Keep dates, numbers, metrics, company names and technology names verbatim; these are the details that get asked about.
- If a page is blank or unreadable, output nothing for it rather than guessing.
- Output only the transcription. No commentary, no markdown fences, no headings of your own.`;

const PROMPT = `Transcribe every page of this resume in order. Separate pages with a blank line.`;

async function renderPage(doc: PdfDocument, pageNumber: number): Promise<string | null> {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    if (!base.width || !base.height) return null;

    const scale = Math.min(RENDER_WIDTH / base.width, 3);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    // PDFs render onto transparency; JPEG has no alpha, so an unpainted
    // background would come out black and the text with it.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const jpeg = await canvas.encode('jpeg', JPEG_QUALITY);
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } finally {
    page.cleanup();
  }
}

export interface VlmTextResult {
  text: string;
  wordCount: number;
  pageCount: number;
  pagesRead: number;
}

export async function extractWithVlm(bytes: Uint8Array): Promise<VlmTextResult> {
  const doc = await openDocument(bytes);
  const images: string[] = [];
  let pageCount = 0;

  try {
    pageCount = doc.numPages;
    const pagesToRead = Math.min(pageCount, MAX_VLM_PAGES);

    for (let n = 1; n <= pagesToRead; n++) {
      const image = await renderPage(doc, n);
      if (image) images.push(image);
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  if (images.length === 0) {
    throw new Error('Could not render any page of this PDF.');
  }

  const totalBytes = images.reduce((sum, img) => sum + img.length, 0);
  logger.info({ pages: images.length, approxKb: Math.round(totalBytes / 1024) }, 'sending pages to vision model');

  const raw = await completeVision(SYSTEM, PROMPT, images);
  const text = raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    text,
    wordCount: countWords(text),
    pageCount,
    pagesRead: images.length,
  };
}
