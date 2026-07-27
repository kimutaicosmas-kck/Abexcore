import { describe, expect, it } from 'vitest';
import { APP_NAME, DESIGNER } from '../constants/brand';

describe('brand constants', () => {
  it('uses APEXCORE ERP branding', () => {
    expect(APP_NAME).toBe('ApexCore ERP');
    expect(DESIGNER).toBe('ApexCore Technologies');
  });
});
