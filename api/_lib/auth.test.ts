import { describe, expect, it } from 'vitest';

// Production must refuse ALLOW_UNVERIFIED_AUTH: the guard lives in auth.ts
// unverifiedUser() (early return in production). This test pins the invariant
// at the config level too.
import { assertProductionSafe, serverConfig } from './config';

describe('auth production invariant', () => {
  it('refuses unverified auth and demo mode in production', () => {
    expect(
      assertProductionSafe({ ...serverConfig(), isProduction: true, allowUnverifiedAuth: true, demoMode: false }),
    ).toContain('ALLOW_UNVERIFIED_AUTH');
    expect(
      assertProductionSafe({ ...serverConfig(), isProduction: true, allowUnverifiedAuth: false, demoMode: true }),
    ).toContain('DEMO_MODE');
    expect(
      assertProductionSafe({ ...serverConfig(), isProduction: true, allowUnverifiedAuth: false, demoMode: false }),
    ).toBeNull();
  });
});
