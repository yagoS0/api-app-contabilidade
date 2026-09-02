// SO LEITURA. Quantos OWNER ATIVOS cada empresa tem — e quem sao eles?
//
// ⚠ A rota le o responsavel com `findFirst({ role:"OWNER", status:"ACTIVE", orderBy:{createdAt:"asc"} })`:
// com DOIS donos ativos ela devolve o mais ANTIGO e o segundo fica invisivel na tela, com acesso
// igual. Este script existe para essa sombra nao passar despercebida.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const vinculos = await prisma.companyClientUser.findMany({
  where: { role: "OWNER", status: "ACTIVE" },
  select: {
    companyId: true,
    createdAt: true,
    user: { select: { email: true } },
    company: { select: { razao: true } },
  },
  orderBy: { createdAt: "asc" },
});

const porEmpresa = new Map();
for (const v of vinculos) {
  if (!porEmpresa.has(v.companyId)) porEmpresa.set(v.companyId, []);
  porEmpresa.get(v.companyId).push(v);
}

const comMaisDeUm = [...porEmpresa.values()].filter((l) => l.length > 1);
console.log(`vinculos OWNER/ACTIVE: ${vinculos.length}  ·  empresas: ${porEmpresa.size}`);
console.log(`⚠ empresas com MAIS DE UM dono ativo: ${comMaisDeUm.length}`);
console.log("");

const porEmail = new Map();
for (const v of vinculos) {
  const e = String(v.user?.email || "(sem e-mail)").toLowerCase();
  porEmail.set(e, (porEmail.get(e) || 0) + 1);
}
[...porEmail.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .forEach(([email, n]) => console.log(`  ${String(n).padStart(3)} empresa(s)  ${email}`));

console.log("");
comMaisDeUm.slice(0, 5).forEach((l) => {
  console.log(`${l[0].company?.razao}:`);
  l.forEach((v) => console.log(`   ${v.createdAt.toISOString().slice(0, 10)}  ${v.user?.email}`));
});

await prisma.$disconnect();
