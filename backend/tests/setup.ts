import 'dotenv/config';
import { it } from 'vitest';
import { createApp } from '../src/app';
import { checkDbConnected, loginAsPlatformOwner } from './helpers/testAuth';
import { ensureWorkflowFixtures } from './helpers/ensureFixtures';

const app = createApp();

export const testCtx = {
  app,
  dbConnected: false,
  authToken: '',
};

const connected = await checkDbConnected(app);
testCtx.dbConnected = connected;

if (connected) {
  testCtx.authToken = await loginAsPlatformOwner(app);
  await ensureWorkflowFixtures(testCtx.authToken);
}

/** Run an integration test only when the database is available (evaluated at run time, not collection). */
export function itWithDb(name: string, fn: () => Promise<void>) {
  it(name, async ({ skip }) => {
    if (!testCtx.dbConnected) skip();
    await fn();
  });
}
