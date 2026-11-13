/**
 * Every colour, spacing value and text style in CueGoblin lives here.
 *
 * Screens import these tokens instead of hardcoding hex codes, so the whole
 * app can be re-skinned from one file. Three colours carry the design:
 * warm ivory paper, deep plum ink, and lime for anything active.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  /** Page background: warm paper. */
  ivory: '#FBF4E6',
  /** Cards and inputs sitting on the paper. */
  surface: '#FFFDF6',
  /** Primary ink: deep plum. */
  plum: '#3B1B3E',
  /** Secondary text (labels, hints). */
  plumMuted: '#6E4A67',
  /** Tertiary text (timestamps, placeholders). */
  plumFaint: '#9A7C93',
  /** The one accent. Reserved for "active" and "done". */
  lime: '#C9F75F',
  /** Lime pressed state. */
  limePressed: '#B7E84A',
  /** Very pale lime, for calm fills behind icons. */
  limeWash: '#EFFBD3',
  /** Hairlines and card borders. */
  line: '#E8DCC5',
  /** Destructive actions only (delete). */
  danger: '#A63F2E',
} as const;

/** A 4pt spacing scale keeps rhythm consistent without guesswork. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 18,
  lg: 26,
  pill: 999,
} as const;

/**
 * `satisfies` checks these against React Native's TextStyle type while keeping
 * the literal values, so typos like fontWeight: 'boldest' fail typecheck.
 */
export const typography = {
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -0.9, color: colors.plum },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, color: colors.plum },
  body: { fontSize: 16, fontWeight: '500', color: colors.plum, lineHeight: 23 },
  input: { fontSize: 17, fontWeight: '500', color: colors.plum, lineHeight: 25 },
  meta: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7, color: colors.plumFaint },
  hint: { fontSize: 13, fontWeight: '500', color: colors.plumFaint, lineHeight: 19 },
  button: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
} satisfies Record<string, TextStyle>;

/**
 * iOS uses shadow*, Android uses elevation, web supports boxShadow. Picking per
 * platform here means cards can opt in with `...cardShadow` and stay subtle.
 */
export const cardShadow: ViewStyle =
  Platform.select<ViewStyle>({
    ios: {
      shadowColor: colors.plum,
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 5 },
    },
    android: { elevation: 2 },
    default: {},
  }) ?? {};
