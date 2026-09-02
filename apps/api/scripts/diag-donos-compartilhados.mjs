// SO LEITURA. Quem ja e OWNER de mais de uma empresa? E o que acontece ao trocar o e-mail?
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const vinculos = await prisma.companyClientUser.findMany({
  where: { role: "OWNER", status: "ACTIVE" },
  select: { userId: true, company: { select: { razao: true } }, user: { select: { email: true, name: true } } },
});

const porUser = new Map();
for (const v of vinculos) {
  if (!porUser.has(v.userId)) porUser.set(v.userId, { email: v.user?.email, nome: v.user?.name, empresas: [] });
  porUser.get(v.userId).empresas.push(v.company?.razao);
}

const lista = [...porUser.values()].sort((a, b) => b.empresas.length - a.empresas.length);
console.log(`vinculos OWNER ativos: ${vinculos.length} | contas distintas: ${lista.length}\n`);
console.log("CONTAS QUE JA ATENDEM MAIS DE UMA EMPRESA (o compartilhamento que o dono quer):");
let compartilhadas = 0;
for (const u of lista) {
  if (u.empresas.length < 2) continue;
  compartilhadas++;
  console.log(`  ${u.email}  ->  ${u.empresas.length} empresas`);
  u.empresas.forEach((e) => console.log(`       ${e}`));
}
if (!compartilhadas) console.log("  (nenhuma)");
console.log(`\ncontas com UMA empresa so: ${lista.filter((u) => u.empresas.length === 1).length}`);

// O 409 acontece quando o contador digita um e-mail que JA e de um User qualquer
// (mesmo que esse User nao seja OWNER de nada).
const totalUsers = await prisma.user.count();
const clientes = await prisma.user.count({ where: { accountType: "CLIENT" } });
console.log(`\nUsers no banco: ${totalUsers} (CLIENT: ${clientes})`);
console.log("=> digitar QUALQUER um desses e-mails no campo do responsavel, na EDICAO,");
console.log("   produz 409 owner_email_already_in_use. E o caso da ALESSANDRO.");

await prisma.$disconnect();
