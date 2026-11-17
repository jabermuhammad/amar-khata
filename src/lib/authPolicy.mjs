export function normalizeAuthEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function canLinkGoogleEmail(accountEmail, googleEmail) {
  const account = normalizeAuthEmail(accountEmail);
  const google = normalizeAuthEmail(googleEmail);
  return Boolean(account && google && account === google);
}
