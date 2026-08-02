import { describe, expect, it } from 'vitest';
import { getAppBaseHost, resolveTenantSlugFromHost } from './tenant';

describe('resolveTenantSlugFromHost', () => {
  it('does not treat apex .co.ke as a tenant subdomain', () => {
    expect(resolveTenantSlugFromHost('abexcore.co.ke')).toBeNull();
    expect(getAppBaseHost('abexcore.co.ke')).toBe('abexcore.co.ke');
  });

  it('resolves tenant on .co.ke', () => {
    expect(resolveTenantSlugFromHost('owner.abexcore.co.ke')).toBe('owner');
    expect(getAppBaseHost('owner.abexcore.co.ke')).toBe('abexcore.co.ke');
  });

  it('ignores www on .co.ke', () => {
    expect(resolveTenantSlugFromHost('www.abexcore.co.ke')).toBeNull();
    expect(getAppBaseHost('www.abexcore.co.ke')).toBe('abexcore.co.ke');
  });

  it('still supports simple tenant.example.com hosts', () => {
    expect(resolveTenantSlugFromHost('acme.example.com')).toBe('acme');
    expect(getAppBaseHost('acme.example.com')).toBe('example.com');
  });
});
