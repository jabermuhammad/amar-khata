import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { DEFAULT_PDF_MARGIN_MM, hasPdfSignature, isItemRowFilled, isTotalRowFilled, pageDimensions, paginateItems } from '../src/lib/pdfLayout.mjs';
import { assertSavedPdfMatchesSource, bytesToBase64, createPdfHtml, readPdfPageCount } from '../src/lib/pdfDocument.mjs';

const options = { fontSize: 10, title: 'বিয়ের বাজার', totalAmount: 12800 };
const testFonts = { thin: 'dGhpbg==', regular: 'cmVndWxhcg==', bold: 'Ym9sZA==' };
const makeItems = count => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  name: `বাজারের পণ্য ${index + 1}`,
  qty: index % 2 ? '১ কেজি' : '২টি',
  status: index % 2 ? 'pending' : 'purchased',
}));
const pdfCenterSource = readFileSync(new URL('../src/components/PdfCenterModal.tsx', import.meta.url), 'utf8');

test('PDF dimensions are fixed to A4 portrait (210 × 297 mm)', () => {
  const points = pageDimensions();
  assert.ok(Math.abs(points.width * 25.4 / 72 - 210) < 0.001);
  assert.ok(Math.abs(points.height * 25.4 / 72 - 297) < 0.001);
  assert.ok(points.width < points.height);
});

for (const count of [30, 50, 100]) {
  test(`${count} items are retained in order, packed to page capacity, with the total on the last page`, () => {
    const items = makeItems(count);
    const layout = paginateItems(items, options);

    assert.ok(layout.pages.length > 0 && layout.pages.length <= 10);
    assert.equal(layout.exceedsMaxPages, false);
    assert.deepEqual(layout.oversizedIds, []);
    assert.deepEqual(layout.pages.flat().map(item => item.id), items.map(item => item.id));
    assert.equal(layout.usedHeightsMm.length, layout.pages.length);
    assert.ok(layout.usedHeightsMm.at(-1) <= layout.pageCapacityMm);

    for (let pageIndex = 0; pageIndex < layout.pages.length - 1; pageIndex += 1) {
      const nextRowHeight = layout.rowHeights[layout.pages
        .slice(0, pageIndex + 1)
        .reduce((sum, page) => sum + page.length, 0)];
      assert.ok(layout.usedHeightsMm[pageIndex] + nextRowHeight > layout.pageCapacityMm,
        `page ${pageIndex + 1} should not leave room for the next complete row`);
    }
  });
}

test('more than ten pages disables export without dropping any item', () => {
  const items = makeItems(400);
  const layout = paginateItems(items, options);

  assert.ok(layout.exceedsMaxPages);
  assert.ok(layout.pages.length > 10);
  assert.deepEqual(layout.pages.flat().map(item => item.id), items.map(item => item.id));
});

test('ten-page layout remains allowed and preserves every item', () => {
  const items = makeItems(200);
  const layout = paginateItems(items, options);

  assert.equal(layout.pages.length, 10);
  assert.equal(layout.exceedsMaxPages, false);
  assert.deepEqual(layout.pages.flat().map(item => item.id), items.map(item => item.id));
});

test('an individually oversized row remains visible in pagination and is flagged for export blocking', () => {
  const items = makeItems(3);
  items[1].name = 'বাংলা পণ্যের নাম '.repeat(240);
  const layout = paginateItems(items, options);

  assert.deepEqual(layout.pages.flat().map(item => item.id), items.map(item => item.id));
  assert.ok(layout.oversizedIds.includes(2));
});

test('long Bengali rows, large font, quantity and price wrapping reserve footer and final total space', () => {
  const items = makeItems(13).map((item, index) => ({
    ...item,
    name: `${item.name} — ${'বাংলা পণ্যের নাম '.repeat(index % 4 + 1)}`,
    qty: index % 3 === 0 ? 'একশ পঞ্চাশ কেজি' : item.qty,
    price: index % 5 === 0 ? 123456789 : 240,
  }));
  const layout = paginateItems(items, { ...options, fontSize: 14 });

  assert.ok(layout.pages.length <= 10);
  assert.deepEqual(layout.pages.flat().map(item => item.id), items.map(item => item.id));
  assert.ok(layout.usedHeightsMm.every(height => height <= layout.pageCapacityMm));
  const lastPageStart = layout.pages.slice(0, -1).reduce((sum, page) => sum + page.length, 0);
  const lastPageRowsHeight = layout.rowHeights.slice(lastPageStart).reduce((sum, height) => sum + height, 0);
  assert.equal(layout.usedHeightsMm.at(-1), Math.round((lastPageRowsHeight + layout.totalRowHeightMm) * 10) / 10);
  assert.ok(layout.usedHeightsMm.at(-1) <= layout.pageCapacityMm,
    'the final item and total must fit above the separately reserved footer area');
});

test('invalid page settings are rejected', () => {
  assert.throws(() => paginateItems(makeItems(1), { margin: 31, fontSize: 10 }), /Unsupported PDF page settings/);
});

test('shopping-list margin defaults to fixed 14 mm while shared layout accepts optional future margins', () => {
  const defaultLayout = paginateItems(makeItems(1), { fontSize: 10 });
  const explicitLayout = paginateItems(makeItems(1), { margin: DEFAULT_PDF_MARGIN_MM, fontSize: 10 });
  const futureCustomLayout = paginateItems(makeItems(1), { margin: 18, fontSize: 10 });

  assert.equal(DEFAULT_PDF_MARGIN_MM, 14);
  assert.equal(defaultLayout.pageCapacityMm, explicitLayout.pageCapacityMm);
  assert.ok(futureCustomLayout.pageCapacityMm < defaultLayout.pageCapacityMm);
});

test('a large total uses the merged amount width and fits one line at the largest supported font', () => {
  const layout = paginateItems(makeItems(1), { fontSize: 14, totalAmount: 123456789 });
  const singleLineHeight = Math.max(10, 14 * 1.35 * 0.3528 + 4 + 0.25);
  assert.equal(layout.totalRowHeightMm, singleLineHeight);
});

test('the supported font sizes are 9 through 14 and affect row height without changing A4 column geometry', () => {
  const item = makeItems(1)[0];
  const small = paginateItems([item], { fontSize: 9, totalAmount: 100 });
  const normal = paginateItems([item], { fontSize: 12, totalAmount: 100 });
  const large = paginateItems([item], { fontSize: 14, totalAmount: 100 });

  assert.ok(small.rowHeights[0] < normal.rowHeights[0]);
  assert.ok(normal.rowHeights[0] < large.rowHeights[0]);
  assert.ok(large.pageCapacityMm < normal.pageCapacityMm);
  assert.ok(normal.pageCapacityMm < small.pageCapacityMm);
  const thirtyItems = makeItems(30);
  const fourteenPointLayout = paginateItems(thirtyItems, { ...options, fontSize: 14 });
  assert.ok(fourteenPointLayout.pages.length > 1);
  assert.deepEqual(fourteenPointLayout.pages.flat().map(value => value.id), thirtyItems.map(value => value.id));
  assert.throws(() => paginateItems([item], { fontSize: 15 }), /Unsupported PDF page settings/);
});

test('first item is filled, alternating item fills continue across pages, and total fill alternates from last item', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(isItemRowFilled), [true, false, true, false, true]);
  assert.equal(isTotalRowFilled(1), false);
  assert.equal(isTotalRowFilled(2), true);
});

test('renderer capacity recalibration can change pagination without dropping or reordering items', () => {
  const items = makeItems(30);
  const initial = paginateItems(items, { ...options });
  const adjusted = paginateItems(items, { ...options, pageCapacityMm: initial.pageCapacityMm - 10 });

  assert.ok(adjusted.pages.length >= initial.pages.length);
  assert.deepEqual(adjusted.pages.flat().map(item => item.id), items.map(item => item.id));
});

test('PDF file validation accepts only the binary %PDF- signature', () => {
  assert.equal(hasPdfSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
  assert.equal(hasPdfSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46])), false);
  assert.equal(hasPdfSignature(new Uint8Array([0x50, 0x44, 0x46, 0x2d, 0x31])), false);
});

test('PDF page counter reads the root page tree count and ignores page-like text in streams', () => {
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R >> endobj
5 0 obj << /Length 24 >> stream
/Type /Page in user text
endstream endobj
4 0 obj << /Type /Page /Parent 2 0 R >> endobj
trailer << /Root 1 0 R >>
%%EOF`;
  assert.equal(readPdfPageCount(new TextEncoder().encode(pdf)), 2);
  assert.throws(() => readPdfPageCount(new TextEncoder().encode('not pdf')), /Invalid PDF signature/);
});

test('SAF saved PDF must have a valid signature, matching byte size and matching page count', () => {
  const twoPagePdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R >> endobj
%%EOF`);
  const onePagePdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R >> endobj
%%EOF`);
  const onePagePdfSameSize = new Uint8Array(twoPagePdf.byteLength);
  onePagePdfSameSize.set(onePagePdf);
  onePagePdfSameSize.fill(0x20, onePagePdf.byteLength);
  const invalidSignatureSameSize = new Uint8Array(twoPagePdf.byteLength).fill(0x20);
  const changedByteSameLength = twoPagePdf.slice();
  changedByteSameLength[6] ^= 1;
  const validPdfDifferentSize = new Uint8Array(twoPagePdf.byteLength + 1);
  validPdfDifferentSize.set(twoPagePdf);
  validPdfDifferentSize[validPdfDifferentSize.length - 1] = 0x20;

  assert.equal(assertSavedPdfMatchesSource(twoPagePdf, 2, twoPagePdf.slice()), 2);
  assert.throws(() => assertSavedPdfMatchesSource(twoPagePdf, 2, validPdfDifferentSize), /size/);
  assert.throws(() => assertSavedPdfMatchesSource(twoPagePdf, 2, onePagePdfSameSize), /page count/);
  assert.throws(() => assertSavedPdfMatchesSource(twoPagePdf, 2, invalidSignatureSameSize), /signature/);
  assert.throws(() => assertSavedPdfMatchesSource(twoPagePdf, 1, twoPagePdf), /page count/);
  assert.throws(() => assertSavedPdfMatchesSource(twoPagePdf, 2, changedByteSameLength), /binary content/);
});

test('generated HTML repeats the title, table header, footer and page number on every A4 page', () => {
  const pages = [[makeItems(1)[0]], makeItems(2).map((item, index) => ({ ...item, id: index + 2 }))];
  const html = createPdfHtml({
    title: 'বিয়ের বাজার', createdAt: '2026-11-04T00:00:00.000Z', total: 12800, fontSize: 12,
    pages, formatNumber: value => value.toLocaleString('bn-BD'), fonts: testFonts,
  });

  assert.equal((html.match(/class="sheet"/g) || []).length, 2);
  assert.equal((html.match(/আমার খাতা - বিয়ের বাজার/g) || []).length, 2);
  assert.equal((html.match(/পণ্যের নাম/g) || []).length, 2);
  assert.equal((html.match(/পৃষ্ঠা /g) || []).length, 2);
  assert.equal((html.match(/class="total(?:\s|")/g) || []).length, 1);
  assert.match(html, /<td colspan="3">মোট :<\/td><td class="totalAmount" colspan="2">/);
  assert.match(html, /@page\{size:[^}]+mm [^}]+mm;margin:0\}/);
  assert.match(html, /\.table td\{[^}]*border:0\.25mm solid/);
  assert.match(html, /\.sheet footer\{[^}]*bottom:14mm/);
  assert.match(html, /\.table tr\{break-inside:avoid;page-break-inside:avoid\}/);
  assert.match(html, /\.totalAmount\{text-align:right;white-space:nowrap;overflow-wrap:normal\}/);
  assert.match(html, /<tr class="item filled">/);
  assert.doesNotMatch(html, /<h1[^>]*>[^<]*<\/h1>[^<]*<hr/);
});

test('font sizes 9 and 14 retain the same fixed horizontal PDF column widths', () => {
  const items = makeItems(1);
  const htmlAt9 = createPdfHtml({
    title: 'তালিকা', total: 1, fontSize: 9, pages: [items], formatNumber: String, fonts: testFonts,
  });
  const htmlAt30 = createPdfHtml({
    title: 'তালিকা', total: 1, fontSize: 14, pages: [items], formatNumber: String, fonts: testFonts,
  });
  const fixedColumns = '.number{width:9mm;text-align:center;color:#34483d}.name{width:auto}.quantity{width:24mm}.status{width:32mm}.price{width:22mm;text-align:right}';
  assert.ok(htmlAt9.includes(fixedColumns));
  assert.ok(htmlAt30.includes(fixedColumns));
});

test('one, two, five and ten page previews create the same number of explicit HTML sheets', () => {
  for (const [count, expectedPages] of [[1, 1], [30, 2], [105, 5], [200, 10]]) {
    const items = makeItems(count);
    const layout = paginateItems(items, options);
    const html = createPdfHtml({
      title: options.title, total: options.totalAmount, fontSize: options.fontSize,
      pages: layout.pages, formatNumber: value => value.toLocaleString('bn-BD'), fonts: testFonts,
    });
    assert.equal(layout.pages.length, expectedPages);
    assert.equal((html.match(/class="sheet"/g) || []).length, expectedPages);
  }
});

test('preview fonts 9–14 retain every item and use the same page model as PDF export', () => {
  const items = makeItems(50).map((item, index) => ({ ...item, name: `${item.name} ${'বাংলা '.repeat(index % 3 + 1)}` }));
  for (const fontSize of [9, 10, 11, 12, 13, 14]) {
    const layout = paginateItems(items, { ...options, fontSize });
    const html = createPdfHtml({ title: options.title, total: options.totalAmount, fontSize, pages: layout.pages, formatNumber: String, fonts: testFonts });
    assert.equal((html.match(/class="sheet"/g) || []).length, layout.pages.length, `font ${fontSize}`);
    assert.deepEqual(layout.pages.flat().map(item => item.id), items.map(item => item.id), `font ${fontSize}`);
    assert.ok(layout.pages.length <= 10, `font ${fontSize}`);
  }
});

test('PDF HTML embeds all three UN Bangla faces and applies the family without changing the fixed page design', () => {
  const html = createPdfHtml({
    title: 'তালিকা', total: 42, fontSize: 10, pages: [makeItems(1)], formatNumber: String, fonts: testFonts,
  });

  assert.match(html, /font-weight:100[^}]*dGhpbg==/);
  assert.match(html, /font-weight:400[^}]*cmVndWxhcg==/);
  assert.match(html, /font-weight:700[^}]*Ym9sZA==/);
  assert.match(html, /font-family:"UN Bangla",sans-serif;font-synthesis:none/);
  assert.match(html, /@page\{size:[^}]+mm [^}]+mm;margin:0\}/);
  assert.match(html, /\.sheet\{width:[^;]+;height:[^;]+;padding:14mm/);
  assert.match(html, /\.number\{width:9mm/);
  assert.match(html, /\.quantity\{width:24mm/);
  assert.match(html, /\.status\{width:32mm/);
  assert.match(html, /\.price\{width:22mm/);
  assert.throws(() => createPdfHtml({ title: 'তালিকা', total: 42, fontSize: 10, pages: [makeItems(1)], formatNumber: String }), /font data/);
});

test('TTF bytes are converted to exact base64 without text encoding corruption', () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([0]), new Uint8Array([0, 1]), new Uint8Array([0, 1, 2]), new Uint8Array([0, 1, 2, 3]), new Uint8Array([0xff, 0x00, 0x80])]) {
    const encoded = bytesToBase64(bytes);
    assert.equal(Buffer.from(encoded, 'base64').compare(Buffer.from(bytes)), 0);
    assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
  }
});

test('font 10 and 11 previews keep all rows in a bounded scroll region with the total and footer outside it', () => {
  const rowsStart = pdfCenterSource.indexOf('<ScrollView key={`${currentPage}-${options.fontSize}`} style={s.previewRows}');
  const rowsEnd = pdfCenterSource.indexOf('</ScrollView>', rowsStart);
  const totalStart = pdfCenterSource.indexOf('{currentPage === pages.length - 1 && <View style={[s.previewTotal', rowsEnd);
  const footerStart = pdfCenterSource.indexOf('<View style={s.paperFooter}>', totalStart);

  assert.ok(rowsStart >= 0 && rowsEnd > rowsStart);
  assert.match(pdfCenterSource.slice(rowsStart, rowsEnd), /nestedScrollEnabled/);
  assert.match(pdfCenterSource.slice(rowsStart, rowsEnd), /page\.map\(/);
  assert.doesNotMatch(pdfCenterSource.slice(rowsStart, rowsEnd), /numberOfLines|ellipsizeMode/);
  assert.ok(totalStart > rowsEnd && footerStart > totalStart);
  assert.match(pdfCenterSource, /previewRows: \{ flex: 1, minHeight: 0 \}/);
  assert.match(pdfCenterSource, /overflow: 'hidden'/);
});
