import { test, expect } from "vitest";
import { mintSession, bearerClaims, isDeviceBearer, requireDeviceScope } from "../../api/_lib/auth.js";
function claims(token) { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
test('device access lifetime can be shorter than one day', () => { process.env.TOKEN_ENCRYPTION_KEY = 'test-key-that-is-at-least-thirty-two-characters'; const token = mintSession('acct_test', { typ: 'device', expDays: 1 / 96 }); const payload = claims(token); expect(payload.typ).toBe('device'); expect(payload.exp - payload.iat).toBe(900); });
test('ordinary sessions remain 30 days by default', () => { process.env.TOKEN_ENCRYPTION_KEY = 'test-key-that-is-at-least-thirty-two-characters'; const payload = claims(mintSession('acct_test', {})); expect(payload.exp - payload.iat).toBe(30 * 24 * 3600); });
test('device bearer claims and scopes are explicit', () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key-that-is-at-least-thirty-two-characters';
  const token = mintSession('acct_test', { typ: 'device', scopes: ['chat:use', 'code:use'] });
  const req = { headers: { authorization: `Bearer ${token}` } };
  expect(isDeviceBearer(req)).toBe(true);
  expect(bearerClaims(req).uid).toBe('acct_test');
  expect(requireDeviceScope(req, ['chat:use'])).toBe(true);
  expect(() => requireDeviceScope(req, ['tools:use'])).toThrow(/scope/i);
});
test('malformed bearer credentials do not become device authority', () => {
  expect(isDeviceBearer({ headers: { authorization: 'Bearer not-a-token' } })).toBe(false);
  expect(bearerClaims({ headers: {} })).toBeNull();
});
