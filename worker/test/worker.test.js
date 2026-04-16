import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ROLES,
  timingSafeEqual,
  extractBearer,
  validateAnswers,
  escapeCSV,
} from '../src/index.js';

test('ALLOWED_ROLES contains expected values and nothing else', () => {
  const expected = ['venue', 'booker', 'band', 'label', 'fan', 'email_signup'];
  assert.equal(ALLOWED_ROLES.size, expected.length);
  for (const r of expected) assert.ok(ALLOWED_ROLES.has(r));
  assert.ok(!ALLOWED_ROLES.has('admin'));
});

test('timingSafeEqual: equal strings return true', () => {
  assert.equal(timingSafeEqual('abc123', 'abc123'), true);
});

test('timingSafeEqual: different strings return false', () => {
  assert.equal(timingSafeEqual('abc123', 'abc124'), false);
});

test('timingSafeEqual: different lengths return false', () => {
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
});

test('timingSafeEqual: non-strings return false', () => {
  assert.equal(timingSafeEqual(null, 'abc'), false);
  assert.equal(timingSafeEqual('abc', undefined), false);
  assert.equal(timingSafeEqual(123, 123), false);
});

function mockRequest(headers = {}) {
  return { headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null } };
}

test('extractBearer: parses Bearer token', () => {
  const req = mockRequest({ Authorization: 'Bearer my-token-123' });
  assert.equal(extractBearer(req), 'my-token-123');
});

test('extractBearer: case-insensitive scheme', () => {
  const req = mockRequest({ Authorization: 'bearer lowercase-token' });
  assert.equal(extractBearer(req), 'lowercase-token');
});

test('extractBearer: missing header returns null', () => {
  assert.equal(extractBearer(mockRequest()), null);
});

test('extractBearer: non-Bearer scheme returns null', () => {
  const req = mockRequest({ Authorization: 'Basic dXNlcjpwYXNz' });
  assert.equal(extractBearer(req), null);
});

test('validateAnswers: strips unknown types and keeps strings', () => {
  const result = validateAnswers({
    q01: 'Tony',
    q02: 42,
    q03: true,
    q04: null,
    q05: { nested: 'object' },
    q06: undefined,
  });
  assert.equal(result.q01, 'Tony');
  assert.equal(result.q02, '42');
  assert.equal(result.q03, 'true');
  assert.ok(!('q04' in result));
  assert.ok(!('q05' in result));
  assert.ok(!('q06' in result));
});

test('validateAnswers: caps field length at MAX_FIELD_LEN (4000)', () => {
  const long = 'a'.repeat(10000);
  const result = validateAnswers({ q01: long });
  assert.equal(result.q01.length, 4000);
});

test('validateAnswers: handles arrays of primitives', () => {
  const result = validateAnswers({ q01: ['a', 'b', 1, true] });
  assert.deepEqual(result.q01, ['a', 'b', '1', 'true']);
});

test('validateAnswers: drops non-primitive array items', () => {
  const result = validateAnswers({ q01: ['ok', {}, null, 'also-ok'] });
  assert.deepEqual(result.q01, ['ok', 'also-ok']);
});

test('validateAnswers: rejects keys longer than 64 chars', () => {
  const longKey = 'x'.repeat(65);
  const result = validateAnswers({ [longKey]: 'value', q01: 'ok' });
  assert.ok(!(longKey in result));
  assert.equal(result.q01, 'ok');
});

test('escapeCSV: null and undefined become empty string', () => {
  assert.equal(escapeCSV(null), '');
  assert.equal(escapeCSV(undefined), '');
});

test('escapeCSV: plain string unquoted', () => {
  assert.equal(escapeCSV('hello'), 'hello');
});

test('escapeCSV: quotes values with commas', () => {
  assert.equal(escapeCSV('a,b'), '"a,b"');
});

test('escapeCSV: escapes internal quotes by doubling', () => {
  assert.equal(escapeCSV('say "hi"'), '"say ""hi"""');
});

test('escapeCSV: quotes values with newlines and carriage returns', () => {
  assert.equal(escapeCSV('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCSV('line1\rline2'), '"line1\rline2"');
});

test('escapeCSV: mitigates formula injection for leading = + - @', () => {
  assert.equal(escapeCSV('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(escapeCSV('+cmd'), "'+cmd");
  assert.equal(escapeCSV('-2+3'), "'-2+3");
  assert.equal(escapeCSV('@evil'), "'@evil");
});

test('escapeCSV: mitigates formula injection even when quoting is also needed', () => {
  // '=a,b' starts with = AND contains a comma — should get both prefix and quoting
  const out = escapeCSV('=a,b');
  assert.equal(out, `"'=a,b"`);
});
