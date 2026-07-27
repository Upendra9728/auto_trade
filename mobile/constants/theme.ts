export const Colors = {
  primary: '#1E40AF',
  primaryLight: '#3B82F6',
  primaryBg: '#EFF6FF',

  success: '#059669',
  successBg: '#ECFDF5',
  error: '#DC2626',
  errorBg: '#FEF2F2',
  warning: '#D97706',
  warningBg: '#FFFBEB',
  info: '#0891B2',
  infoBg: '#ECFEFF',

  text: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',

  background: '#F3F4F6',
  surface: '#FFFFFF',
  border: '#E5E7EB',
  divider: '#F3F4F6',

  buy: '#059669',
  buyBg: '#ECFDF5',
  sell: '#DC2626',
  sellBg: '#FEF2F2',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};

export const Typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, color: Colors.text },
  h2: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  h3: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: Colors.text },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, color: Colors.textSecondary },
  caption: { fontSize: 12, fontWeight: '400' as const, color: Colors.textMuted },
  label: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  mono: { fontSize: 13, fontFamily: 'monospace' as const, color: Colors.text },
};

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
};
