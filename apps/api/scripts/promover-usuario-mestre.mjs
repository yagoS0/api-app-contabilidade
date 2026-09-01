// ⚠⚠ PROMOVE UMA CONTA A MESTRE (`role: "admin"`) — decisão do dono, 01/09/2026.
//
// > *"o meu login e senha em ambos os portais é de mestre, eu posso executar o que eu quiser,
// > emitir nota em qualquer empresa etc, apenas o meu deve fazer isso."*
//
// ⚠⚠ `admin` é BYPASS TOTAL nos três middlewares: OWNER em qualquer empresa do banco (fora da
// carteira inclusive), FIRM_ADMIN com scopes `*`, e emissão de NFS-e em nome de qualquer cliente.
// É exatamente o pedido — e é por isso que este script:
//   • é ENSAIO por padrão (`--aplicar` para gravar);
//   • exige o E-MAIL EXATO como argumento, nunca "o primeiro FIRM da lista";
//   • recusa promover mais de uma conta por execução, e recusa conta que não seja FIRM ativa.
//
// Uso:  node scripts/promover-usuario-mestre.mjs <email> [--aplicar]
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.argv[2];
const aplicar = process.argv.includes("--aplicar");

if (!email || email.startsWith("--")) {
  console.error("uso: node scripts/promover-usuario-mestre.mjs <email> [--aplicar]");
  process.exit(1);
}

const u = await prisma.user.findFirst({
  where: { email },
  select: { id: true, email: true, role: true, accountType: true, status: true, podeAbrirPortalDoCliente: true },
});

if (!u) {
  console.error(`nenhum usuário com o e-mail ${email}`);
  process.exit(1);
}
console.log("encontrado:", JSON.stringify(u, null, 2));

if (u.accountType !== "FIRM" || String(u.status).toLowerCase() !== "active") {
  console.error("⚠ recusado: mestre é conta FIRM ativa — esta não é.");
  process.exit(1);
}
if (u.role === "admin") {
  console.log("já é admin — nada a fazer.");
  process.exit(0);
}

if (!aplicar) {
  console.log(`\nENSAIO: ${u.email} passaria de role "${u.role}" para "admin". Rode com --aplicar para gravar.`);
  process.exit(0);
}

await prisma.user.update({ where: { id: u.id }, data: { role: "admin" } });
const depois = await prisma.user.findUnique({ where: { id: u.id }, select: { email: true, role: true } });
console.log("gravado:", JSON.stringify(depois));
await prisma.$disconnect();
