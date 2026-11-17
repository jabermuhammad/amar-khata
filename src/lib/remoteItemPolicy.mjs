/** Use the UI-created item ID as the Firestore document ID. This makes an
 * add retry target the same document and keeps immediate edits/deletes aligned
 * with the live snapshot instead of creating an unrelated random document. */
export function remoteItemDocumentId(id) {
  const value = String(id ?? '').trim();
  if (!value || value.includes('/') || value === '.' || value === '..' || value.length > 120) {
    throw new Error('পণ্যের স্থায়ী ID সঠিক নয়; আবার যোগ করার আগে তালিকা রিফ্রেশ করুন।');
  }
  return value;
}
