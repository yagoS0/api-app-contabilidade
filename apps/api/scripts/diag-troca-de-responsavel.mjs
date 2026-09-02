// SO LEITURA. "Por que eu nao consigo trocar o responsavel da empresa?"
//
// ⚠⚠ A HIPOTESE QUE ESTE SCRIPT MEDE: depois de o contador CONFIRMAR o vinculo, a rota ainda
// executa, na MESMA transacao, um update na tabela LEGADA:
//
//   if (ownerEmailInput && updatedLegacy?.clientId) {
//     if (companiesDoClient <= 1) tx.client.update({ data: { email, login } })
//   }
//
// `Client.email` e `Client.login` sao os DOIS `@unique`. Se ja existir um `Client` com o e-mail de
// destino — e ele existe sempre que aquela pessoa ja e dona de outra empresa, porque o
// provisionamento cria um `Client` por e-mail — o update estoura P2002 e derruba a TRANSACAO
// INTEIRA. O vinculo que acabou de ser feito volta atras, e o contador ve um erro tecnico.
//
// Nao escreve nada, nao chama servico externo.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const empresas = await prisma.portalClient.findMany({
  select: { id: true, razao: true, companyId: true },
  orderBy: { razao: "asc" },
});

const legadas = await prisma.company.findMany({
  select: { id: true, clientId: true, razaoSocial: true },
});
const legadaPorId = new Map(legadas.map((c) => [c.id, c]));

const donos = await prisma.companyClientUser.findMany({
  where: { role: "OWNER", status: "ACTIVE" },
  select: { companyId: true, user: { select: { id: true, email: true } } },
});
const donoPorEmpresa = new Map(donos.map((d) => [d.companyId, d.user]));

const clients = await prisma.client.findMany({ select: { id: true, email: true, login: true } });
const clientPorEmail = new Map(clients.map((c) => [String(c.email || "").toLowerCase(), c]));

// Quantas Company cada Client legado atende (o `companiesDoClient <= 1` da rota)
const porClient = new Map();
for (const c of legadas) {
  if (!c.clientId) continue;
  porClient.set(c.clientId, (porClient.get(c.clientId) || 0) + 1);
}

console.log(`empresas: ${empresas.length}  ·  Client legados: ${clients.length}`);
console.log(`empresas SEM dono OWNER ativo: ${empresas.filter((e) => !donoPorEmpresa.get(e.id)).length}`);
console.log("");

// A pergunta central: trocar o responsavel de X para o e-mail de OUTRO dono da carteira
// esbarraria no @unique de Client?
const emailsDeDonos = [...new Set(donos.map((d) => String(d.user?.email || "").toLowerCase()).filter(Boolean))];
console.log(`e-mails distintos de responsaveis: ${emailsDeDonos.length}`);
const comClient = emailsDeDonos.filter((e) => clientPorEmail.has(e));
console.log(`⚠ desses, JA existem como Client legado (o @unique que estoura): ${comClient.length}`);
console.log("");

let travariam = 0;
const exemplos = [];
for (const emp of empresas) {
  const legada = legadaPorId.get(emp.companyId);
  if (!legada?.clientId) continue;
  const quantas = porClient.get(legada.clientId) || 0;
  if (quantas > 1) continue; // a rota nem tenta o update
  // Para cada e-mail de OUTRO responsavel, o update tentaria gravar email/login ja usados
  const donoAtual = String(donoPorEmpresa.get(emp.id)?.email || "").toLowerCase();
  const colide = comClient.filter((e) => e !== donoAtual);
  if (colide.length) {
    travariam += 1;
    if (exemplos.length < 6) exemplos.push(`${emp.razao} (dono ${donoAtual || "-"}) — colide com ${colide.length} e-mail(s)`);
  }
}
console.log(`⚠⚠ empresas em que a rota TENTARIA o client.update (Client de 1 empresa so): ${travariam} de ${empresas.length}`);
exemplos.forEach((e) => console.log(`   ${e}`));

const ALVO = (process.argv[2] || "").toLowerCase();
if (ALVO) {
  console.log("");
  console.log(`alvo pedido: ${ALVO}`);
  console.log(`  ha User com esse e-mail?   ${Boolean(await prisma.user.findUnique({ where: { email: ALVO } }))}`);
  console.log(`  ha Client com esse e-mail? ${clientPorEmail.has(ALVO)}`);
  const porLogin = clients.find((c) => String(c.login || "").toLowerCase() === ALVO);
  console.log(`  ha Client com esse LOGIN?  ${Boolean(porLogin)}`);
}

await prisma.$disconnect();
