import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  const count = await prisma.company.count();
  console.log(`DB OK — ${count} companies`);
}

main()
  .catch((e) => {
    console.error('DB FAIL:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
