/** Avoid network work until Android reports a connected, reachable network. */
export function isInternetAvailable(state) {
  if (!state || state.isConnected !== true || state.isInternetReachable === false) return false;
  return true;
}
