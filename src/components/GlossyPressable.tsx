import React from 'react';
import { Pressable as NativePressable, StyleSheet, View, type PressableProps } from 'react-native';

const glossColor = 'rgba(255,255,255,0.18)';

/** Adds a restrained top highlight and shallow depth to solid interactive surfaces. */
export function GlossyPressable({ style, children, ...props }: PressableProps) {
  if (typeof style === 'function' || typeof children === 'function') {
    return <NativePressable {...props} style={style}>{children}</NativePressable>;
  }
  const flattened = StyleSheet.flatten(style);
  const backgroundColor = flattened?.backgroundColor;
  const hasGloss = typeof backgroundColor === 'string' && backgroundColor !== 'transparent' && !backgroundColor.startsWith('rgba(');
  if (!hasGloss || !flattened) return <NativePressable {...props} style={style}>{children}</NativePressable>;
  const radius = flattened.borderRadius || 0;
  return (
    <NativePressable
      {...props}
      style={style}
    >
      {children}
      <View pointerEvents="none" style={[s.gloss, {
        borderTopLeftRadius: flattened.borderTopLeftRadius || radius,
        borderTopRightRadius: flattened.borderTopRightRadius || radius,
      }]} />
    </NativePressable>
  );
}

const s = StyleSheet.create({ gloss: { position: 'absolute', top: 0, left: 1, right: 1, height: 2, backgroundColor: glossColor } });
