import { AppText, Screen } from '@traiteur/mobile-ui';
import { getLocalizedText } from '@traiteur/shared';
import { Stack } from 'expo-router';

const welcome = { fr: 'Bienvenue', ar: 'مرحبا' };

export default function HomeScreen() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Accueil' }} />
      <AppText variant="title">{getLocalizedText(welcome, 'fr')}</AppText>
      <AppText variant="muted">Application client — catalogue, devis et réservations.</AppText>
    </Screen>
  );
}
