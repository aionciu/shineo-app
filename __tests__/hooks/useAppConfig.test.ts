import { renderHook, waitFor } from '@testing-library/react-native';
import { useAppConfig } from '../../hooks/useAppConfig';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({
        data: [
          { key: 'default_search_radius_m', value: '2000' },
          { key: 'min_app_version', value: '1.0.0' },
          { key: 'privacy_policy_url', value: 'https://shineo.app/privacy' },
        ],
        error: null,
      }),
    }),
  },
}));

test('useAppConfig returns parsed config', async () => {
  const { result } = renderHook(() => useAppConfig());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.config['default_search_radius_m']).toBe('2000');
  expect(result.current.config['min_app_version']).toBe('1.0.0');
});
