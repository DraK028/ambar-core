import { useColorScheme } from 'react-native';

/** Misma paleta que la banca web: grafito verdoso con acento ámbar; verde solo para abonos. */
const light = {
  bg: '#F3F5F4',
  surface: '#FFFFFF',
  raised: '#F7F9F8',
  line: '#D9E0DE',
  text: '#13201F',
  muted: '#56666A',
  accent: '#8F5A08',
  accentFill: '#E0A43B',
  onAccent: '#1B1406',
  positive: '#1E7A4A',
  danger: '#A8402B',
  dangerSoft: 'rgba(168,64,43,0.08)',
};

const dark: typeof light = {
  bg: '#0F1416',
  surface: '#161D20',
  raised: '#1D2629',
  line: '#2B373B',
  text: '#E4E9E7',
  muted: '#97A6A3',
  accent: '#E9B65A',
  accentFill: '#E0A43B',
  onAccent: '#1B1406',
  positive: '#7CC48B',
  danger: '#EF8A75',
  dangerSoft: 'rgba(239,138,117,0.10)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
