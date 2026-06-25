// Q21 (spec v2) / Q28 Fase 0 — Seeds GLOBAIS do MapaContaTributo (contas sugeridas por PAPEL de linha).
// Modelo contábil correto (papéis distintos provisão × pagamento):
//   PROVISÃO  : D CONTRAPARTIDA / C PARC (passivo "parcelamento a pagar") — só principal.
//   PAGAMENTO : D PARC (amortiza o passivo) + D JUROS + D MULTA / C CAIXA.
// Convenções do Simples Nacional (sugestões — o contador sobrescreve por cliente):
//   PARC(passivo) 265, JUROS 501, MULTA 502, CAIXA 5.  CONTRAPARTIDA fica EM BRANCO de propósito
//   (despesa/reclasse depende do plano do cliente — não inventar). A provisão NÃO mapeia caixa.
//
// codigoTributo=null = vale pra qualquer tributo daquele papel (fallback geral).

// Papéis (espelham o lançamento real do contador, e são editáveis na config do parcelamento):
//   PROVISÃO : D PRINCIPAL(265) + D JUROS(501) [+ D MULTA(502)] / C PARC(553, parcelamento a pagar)
//   PAGAMENTO: D PARC(553) + D JUROS(501) [+ D MULTA(502)] / C CAIXA(5)
// PARC(553) = passivo (creditado na provisão, debitado no pagamento). Sugestões SN — o contador ajusta.
const SEEDS = [
  // Simples Nacional
  { tipoParcelamento: "PARCSN", tipoLinha: "PRINCIPAL", codigoTributo: null, contaId: "265" },
  { tipoParcelamento: "PARCSN", tipoLinha: "JUROS", codigoTributo: null, contaId: "501" },
  { tipoParcelamento: "PARCSN", tipoLinha: "MULTA", codigoTributo: null, contaId: "502" },
  { tipoParcelamento: "PARCSN", tipoLinha: "PARC", codigoTributo: null, contaId: "553" },
  { tipoParcelamento: "PARCSN", tipoLinha: "CAIXA", codigoTributo: null, contaId: "5" },
  // MEI (mesma convenção por enquanto)
  { tipoParcelamento: "PARCMEI", tipoLinha: "PRINCIPAL", codigoTributo: null, contaId: "265" },
  { tipoParcelamento: "PARCMEI", tipoLinha: "JUROS", codigoTributo: null, contaId: "501" },
  { tipoParcelamento: "PARCMEI", tipoLinha: "MULTA", codigoTributo: null, contaId: "502" },
  { tipoParcelamento: "PARCMEI", tipoLinha: "PARC", codigoTributo: null, contaId: "553" },
  { tipoParcelamento: "PARCMEI", tipoLinha: "CAIXA", codigoTributo: null, contaId: "5" },
];

export async function seedMapaContaTributoGlobal(prisma, { log } = {}) {
  let ok = 0;
  for (const s of SEEDS) {
    try {
      // findFirst+create (não upsert): Prisma não aceita unique composto com portalClientId null.
      const found = await prisma.mapaContaTributo.findFirst({
        where: { portalClientId: null, tipoParcelamento: s.tipoParcelamento, tipoLinha: s.tipoLinha, codigoTributo: s.codigoTributo },
      });
      if (!found) {
        await prisma.mapaContaTributo.create({ data: { portalClientId: null, ...s } });
      } else if (found.contaId !== s.contaId) {
        // Reconcilia o DEFAULT global quando a sugestão da seed muda (ex.: PARC 265 → 553).
        // Overrides do contador ficam em linhas com portalClientId != null (têm prioridade no resolver).
        await prisma.mapaContaTributo.update({ where: { id: found.id }, data: { contaId: s.contaId } });
      }
      ok++;
    } catch (err) {
      log?.warn?.({ err: err?.message, seed: s }, "Seed MapaContaTributo: linha falhou");
    }
  }
  log?.info?.({ ok, total: SEEDS.length }, "Seed MapaContaTributo (global) concluído");
  return { ok };
}
