// Exercita as REGRAS DO ESCRITÓRIO contra o banco de verdade.
//
//   node scripts/diag-regras-obrigacao.mjs            → cria, confere e APAGA tudo que criou
//   node scripts/diag-regras-obrigacao.mjs --manter   → não apaga (para inspecionar na tela)
//
// O que precisa de prova aqui não é o CRUD, é a PROPAGAÇÃO: quem entra no filtro, quem sai, o que
// acontece com quem foi editado na empresa, e se excluir a regra apaga ou desvincula. Tudo isso
// só aparece com várias empresas de regimes diferentes no banco.

import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  adicionarExcecao,
  atualizarRegra,
  criarRegra,
  listarRegras,
  preverEscopo,
  removerExcecao,
  removerRegra,
} from "../src/application/obrigacoes/RegrasObrigacaoService.js";
import { atualizar as atualizarObrigacao } from "../src/application/obrigacoes/ObrigacoesService.js";

const manter = process.argv.includes("--manter");
const NOME = "[DIAG] Regra de teste";

const ok = (m) => console.log(`  ✓ ${m}`);
const falha = (m) => { console.log(`  ✗ ${m}`); process.exitCode = 1; };
const checar = (cond, m) => (cond ? ok(m) : falha(m));

async function main() {
  const todas = await prisma.portalClient.findMany({
    select: { id: true, razao: true, temFolha: true, companyId: true },
  });
  const portalIds = todas.map((p) => p.id);
  const legadas = await prisma.company.findMany({
    where: { id: { in: todas.map((t) => t.companyId).filter(Boolean) } },
    select: { id: true, regimeTributario: true },
  });
  const regimePorLegacy = new Map(legadas.map((l) => [l.id, l.regimeTributario]));

  const porRegime = {};
  let semLegado = 0;
  for (const p of todas) {
    const r = p.companyId ? regimePorLegacy.get(p.companyId) : null;
    if (!r) { semLegado += 1; continue; }
    porRegime[r] = (porRegime[r] || 0) + 1;
  }
  console.log(`Carteira: ${todas.length} empresas`);
  console.log(`  por regime: ${Object.entries(porRegime).map(([k, v]) => `${k}=${v}`).join(", ") || "nenhum"}`);
  console.log(`  sem cadastro legado (regime desconhecido): ${semLegado}`);
  console.log(`  com folha: ${todas.filter((t) => t.temFolha).length}\n`);

  const regimeAlvo = Object.keys(porRegime).sort((a, b) => porRegime[b] - porRegime[a])[0];
  if (!regimeAlvo) { console.log("Nenhuma empresa com regime — nada a exercitar."); return; }

  // Limpa sobra de execução anterior interrompida.
  const antigas = await prisma.regraObrigacao.findMany({ where: { nome: NOME }, select: { id: true } });
  for (const a of antigas) await removerRegra({ regraId: a.id, modo: "remover" });

  console.log(`1) Prévia do escopo (POR_FILTRO, regime ${regimeAlvo})`);
  const previa = await preverEscopo({ portalIds, escopo: "POR_FILTRO", filtros: { regimes: [regimeAlvo], temFolha: null } });
  checar(previa.total === porRegime[regimeAlvo], `prévia diz ${previa.total}, carteira tem ${porRegime[regimeAlvo]} nesse regime`);
  checar(
    semLegado === 0 || previa.total < todas.length,
    `empresa sem regime declarado NÃO entrou no filtro por regime (${semLegado} fora)`,
  );

  console.log("\n2) Criar a regra propaga para todas do escopo");
  const { regra, criadas, empresasNoEscopo } = await criarRegra({
    portalIds,
    dados: {
      nome: NOME,
      categoria: "fiscal",
      periodicidade: "MENSAL",
      diaVencimento: 15,
      ajusteDiaUtil: "ANTECIPAR",
      defasagemMeses: 1,
      escopo: "POR_FILTRO",
      filtros: { regimes: [regimeAlvo], temFolha: null },
    },
  });
  checar(criadas === previa.total && empresasNoEscopo === previa.total, `criou ${criadas} obrigações para ${empresasNoEscopo} empresas`);

  const comOcorrencias = await prisma.obrigacao.findMany({
    where: { regraId: regra.id },
    select: { id: true, portalClientId: true, _count: { select: { ocorrencias: true } } },
  });
  checar(
    comOcorrencias.every((o) => o._count.ocorrencias === 12),
    `cada empresa recebeu 12 ocorrências (${comOcorrencias.map((o) => o._count.ocorrencias).join(",")})`,
  );

  console.log("\n3) Editar a regra propaga para todas");
  await atualizarRegra({ portalIds, regraId: regra.id, dados: { diaVencimento: 18 } });
  const dias = await prisma.obrigacao.findMany({ where: { regraId: regra.id }, select: { diaVencimento: true } });
  checar(dias.every((d) => d.diaVencimento === 18), `todas foram para o dia 18 (${[...new Set(dias.map((d) => d.diaVencimento))].join(",")})`);

  console.log("\n4) Editar NA EMPRESA vira sobrescrita e a regra passa a respeitar");
  const alvo = comOcorrencias[0];
  await atualizarObrigacao({ portalIds, obrigacaoId: alvo.id, dados: { diaVencimento: 7 } });
  const depoisDeEditar = await prisma.obrigacao.findUnique({ where: { id: alvo.id }, select: { sobrescritaLocal: true, diaVencimento: true } });
  checar(depoisDeEditar.sobrescritaLocal === true, "a obrigação ficou marcada como sobrescrita local");

  const efeito = await atualizarRegra({ portalIds, regraId: regra.id, dados: { diaVencimento: 22 } });
  const aposPropagar = await prisma.obrigacao.findUnique({ where: { id: alvo.id }, select: { diaVencimento: true } });
  checar(
    aposPropagar.diaVencimento === 7 && efeito.puladas === 1,
    `a regra pulou a sobrescrita (ficou no dia ${aposPropagar.diaVencimento}, ${efeito.puladas} pulada)`,
  );
  const outras = await prisma.obrigacao.findMany({
    where: { regraId: regra.id, id: { not: alvo.id } }, select: { diaVencimento: true },
  });
  checar(outras.every((o) => o.diaVencimento === 22), "as demais foram para o dia 22");

  console.log("\n5) Exceção tira a empresa da regra");
  const vitima = comOcorrencias.find((o) => o.id !== alvo.id);
  if (vitima) {
    await adicionarExcecao({ portalIds, regraId: regra.id, companyId: vitima.portalClientId, motivo: "teste" });
    const sobrou = await prisma.obrigacao.findFirst({ where: { id: vitima.id } });
    checar(!sobrou, "a obrigação daquela empresa foi removida");

    await removerExcecao({ portalIds, regraId: regra.id, companyId: vitima.portalClientId });
    const voltou = await prisma.obrigacao.findFirst({ where: { regraId: regra.id, portalClientId: vitima.portalClientId } });
    checar(Boolean(voltou), "tirar a exceção devolve a obrigação");
  } else {
    console.log("  (só uma empresa no escopo — sem como testar exceção)");
  }

  console.log("\n6) Resumo em linguagem natural");
  const [naLista] = (await listarRegras({ portalIds })).filter((r) => r.nome === NOME);
  console.log(`  "${naLista?.resumoEscopo}"`);
  checar(Boolean(naLista?.resumoEscopo?.includes("empresa")), "o card não obriga a decodificar JSON de filtro");
  checar(naLista?.totalSobrescritas === 1, `contou ${naLista?.totalSobrescritas} sobrescrita(s)`);

  console.log("\n7) Excluir a regra: desvincular preserva, remover apaga");
  const idsAntes = (await prisma.obrigacao.findMany({ where: { regraId: regra.id }, select: { id: true } })).map((o) => o.id);
  const r1 = await removerRegra({ regraId: regra.id, modo: "desvincular" });
  const aindaExistem = await prisma.obrigacao.count({ where: { id: { in: idsAntes } } });
  checar(
    aindaExistem === idsAntes.length && r1.desvinculadas === idsAntes.length,
    `desvincular manteve as ${aindaExistem} obrigações, agora avulsas`,
  );
  const semRegra = await prisma.obrigacao.count({ where: { id: { in: idsAntes }, regraId: null } });
  checar(semRegra === idsAntes.length, "todas ficaram sem regraId");

  if (manter) {
    console.log(`\n--manter: as ${idsAntes.length} obrigações avulsas ficaram no banco.`);
  } else {
    await prisma.obrigacao.deleteMany({ where: { id: { in: idsAntes } } });
    console.log(`\nLimpo: ${idsAntes.length} obrigação(ões) de teste removida(s).`);
  }
}

main()
  .catch((err) => { console.error("ERRO:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
