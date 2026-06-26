import { View, Text, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { theme } from '../constants/theme';

export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const { t } = useTranslation();

  const animatedStyle = useAnimatedStyle(() => ({
    height: withTiming(isOnline ? 0 : 36, { duration: 250 }),
    opacity: withTiming(isOnline ? 0 : 1, { duration: 250 }),
  }));

  return (
    <Animated.View style={[styles.banner, animatedStyle]}>
      <Text style={styles.text}>{t('common.noInternet')}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: theme.colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  text: {
    color: '#fff',
    ...theme.typography.caption,
    fontWeight: '600',
  },
});
