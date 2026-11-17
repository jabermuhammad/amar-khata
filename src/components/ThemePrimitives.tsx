import React, { createContext, forwardRef, useContext } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View, type KeyboardAvoidingViewProps, type ScrollViewInstance, type ScrollViewProps, type TextInputInstance, type TextInputProps, type TextProps, type ViewProps, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { semanticIconColor, type SemanticIconRole } from '../lib/themePolicy.mjs';

type Theme = 'light' | 'dark';
const colors = {
  light: { bg: '#fafaf7', surface: '#ffffff', surface2: '#f1f4ef', text: '#20231f', muted: '#747d74', border: '#e5e9e1' },
  dark: { bg: '#0c1117', surface: '#141c25', surface2: '#19222d', text: '#eef2f4', muted: '#98a4ad', border: '#26323e' },
};
export const ThemeSurfaceContext = createContext(false);

function channelInfo(color: string) {
  const match = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const hex = match?.[1].length === 3 ? [...match[1]].map(value => value + value).join('') : match?.[1];
  if (!hex) return null;
  const values = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
  return { luminance: values.reduce((sum, value) => sum + value, 0) / (3 * 255), saturation: (Math.max(...values) - Math.min(...values)) / 255 };
}
export function styleIsAccent(style: unknown) {
  const values = Array.isArray(style) ? style : [style];
  return values.some(value => {
    if (!value || typeof value !== 'object') return false;
    const bg = (value as Record<string, unknown>).backgroundColor;
    const info = typeof bg === 'string' ? channelInfo(bg) : null;
    return Boolean(info && info.saturation > 0.09);
  });
}
function adaptColor(value: unknown, property: string, theme: Theme, accent: boolean) {
  if (typeof value !== 'string' || value.startsWith('rgba') || value.startsWith('hsla')) return value;
  const info = channelInfo(value);
  if (!info || info.saturation > 0.09) return value;
  const { luminance: lum } = info;
  if (theme === 'dark') {
    if (property === 'color' || property === 'placeholderTextColor') return lum < 0.34 ? (lum < 0.12 ? colors.dark.muted : colors.dark.text) : value;
    if (property.startsWith('border') && lum > 0.45) return colors.dark.border;
    if (property === 'backgroundColor') {
      if (value.toLowerCase() === '#fafaf7') return colors.dark.bg;
      if (value.toLowerCase() === '#ffffff' || value.toLowerCase() === '#fff') return colors.dark.surface;
      return lum > 0.88 ? colors.dark.surface : lum > 0.55 ? colors.dark.surface2 : value;
    }
    return value;
  }
  if (property === 'color' || property === 'placeholderTextColor') {
    if (lum > 0.92 && accent) return value;
    return lum < 0.38 || lum > 0.92 ? (lum < 0.12 ? colors.light.muted : colors.light.text) : value;
  }
  if (property.startsWith('border') && lum < 0.35) return colors.light.border;
  if (property === 'backgroundColor' && lum < 0.24) return lum < 0.10 ? colors.light.bg : lum < 0.19 ? colors.light.surface : colors.light.surface2;
  return value;
}
export function adaptThemeStyle(style: unknown, theme: Theme, accent = false): unknown {
  if (Array.isArray(style)) return style.map(value => adaptThemeStyle(value, theme, accent));
  if (!style || typeof style !== 'object') return style;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) output[key] = /color$/i.test(key) ? adaptColor(value, key, theme, accent) : value;
  return output;
}

export const ThemedView = forwardRef<React.ElementRef<typeof View>, ViewProps>(function ThemedView({ style, ...props }, ref) {
  const { theme } = useTheme();
  const inheritedAccent = useContext(ThemeSurfaceContext);
  const accent = styleIsAccent(style) || inheritedAccent;
  return <ThemeSurfaceContext.Provider value={accent}><View {...props} ref={ref as never} style={adaptThemeStyle(style, theme) as StyleProp<ViewStyle>} /></ThemeSurfaceContext.Provider>;
});
export const ThemedText = forwardRef<React.ElementRef<typeof Text>, TextProps>(function ThemedText({ style, ...props }, ref) {
  const { theme } = useTheme();
  const accent = useContext(ThemeSurfaceContext);
  return <Text {...props} ref={ref as never} style={[{ fontFamily: 'UN Bangla' }, adaptThemeStyle(style, theme, accent) as StyleProp<TextStyle>]} />;
});
export function ThemedIcon({ role = 'secondary', children, style, ...props }: Omit<TextProps, 'role'> & { role?: SemanticIconRole }) {
  const { theme } = useTheme();
  return <Text {...props} style={[style, { color: semanticIconColor(role, theme) }]}>{children}</Text>;
}
export const ThemedTextInput = forwardRef<TextInputInstance, TextInputProps>(function ThemedTextInput({ style, placeholderTextColor, selectionColor, ...props }, ref) {
  const { theme } = useTheme();
  const palette = colors[theme];
  return <TextInput {...props} ref={ref} style={[{ fontFamily: 'UN Bangla' }, adaptThemeStyle(style, theme) as StyleProp<TextStyle>]} placeholderTextColor={placeholderTextColor || palette.muted} selectionColor={selectionColor || '#2aab6d'} />;
});
export const ThemedScrollView = forwardRef<ScrollViewInstance, ScrollViewProps>(function ThemedScrollView({ style, contentContainerStyle, ...props }, ref) {
  const { theme } = useTheme();
  return <ScrollView {...props} ref={ref} style={adaptThemeStyle(style, theme) as StyleProp<ViewStyle>} contentContainerStyle={adaptThemeStyle(contentContainerStyle, theme) as StyleProp<ViewStyle>} />;
});
export const ThemedKeyboardAvoidingView = forwardRef<React.ElementRef<typeof KeyboardAvoidingView>, KeyboardAvoidingViewProps>(function ThemedKeyboardAvoidingView({ style, ...props }, ref) {
  const { theme } = useTheme();
  return <KeyboardAvoidingView {...props} ref={ref as never} style={adaptThemeStyle(style, theme) as StyleProp<ViewStyle>} />;
});
export const ThemedSafeAreaView = forwardRef<React.ElementRef<typeof SafeAreaView>, SafeAreaViewProps>(function ThemedSafeAreaView({ style, ...props }, ref) {
  const { theme } = useTheme();
  return <SafeAreaView {...props} ref={ref as never} style={adaptThemeStyle(style, theme) as StyleProp<ViewStyle>} />;
});
