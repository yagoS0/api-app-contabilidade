import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log({ envDb: process.env.DATABASE_URL, pType: typeof p, userType: typeof p?.user });
  await p.$connect();
  console.log('connected ok');
  await p.$disconnect();
}

main().catch((err) => {
  console.error('err', err);
  process.exit(1);
});