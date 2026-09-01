// SÓ LEITURA — os usuários FIRM e as marcas deles.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  where: { role: { in: ["admin", "contador"] } },
  select: { id: true, email: true, role: true, accountType: true, podeAbrirPortalDoCliente: true, status: true },
});
console.log(JSON.stringify(users, null, 2));
console.log("companyFirmAccess ativos por usuario:");
for (const u of users) {
  const n = await prisma.companyFirmAccess.count({ where: { userId: u.id, status: "ACTIVE" } });
  console.log(` ${u.email}: ${n}`);
}
await prisma.$disconnect();
