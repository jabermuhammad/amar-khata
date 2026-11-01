export type Status = 'pending' | 'purchased' | 'omitted' | 'new';
export type Item = { id: number | string; name: string; qty: string; status: Status; price?: number };
export type ListId = string;
export type ListCategory = 'today' | 'monthly' | 'gift';
export type ShoppingList = { title: string; category?: ListCategory; createdAt?: string; items: Item[]; cloudId?: string };
export type Note = { id?: string; title: string; body: string; createdAt?: string; updatedAt?: string; cloudId?: string };

export const normalizeStoredLists = (value: unknown): Record<ListId, ShoppingList> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const list = raw as Partial<ShoppingList>;
    const category = list.category === 'today' || list.category === 'monthly' || list.category === 'gift' ? list.category : undefined;
    return [[id, { ...list, title: typeof list.title === 'string' ? list.title : '', category, createdAt: typeof list.createdAt === 'string' ? list.createdAt : undefined, items: Array.isArray(list.items) ? list.items : [] } as ShoppingList]];
  }));
};

export const removeEmptyLocalListDrafts = (lists: Record<ListId, ShoppingList>): Record<ListId, ShoppingList> => Object.fromEntries(
  Object.entries(lists).filter(([, list]) => Boolean(list.cloudId || list.title.trim() || list.items.length)),
);

export const STORE = { photo: 'amar-khata-profile-photo', note: 'amar-khata-note', notes: 'amar-khata-notes', lists: 'amar-khata-lists' };
export const initialLists: Record<ListId, ShoppingList> = {
  today: { title: 'আজকের বাজার', category: 'today', createdAt: new Date().toISOString(), items: [
    { id: 1, name: 'মিনিকেট চাল', qty: '৫ কেজি', status: 'pending' },
    { id: 2, name: 'সরিষার তেল', qty: '২ লিটার', status: 'purchased', price: 410 },
    { id: 3, name: 'দেশি পেঁয়াজ', qty: '২ কেজি', status: 'new' },
    { id: 4, name: 'কাঁচা মরিচ', qty: '২৫০ গ্রাম', status: 'omitted' },
  ] },
  monthly: { title: 'মাসিক বাজার', category: 'monthly', createdAt: new Date().toISOString(), items: [
    { id: 11, name: 'আটা', qty: '৫ কেজি', status: 'purchased', price: 340 },
    { id: 12, name: 'মসুর ডাল', qty: '২ কেজি', status: 'pending' },
    { id: 13, name: 'গুঁড়া দুধ', qty: '১ প্যাকেট', status: 'pending' },
  ] },
  gift: { title: 'উপহারের তালিকা', category: 'gift', createdAt: new Date().toISOString(), items: [] },
};
export const initialNote: Note = {
  title: 'আগামী সপ্তাহের পরিকল্পনা',
  body: 'মঙ্গলবারের সভার আগে উপস্থাপনার খসড়া শেষ করতে হবে।\n\n• গবেষণার তথ্যগুলো আবার যাচাই করা\n• দলের সবার মতামত নেওয়া\n• চূড়ান্ত নকশা প্রস্তুত করা\n\nবৃহস্পতিবার বিকেলে মায়ের সঙ্গে ডাক্তারের কাছে যেতে হবে।',
};
export const bn = (value: number) => value.toLocaleString('bn-BD');
