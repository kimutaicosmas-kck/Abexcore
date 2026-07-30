import { describe, expect, it } from 'vitest';
import { ASSIGNABLE_MODULES, MODULE_LABELS, modulesForRoleName } from './roleModules';

describe('roleModules', () => {
  it('labels every assignable module', () => {
    for (const mod of ASSIGNABLE_MODULES) {
      expect(MODULE_LABELS[mod]).toBeTruthy();
    }
  });

  it('gives Managing Director full assignable set', () => {
    const mods = modulesForRoleName('Managing Director');
    expect(mods).toEqual(expect.arrayContaining([...ASSIGNABLE_MODULES]));
  });
});
