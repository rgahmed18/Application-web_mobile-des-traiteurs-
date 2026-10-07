import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, fontSizes } from '../theme';

type Variant = 'title' | 'body' | 'muted';

export interface AppTextProps extends TextProps {
  variant?: Variant;
}

/** Texte de base avec les styles du thème. */
export function AppText({ variant = 'body', style, ...props }: AppTextProps) {
  return <Text style={[styles[variant], style]} {...props} />;
}

const styles = StyleSheet.create({
  title: { fontSize: fontSizes.xl, fontWeight: '700', color: colors.text },
  body: { fontSize: fontSizes.md, color: colors.text },
  muted: { fontSize: fontSizes.sm, color: colors.textMuted },
});
