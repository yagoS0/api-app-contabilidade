// SO LEITURA. Quais empresas NAO conseguem salvar o cadastro — e por qual motivo?
//
// Cada linha e uma causa MEDIDA (02/09/2026), nao suposta:
//   1. dono cuja conta atende 2+ empresas  -> a rota tratava e-mail IGUAL como troca (409)
//   2. `cnaePrincipal` > 20 chars          -> o Zod recusava (400)                 [corrigido]
//   3. sem `Company` legada (`companyId`)  -> `tx.company.update` e PULADO: 200 e nada gravado
//   4. regime MEI/OUTRO                    -> o Zod aceita 5 valores, o normalizador 3 (400)
//   5. UF em branco                        -> `z.string().length(2)` recusa antes do normalizador
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const portais = await prisma.portalClient.findMany({
  select: { id: true, razao: true, companyId: true, uf: true },
  orderBy: { razao: "asc" },
});
const legadas = await prisma.company.findMany({
  select: { id: true, regimeTributario: true, cnaePrincipal: true, enderecoJson: true },
});
const legadaPorId = new Map(legadas.map((c) => [c.id, c]));

const donos = await prisma.companyClientUser.findMany({
  where: { role: "OWNER", status: "ACTIVE" },
  select: { companyId: true, userId: true },
});
const vinculosPorUser = new Map();
for (const d of donos) vinculosPorUser.set(d.userId, (vinculosPorUser.get(d.userId) || 0) + 1);
const donoPorEmpresa = new Map(donos.map((d) => [d.companyId, d.userId]));

// ⚠ O conjunto REAL de `companyProfile.js` (REGIMES), nao o que eu supus na primeira versao deste
// script: "PRESUMIDO"/"REAL" sao ALIASES aceitos e normalizados para estes. A primeira rodada
// acusou 11 empresas por causa do conjunto errado — alarme falso, corrigido aqui.
const REGIMES = new Set(["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL"]);
const causas = { compartilhado: [], cnaeLongo: [], semLegada: [], regime: [], ufVazia: [] };

for (const p of portais) {
  const L = p.companyId ? legadaPorId.get(p.companyId) : null;
  const dono = donoPorEmpresa.get(p.id);
  if (dono && (vinculosPorUser.get(dono) || 0) > 1) causas.compartilhado.push(p.razao);
  if (!L) causas.semLegada.push(p.razao);
  if (L && String(L.cnaePrincipal || "").length > 20) causas.cnaeLongo.push(p.razao);
  if (L && L.regimeTributario && !REGIMES.has(String(L.regimeTributario).toUpperCase())) {
    causas.regime.push(`${p.razao} (${L.regimeTributario})`);
  }
  const uf = String(p.uf || L?.enderecoJson?.uf || "").trim();
  if (uf.length !== 2) causas.ufVazia.push(`${p.razao} (uf=${JSON.stringify(uf)})`);
}

console.log(`empresas: ${portais.length}`);
console.log("");
const linha = (rotulo, lista) => {
  console.log(`${rotulo}: ${lista.length}`);
  lista.slice(0, 8).forEach((x) => console.log(`   · ${x}`));
};
linha("1. dono com conta em 2+ empresas (409 ao salvar SEM mexer no e-mail — CORRIGIDO no codigo)", causas.compartilhado);
linha("2. cnaePrincipal > 20 chars (400 — CORRIGIDO no codigo)", causas.cnaeLongo);
linha("3. SEM Company legada (200 e 30 campos NAO gravados — em silencio)", causas.semLegada);
linha("4. regime MEI/OUTRO (400 company_regime_tributario_invalid)", causas.regime);
linha("5. UF em branco (400 validation_failed generico)", causas.ufVazia);

const total = new Set([...causas.compartilhado, ...causas.cnaeLongo, ...causas.semLegada,
  ...causas.regime.map((s) => s.split(" (")[0]), ...causas.ufVazia.map((s) => s.split(" (")[0])]);
console.log("");
console.log(`empresas com ao menos UMA causa: ${total.size} de ${portais.length}`);
await prisma.$disconnect();
