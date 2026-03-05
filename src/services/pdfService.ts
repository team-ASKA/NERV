/**
 * Extract text from a PDF file using pdfjs-dist
 */
export const extractTextFromPDF = async (file: File): Promise<string> => {
  // Method 1: pdfjs-dist (proper PDF parsing)
  try {
    const pdfjsLib = await import('pdfjs-dist');

    // Required: set worker source. Use CDN to avoid build complexity.
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = '';
    const numPages = pdf.numPages;
    console.log(`[pdfService] PDF has ${numPages} pages`);

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Join items with spaces, add newline between pages
      const pageText = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');

      fullText += pageText + '\n';
    }

    const cleanText = fullText.replace(/\s+/g, ' ').trim();
    console.log(`[pdfService] Extracted ${cleanText.length} chars via pdfjs-dist`);

    if (cleanText.length > 50) {
      return cleanText;
    }
    throw new Error('PDFjs extracted insufficient text');
  } catch (pdfjsError) {
    console.warn('[pdfService] pdfjs-dist failed, trying fallback:', pdfjsError);
  }

  // Method 2: Fallback — raw binary scan for parenthesis-enclosed strings
  // Works on some older, uncompressed PDFs
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder('latin1'); // latin1 preserves byte values
    const content = decoder.decode(uint8Array);

    // Extract text from BT...ET blocks (Begin Text / End Text)
    const btEtBlocks = content.match(/BT[\s\S]*?ET/g) || [];
    let extractedText = '';

    btEtBlocks.forEach(block => {
      // Match parenthesized strings like (Hello World)
      const strings = block.match(/\(([^()\\]|\\.)*\)/g) || [];
      strings.forEach(s => {
        const inner = s.slice(1, -1)
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')');
        // Keep only printable ASCII
        const printable = inner.replace(/[^\x20-\x7E\n\r\t]/g, ' ').trim();
        if (printable.length > 1) {
          extractedText += printable + ' ';
        }
      });
    });

    const cleaned = extractedText.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 50) {
      console.log(`[pdfService] Fallback extracted ${cleaned.length} chars`);
      return cleaned;
    }
  } catch (fallbackError) {
    console.error('[pdfService] Fallback also failed:', fallbackError);
  }

  throw new Error(
    'Could not extract text from this PDF. ' +
    'The file may be scanned/image-based or encrypted. ' +
    'Please try a text-based PDF resume.'
  );
};