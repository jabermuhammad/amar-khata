/** Keep loading, empty and failed data states distinct for the Lists screen. */
export function getListScreenState({ rows, localLoading, remoteLoading, localError, remoteError }) {
  if (rows.length > 0) return 'content';
  if (localLoading || remoteLoading) return 'loading';
  if (localError || remoteError) return 'error';
  return 'empty';
}
