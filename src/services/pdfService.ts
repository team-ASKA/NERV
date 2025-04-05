/**
 * Extract text from a PDF file
 * @param file - The PDF file to extract text from
 * @returns The extracted text
 */
export const extractTextFromPDF = async (file: File): Promise<string> => {
  try {
    // Create a URL for the file
    const fileURL = URL.createObjectURL(file);
    
    // Read the PDF file as an ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Use FileReader as a fallback method to extract text
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          // Simple text extraction approach
          // This is not ideal but works as a fallback without external libraries
          const buffer = event.target?.result as ArrayBuffer;
          let text = '';
          
          // Convert ArrayBuffer to string and try to extract plain text
          const uint8Array = new Uint8Array(buffer);
          const textDecoder = new TextDecoder('utf-8');
          const content = textDecoder.decode(uint8Array);
          
          console.log("PDF extraction: Processing file of size", file.size / 1024, "KB");
          
          // Extract text content between markers (enhanced heuristic approach)
          // Look for common PDF text markers
          const textMarkers = [
            /\/Text/g,
            /\/T\s/g,
            /\/Contents/g, 
            /\/TJ/g, 
            /\/Tj/g,
            /\([\w\s.,;:'"!?&()\-+]*\)/g,
            /\[((?:\([^\)]*\)|<[^>]*>)[^\]]*)\]/g  // Array of text objects
          ];
          
          // First pass - extract potential content areas
          let potentialContent = '';
          
          // Extract text between BT and ET tags (Begin Text/End Text)
          const textBlocks = content.match(/BT[\s\S]*?ET/g) || [];
          textBlocks.forEach(block => {
            potentialContent += block + '\n';
          });
          
          // Process both the full content and potential content areas
          [content, potentialContent].forEach(contentToProcess => {
            textMarkers.forEach(marker => {
              const matches = contentToProcess.match(marker);
              if (matches) {
                matches.forEach(match => {
                  // Clean up the matched text
                  const cleaned = match.replace(/[()\/\\<>\[\]]/g, ' ').trim();
                  if (cleaned.length > 2) {
                    text += cleaned + ' ';
                  }
                });
              }
            });
          });
          
          // Clean up the text
          text = text
            // Remove repeated whitespace
            .replace(/\s+/g, ' ')
            // Remove strange control characters
            .replace(/[^\x20-\x7E]/g, ' ')
            // Clean up potential PDF artifacts
            .replace(/\s+/g, ' ')
            .trim();
          
          // If text extraction fails or produces too little content, try a different approach
          if (text.length < 100) {
            console.log("Initial extraction yielded insufficient text, trying secondary method");
            
            // Secondary method: try to find text between parentheses and decode hex values
            const parenthesesText = content.match(/\([^\)]*\)/g) || [];
            let secondaryText = '';
            
            parenthesesText.forEach(match => {
              const cleaned = match.replace(/[()]/g, '').trim();
              if (cleaned.length > 2) {
                secondaryText += cleaned + ' ';
              }
            });
            
            // If secondary method produced more text, use it
            if (secondaryText.length > text.length) {
              text = secondaryText;
            }
            
            // If still insufficient, add diagnostic info
            if (text.length < 100) {
              text = `PDF text extraction resulted in limited content. Here's what could be extracted: 
              
              ${text}
              
              The PDF appears to be ${(file.size / 1024).toFixed(2)} KB in size and is named ${file.name}.`;
            }
          }
          
          console.log("PDF extraction: Extracted text length:", text.length);
          
          // Clean up
          URL.revokeObjectURL(fileURL);
          
          resolve(text);
        } catch (error) {
          console.error("PDF extraction error in reader.onload:", error);
          reject(error);
        }
      };
      
      reader.onerror = (error) => {
        console.error("PDF extraction error in reader.onerror:", error);
        reject(error);
      };
      
      reader.readAsArrayBuffer(file);
    });
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  }
};