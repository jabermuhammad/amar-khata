export function permissionForResourceSummary(kind, membership) {
  if (!membership) return null;
  const permission = membership.permission;
  const allowed = kind === 'list'
    ? ['owner', 'editor', 'shopper']
    : kind === 'note'
      ? ['owner', 'editor', 'viewer']
      : [];
  if (!allowed.includes(permission)) throw new Error('Cloud resource-এর permission যাচাই করা যায়নি; তালিকাটি খোলা হয়নি।');
  return permission;
}

export function assertFirebaseUidMatches(currentUid, uid) {
  if (!uid || !currentUid || currentUid !== uid) throw new Error('বর্তমান Firebase account যাচাই করা যায়নি। আবার সাইন ইন করুন।');
}

export function inviteTargetEmailError(actorEmail, targetEmail) {
  const normalizedActor = typeof actorEmail === 'string' ? actorEmail.trim().toLowerCase() : '';
  const normalizedTarget = typeof targetEmail === 'string' ? targetEmail.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedTarget)) return 'সঠিক ইমেইল ঠিকানা লিখুন।';
  if (normalizedActor && normalizedActor === normalizedTarget) return 'নিজের ইমেইলে invite পাঠানো যাবে না। অন্য account-এর ইমেইল লিখুন।';
  return null;
}
