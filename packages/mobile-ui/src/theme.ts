/** Thème commun aux applications mobiles (sera personnalisable par traiteur). */
export const colors = {
  primary: '#B45309',
  primaryForeground: '#FFFFFF',
  background: '#FFFBF5',
  surface: '#FFFFFF',
  text: '#1C1917',
  textMuted: '#78716C',
  border: '#E7E5E4',
  danger: '#B91C1C',
  success: '#15803D',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

export const fontSizes = {
  sm: 13,
  md: 16,
  lg: 20,
  xl: 28,
} as const;

export const theme = { colors, spacing, radius, fontSizes } as const;
export type Theme = typeof theme;
