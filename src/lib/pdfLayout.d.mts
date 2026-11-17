export type PdfLayoutOptions = { margin?: number; fontSize: 9 | 10 | 11 | 12 | 13 | 14; title?: string; totalAmount?: number; pageCapacityMm?: number };
export type PdfLayoutItem = { id: number | string; name: string; qty?: string; status: string; price?: number };
export function pageDimensions(): { width: number; height: number };
export function estimateItemRowHeightMm(item: PdfLayoutItem, options: PdfLayoutOptions, itemNumber?: number): number;
export const DEFAULT_PDF_MARGIN_MM: number;
export function isItemRowFilled(zeroBasedIndex: number): boolean;
export function isTotalRowFilled(itemCount: number): boolean;
export function hasPdfSignature(bytes: Uint8Array): boolean;
export function paginateItems<T extends PdfLayoutItem>(items: T[], options: PdfLayoutOptions): {
  pages: T[][];
  oversizedIds: Array<number | string>;
  exceedsMaxPages: boolean;
  pageCapacityMm: number;
  rowHeights: number[];
  totalRowHeightMm: number;
  usedHeightsMm: number[];
};
