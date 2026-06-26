import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { theme } from '../constants/theme';

export function ForceUpdateScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('common.updateRequired')}</Text>
      <Text style={styles.message}>{t('common.updateMessage')}</Text>
      <Pressable
        style={styles.button}
        onPress={() => Linking.openURL('https://apps.apple.com/app/shineo')}
      >
        <Text style={styles.buttonText}>{t('common.openAppStore')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing[3], backgroundColor: theme.colors.background },
  title: { ...theme.typography.screenTitle, color: theme.colors.textPrimary, marginBottom: theme.spacing[1] },
  message: { ...theme.typography.body, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: theme.spacing[4] },
  button: { backgroundColor: theme.colors.primary, paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[1], borderRadius: theme.radius.button },
  buttonText: { ...theme.typography.body, color: '#fff', fontWeight: '600' },
});
