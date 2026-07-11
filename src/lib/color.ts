/**
 * sRGB <-> HSV conversions for the accent color picker.
 *
 * Material's own `Hct` is perceptual, which is what makes it right for growing
 * a palette from a seed and wrong for a picker wheel: its chroma ceiling moves
 * with hue and tone, so a fixed-radius wheel would have unreachable regions.
 * HSV is a plain cylinder and maps onto (angle, radius, overlay) exactly.
 */

export interface RGB {
  /** 0-255, integral. */
  r: number;
  g: number;
  b: number;
}

export interface HSV {
  /** Degrees, [0, 360). */
  h: number;
  /** [0, 1] */
  s: number;
  /** [0, 1] */
  v: number;
}

export type Channel = keyof RGB;

const HEX_PATTERN = /^#?(?:[\da-f]{3}|[\da-f]{6})$/i;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Accepts `#abc`, `abc`, `#aabbcc`, `aabbcc`. Null when the text is not a color. */
export function parseHex(input: string): RGB | null {
  const trimmed = input.trim();
  if (!HEX_PATTERN.test(trimmed)) return null;

  const digits = trimmed.replace('#', '');
  const full =
    digits.length === 3
      ? digits.replace(/./g, (digit) => digit + digit)
      : digits;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function formatHex({ r, g, b }: RGB): string {
  const digits = [r, g, b].map((channel) => channel.toString(16).padStart(2, '0'));
  return `#${digits.join('')}`;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const value = Math.max(red, green, blue);
  const chroma = value - Math.min(red, green, blue);

  // A neutral has no angle to recover; callers that need to keep a hue across
  // a trip through gray must hold onto their own HSV rather than re-deriving.
  let hue = 0;
  if (chroma !== 0) {
    if (value === red) hue = 60 * ((green - blue) / chroma);
    else if (value === green) hue = 60 * ((blue - red) / chroma + 2);
    else hue = 60 * ((red - green) / chroma + 4);
  }

  return {
    h: (hue + 360) % 360,
    s: value === 0 ? 0 : chroma / value,
    v: value,
  };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hue = ((h % 360) + 360) % 360;
  const chroma = v * s;
  // The channel between the max and the min, falling off linearly across each
  // 60-degree sector.
  const mid = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const floor = v - chroma;

  const sector = Math.floor(hue / 60) % 6;
  const [red, green, blue] = [
    [chroma, mid, 0],
    [mid, chroma, 0],
    [0, chroma, mid],
    [0, mid, chroma],
    [mid, 0, chroma],
    [chroma, 0, mid],
  ][sector];

  return {
    r: Math.round((red + floor) * 255),
    g: Math.round((green + floor) * 255),
    b: Math.round((blue + floor) * 255),
  };
}

export function hsvToHex(hsv: HSV): string {
  return formatHex(hsvToRgb(hsv));
}
