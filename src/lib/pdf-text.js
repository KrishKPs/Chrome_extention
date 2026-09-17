/*
 * pdf-text.js — turns a PDF resume into plain text, once, at upload time.
 *
 * We store the extracted text (not the PDF), so every analysis sends only
 * words — the cheapest option in tokens. Uses Mozilla's pdf.js, copied into
 * src/vendor/ because Manifest V3 forbids loading code from a CDN.
 * This file must NOT make network calls.
 */

import { GlobalWorkerOptions, getDocument } from "../vendor/pdfjs/pdf.min.mjs";

// pdf.js parses in a background "worker" thread so the page stays responsive.
// `import.meta.url` is this file's own address, so the path works anywhere.
GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;

// Takes the file's bytes (an ArrayBuffer) and resolves to its text.
export async function extractPdfText(bytes) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  try {
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const { items } = await page.getTextContent();
      // Each item is a run of text; hasEOL marks the end of a visual line.
      pages.push(items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join(""));
    }
    return pages
      .join("\n\n")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } finally {
    // Frees the worker's memory, whether parsing succeeded or not.
    await loadingTask.destroy();
  }
}
