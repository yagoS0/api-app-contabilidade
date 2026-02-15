import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_NAME = process.env.ADMIN_NAME || "Administrador";
const ADMIN_ACCOUNT_TYPE = process.env.ADMIN_ACCOUNT_TYPE || "FIRM";

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      "Defina ADMIN_EMAIL e ADMIN_PASSWORD para executar o seed de admin."
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });

  if (existing) {
    console.log("Admin já existe, atualizando senha/role/status...");
    await prisma.user.update({
      where: { email: ADMIN_EMAIL },
      data: {
        name: ADMIN_NAME,
        passwordHash,
        role: "admin",
        status: "active",
        accountType: ADMIN_ACCOUNT_TYPE,
      },
    });
  } else {
    console.log("Criando admin inicial...");
    await prisma.user.create({
      data: {
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        passwordHash,
        role: "admin",
        status: "active",
        accountType: ADMIN_ACCOUNT_TYPE,
      },
    });
  }

  console.log("Seed finalizado com sucesso.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

