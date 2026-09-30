/** 128bit is dark-first: deep navy background with a neon cyan accent. */
export const Colors = {
  background: '#07090F',
  surface: '#111522',
  surfaceRaised: '#1A2031',
  border: '#232A3F',
  text: '#F2F5FF',
  textSecondary: '#8B93AD',
  accent: '#3DF2E0',
  accentText: '#04110F',
  danger: '#FF5C7A',
  success: '#5CFF9D',
} as const;

export const Spacing = {
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
} as const;

export const Radius = { sm: 8, md: 12, lg: 20 } as const;

export const MaxContentWidth = 800;
