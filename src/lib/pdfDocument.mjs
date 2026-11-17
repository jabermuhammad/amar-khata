import { DEFAULT_PDF_MARGIN_MM, isItemRowFilled, isTotalRowFilled, pageDimensions } from './pdfLayout.mjs';

function bytesToAscii(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 16_384, bytes.length))));
  }
  return chunks.join('');
}

export function bytesToBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | (second >> 4)];
    output += hasSecond ? alphabet[((second & 15) << 2) | (third >> 6)] : '=';
    output += hasThird ? alphabet[third & 63] : '=';
  }
  return output;
}

export function readPdfPageCount(bytes) {
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Invalid PDF signature');
  }
  const source = bytesToAscii(bytes);
  if (!source.includes('%%EOF')) throw new Error('Incomplete PDF file');
  const objectPattern = /\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  let match;
  let leafPages = 0;
  while ((match = objectPattern.exec(source)) !== null) {
    const objectBody = match[1].split(/\bstream\b/, 1)[0];
    if (/\/Type\s*\/Pages\b/.test(objectBody) && !/\/Parent\b/.test(objectBody)) {
      const count = objectBody.match(/\/Count\s+(\d+)\b/);
      if (count && Number(count[1]) > 0) return Number(count[1]);
    }
    if (/\/Type\s*\/Page(?![A-Za-z])\b/.test(objectBody)) leafPages += 1;
  }
  if (leafPages === 0) throw new Error('PDF page tree could not be read');
  return leafPages;
}

export function assertSavedPdfMatchesSource(sourceBytes, expectedSourcePageCount, savedBytes) {
  if (!(sourceBytes instanceof Uint8Array) || sourceBytes.byteLength < 8
    || !(savedBytes instanceof Uint8Array) || savedBytes.byteLength < 8) {
    throw new Error('PDF ফাইলের byte size যাচাই করা যায়নি।');
  }
  let sourcePageCount;
  let savedPageCount;
  try {
    sourcePageCount = readPdfPageCount(sourceBytes);
    savedPageCount = readPdfPageCount(savedBytes);
  } catch {
    throw new Error('PDF signature বা page tree বৈধ নয়; সংরক্ষণ সম্পন্ন হয়নি।');
  }
  if (sourcePageCount !== expectedSourcePageCount) {
    throw new Error('তৈরি PDF-এর page count পুনরায় যাচাইয়ে মেলেনি।');
  }
  if (sourceBytes.byteLength !== savedBytes.byteLength) {
    throw new Error('সংরক্ষিত PDF-এর byte size মূল PDF-এর সঙ্গে মেলেনি।');
  }
  if (sourcePageCount !== savedPageCount) {
    throw new Error('সংরক্ষিত PDF-এর page count মূল PDF-এর সঙ্গে মেলেনি।');
  }
  for (let index = 0; index < sourceBytes.byteLength; index += 1) {
    if (sourceBytes[index] !== savedBytes[index]) {
      throw new Error('সংরক্ষিত PDF-এর binary content মূল PDF-এর সঙ্গে মেলেনি।');
    }
  }
  return savedPageCount;
}

export function createPdfHtml({ title, createdAt, total, fontSize, pages, formatNumber, fonts }) {
  if (!fonts || !['thin', 'regular', 'bold'].every(weight => typeof fonts[weight] === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(fonts[weight]))) {
    throw new Error('PDF-এর UN Bangla font data পাওয়া যায়নি বা বৈধ নয়।');
  }
  const esc = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const parsedDate = createdAt ? new Date(createdAt) : new Date();
  const date = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const dateText = date.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
  const itemCount = pages.reduce((count, page) => count + page.length, 0);
  const pageMarkup = pages.map((page, pageNumber) => {
    const pageStart = pages.slice(0, pageNumber).reduce((count, rows) => count + rows.length, 0);
    const rows = page.map((item, index) => {
      const absoluteIndex = pageStart + index;
      const purchased = item.status === 'purchased';
      const fillClass = isItemRowFilled(absoluteIndex) ? ' filled' : '';
      return `<tr class="item${fillClass}"><td class="number">${formatNumber(absoluteIndex + 1)}</td><td class="name">${esc(item.name)}</td><td class="quantity">${esc(item.qty || '—')}</td><td class="status">${purchased ? '✓ কেনা হয়েছে' : '□ বাকি'}</td><td class="price">${typeof item.price === 'number' ? `৳${formatNumber(item.price)}` : '—'}</td></tr>`;
    }).join('');
    const totalFillClass = isTotalRowFilled(itemCount) ? ' filled' : '';
    const totalRow = pageNumber === pages.length - 1
      ? `<tr class="total${totalFillClass}"><td colspan="3">মোট :</td><td class="totalAmount" colspan="2">৳${formatNumber(total)}</td></tr>`
      : '';
    return `<section class="sheet"><h1>আমার খাতা - ${esc(title.trim() || 'বাজারের তালিকা')}</h1><table class="table"><thead><tr><th class="number">নং</th><th class="name">পণ্যের নাম</th><th class="quantity">পরিমাণ</th><th class="status">অবস্থা</th><th class="price">দাম</th></tr></thead><tbody>${rows}${totalRow}</tbody></table><footer><span>তারিখ: ${esc(dateText)}</span><span>পৃষ্ঠা ${formatNumber(pageNumber + 1)} / ${formatNumber(pages.length)}</span></footer></section>`;
  }).join('');
  const dimensions = pageDimensions();
  const widthMm = dimensions.width / 72 * 25.4;
  const heightMm = dimensions.height / 72 * 25.4;
  const margin = DEFAULT_PDF_MARGIN_MM;
  const headerFontSize = Math.min(fontSize, 12);

  const fontFaces = `@font-face{font-family:"UN Bangla";font-style:normal;font-weight:100;font-display:block;src:url(data:font/ttf;base64,${fonts.thin}) format("truetype")}@font-face{font-family:"UN Bangla";font-style:normal;font-weight:400;font-display:block;src:url(data:font/ttf;base64,${fonts.regular}) format("truetype")}@font-face{font-family:"UN Bangla";font-style:normal;font-weight:700;font-display:block;src:url(data:font/ttf;base64,${fonts.bold}) format("truetype")}`;
  return `<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || 'বাজারের তালিকা')}</title><style>${fontFaces}@page{size:${widthMm}mm ${heightMm}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:"UN Bangla",sans-serif;font-synthesis:none;color:#17231f;font-size:${fontSize}pt}.sheet{width:${widthMm}mm;height:${heightMm}mm;padding:${margin}mm;position:relative;page-break-after:always;break-after:page}.sheet:last-child{page-break-after:auto;break-after:auto}h1{font-size:${fontSize + 5}pt;line-height:1.25;color:#167455;font-weight:700;margin:0;padding:0;overflow-wrap:anywhere}.table{width:100%;border-collapse:collapse;table-layout:fixed}.table thead{display:table-header-group}.table th{background:#e6f0ea;color:#23392e;font-size:${headerFontSize}pt;line-height:1.2;text-align:left;padding:2mm;border:0.25mm solid #cad8cf}.table td{font-size:${fontSize}pt;line-height:1.35;padding:2mm;border:0.25mm solid #d4dfd8;vertical-align:top;overflow-wrap:anywhere}.table .filled td{background:#f0f5f2}.number{width:9mm;text-align:center;color:#34483d}.name{width:auto}.quantity{width:24mm}.status{width:32mm}.price{width:22mm;text-align:right}.totalAmount{text-align:right;white-space:nowrap;overflow-wrap:normal}.table tr{break-inside:avoid;page-break-inside:avoid}.total td{font-weight:700}.sheet footer{position:absolute;left:${margin}mm;right:${margin}mm;bottom:${margin}mm;border-top:0.25mm solid #cad8cf;padding-top:2mm;display:flex;justify-content:space-between;color:#65736b;font-size:8pt;line-height:1.3}</style></head><body>${pageMarkup}</body></html>`;
}
