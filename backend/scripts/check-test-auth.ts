import 'dotenv/config';
import { createApp } from '../src/app';
import { checkDbConnected, loginAsPlatformOwner } from '../tests/helpers/testAuth';

async function main() {
  const app = createApp();
  const dbConnected = await checkDbConnected(app);
  console.log('dbConnected:', dbConnected);

  if (dbConnected) {
    const token = await loginAsPlatformOwner(app);
    console.log('login OK, token length:', token.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
