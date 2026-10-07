import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, spacing } from '../theme';

/** Conteneur plein écran avec le fond et les marges du thème. */
export function Screen({ style, ...props }: ViewProps) {
  return <View style={[styles.container, style]} {...props} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
