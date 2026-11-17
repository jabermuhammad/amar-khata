import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { ThemedSafeAreaView as SafeAreaView, ThemedText as Text, ThemedView as View, ThemedIcon } from './ThemePrimitives';
import { GlossyPressable as Pressable } from './GlossyPressable';
import { useTheme } from '../contexts/ThemeContext';
import { bn, type ShoppingList } from '../data';
import { DEFAULT_PDF_MARGIN_MM, isItemRowFilled, isTotalRowFilled, pageDimensions as getPageDimensions, paginateItems } from '../lib/pdfLayout.mjs';
import { assertSavedPdfMatchesSource, bytesToBase64, createPdfHtml, readPdfPageCount } from '../lib/pdfDocument.mjs';

type PdfOptions = { fontSize: 9 | 10 | 11 | 12 | 13 | 14 };
type Props = { visible: boolean; list: ShoppingList; total: number; onClose: () => void };

const FONT_SIZES: PdfOptions['fontSize'][] = [9, 10, 11, 12, 13, 14];

const TEMP_PREFIX = 'amar-khata-pdf-';
const TEMP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MIME_PDF = 'application/pdf';
const activeTemporaryPdfs = new Set<string>();
const PDF_FONT_ASSETS = {
  thin: require('../../assets/fonts/UNBangla-Thin.ttf'),
  regular: require('../../assets/fonts/UNBangla-Regular.ttf'),
  bold: require('../../assets/fonts/UNBangla-Bold.ttf'),
};
type PdfFonts = { thin: string; regular: string; bold: string };
let pdfFontsPromise: Promise<PdfFonts> | null = null;

function loadPdfFonts() {
  if (!pdfFontsPromise) {
    pdfFontsPromise = Promise.all(Object.entries(PDF_FONT_ASSETS).map(async ([weight, moduleId]) => {
      const asset = await Asset.fromModule(moduleId).downloadAsync();
      if (!asset.localUri) throw new Error(`UN Bangla ${weight} PDF font ফাইলটি খোলা যায়নি।`);
      const bytes = await new File(asset.localUri).bytes();
      if (!bytes.length) throw new Error(`UN Bangla ${weight} PDF font ফাইলটি খালি।`);
      return [weight, bytesToBase64(bytes)] as const;
    })).then(entries => Object.fromEntries(entries) as PdfFonts).catch(error => {
      pdfFontsPromise = null;
      throw error;
    });
  }
  return pdfFontsPromise;
}

export default function PdfCenterModal({ visible, list, total, onClose }: Props) {
  const { theme } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [options, setOptions] = useState<PdfOptions>({ fontSize: 10 });
  const [capacityCalibration, setCapacityCalibration] = useState<{ key: string; capacityMm: number } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [generated, setGenerated] = useState<{ file: File; pageCount: number; key: string } | null>(null);
  const [busy, setBusy] = useState<'generating' | 'sharing' | 'saving' | 'printing' | null>(null);
  const [status, setStatus] = useState('');
  const operationLock = useRef(false);
  const colors = theme === 'dark' ? dark : light;
  const printableItems = useMemo(() => list.items.filter(item => item.status !== 'omitted'), [list.items]);
  const configKey = useMemo(() => JSON.stringify({ options, title: list.title, createdAt: list.createdAt, items: printableItems.map(item => [item.id, item.name, item.qty, item.status, item.price]), total }), [list.createdAt, list.title, options, printableItems, total]);
  const pageCapacityOverride = capacityCalibration?.key === configKey ? capacityCalibration.capacityMm : undefined;
  const layout = useMemo(() => paginateItems(printableItems, { ...options, title: list.title, totalAmount: total, pageCapacityMm: pageCapacityOverride }), [list.title, options, pageCapacityOverride, printableItems, total]);
  const pages = layout.pages;
  const currentPage = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const pageStartIndex = pages.slice(0, currentPage).reduce((count, rows) => count + rows.length, 0);
  const previewScale = Math.max(0.5, (windowWidth - 32) / 210);
  const actualPageCount = generated?.key === configKey ? generated.pageCount : null;
  const parsedDate = list.createdAt ? new Date(list.createdAt) : new Date();
  const date = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const filename = `Amar-Khata-List-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.pdf`;

  useEffect(() => {
    try {
      const cutoff = Date.now() - TEMP_RETENTION_MS;
      for (const entry of Paths.cache.list()) {
        if (entry instanceof File && entry.name.startsWith(TEMP_PREFIX) && !activeTemporaryPdfs.has(entry.uri) && entry.modificationTime !== null && entry.modificationTime < cutoff) {
          try { entry.delete(); } catch { /* Cache cleanup is best-effort and only targets this feature's stale temporary PDFs. */ }
        }
      }
    } catch { /* Cache listing may be unavailable on some devices. */ }
  }, []);

  const buildPdf = async (returnTo: 'sharing' | 'saving' | 'printing' | null = null) => {
    if (!printableItems.length) throw new Error('প্রিন্ট করার মতো কোনো পণ্য নেই।');
    if (layout.exceedsMaxPages) throw new Error('এই তালিকার PDF ১০ পৃষ্ঠার বেশি হবে। কোনো তথ্য বাদ না দিয়ে Export বন্ধ রাখা হয়েছে; ফন্ট ছোট করুন বা তালিকা ছোট করে আবার চেষ্টা করুন।');
    if (layout.oversizedIds.length) throw new Error('কিছু পণ্যের নাম এক A4 সারিতে রাখা যাচ্ছে না। ফন্ট ছোট করুন বা নাম সংক্ষিপ্ত করুন।');
    setBusy('generating');
    setStatus('PDF তৈরি হচ্ছে…');
    let intermediate: File | null = null;
    try {
      let candidateLayout = layout;
      let result: Awaited<ReturnType<typeof Print.printToFileAsync>> | null = null;
      let rendererMatched = false;
      let verifiedPageCount = 0;
      const pdfFonts = await loadPdfFonts();
      for (let attempt = 0; attempt < 7; attempt += 1) {
        if (candidateLayout.exceedsMaxPages) throw new Error('Android PDF Renderer অনুযায়ী এই তালিকায় ১০ পৃষ্ঠার বেশি লাগবে। কোনো তথ্য বাদ না দিয়ে Export বন্ধ রাখা হয়েছে।');
        result = await Print.printToFileAsync({ html: createPdfHtml({ title: list.title, createdAt: list.createdAt, total, fontSize: options.fontSize, pages: candidateLayout.pages, formatNumber: bn, fonts: pdfFonts }), ...pageDimensions() });
        intermediate = new File(result.uri);
        verifiedPageCount = await assertPdfFile(intermediate);
        if (verifiedPageCount === candidateLayout.pages.length) {
          rendererMatched = true;
          break;
        }
        intermediate.delete();
        intermediate = null;
        // Extra physical pages mean the capacity estimate was too optimistic.
        // Fewer pages cannot safely be corrected by packing more content, so fail closed.
        if (verifiedPageCount < candidateLayout.pages.length) {
          throw new Error('Android PDF Renderer প্রত্যাশার চেয়ে কম পৃষ্ঠা তৈরি করেছে। পৃষ্ঠা বিন্যাস যাচাই করা যায়নি; কোনো ফাইল শেয়ার, সংরক্ষণ বা প্রিন্ট করা হয়নি।');
        }
        const stepMm = Math.max(1, candidateLayout.pageCapacityMm * 0.02);
        const nextCapacity = candidateLayout.pageCapacityMm - stepMm;
        candidateLayout = paginateItems(printableItems, { ...options, title: list.title, totalAmount: total, pageCapacityMm: nextCapacity });
      }
      if (!rendererMatched || !result || !intermediate) {
        throw new Error('Android PDF Renderer-এর পৃষ্ঠা সংখ্যা প্রিভিউয়ের সঙ্গে স্থিরভাবে মেলেনি। কোনো ফাইল শেয়ার, সংরক্ষণ বা প্রিন্ট করা হয়নি; ফন্ট ছোট করে আবার চেষ্টা করুন।');
      }
      if (verifiedPageCount > 10) throw new Error('Android PDF Renderer-এ PDF ১০ পৃষ্ঠার সীমা ছাড়িয়েছে। কোনো তথ্য বাদ না দিয়ে Export বন্ধ রাখা হয়েছে।');
      setCapacityCalibration({ key: configKey, capacityMm: candidateLayout.pageCapacityMm });
      const target = uniqueCacheFile();
      await intermediate.move(target);
      const savedPageCount = await assertPdfFile(target);
      if (savedPageCount !== verifiedPageCount) throw new Error('সংরক্ষিত PDF-এর পৃষ্ঠা সংখ্যা মূল ফাইলের সঙ্গে মেলেনি।');
      setGenerated({ file: target, pageCount: verifiedPageCount, key: configKey });
      setPageIndex(0);
      setStatus(`PDF তৈরি হয়েছে · ${bn(verifiedPageCount)} পৃষ্ঠা`);
      return { file: target, pageCount: verifiedPageCount };
    } catch (error) {
      try { if (intermediate?.exists) intermediate.delete(); } catch { /* Best-effort cleanup of incomplete private cache output. */ }
      throw error;
    } finally {
      setBusy(returnTo);
    }
  };

  const getCurrentPdf = async (returnTo: 'sharing' | 'saving' | 'printing') => generated?.key === configKey && generated.file.exists ? generated : buildPdf(returnTo);

  const sharePdf = async () => {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy('sharing');
    try {
      const pdf = await getCurrentPdf('sharing');
      if (!(await Sharing.isAvailableAsync())) throw new Error('এই ডিভাইসে ফাইল শেয়ার করার সুবিধা পাওয়া যায়নি।');
      setStatus('Android Share Sheet খোলা হচ্ছে…');
      activeTemporaryPdfs.add(pdf.file.uri);
      try { await Sharing.shareAsync(pdf.file.uri, { mimeType: MIME_PDF, dialogTitle: 'আমার খাতার PDF শেয়ার করুন' }); }
      finally { activeTemporaryPdfs.delete(pdf.file.uri); }
      setStatus('Share Sheet বন্ধ হয়েছে। পাঠানো সম্পন্ন হয়েছে কি না নির্বাচিত অ্যাপে দেখুন।');
    } catch (error) {
      setStatus('');
      Alert.alert('PDF শেয়ার করা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।');
    } finally { operationLock.current = false; setBusy(null); }
  };

  const savePdf = async () => {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy('saving');
    try {
      if (Platform.OS !== 'android') throw new Error('এই ফোল্ডার বাছাই পদ্ধতি শুধু Android-এ সমর্থিত।');
      const pdf = await getCurrentPdf('saving');
      const sourceBytes = await pdf.file.bytes();
      const sourcePageCount = readPdfPageCount(sourceBytes);
      if (sourcePageCount !== pdf.pageCount) throw new Error('তৈরি PDF-এর পৃষ্ঠা সংখ্যা পুনরায় যাচাইয়ে মেলেনি।');
      setStatus('সংরক্ষণের ফোল্ডার বেছে নিন…');
      const directory = await Directory.pickDirectoryAsync();
      const existingNames = new Set(directory.list().map(entry => entry.name));
      const targetName = nonOverwritingName(filename, existingNames);
      const destination = directory.createFile(targetName, MIME_PDF);
      try {
        // SAF content URIs must receive the raw PDF bytes; copying avoids text/base64 conversions.
        await destination.write(sourceBytes);
        if (!destination.exists) throw new Error('সংরক্ষিত PDF ফাইলটি পাওয়া যায়নি।');
        if (!destination.uri.startsWith('content://')) throw new Error('Android SAF ফোল্ডারের বৈধ content URI পাওয়া যায়নি।');
        const savedBytes = await destination.bytes();
        assertSavedPdfMatchesSource(sourceBytes, pdf.pageCount, savedBytes);
      } catch (error) {
        try { if (destination.exists) destination.delete(); }
        catch (cleanupError) { attachCleanupError(error, cleanupError); }
        throw error;
      }
      setStatus('PDF নির্বাচিত ফোল্ডারে সংরক্ষিত হয়েছে।');
      Alert.alert('সংরক্ষণ সম্পন্ন', `${targetName}\nনির্বাচিত ফোল্ডারে PDF-টি সংরক্ষিত হয়েছে।`);
    } catch (error) {
      setStatus('');
      const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (errorCode.includes('CANCEL') || (error instanceof Error && /cancel/i.test(error.message))) return;
      Alert.alert('PDF সংরক্ষণ করা যায়নি', formatSaveError(error));
    } finally { operationLock.current = false; setBusy(null); }
  };

  const printPdf = async () => {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy('printing');
    try {
      const pdf = await getCurrentPdf('printing');
      activeTemporaryPdfs.add(pdf.file.uri);
      try { await Print.printAsync({ uri: pdf.file.uri }); }
      finally { activeTemporaryPdfs.delete(pdf.file.uri); }
      setStatus('Android Print dialog খোলা হয়েছে। প্রিন্ট সম্পন্ন হয়েছে কি না সেখানে নিশ্চিত করুন।');
    } catch (error) {
      setStatus('');
      Alert.alert('প্রিন্ট শুরু করা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।');
    } finally { operationLock.current = false; setBusy(null); }
  };

  const page = pages[currentPage] || [];
  const title = list.title.trim() || 'বাজারের তালিকা';
  const isBusy = busy !== null;
  const hasUnrenderableRow = layout.oversizedIds.length > 0 || layout.exceedsMaxPages;
  const paginationWarning = layout.exceedsMaxPages
    ? 'এই তালিকার জন্য ১০ পৃষ্ঠার বেশি লাগবে। কোনো তথ্য বাদ না দিয়ে PDF Export বন্ধ আছে।'
    : layout.oversizedIds.length
      ? 'কিছু পণ্যের নাম A4 পৃষ্ঠায় সম্পূর্ণ রাখা যাচ্ছে না। ছোট ফন্ট বেছে নিন বা নাম সংক্ষিপ্ত করুন।'
      : '';

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
    <SafeAreaView style={[s.screen, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[s.header, { borderBottomColor: colors.line }]}>
        <Pressable onPress={onClose} disabled={isBusy} style={s.back} accessibilityRole="button" accessibilityLabel="PDF Center বন্ধ করুন"><ThemedIcon role="primary" style={[s.backText, { color: colors.text }]}>‹</ThemedIcon></Pressable>
        <View style={s.headerCopy}><Text style={[s.headerTitle, { color: colors.text }]}>PDF Center</Text><Text style={[s.headerSubtitle, { color: colors.muted }]}>তালিকার পেশাদার PDF তৈরি করুন</Text></View>
        <Text style={[s.pdfMark, { color: colors.accent }]}>PDF</Text>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.sectionHeading}><Text style={[s.sectionTitle, { color: colors.text }]}>ডকুমেন্ট প্রিভিউ</Text><Text style={[s.pageCount, { color: colors.muted }]}>{bn(currentPage + 1)} / {bn(actualPageCount ?? pages.length)} পৃষ্ঠা{actualPageCount === null ? ' · আনুমানিক' : ''}</Text></View>
        <View style={[s.paper, { backgroundColor: '#fff', borderColor: colors.line, aspectRatio: pageAspect(), paddingHorizontal: DEFAULT_PDF_MARGIN_MM * previewScale, paddingTop: DEFAULT_PDF_MARGIN_MM * previewScale, paddingBottom: DEFAULT_PDF_MARGIN_MM * previewScale }]}>
          <Text style={[s.previewTitle, { fontSize: (options.fontSize + 5) * 0.3528 * previewScale }]}>আমার খাতা - {title}</Text>
          <View style={[s.previewTableHeader, { paddingVertical: 2 * previewScale }]}><Text style={[s.previewTh, s.numberCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>নং</Text><Text style={[s.previewTh, s.nameCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>পণ্যের নাম</Text><Text style={[s.previewTh, s.qtyCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>পরিমাণ</Text><Text style={[s.previewTh, s.statusCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>অবস্থা</Text><Text style={[s.previewTh, s.priceCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>দাম</Text></View>
          <ScrollView key={`${currentPage}-${options.fontSize}`} style={s.previewRows} contentContainerStyle={s.previewRowsContent} nestedScrollEnabled showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            {page.map((item, index) => { const absoluteIndex = pageStartIndex + index; return <View key={String(item.id)} style={[s.previewRow, { paddingVertical: 2 * previewScale, minHeight: layout.rowHeights[absoluteIndex] * previewScale }, isItemRowFilled(absoluteIndex) && s.previewFilledRow]}><Text style={[s.previewTd, s.numberCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>{bn(absoluteIndex + 1)}</Text><Text style={[s.previewTd, s.nameCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>{item.name}</Text><Text style={[s.previewTd, s.qtyCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>{item.qty || '—'}</Text><Text style={[s.previewTd, s.statusCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>{item.status === 'purchased' ? '✓ কেনা হয়েছে' : '□ বাকি'}</Text><Text style={[s.previewTd, s.priceCol, { fontSize: options.fontSize * 0.3528 * previewScale }]}>{typeof item.price === 'number' ? `৳${bn(item.price)}` : '—'}</Text></View>; })}
          </ScrollView>
          {currentPage === pages.length - 1 && <View style={[s.previewTotal, { minHeight: layout.totalRowHeightMm * previewScale }, isTotalRowFilled(printableItems.length) && s.previewTotalFilled]}><Text style={[s.previewTotalLabel, { fontSize: options.fontSize * 0.3528 * previewScale }]}>মোট :</Text><Text style={[s.previewTotalValue, { fontSize: options.fontSize * 0.3528 * previewScale }]} numberOfLines={1}>৳{bn(total)}</Text></View>}
          <View style={s.paperFooter}><Text style={s.footerText}>তারিখ: {date.toLocaleDateString('bn-BD')}</Text><Text style={s.footerText}>পৃষ্ঠা {bn(currentPage + 1)} / {bn(pages.length)}</Text></View>
        </View>
        <View style={s.pageNav}><Pressable disabled={currentPage === 0 || isBusy} onPress={() => setPageIndex(Math.max(0, currentPage - 1))} style={[s.pageButton, { borderColor: colors.line, flexDirection: 'row', gap: 4 }]}><ThemedIcon role={currentPage === 0 || isBusy ? 'disabled' : 'primary'}>‹</ThemedIcon><Text style={{ color: colors.text }}>আগের পৃষ্ঠা</Text></Pressable><Pressable disabled={currentPage >= pages.length - 1 || isBusy} onPress={() => setPageIndex(Math.min(pages.length - 1, currentPage + 1))} style={[s.pageButton, { borderColor: colors.line, flexDirection: 'row', gap: 4 }]}><Text style={{ color: colors.text }}>পরের পৃষ্ঠা</Text><ThemedIcon role={currentPage >= pages.length - 1 || isBusy ? 'disabled' : 'primary'}>›</ThemedIcon></Pressable></View>

        <Text style={[s.sectionTitle, s.controlsTitle, { color: colors.text }]}>A4 পৃষ্ঠা ও টাইপসেটিং</Text>
        <Text style={[s.controlLabel, { color: colors.muted }]}>মার্জিন: {bn(DEFAULT_PDF_MARGIN_MM)} মিমি · স্থির A4 Portrait</Text>
        <Text style={[s.controlLabel, { color: colors.muted, marginTop: 9 }]}>ফন্ট সাইজ · {bn(options.fontSize)} pt</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled"><View style={s.fontChoices}>{FONT_SIZES.map(size => <Pressable key={size} disabled={isBusy} onPress={() => setOptions({ fontSize: size })} style={[s.fontChoice, { borderColor: size === options.fontSize ? colors.accent : colors.line, backgroundColor: size === options.fontSize ? colors.wash : colors.surface }]} accessibilityRole="button" accessibilityLabel={`ফন্ট সাইজ ${size} পয়েন্ট`}><Text style={{ color: size === options.fontSize ? colors.accent : colors.text, fontSize: 11 }}>{size}</Text></Pressable>)}</View></ScrollView>
        <View style={[s.financialCard, { backgroundColor: colors.surface, borderColor: colors.line }]}><Text style={[s.financialTitle, { color: colors.text }]}>আর্থিক সারাংশ</Text><Text style={[s.financialText, { color: colors.muted }]}>কেনা পণ্যের নথিভুক্ত মোট খরচ: <Text style={{ color: colors.accent, fontWeight: '700' }}>৳{bn(total)}</Text></Text><Text style={[s.financialText, { color: colors.muted }]}>বাকি পণ্য: {bn(printableItems.filter(item => item.status !== 'purchased').length)}টি · কেনা পণ্য: {bn(printableItems.filter(item => item.status === 'purchased').length)}টি</Text></View>

        {!!paginationWarning && <Text style={[s.status, { color: colors.muted }]} accessibilityLiveRegion="polite">{paginationWarning}</Text>}
        {!!status && <Text style={[s.status, { color: colors.muted }]} accessibilityLiveRegion="polite">{status}</Text>}
        {busy === 'generating' && <View style={s.progress}><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.muted }}>স্থানীয়ভাবে PDF তৈরি হচ্ছে…</Text></View>}
        <Pressable disabled={isBusy || !printableItems.length || hasUnrenderableRow} onPress={() => { void sharePdf(); }} style={[s.primary, { backgroundColor: colors.accent }, (isBusy || !printableItems.length || hasUnrenderableRow) && s.disabled]} accessibilityRole="button"><Text style={s.primaryText}>{busy === 'sharing' ? 'তৈরি ও শেয়ার হচ্ছে…' : 'PDF তৈরি করে শেয়ার করুন'}</Text></Pressable>
        <View style={s.actionRow}>
          <Pressable disabled={isBusy || !printableItems.length || hasUnrenderableRow} onPress={() => { void savePdf(); }} style={[s.secondary, { borderColor: colors.line, backgroundColor: colors.surface }, (isBusy || !printableItems.length || hasUnrenderableRow) && s.disabled]} accessibilityRole="button"><Text style={{ color: colors.text }}>{busy === 'saving' ? 'সংরক্ষণ হচ্ছে…' : 'ডিভাইসে Save'}</Text></Pressable>
          <Pressable disabled={isBusy || !printableItems.length || hasUnrenderableRow} onPress={() => { void printPdf(); }} style={[s.secondary, { borderColor: colors.line, backgroundColor: colors.surface }, (isBusy || !printableItems.length || hasUnrenderableRow) && s.disabled]} accessibilityRole="button"><Text style={{ color: colors.text }}>{busy === 'printing' ? 'প্রিন্ট হচ্ছে…' : 'Direct Print'}</Text></Pressable>
        </View>
        <Text style={[s.privacyNote, { color: colors.muted }]}>PDF ফোনের সাময়িক স্টোরেজে তৈরি হয়। শেয়ার বা Print-এর জন্য আগে Save করার দরকার নেই; কোনো PDF Firebase বা Cloud-এ পাঠানো হয় না।</Text>
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

function pageDimensions() {
  return getPageDimensions();
}

function pageAspect() {
  const size = pageDimensions();
  return size.width / size.height;
}

async function assertPdfFile(file: File) {
  if (!file.exists || !Number.isSafeInteger(file.size) || file.size < 8 || !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('PDF ফাইলটি অসম্পূর্ণ বা অবৈধ।');
  }
  try { return readPdfPageCount(await file.bytes()); }
  catch { throw new Error('PDF signature, page objects বা শেষ marker বৈধ নয়; ফাইলটি শেয়ার বা সংরক্ষণ করা হয়নি।'); }
}

function uniqueCacheFile() {
  const existing = new Set(Paths.cache.list().filter(entry => entry instanceof File).map(entry => entry.name));
  let suffix = 0;
  let name = `${TEMP_PREFIX}${Date.now()}.pdf`;
  while (existing.has(name)) { suffix += 1; name = `${TEMP_PREFIX}${Date.now()}-${suffix}.pdf`; }
  return new File(Paths.cache, name);
}

function nonOverwritingName(filename: string, existingNames: Set<string>) {
  if (!existingNames.has(filename)) return filename;
  const suffix = filename.slice(0, -4);
  let number = 2;
  while (existingNames.has(`${suffix}-${number}.pdf`)) number += 1;
  return `${suffix}-${number}.pdf`;
}

function nativeErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return { message: String(error), code: '' };
  const record = error as { message?: unknown; code?: unknown };
  return {
    message: typeof record.message === 'string' ? record.message : String(error),
    code: typeof record.code === 'string' || typeof record.code === 'number' ? String(record.code) : '',
  };
}

function attachCleanupError(error: unknown, cleanupError: unknown) {
  if (error && typeof error === 'object') {
    try { Object.defineProperty(error, 'cleanupError', { value: cleanupError, configurable: true }); }
    catch { /* Keep the original native write error if it cannot be annotated. */ }
  }
}

function formatSaveError(error: unknown) {
  const primary = nativeErrorDetails(error);
  const cleanup = error && typeof error === 'object' && 'cleanupError' in error
    ? nativeErrorDetails((error as { cleanupError: unknown }).cleanupError)
    : null;
  const details = [
    primary.message ? `বিস্তারিত: ${primary.message}` : '',
    primary.code ? `Error code: ${primary.code}` : '',
    cleanup ? `অসম্পূর্ণ ফাইল পরিষ্কারের ত্রুটি: ${cleanup.message}${cleanup.code ? ` (${cleanup.code})` : ''}` : '',
  ].filter(Boolean).join('\n');
  return `ফোল্ডার নির্বাচন, অনুমতি এবং স্টোরেজ পরীক্ষা করে আবার চেষ্টা করুন।${details ? `\n\n${details}` : ''}`;
}

const light = { background: '#f7f8f5', surface: '#fff', text: '#1e2822', muted: '#67736b', line: '#dce4dd', accent: '#18794e', wash: '#e8f4ed', input: '#fff' };
const dark = { background: '#0c1117', surface: '#141c25', text: '#edf2f4', muted: '#9ca8a1', line: '#293640', accent: '#45bd86', wash: '#142c22', input: '#101820' };
const s = StyleSheet.create({
  previewTh: { color: '#23392e', fontWeight: '700', borderWidth: StyleSheet.hairlineWidth, borderColor: '#cad8cf', paddingHorizontal: 1 },
  screen: { flex: 1 }, header: { minHeight: 66, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 11 }, back: { width: 42, height: 48, justifyContent: 'center' }, backText: { fontSize: 36, lineHeight: 40 }, headerCopy: { flex: 1 }, headerTitle: { fontSize: 18, fontWeight: '700' }, headerSubtitle: { fontSize: 11, marginTop: 2 }, pdfMark: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2 }, content: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 28 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }, sectionTitle: { fontSize: 15, fontWeight: '700' }, pageCount: { fontSize: 11 }, paper: { width: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 2, alignSelf: 'center', flexDirection: 'column', overflow: 'hidden', elevation: 2 }, previewTitle: { color: '#167455', fontWeight: '700', marginBottom: 0, paddingBottom: 0 }, previewTableHeader: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#e6f0ea' }, previewRows: { flex: 1, minHeight: 0 }, previewRowsContent: { flexGrow: 0 }, previewRow: { flexDirection: 'row', alignItems: 'stretch' }, previewTd: { color: '#243129', borderWidth: StyleSheet.hairlineWidth, borderColor: '#d4dfd8', paddingHorizontal: 1, textAlignVertical: 'center' }, previewFilledRow: { backgroundColor: '#f0f5f2' }, numberCol: { width: '5%' }, nameCol: { width: '52%' }, qtyCol: { width: '13%' }, statusCol: { width: '18%' }, priceCol: { width: '12%', textAlign: 'right' }, previewTotal: { flexDirection: 'row', alignItems: 'stretch' }, previewTotalFilled: { backgroundColor: '#f0f5f2' }, previewTotalLabel: { width: '68%', color: '#24392d', fontWeight: '700', borderWidth: StyleSheet.hairlineWidth, borderColor: '#b9cec1', paddingHorizontal: 2 }, previewTotalValue: { width: '32%', color: '#24392d', fontWeight: '700', textAlign: 'right', borderWidth: StyleSheet.hairlineWidth, borderColor: '#b9cec1', paddingHorizontal: 2, flexShrink: 0 }, paperFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#cad8cf' }, footerText: { color: '#65736b', fontSize: 7 }, pageNav: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 8 }, pageButton: { flex: 1, minHeight: 38, borderWidth: 1, borderRadius: 9, justifyContent: 'center', alignItems: 'center' }, controlsTitle: { marginTop: 22, marginBottom: 10 }, controlLabel: { fontSize: 11, marginBottom: 6 }, fontChoices: { flexDirection: 'row', gap: 4, paddingRight: 4 }, fontChoice: { width: 32, height: 38, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, financialCard: { marginTop: 16, borderWidth: 1, borderRadius: 11, padding: 12, gap: 5 }, financialTitle: { fontSize: 12, fontWeight: '700' }, financialText: { fontSize: 11, lineHeight: 17 }, status: { textAlign: 'center', fontSize: 11, marginTop: 12 }, progress: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9, marginTop: 10 }, primary: { minHeight: 48, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 15 }, primaryText: { color: '#fff', fontSize: 14, fontWeight: '700' }, actionRow: { flexDirection: 'row', gap: 9, marginTop: 9 }, secondary: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.55 }, privacyNote: { fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 13 },
});
