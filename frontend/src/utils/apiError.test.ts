import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  classifyApiError,
  getApiErrorCode,
  getApiErrorMessage,
  getApiErrorTitle,
  isNetworkRelatedError,
} from './apiError';

describe('getApiErrorMessage', () => {
  it('prefers API message from response body', () => {
    expect(
      getApiErrorMessage({ response: { data: { message: 'Invalid credentials' }, status: 401 } })
    ).toBe('Invalid credentials');
  });

  it('handles null/undefined', () => {
    expect(getApiErrorMessage(null)).toMatch(/something went wrong/i);
  });

  it('returns offline message when browser is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(getApiErrorMessage({ code: 'ERR_NETWORK' })).toMatch(/offline/i);
  });

  it('returns network message when online but server unreachable', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(getApiErrorMessage({ code: 'ERR_NETWORK' })).toMatch(/could not connect/i);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe('classifyApiError', () => {
  it('classifies timeout errors', () => {
    expect(classifyApiError({ code: 'ECONNABORTED' })).toBe('timeout');
  });

  it('classifies server errors', () => {
    expect(classifyApiError({ response: { status: 503 } })).toBe('server');
  });
});

describe('getApiErrorTitle', () => {
  it('uses friendly offline title', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(getApiErrorTitle({ code: 'ERR_NETWORK' })).toBe('No internet connection');
    vi.restoreAllMocks();
  });
});

describe('isNetworkRelatedError', () => {
  it('includes offline and network failures', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(isNetworkRelatedError({ code: 'ERR_NETWORK' })).toBe(true);
    vi.restoreAllMocks();

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    expect(isNetworkRelatedError({ code: 'ERR_NETWORK' })).toBe(true);
    vi.restoreAllMocks();
  });

  it('excludes validation errors with API messages', () => {
    expect(
      isNetworkRelatedError({ response: { data: { message: 'Email already exists' }, status: 400 } })
    ).toBe(false);
  });
});

describe('getApiErrorCode', () => {
  it('reads code from response data', () => {
    expect(getApiErrorCode({ response: { data: { code: 'TENANT_REQUIRED' } } })).toBe(
      'TENANT_REQUIRED'
    );
  });
});
