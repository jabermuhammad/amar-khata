import React, { useContext } from 'react';
import { Pressable as NativePressable, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';
import { ThemeSurfaceContext, adaptThemeStyle, styleIsAccent } from './ThemePrimitives';
import { useTheme } from '../contexts/ThemeContext';

/** Kept as the app-wide Pressable alias; preserves caller styles and behavior. */
export function GlossyPressable({ style, children, ...props }: PressableProps) {
  const { theme } = useTheme();
  const inheritedAccent = useContext(ThemeSurfaceContext);
  const accent = styleIsAccent(style) || inheritedAccent;
  const themedStyle: PressableProps['style'] = typeof style === 'function'
    ? (state: PressableStateCallbackType) => adaptThemeStyle(style(state), theme, accent) as StyleProp<ViewStyle>
    : adaptThemeStyle(style, theme, accent) as StyleProp<ViewStyle>;
  if (typeof children === 'function') return <NativePressable {...props} style={themedStyle}>{state => <ThemeSurfaceContext.Provider value={accent}>{children(state)}</ThemeSurfaceContext.Provider>}</NativePressable>;
  return <NativePressable {...props} style={themedStyle}><ThemeSurfaceContext.Provider value={accent}>{children}</ThemeSurfaceContext.Provider></NativePressable>;
}
