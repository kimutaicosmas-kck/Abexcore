import { describe, expect, it } from 'vitest';
import { getApiErrorCode, getApiErrorMessage } from './apiError';

describe('getApiErrorMessage', () => {
  it('prefers API message from response body', () => {
    expect(
      getApiErrorMessage({ response: { data: { message: 'Invalid credentials' }, status: 401 } })
    ).toBe('Invalid credentials');
  });

  it('handles null/undefined', () => {
    expect(getApiErrorMessage(null)).toMatch(/something went wrong/i);
  });
});

describe('getApiErrorCode', () => {
  it('reads code from response data', () => {
    expect(getApiErrorCode({ response: { data: { code: 'TENANT_REQUIRED' } } })).toBe(
      'TENANT_REQUIRED'
    );
  });
});
