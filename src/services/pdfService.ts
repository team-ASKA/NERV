/**
 * PDF text extraction service using PDF.js
 */
import * as pdfjsLib from 'pdfjs-dist';
import { TextItem, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { isValidPDF } from './pdfValidationService';

// Initialize PDF.js with the worker
// The worker is copied to /public/pdf.worker.min.js during build
if (typeof window !== 'undefined' && 'Worker' in window) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
}

/**
 * Fallback PDF text extraction using simple regex
 * This is a last resort if PDF.js fails to load
 * @param file - The PDF file to extract text from
 * @returns The extracted text
 */
const fallbackExtractText = async (file: File): Promise<string> => {
  try {
    console.log("Using fallback PDF extraction method");
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const textDecoder = new TextDecoder('utf-8');
    const content = textDecoder.decode(uint8Array);
    
    // Look for text between parentheses, which often contains readable text in PDFs
    const parenthesesText = content.match(/\([^\)]{2,100}\)/g) || [];
    let extractedText = '';
    
    parenthesesText.forEach(match => {
      const cleaned = match.replace(/[()]/g, '').trim();
      if (cleaned.length > 2 && /[a-zA-Z]{3,}/.test(cleaned)) {
        extractedText += cleaned + ' ';
      }
    });
    
    // Clean up and format
    extractedText = extractedText
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E]/g, ' ')
      .trim();
    
    return extractedText || `Could not extract text from ${file.name}. The file might be encrypted, scanned, or contain only images.`;
  } catch (error) {
    console.error('Error in fallback PDF extraction:', error);
    return `Failed to extract text from ${file.name}.`;
  }
};

/**
 * Extract text from a PDF file using PDF.js library
 * @param file - The PDF file to extract text from
 * @returns The extracted text
 */
export const extractTextFromPDF = async (file: File): Promise<string> => {
  try {
    // Check if the file is valid
    if (!await isValidPDF(file)) {
      return `The file ${file.name} does not appear to be a valid PDF.`;
    }
    
    // Log file details
    console.log("PDF extraction: Processing file", file.name, "of size", (file.size / 1024).toFixed(2), "KB");
    
    // Convert file to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Ensure the worker is loaded before proceeding
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      console.warn("PDF.js worker source is not set. Setting to default location.");
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
    }
    
    try {
      // Try to load the PDF using PDF.js
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      let pdf: PDFDocumentProxy;
      
      try {
        // Set a timeout for PDF loading
        const pdfPromise = loadingTask.promise;
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('PDF loading timed out')), 15000);
        });
        
        pdf = await Promise.race([pdfPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.error('PDF loading timed out or failed:', timeoutError);
        return await fallbackExtractText(file);
      }
      
      console.log("PDF loaded successfully with", pdf.numPages, "pages");
      
      // Initialize text collection
      let extractedText = '';
      
      // Process each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          // Get the page
          const page = await pdf.getPage(pageNum);
          
          // Get text content from the page
          const textContent = await page.getTextContent();
          
          // Extract text items and join them with spaces
          const pageText = textContent.items
            .map((item) => ('str' in item ? (item as TextItem).str : ''))
            .join(' ');
          
          extractedText += pageText + '\n\n';
        } catch (pageError) {
          console.error(`Error processing page ${pageNum}:`, pageError);
          extractedText += `[Error extracting content from page ${pageNum}]\n\n`;
        }
      }
      
      // Clean up the text: remove excessive whitespace, normalize line breaks
      const cleanedText = extractedText
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
      
      // Validate the extracted content
      if (cleanedText.length < 50) {
        console.warn("PDF extraction yielded very little text content:", cleanedText.length, "characters");
        // Try fallback method instead
        return await fallbackExtractText(file);
      }
      
      console.log("PDF extraction: Successfully extracted", cleanedText.length, "characters");
      return cleanedText;
    } catch (pdfJsError) {
      // If PDF.js fails, try the fallback method
      console.error('PDF.js extraction failed, using fallback method:', pdfJsError);
      return await fallbackExtractText(file);
    }
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    return `Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
};