import {
  argbFromHex,
  hexFromArgb,
  Hct,
  themeFromSourceColor,
} from '@material/material-color-utilities';

import type { Scheme } from '@material/material-color-utilities';

/**
 * Runtime Material 3 palette generation. A single seed color expands into the
 * full token set for both schemes via the same algorithm Android and Flutter
 * use, so `theme.css`'s static blue becomes the pre-hydration fallback and the
 * live palette is whatever accent the user picked.
 */

export interface AccentPreset {
  hex: string;
  name: string;
}

/** The default seed reproduces the Flutter app's blue (`theme.blue.dart`). */
export const DEFAULT_ACCENT = '#006496';

export const PRESET_ACCENTS: AccentPreset[] = [
  {
    hex: DEFAULT_ACCENT,
    name: 'Blue',
  },
  {
    hex: '#4355b9',
    name: 'Indigo',
  },
  {
    hex: '#6750a4',
    name: 'Violet',
  },
  {
    hex: '#984061',
    name: 'Magenta',
  },
  {
    hex: '#b3261e',
    name: 'Red',
  },
  {
    hex: '#8b5000',
    name: 'Orange',
  },
  {
    hex: '#386a20',
    name: 'Green',
  },
  {
    hex: '#00696d',
    name: 'Teal',
  },
];

/**
 * CSS custom property -> Scheme accessor. Scheme exposes its tokens as
 * prototype getters, so they cannot be enumerated; naming each one also keeps
 * the mapping back to `theme.css` explicit.
 */
const TOKENS: Record<string, (scheme: Scheme) => number> = {
  '--primary': (s) => s.primary,
  '--on-primary': (s) => s.onPrimary,
  '--primary-container': (s) => s.primaryContainer,
  '--on-primary-container': (s) => s.onPrimaryContainer,
  '--inverse-primary': (s) => s.inversePrimary,

  '--secondary': (s) => s.secondary,
  '--on-secondary': (s) => s.onSecondary,
  '--secondary-container': (s) => s.secondaryContainer,
  '--on-secondary-container': (s) => s.onSecondaryContainer,

  '--tertiary': (s) => s.tertiary,
  '--on-tertiary': (s) => s.onTertiary,
  '--tertiary-container': (s) => s.tertiaryContainer,
  '--on-tertiary-container': (s) => s.onTertiaryContainer,

  '--error': (s) => s.error,
  '--on-error': (s) => s.onError,
  '--error-container': (s) => s.errorContainer,
  '--on-error-container': (s) => s.onErrorContainer,

  '--background': (s) => s.background,
  '--on-background': (s) => s.onBackground,

  '--surface': (s) => s.surface,
  '--on-surface': (s) => s.onSurface,

  '--surface-variant': (s) => s.surfaceVariant,
  '--on-surface-variant': (s) => s.onSurfaceVariant,

  '--inverse-surface': (s) => s.inverseSurface,
  '--on-inverse-surface': (s) => s.inverseOnSurface,

  '--outline': (s) => s.outline,
  '--outline-variant': (s) => s.outlineVariant,

  '--shadow': (s) => s.shadow,
  '--scrim': (s) => s.scrim,

  // Material draws the surface tint from the primary tonal palette.
  '--surface-tint': (s) => s.primary,
};

/** Deriving a theme walks six tonal palettes; seeds repeat on every scheme flip. */
const cache = new Map<string, {
  light: Scheme;
  dark: Scheme;
}>();

function schemesFor(seedHex: string): {
  light: Scheme;
  dark: Scheme;
} {
  const cached = cache.get(seedHex);
  if (cached !== undefined) return cached;

  const schemes = themeFromSourceColor(argbFromHex(seedHex)).schemes;
  cache.set(seedHex, schemes);
  return schemes;
}

/**
 * Writes the generated palette as inline custom properties on <html>, which
 * override the static values in `theme.css`. `--divider` is left alone: it is
 * defined relative to `--outline-variant` and follows automatically. The
 * always-dark `--dark-*` tokens (app bar, toasts) stay static by design.
 */
export function applyDynamicColor(seedHex: string, mode: 'light' | 'dark'): void {
  const scheme = schemesFor(seedHex)[mode];
  const style = document.documentElement.style;

  for (const [property, read] of Object.entries(TOKENS)) {
    style.setProperty(property, hexFromArgb(read(scheme)));
  }
}

/**
 * Black or white, whichever stays legible drawn directly on `hex`. Material
 * flips ink at tone 60, which is where a hue stops reading as "dark".
 */
export function contrastingInk(hex: string): string {
  return Hct.fromInt(argbFromHex(hex)).tone >= 60 ? '#000000' : '#ffffff';
}
