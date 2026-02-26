import test from 'node:test';
import assert from 'node:assert/strict';
import { getIdentityToken } from '../../modules/auth.js';

test('getIdentityToken falls back to force-refresh and token cache when jwt fails', async () => {
  let calls = 0;
  globalThis.window = {
    netlifyIdentity: {
      currentUser() {
        return {
          token: { access_token: 'cached-token' },
          async jwt(forceRefresh) {
            calls += 1;
            if (calls === 1) {
              throw new Error('transient');
            }
            if (forceRefresh === true) {
              throw new Error('refresh-failed');
            }
            return 'jwt-token';
          }
        };
      }
    }
  };

  const token = await getIdentityToken();
  assert.equal(token, 'cached-token');
});
