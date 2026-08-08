import { describe, expect, it } from 'vitest';
import { getAppBaseHost, isStandalonePwa, resolveTenantSlugFromHost } from './tenant';

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

  it('does not treat IPv4/IPv6 as a tenant slug (CI uses 127.0.0.1)', () => {
    expect(resolveTenantSlugFromHost('127.0.0.1')).toBeNull();
    expect(resolveTenantSlugFromHost('192.168.1.10')).toBeNull();
    expect(resolveTenantSlugFromHost('::1')).toBeNull();
    expect(getAppBaseHost('127.0.0.1')).toBe('127.0.0.1');
  });

  it('treats bare localhost as non-tenant', () => {
    expect(resolveTenantSlugFromHost('localhost')).toBeNull();
  });
});

describe('isStandalonePwa', () => {
  it('is false in normal jsdom (not an installed app)', () => {
    expect(isStandalonePwa()).toBe(false);
  });
});
