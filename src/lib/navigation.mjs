/** Navigate back when a screen has history, otherwise replace with its parent route. */
export function goBackOrReplace(router, fallbackRoute) {
  if (router.canGoBack()) {
    router.back();
    return 'back';
  }
  router.replace(fallbackRoute);
  return 'replace';
}
