import { Dimensions } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BASE_WIDTH = 375;
const BASE_HEIGHT = 812;

export const scale = (size: number) => Math.round((SCREEN_WIDTH / BASE_WIDTH) * size);
export const verticalScale = (size: number) => Math.round((SCREEN_HEIGHT / BASE_HEIGHT) * size);
export const moderateScale = (size: number, factor = 0.35) =>
  Math.round(size + (scale(size) - size) * factor);

export const Screen = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
};

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
  h1: { fontSize: moderateScale(28), fontWeight: '700' as const, color: Colors.text },
  h2: { fontSize: moderateScale(22), fontWeight: '700' as const, color: Colors.text },
  h3: { fontSize: moderateScale(18), fontWeight: '600' as const, color: Colors.text },
  body: { fontSize: moderateScale(15), fontWeight: '400' as const, color: Colors.text },
  bodySmall: { fontSize: moderateScale(13), fontWeight: '400' as const, color: Colors.textSecondary },
  caption: { fontSize: moderateScale(12), fontWeight: '400' as const, color: Colors.textMuted },
  label: { fontSize: moderateScale(12), fontWeight: '600' as const, color: Colors.textSecondary },
  mono: { fontSize: moderateScale(13), fontFamily: 'monospace' as const, color: Colors.text },
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
