import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { OfflineBanner } from '../../components/OfflineBanner';

export default function AppLayout() {
  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <Tabs screenOptions={{ headerShown: false }} />
    </View>
  );
}
