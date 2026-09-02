// ⚠⚠ APAGA UMA CONTA QUE ESTE AGENTE CRIOU EM 30/08/2026 E QUE NAO DEVERIA EXISTIR.
//
// Decisao do dono, 02/09/2026: *"esse yago.cliente nao existe e nem deveria, o login e
// yago@altan.company"*.
//
// O que foi criado na epoca: um `User` CLIENT `yago.cliente@belgencontabilidade.com` com papel
// **OWNER, ATIVO, em 34 empresas**, para que o dono visse o portal do cliente por dentro.
// Efeitos colaterais que so foram medidos hoje:
//
//   · 26 das 34 empresas ficaram com DOIS donos ativos;
//   · a rota le o responsavel com `orderBy: { createdAt: "asc" }` — entao, ao TROCAR o
//     responsavel, o vinculo novo (de hoje) perde para o de teste (30/08) e a tela mostra a conta
//     de teste como responsavel. E parte do *"nao consigo alterar o responsavel"*.
//
// ⚠ E o caminho CERTO para o dono ver o portal do cliente ja existe, criado no mesmo dia:
// `User.podeAbrirPortalDoCliente` na conta FIRM dele. Uma conta CLIENT falsa era o atalho errado.
//
// ENSAIO POR PADRAO. Escreve so com `--aplicar`.
//
// ⚠ A ordem importa: as FKs apontam para `User`, entao os dependentes saem antes. Tudo numa
// transacao — ou some inteiro, ou nao some nada.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const EMAIL = process.env.EMAIL_DE_TESTE || "yago.cliente@belgencontabilidade.com";
const aplicar = process.argv.includes("--aplicar");

const conta = await prisma.user.findUnique({
  where: { email: EMAIL },
  select: { id: true, email: true, name: true, role: true, status: true, accountType: true, createdAt: true },
});
if (!conta) {
  console.log(`conta ${EMAIL} nao existe — nada a fazer`);
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`conta: ${conta.email}`);
console.log(`  id ${conta.id} · role ${conta.role} · status ${conta.status} · ${conta.accountType} · criada ${conta.createdAt.toISOString().slice(0, 10)}`);
console.log("");

const vinculos = await prisma.companyClientUser.findMany({
  where: { userId: conta.id },
  select: { id: true, status: true, role: true, companyId: true, company: { select: { razao: true } } },
});
const sessoes = await prisma.clientSession.count({ where: { userId: conta.id } });
const tokens = await prisma.passwordResetToken.count({ where: { userId: conta.id } });
const contatos = await prisma.contatoWhatsapp.count({ where: { userId: conta.id } });
const trocas = await prisma.portalPasswordChange.count({ where: { userId: conta.id } });
const acessoEscritorio = await prisma.companyFirmAccess.count({ where: { userId: conta.id } });

console.log(`vinculos de cliente: ${vinculos.length}  (ATIVOS OWNER: ${vinculos.filter((v) => v.status === "ACTIVE" && v.role === "OWNER").length})`);
console.log(`sessoes: ${sessoes} · tokens de senha: ${tokens} · contatos whatsapp: ${contatos} · trocas de senha: ${trocas}`);
console.log(`⚠ acessos de ESCRITORIO desta conta: ${acessoEscritorio}  (tem de ser 0 — ela e CLIENT)`);
console.log("");

// ⚠⚠ A CONSEQUENCIA QUE PRECISA SER DITA ANTES: quais empresas ficam SEM dono ativo?
const idsEmpresas = [...new Set(vinculos.filter((v) => v.status === "ACTIVE" && v.role === "OWNER").map((v) => v.companyId))];
const outros = await prisma.companyClientUser.findMany({
  where: { companyId: { in: idsEmpresas }, role: "OWNER", status: "ACTIVE", userId: { not: conta.id } },
  select: { companyId: true },
});
const comOutroDono = new Set(outros.map((o) => o.companyId));
const ficamSemDono = vinculos.filter(
  (v) => v.status === "ACTIVE" && v.role === "OWNER" && !comOutroDono.has(v.companyId)
);
console.log(`empresas que voltam a ter UM dono real: ${idsEmpresas.length - ficamSemDono.length}`);
console.log(`⚠ empresas que ficam SEM responsavel: ${ficamSemDono.length}`);
console.log("   (⚠ elas NUNCA tiveram um: a conta de teste so ACRESCENTOU vinculos, nunca substituiu.");
console.log("    A tela passa a dizer 'sem responsavel', com o motivo — que e a verdade.)");
ficamSemDono.forEach((v) => console.log(`   · ${v.company?.razao}`));

if (!aplicar) {
  console.log("");
  console.log("ensaio. rode com --aplicar para apagar.");
  await prisma.$disconnect();
  process.exit(0);
}

const r = await prisma.$transaction(async (tx) => {
  const v = await tx.companyClientUser.deleteMany({ where: { userId: conta.id } });
  const s = await tx.clientSession.deleteMany({ where: { userId: conta.id } });
  const t = await tx.passwordResetToken.deleteMany({ where: { userId: conta.id } });
  const p = await tx.portalPasswordChange.deleteMany({ where: { userId: conta.id } });
  // ⚠ `contatos_whatsapp.userId` e NULLABLE: o contato e da EMPRESA, nao da conta. Desligar o
  //   vinculo preserva o cadastro do numero; apagar o contato perderia dado de outra frente.
  const c = await tx.contatoWhatsapp.updateMany({ where: { userId: conta.id }, data: { userId: null } });
  await tx.user.delete({ where: { id: conta.id } });
  return { vinculos: v.count, sessoes: s.count, tokens: t.count, trocas: p.count, contatos: c.count };
});

console.log("");
console.log(`apagado: ${JSON.stringify(r)} + a propria conta`);

const aindaExiste = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
const semDono = await prisma.portalClient.count({
  where: { companyClientUsers: { none: { role: "OWNER", status: "ACTIVE" } } },
});
const duplos = await prisma.companyClientUser.groupBy({
  by: ["companyId"],
  where: { role: "OWNER", status: "ACTIVE" },
  _count: { _all: true },
});
console.log(`conta ainda existe? ${Boolean(aindaExiste)}`);
console.log(`empresas SEM dono ativo: ${semDono}`);
console.log(`empresas com MAIS DE UM dono ativo: ${duplos.filter((d) => d._count._all > 1).length}`);

await prisma.$disconnect();
