import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SignInScreen from '../../app/sign-in';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({ type: 'success', data: { idToken: 'test-token' } }),
  },
  GoogleSigninButton: Object.assign(
    ({ onPress }: { onPress: () => void }) => {
      const { Pressable, Text } = require('react-native');
      return <Pressable testID="google-btn" onPress={onPress}><Text>Google</Text></Pressable>;
    },
    {
      Size: { Wide: 'wide', Standard: 'standard', Icon: 'icon' },
      Color: { Dark: 'dark', Light: 'light' },
    }
  ),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null }),
    },
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

test('tapping Google button calls signIn', async () => {
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  const { supabase } = require('../../lib/supabase');
  const { getByTestId } = render(<SignInScreen />);
  fireEvent.press(getByTestId('google-btn'));
  await waitFor(() => {
    expect(GoogleSignin.signIn).toHaveBeenCalled();
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'test-token' });
  });
});
