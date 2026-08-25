import { describe, it, expect } from '@jest/globals';
import { render } from '@testing-library/react-native';

import LoginScreen from '@/app/(auth)/login';

/**
 * The login inputs must not let the keyboard rewrite what the user typed.
 *
 * Reported from the field: an account that logged in fine on web was refused
 * by the app with "Invalid credentials". React Native defaults autoCapitalize
 * to "sentences", and on iOS a secureTextEntry field still applies it — so the
 * first character of a typed password is silently upper-cased and the password
 * sent is not the one typed. Web has no such behaviour, which is exactly why it
 * worked there.
 *
 * Rendered rather than asserted against the source, because these are props on
 * a specific input among several and a grep cannot tell which field it landed
 * on — the email field already had autoCapitalize while the password field did
 * not.
 */
describe('login screen inputs', () => {
  async function inputs() {
    // RNTL 14 removed UNSAFE_getAllByType; `root.queryAll(predicate)` is the
    // replacement. Selecting by prop rather than by placeholder because the
    // placeholders come from i18n and would tie this test to translation keys.
    const { root } = await render(<LoginScreen />);
    // Host elements carry the string type 'TextInput', not the component
    // reference.
    const all = root!.queryAll((node: any) => node.type === 'TextInput');
    const password = all.find((i: any) => i.props.secureTextEntry);
    const email = all.find((i: any) => i.props.keyboardType === 'email-address');
    return { email, password } as { email: any; password: any };
  }

  it('never auto-capitalises the password', async () => {
    const { password } = await inputs();

    expect(password).toBeTruthy();
    expect(password.props.autoCapitalize).toBe('none');
  });

  it('never autocorrects the password', async () => {
    const { password } = await inputs();

    expect(password.props.autoCorrect).toBe(false);
  });

  it('never auto-capitalises or autocorrects the email', async () => {
    const { email } = await inputs();

    expect(email).toBeTruthy();
    expect(email.props.autoCapitalize).toBe('none');
    expect(email.props.autoCorrect).toBe(false);
  });
});
