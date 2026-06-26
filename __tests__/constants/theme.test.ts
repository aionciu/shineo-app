import { theme } from '../../constants/theme';

test('primary color is correct', () => {
  expect(theme.colors.primary).toBe('#2DC653');
});

test('spacing unit 1 = 8', () => {
  expect(theme.spacing[1]).toBe(8);
});

test('card radius = 16', () => {
  expect(theme.radius.card).toBe(16);
});
