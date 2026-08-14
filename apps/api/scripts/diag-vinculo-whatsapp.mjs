// DIAGNÓSTICO: o vínculo NÚMERO → EMPRESA (→ PESSOA) está em pé?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma mensagem, nenhuma chamada externa — e ZERO credencial da
// Meta. É de propósito: a Entrega 1 está parada esperando o cadastro do número, e o vínculo é a
// única parte dela que se verifica sem isso.
//
// O QUE ELE MEDE, e por que cada número importa
//
// 1. Quantos contatos existem, e quantos identificam uma PESSOA (`userId`). Sem o ponteiro, o
//    vínculo devolve a empresa e diz que não sabe quem fala — e o papel do RBAC fica inalcançável.
// 2. Quantos NÚMEROS falam por MAIS DE UMA empresa. Este é o número que decide se o canal precisa
//    perguntar "de qual empresa?" ou se isso é caso raro. Um vínculo que assumisse unicidade
//    emitiria no CNPJ errado exatamente nestes.
// 3. Quantos números as DUAS LEITURAS do nono dígito respondem DIFERENTE. É a pergunta aberta ao
//    dono: só a medição diz se a tolerância muda alguma coisa nesta base.
// 4. Contatos cujo `userId` aponta para alguém que NÃO é membro ativo da empresa (o cadastro é
//    validado desde hoje, mas linha anterior a isso nunca passou por conferência).
//
// ⚠ NÃO RODE `scripts/backfill-envio-guia.mjs`. Nada aqui tem relação com ele, e ele quebra o
//   dashboard de forma permanente enquanto a F5 não existir (ver o CLAUDE.md da raiz).
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-vinculo-whatsapp.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";
import { resolverVinculoTelefone, SITUACOES, TOLERANCIAS } from "../src/application/whatsapp/vinculoTelefone.js";

const num = (v) => Number(v || 0).toLocaleString("pt-BR");

let contatos = [];
try {
  contatos = await prisma.contatoWhatsapp.findMany({
    select: {
      id: true,
      portalClientId: true,
      nome: true,
      papel: true,
      telefoneE164: true,
      waId: true,
      optInEm: true,
      ativo: true,
      userId: true,
      portalClient: { select: { id: true, razao: true, cnpj: true } },
    },
  });
} catch (err) {
  console.log("⚠ Não consegui ler `contatos_whatsapp`:", err?.message);
  console.log("  Se a coluna `userId` não existe, a migration 20260814160000 não foi aplicada nesta base.");
  process.exit(1);
}

console.log("═══ 1) O CADASTRO ═══");
console.log(`contatos: ${num(contatos.length)}`);
console.log(`  ativos:            ${num(contatos.filter((c) => c.ativo).length)}`);
console.log(`  com opt-in:        ${num(contatos.filter((c) => c.optInEm).length)}`);
console.log(`  com waId da Meta:  ${num(contatos.filter((c) => c.waId).length)}`);
console.log(`  ⚠ identificam PESSOA (userId): ${num(contatos.filter((c) => c.userId).length)}`);
console.log(`    sem pessoa (papel do RBAC inalcançável): ${num(contatos.filter((c) => !c.userId).length)}`);
console.log(`empresas com pelo menos um contato: ${num(new Set(contatos.map((c) => c.portalClientId)).size)}`);
const totalEmpresas = await prisma.portalClient.count();
console.log(`empresas na base: ${num(totalEmpresas)}`);

if (!contatos.length) {
  console.log("\nNenhum contato cadastrado — o vínculo está inerte. Nada a medir adiante.");
  await prisma.$disconnect();
  process.exit(0);
}

// O papel do RBAC — LIDO, nunca recalculado.
const comUsuario = contatos.filter((c) => c.userId);
const vinculos = comUsuario.length
  ? await prisma.companyClientUser.findMany({
      where: { OR: comUsuario.map((c) => ({ companyId: c.portalClientId, userId: c.userId })) },
      select: { companyId: true, userId: true, role: true, status: true },
    })
  : [];
const porChave = new Map(vinculos.map((v) => [`${v.companyId}|${v.userId}`, { role: v.role, status: v.status }]));
const candidatos = contatos.map((c) => ({
  ...c,
  vinculoRbac: c.userId ? porChave.get(`${c.portalClientId}|${c.userId}`) || null : null,
}));

console.log("\n═══ 2) UM NÚMERO, QUANTAS EMPRESAS? ═══");
const numeros = [...new Set(contatos.flatMap((c) => [c.telefoneE164, c.waId]).filter(Boolean))];
const ambiguos = [];
const divergentes = [];
let vinculados = 0;
for (const n of numeros) {
  const r = resolverVinculoTelefone(n, candidatos);
  if (r.situacao === SITUACOES.AMBIGUO) ambiguos.push({ n, r });
  if (r.situacao === SITUACOES.VINCULADO) vinculados += 1;
  if (r.divergemPeloNonoDigito) divergentes.push({ n, r });
}
console.log(`números distintos: ${num(numeros.length)}`);
console.log(`  identificam UMA empresa: ${num(vinculados)}`);
console.log(`  ⚠ AMBÍGUOS (mais de uma): ${num(ambiguos.length)}`);
for (const { n, r } of ambiguos.slice(0, 20)) {
  console.log(`     ${n} → ${r.empresas.map((e) => `${e.razao} (${e.cnpj})`).join(" · ")}`);
}
if (ambiguos.length > 20) console.log(`     … e mais ${num(ambiguos.length - 20)}`);

console.log("\n═══ 3) AS DUAS LEITURAS DO NONO DÍGITO ═══");
console.log("(ESTRITA = padrão, só dígito a dígito · NONO_DIGITO = casa também a outra forma)");
console.log(`⚠ números em que as leituras DISCORDAM: ${num(divergentes.length)}`);
for (const { n, r } of divergentes.slice(0, 20)) {
  const e = r.leituras[TOLERANCIAS.ESTRITA];
  const t = r.leituras[TOLERANCIAS.NONO_DIGITO];
  console.log(`     ${n}: ESTRITA=${e.situacao}(${e.portalClientIds.length}) · NONO_DIGITO=${t.situacao}(${t.portalClientIds.length})`);
}
if (!divergentes.length) console.log("     nenhum — nesta base a tolerância não muda resposta nenhuma.");

console.log("\n═══ 4) O PONTEIRO PARA A PESSOA ESTÁ SÃO? ═══");
const orfaos = comUsuario.filter((c) => {
  const v = porChave.get(`${c.portalClientId}|${c.userId}`);
  return !v || v.status !== "ACTIVE";
});
console.log(`contatos com userId: ${num(comUsuario.length)}`);
console.log(`  ⚠ apontando para quem NÃO é membro ativo: ${num(orfaos.length)}`);
for (const c of orfaos.slice(0, 20)) {
  const v = porChave.get(`${c.portalClientId}|${c.userId}`);
  console.log(`     ${c.nome} · ${c.telefoneE164} · ${c.portalClient?.razao} → ${v ? `status ${v.status}` : "sem vínculo"}`);
}
console.log("  (o cadastro passou a recusar isso; linha anterior à validação nunca foi conferida)");

console.log("\n⚠ VÍNCULO NÃO É AUTORIZAÇÃO: nada acima diz o que a pessoa PODE fazer.");
console.log("  Quem decide continua sendo requireClientCompanyAccess(minRole) sobre CompanyClientUser.role.");

await prisma.$disconnect();
