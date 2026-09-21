/**
 * Text-layer extraction.
 *
 * pdf.js returns positioned glyph runs, not lines. Joining them in emission
 * order is what produces the classic garbled resume — "React 2021 Node" from a
 * two-column skills table. So we rebuild rows from the baseline coordinates and
 * insert separators from the geometry, which keeps single-column documents
 * clean and makes multi-column ones at least detectable.
 */

import { MAX_PDF_PAGES } from '../../../shared/ingestion.js';
import { countWords } from '../../../shared/resumeParse.js';
import { openDocument, type PdfDocument, type TextItem } from './pdfjs.js';

export interface PdfTextResult {
  text: string;
  wordCount: number;
  /** Pages in the document, even if we only read some of them. */
  pageCount: number;
  pagesRead: number;
  /** True when rows contain wide interior gaps — a column or table layout. */
  looksColumnar: boolean;
}

interface Positioned {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function toPositioned(items: unknown[]): Positioned[] {
  const out: Positioned[] = [];
  for (const raw of items) {
    const item = raw as TextItem;
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const x = Number(t[4]);
    const y = Number(t[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      str,
      x,
      y,
      width: Number.isFinite(item.width) ? Number(item.width) : str.length * 4,
      height: Number.isFinite(item.height) && Number(item.height) > 0 ? Number(item.height) : 10,
    });
  }
  return out;
}

/** Group runs onto shared baselines, top of the page first. */
function buildRows(items: Positioned[]): Positioned[][] {
  if (items.length === 0) return [];

  const heights = items.map((i) => i.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 10;
  // Half a line height: tight enough to keep adjacent lines apart, loose
  // enough to survive the sub-point baseline jitter in most PDFs.
  const tolerance = Math.max(1.5, medianHeight * 0.5);

  const sorted = [...items].sort((a, b) => b.y - a.y);
  const rows: Positioned[][] = [];
  let current: Positioned[] = [];
  let anchor = Number.NaN;

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(item.y - anchor) <= tolerance) {
      if (current.length === 0) anchor = item.y;
      current.push(item);
    } else {
      rows.push(current);
      current = [item];
      anchor = item.y;
    }
  }
  if (current.length > 0) rows.push(current);

  return rows;
}

interface RenderedRow {
  text: string;
  /** Widest interior gap, in multiples of the row's glyph height. */
  maxGapRatio: number;
}

function renderRow(row: Positioned[]): RenderedRow {
  const ordered = [...row].sort((a, b) => a.x - b.x);
  const first = ordered[0];
  if (!first) return { text: '', maxGapRatio: 0 };

  let text = first.str;
  let cursor = first.x + first.width;
  let maxGapRatio = 0;

  for (let i = 1; i < ordered.length; i++) {
    const item = ordered[i];
    if (!item) continue;
    const gap = item.x - cursor;
    const ratio = gap / Math.max(item.height, 1);
    if (ratio > maxGapRatio) maxGapRatio = ratio;

    if (ratio > 2.5) {
      // A column boundary or a right-aligned date. Two spaces so the
      // section splitter and the model both see a real break.
      text += `  ${item.str}`;
    } else if (ratio > 0.18 && !text.endsWith(' ') && !item.str.startsWith(' ')) {
      text += ` ${item.str}`;
    } else {
      text += item.str;
    }
    cursor = item.x + item.width;
  }

  return { text: text.replace(/\s+$/, ''), maxGapRatio };
}

async function readPage(doc: PdfDocument, pageNumber: number): Promise<RenderedRow[]> {
  const page = await doc.getPage(pageNumber);
  try {
    const content = await page.getTextContent({ includeMarkedContent: false });
    const rows = buildRows(toPositioned(content.items));
    return rows.map(renderRow).filter((r) => r.text.trim().length > 0);
  } finally {
    page.cleanup();
  }
}

/**
 * Read the text layer. Returns whatever is there, including nothing — an empty
 * result is a legitimate answer for a scanned PDF and the router's signal to
 * take the vision path.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  const doc = await openDocument(bytes);
  try {
    const pageCount = doc.numPages;
    const pagesRead = Math.min(pageCount, MAX_PDF_PAGES);

    const pages: string[] = [];
    let columnarRows = 0;
    let totalRows = 0;

    for (let n = 1; n <= pagesRead; n++) {
      const rows = await readPage(doc, n);
      totalRows += rows.length;
      columnarRows += rows.filter((r) => r.maxGapRatio > 2.5).length;
      pages.push(rows.map((r) => r.text).join('\n'));
    }

    const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    return {
      text,
      wordCount: countWords(text),
      pageCount,
      pagesRead,
      // A handful of right-aligned dates is normal; a fifth of the document is
      // a layout.
      looksColumnar: totalRows > 0 && columnarRows / totalRows > 0.2,
    };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
