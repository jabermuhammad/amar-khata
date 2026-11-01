import React from 'react';
import { Image } from 'react-native';

export default function ShoppingCartIcon({ size = 28, color = '#f4fffa' }: { size?: number; color?: string }) {
  return <Image
    source={require('../../assets/shopping-cart.png')}
    style={{ width: size, height: size, tintColor: color }}
    resizeMode="contain"
    accessibilityLabel="বাজারের কার্ট"
  />;
}
