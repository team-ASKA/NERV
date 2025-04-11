import * as PDFJS from 'pdfjs-dist';
import { getDocument } from 'pdfjs-dist';

/**
 * Validates if a file is a proper PDF by attempting to load it with PDF.js
 * @param file The file to validate
 * @returns Promise<boolean> True if the file is a valid PDF, false otherwise
 */
export const isValidPDF = async (file: File): Promise<boolean> => {
  try {
    // Get file as ArrayBuffer
    const fileData = await file.arrayBuffer();
    
    // Check PDF header signature (PDF files start with %PDF-)
    const firstBytes = new Uint8Array(fileData.slice(0, 5));
    const header = new TextDecoder().decode(firstBytes);
    if (header !== '%PDF-') {
      console.warn('File does not have PDF header signature');
      return false;
    }
    
    // Try to load the first page only to validate the PDF structure
    const loadingTask = getDocument({
      data: fileData,
      cMapUrl: 'https://unpkg.com/pdfjs-dist@3.4.120/cmaps/',
      cMapPacked: true,
    });
    
    // Set a timeout to prevent hanging on corrupt PDFs
    const timeoutPromise = new Promise<false>((resolve) => {
      setTimeout(() => resolve(false), 5000);
    });
    
    // Race the loading task against the timeout
    const pdf = await Promise.race([
      loadingTask.promise,
      timeoutPromise
    ]);
    
    // If the promise resolved with false, the timeout won
    if (pdf === false) {
      console.warn('PDF validation timed out');
      return false;
    }
    
    // If we got here, the PDF is valid
    return true;
  } catch (error) {
    console.error('PDF validation error:', error);
    return false;
  }
}; 