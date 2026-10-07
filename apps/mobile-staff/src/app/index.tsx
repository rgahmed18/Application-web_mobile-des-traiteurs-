import { AppText, Screen } from '@traiteur/mobile-ui';
import { Stack } from 'expo-router';

export default function HomeScreen() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Mes missions' }} />
      <AppText variant="title">Espace équipe</AppText>
      <AppText variant="muted">
        Application personnel et livreurs — planning, missions et livraisons.
      </AppText>
    </Screen>
  );
}
