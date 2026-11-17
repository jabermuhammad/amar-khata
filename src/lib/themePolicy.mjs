export const THEME_MODES = ['light', 'dark', 'system', 'scheduled'];

const SEMANTIC_ICON_COLORS = {
  light: { primary: '#27804d', secondary: '#68736f', disabled: '#a0aaa3', destructive: '#b33a45', success: '#27804d', informational: '#3176a8', inverse: '#ffffff' },
  dark: { primary: '#8bd5a5', secondary: '#98a4ad', disabled: '#67727b', destructive: '#ff8d91', success: '#8bd5a5', informational: '#86bde8', inverse: '#102016' },
};

export function semanticIconColor(role, theme) {
  return SEMANTIC_ICON_COLORS[theme === 'dark' ? 'dark' : 'light'][role] || SEMANTIC_ICON_COLORS[theme === 'dark' ? 'dark' : 'light'].secondary;
}

export function isLightScheduleTime(now, lightAt = '06:00', darkAt = '18:00') {
  const minute = now.getHours() * 60 + now.getMinutes();
  const toMinutes = value => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [hour, minutes] = value.split(':').map(Number);
    return hour * 60 + minutes;
  };
  const start = toMinutes(lightAt);
  const end = toMinutes(darkAt);
  if (start === null || end === null || start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function resolveTheme(mode, systemScheme, now, lightAt, darkAt) {
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'scheduled') return isLightScheduleTime(now, lightAt, darkAt) ? 'light' : 'dark';
  return systemScheme === 'light' ? 'light' : 'dark';
}

export function shouldShowBottomNavigation(segment) {
  return segment === 'index' || segment === 'lists' || segment === 'notes';
}

export function mayDeleteResource({ local, cloudLinked, permission, currentScopeMatches }) {
  if (!currentScopeMatches) return false;
  if (!cloudLinked) return Boolean(local);
  return permission === 'owner';
}
