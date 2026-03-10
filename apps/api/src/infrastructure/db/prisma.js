import { PrismaClient } from "@prisma/client";

let prismaInstance;

export function getPrisma() {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

export const prisma = getPrisma();

process.on("beforeExit", async () => {
  if (prismaInstance) {
    await prismaInstance.$disconnect().catch(() => {});
  }
});

