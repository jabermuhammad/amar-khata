export type ThemeMode = 'light' | 'dark' | 'system' | 'scheduled';
export type SemanticIconRole = 'primary' | 'secondary' | 'disabled' | 'destructive' | 'success' | 'informational' | 'inverse';
export function semanticIconColor(role: SemanticIconRole, theme: 'light' | 'dark'): string;
export function isLightScheduleTime(now: Date, lightAt?: string, darkAt?: string): boolean;
export function resolveTheme(mode: ThemeMode, systemScheme: 'light' | 'dark' | null | undefined, now: Date, lightAt: string, darkAt: string): 'light' | 'dark';
export function shouldShowBottomNavigation(segment: string | undefined): boolean;
export function mayDeleteResource(value: { local: boolean; cloudLinked: boolean; permission?: string; currentScopeMatches: boolean }): boolean;
