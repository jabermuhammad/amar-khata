const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MAX_PDF_PAGES = 10;
export const DEFAULT_PDF_MARGIN_MM = 14;
const COLUMN_WIDTHS_MM = { number: 9, quantity: 24, status: 32, price: 22 };
const CELL_HORIZONTAL_PADDING_MM = 2;
const ROW_VERTICAL_PADDING_MM = 4;
const TABLE_BORDER_MM = 0.25;
const FOOTER_RESERVE_MM = 7;
const TOTAL_ROW_HEIGHT_MM = 10;
const MIN_FONT_SIZE_PT = 9;
const MAX_FONT_SIZE_PT = 14;

export function pageDimensions() {
  return { width: A4_WIDTH_MM * 72 / 25.4, height: A4_HEIGHT_MM * 72 / 25.4 };
}

function glyphWidthEm(char) {
  if (/[\u0300-\u036F\u0981-\u0983\u09BC\u09BE-\u09CD\u09D7\u09E2-\u09E3]/u.test(char)) return 0;
  if (/\s/u.test(char)) return 0.38;
  if (/[০-৯0-9]/u.test(char)) return 0.62;
  if (/[A-Za-z]/u.test(char)) return 0.68;
  if (/[\u0980-\u09FF]/u.test(char)) return 0.86;
  return 0.72;
}

function wrappedLineCount(text, widthMm, fontSize) {
  const availableEm = widthMm * 72 / 25.4 / fontSize;
  let lines = 1;
  let usedEm = 0;
  for (const char of Array.from(String(text ?? ''))) {
    const widthEm = glyphWidthEm(char);
    if (usedEm > 0 && usedEm + widthEm > availableEm) {
      lines += 1;
      usedEm = 0;
    }
    usedEm += widthEm;
  }
  return lines;
}

export function estimateItemRowHeightMm(item, options, itemNumber = 1) {
  const margin = options.margin ?? DEFAULT_PDF_MARGIN_MM;
  const contentWidthMm = A4_WIDTH_MM - margin * 2;
  const nameWidthMm = Math.max(8, contentWidthMm
    - Object.values(COLUMN_WIDTHS_MM).reduce((sum, width) => sum + width, 0)
    - (5 * CELL_HORIZONTAL_PADDING_MM * 2));
  const status = item.status === 'purchased' ? '✓ কেনা হয়েছে' : '□ বাকি';
  const lines = Math.max(
    wrappedLineCount(item.name, Math.max(8, nameWidthMm), options.fontSize),
    wrappedLineCount(item.qty || '', COLUMN_WIDTHS_MM.quantity - CELL_HORIZONTAL_PADDING_MM * 2, options.fontSize),
    wrappedLineCount(status, COLUMN_WIDTHS_MM.status - CELL_HORIZONTAL_PADDING_MM * 2, options.fontSize),
    wrappedLineCount(item.price == null ? '—' : `৳${Math.abs(Math.trunc(item.price))}`, COLUMN_WIDTHS_MM.price - CELL_HORIZONTAL_PADDING_MM * 2, options.fontSize),
    wrappedLineCount(itemNumber, COLUMN_WIDTHS_MM.number - CELL_HORIZONTAL_PADDING_MM * 2, options.fontSize),
  );
  const lineHeightMm = options.fontSize * 1.35 * 0.3528;
  return Math.ceil((lines * lineHeightMm + ROW_VERTICAL_PADDING_MM + TABLE_BORDER_MM) * 10) / 10;
}

export function paginateItems(items, options) {
  const margin = options.margin ?? DEFAULT_PDF_MARGIN_MM;
  if (!Number.isFinite(margin) || margin < 5 || margin > 30
    || !Number.isFinite(options.fontSize) || options.fontSize < MIN_FONT_SIZE_PT || options.fontSize > MAX_FONT_SIZE_PT) {
    throw new Error('Unsupported PDF page settings');
  }

  const title = `আমার খাতা - ${options.title || 'বাজারের তালিকা'}`;
  const titleWidthMm = A4_WIDTH_MM - margin * 2;
  const titleLines = wrappedLineCount(title, titleWidthMm, options.fontSize + 5);
  const titleHeightMm = titleLines * (options.fontSize + 5) * 1.25 * 0.3528;
  const contentHeightMm = A4_HEIGHT_MM - margin * 2;
  const headerFontSize = Math.min(options.fontSize, 12);
  const headerHeightMm = headerFontSize * 1.2 * 0.3528 + ROW_VERTICAL_PADDING_MM + TABLE_BORDER_MM;
  const calculatedCapacityMm = contentHeightMm - titleHeightMm - headerHeightMm - FOOTER_RESERVE_MM;
  const pageCapacityMm = Number.isFinite(options.pageCapacityMm)
    ? Math.min(calculatedCapacityMm, options.pageCapacityMm)
    : calculatedCapacityMm;
  if (pageCapacityMm <= TOTAL_ROW_HEIGHT_MM) throw new Error('Unsupported PDF page settings');
  const rowHeights = items.map((item, index) => estimateItemRowHeightMm(item, options, index + 1));
  const amountText = `৳${Math.abs(Math.trunc(options.totalAmount ?? 0))}`;
  const totalAmountWidthMm = COLUMN_WIDTHS_MM.status + COLUMN_WIDTHS_MM.price - CELL_HORIZONTAL_PADDING_MM * 2;
  const totalLines = wrappedLineCount(amountText, totalAmountWidthMm, options.fontSize);
  const totalRowHeightMm = Math.max(TOTAL_ROW_HEIGHT_MM, totalLines * options.fontSize * 1.35 * 0.3528 + ROW_VERTICAL_PADDING_MM + TABLE_BORDER_MM);
  const oversizedIds = rowHeights.flatMap((height, index) => height > pageCapacityMm
    ? [items[index].id]
    : []);
  if (totalRowHeightMm > pageCapacityMm) oversizedIds.push('total-row');

  if (!items.length) {
    return { pages: [[]], oversizedIds, exceedsMaxPages: false, pageCapacityMm, rowHeights, totalRowHeightMm, usedHeightsMm: [totalRowHeightMm] };
  }

  const pages = [];
  const usedHeightsMm = [];
  let page = [];
  let used = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const height = rowHeights[index];
    const isLastItem = index === items.length - 1;
    const requiredHeight = height + (isLastItem ? totalRowHeightMm : 0);
    if (page.length && used + requiredHeight > pageCapacityMm) {
      pages.push(page);
      usedHeightsMm.push(used);
      page = [];
      used = 0;
    }
    if (height > pageCapacityMm) {
      if (page.length) {
        pages.push(page);
        usedHeightsMm.push(used);
        page = [];
        used = 0;
      }
      pages.push([item]);
      usedHeightsMm.push(height + (isLastItem ? totalRowHeightMm : 0));
      if (!oversizedIds.includes(item.id)) oversizedIds.push(item.id);
      continue;
    }
    page.push(item);
    used += height;
    if (isLastItem) {
      if (used + totalRowHeightMm > pageCapacityMm && !oversizedIds.includes(item.id)) oversizedIds.push(item.id);
      used += totalRowHeightMm;
    }
  }
  if (page.length) {
    pages.push(page);
    usedHeightsMm.push(used);
  }

  const exceedsMaxPages = pages.length > MAX_PDF_PAGES;
  return { pages, oversizedIds, exceedsMaxPages, pageCapacityMm, rowHeights, totalRowHeightMm, usedHeightsMm: usedHeightsMm.map(value => Math.round(value * 10) / 10) };
}

export function isItemRowFilled(zeroBasedIndex) {
  return zeroBasedIndex % 2 === 0;
}

export function isTotalRowFilled(itemCount) {
  return itemCount % 2 === 0;
}

export function hasPdfSignature(bytes) {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}
