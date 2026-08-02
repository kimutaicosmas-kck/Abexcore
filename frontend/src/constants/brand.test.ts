import { describe, expect, it } from 'vitest';
import { APP_NAME, BRAND_DOMAIN, DESIGNER } from '../constants/brand';

describe('brand constants', () => {
  it('uses ABEXCORE ERP branding', () => {
    expect(APP_NAME).toBe('AbexCore ERP');
    expect(DESIGNER).toBe('AbexCore Technologies');
    expect(BRAND_DOMAIN).toBe('abexcore.co.ke');
  });
});
