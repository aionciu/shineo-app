import { renderHook, act } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

test('useNetworkStatus returns isOnline=true by default', async () => {
  (NetInfo.addEventListener as jest.Mock).mockImplementation((cb) => {
    cb({ isConnected: true });
    return jest.fn();
  });
  const { result } = renderHook(() => useNetworkStatus());
  expect(result.current.isOnline).toBe(true);
});
