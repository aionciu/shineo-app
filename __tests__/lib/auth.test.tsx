import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { SessionProvider, useSession } from '../../lib/auth';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

test('useSession returns isLoading=true initially', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SessionProvider>{children}</SessionProvider>
  );
  const { result } = renderHook(() => useSession(), { wrapper });
  expect(result.current.isLoading).toBe(true);
});

test('useSession returns null session when not logged in', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SessionProvider>{children}</SessionProvider>
  );
  const { result } = renderHook(() => useSession(), { wrapper });
  await new Promise(r => setTimeout(r, 50));
  expect(result.current.session).toBeNull();
});
