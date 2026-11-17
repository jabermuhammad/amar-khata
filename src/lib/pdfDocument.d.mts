import type { PdfLayoutItem } from './pdfLayout.mjs';

export type PdfDocumentItem = PdfLayoutItem & { price?: number };
export function bytesToBase64(bytes: Uint8Array): string;
export function readPdfPageCount(bytes: Uint8Array): number;
export function assertSavedPdfMatchesSource(sourceBytes: Uint8Array, expectedSourcePageCount: number, savedBytes: Uint8Array): number;
export function createPdfHtml(options: {
  title: string;
  createdAt?: string;
  total: number;
  fontSize: 9 | 10 | 11 | 12 | 13 | 14;
  pages: PdfDocumentItem[][];
  formatNumber: (value: number) => string;
  fonts: { thin: string; regular: string; bold: string };
}): string;
