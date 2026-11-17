import type { Href } from 'expo-router';

export type BackNavigationRouter = {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: Href) => void;
};

export function goBackOrReplace(router: BackNavigationRouter, fallbackRoute: Href): 'back' | 'replace';
