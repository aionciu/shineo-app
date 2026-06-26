import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ProfileSetupScreen from '../../app/profile-setup';

const mockRefreshProfile = jest.fn();

jest.mock('../../lib/auth', () => ({
  useSession: () => ({
    session: { user: { id: 'u1', user_metadata: { full_name: 'John', avatar_url: 'https://img' } } },
    profile: null,
    isLoading: false,
    refreshProfile: mockRefreshProfile,
  }),
}));

const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockInsert = jest.fn().mockResolvedValue({ error: null });
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => ({
      upsert: mockUpsert,
      insert: mockInsert,
    })),
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));

jest.mock('../../hooks/useAppConfig', () => ({
  useAppConfig: () => ({ config: { privacy_policy_url: 'https://example.com/privacy' }, isLoading: false }),
}));

test('Continue button disabled without privacy policy acceptance', () => {
  const { getByText } = render(<ProfileSetupScreen />);
  const btn = getByText('common.continue');
  expect(btn).toBeTruthy();
  fireEvent.press(btn);
  expect(mockUpsert).not.toHaveBeenCalled();
});

test('submits profile with display name and accepted privacy policy', async () => {
  const { getByText, getByTestId } = render(<ProfileSetupScreen />);
  fireEvent.changeText(getByTestId('name-input'), 'Alex');
  fireEvent.press(getByTestId('privacy-checkbox'));
  fireEvent.press(getByText('common.continue'));
  await waitFor(() => {
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: 'Alex', onboarded: true }),
      { onConflict: 'id' }
    );
  });
});
