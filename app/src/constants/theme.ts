/** 128bit is dark-first: near-black background with an orange accent. */
export const Colors = {
  background: '#0A0A0A',
  surface: '#151515',
  surfaceRaised: '#1E1E1E',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textSecondary: '#9E9E9E',
  accent: '#FF8A2B',
  accentText: '#FFFFFF',
  danger: '#FF5C5C',
  success: '#5CD68A',
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
