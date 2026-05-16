import * as pdfjs from "pdfjs-dist";

// Use Vite's asset handling to get the worker URL from the installed package
// This is more reliable than external CDNs which might have version mismatches or CORS issues
// @ts-ignore
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export async function getPdfPageCount(file: File): Promise<number> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    return pdf.numPages;
  } catch (error) {
    console.error("[PdfExtractor] Error getting page count:", error);
    throw new Error(`Gagal membaca "${file.name}" untuk menghitung halaman.`);
  }
}

export async function extractTextFromPdf(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullText = "";
    const numPages = pdf.numPages;
    
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += pageText + "\n";
    }
    
    return fullText;
  } catch (error: any) {
    console.error("[PdfExtractor] Error extracting text:", error);
    throw new Error(`Gagal membaca "${file.name}": ${error.message || "Pastikan file PDF tidak rusak atau terproteksi"}.`);
  }
}
