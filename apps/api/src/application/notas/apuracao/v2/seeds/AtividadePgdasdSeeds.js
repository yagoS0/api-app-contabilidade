// Q15.2 (corrigido) — Tabela de-para OFICIAL de atividades do PGDAS-D (43 IDs).
//
// Fonte: spec TRANSDECLARACAO11 (apicenter SERPRO / SDK serpro_integra_contador_api).
// O idAtividade carrega implicitamente o ANEXO e o MERCADO (interno/exterior) — a
// segregação interno/externo é feita escolhendo o idAtividade certo, NÃO por flag.
//
// `tipoReceita` mapeia o nosso classificador → idAtividade pro DEFAULT automático.
// Só os IDs mais comuns têm tipoReceita; o resto fica pra seleção manual no modal.
// Escolha do default (quando há variantes): SEM ST + ISS devido ao próprio município.

const VIGENCIA = new Date("2018-01-01T00:00:00Z");

// [idAtividade, descricao, anexoImplicito, mercado, sujeitoFatorR, tipoReceita|null]
const ATIVIDADES = [
  [1,  "Revenda de mercadorias (interno) — sem ST/monofásico/antecipação",                        "I",   "INTERNO", false, "REVENDA_MERCADORIA"],
  [2,  "Revenda de mercadorias (interno) — com ST/monofásico/antecipação",                         "I",   "INTERNO", false, null],
  [3,  "Revenda de mercadorias para o exterior",                                                    "I",   "EXTERNO", false, "REVENDA_MERCADORIA"],
  [4,  "Venda de industrializados pelo contribuinte (interno) — sem ST",                            "II",  "INTERNO", false, "INDUSTRIALIZACAO"],
  [5,  "Venda de industrializados pelo contribuinte (interno) — com ST",                            "II",  "INTERNO", false, null],
  [6,  "Venda de industrializados pelo contribuinte para o exterior",                               "II",  "EXTERNO", false, "INDUSTRIALIZACAO"],
  [7,  "Locação de bens móveis (interno)",                                                          "III", "INTERNO", false, null],
  [8,  "Locação de bens móveis para o exterior",                                                    "III", "EXTERNO", false, null],
  [9,  "Serviços (interno) — escritórios contábeis com ISS fixo no Município",                      "III", "INTERNO", false, null],
  [10, "Serviços (interno) — Fator R, sem retenção ISS, ISS devido a OUTRO município",              "III", "INTERNO", true,  null],
  [11, "Serviços (interno) — Fator R, sem retenção ISS, ISS devido ao PRÓPRIO município",           "III", "INTERNO", true,  "SERVICO_FATOR_R"],
  [12, "Serviços (interno) — Fator R, com retenção/substituição de ISS",                            "III", "INTERNO", true,  null],
  [13, "Serviços (interno) — Anexo III (não Fator R), sem retenção, ISS a OUTRO município",          "III", "INTERNO", false, null],
  [14, "Serviços (interno) — Anexo III (não Fator R), sem retenção, ISS ao PRÓPRIO município",       "III", "INTERNO", false, "SERVICO_ANEXO_III"],
  [15, "Serviços (interno) — Anexo III (não Fator R), com retenção/substituição de ISS",            "III", "INTERNO", false, null],
  [16, "Serviços (interno) — Anexo IV, sem retenção, ISS a OUTRO município",                         "IV",  "INTERNO", false, null],
  [17, "Serviços (interno) — Anexo IV, sem retenção, ISS ao PRÓPRIO município",                      "IV",  "INTERNO", false, "SERVICO_ANEXO_IV"],
  [18, "Serviços (interno) — Anexo IV, com retenção/substituição de ISS",                           "IV",  "INTERNO", false, null],
  [19, "Construção civil 7.02/7.05/16.1 (interno) — Anexo III, sem retenção, ISS OUTRO município",   "III", "INTERNO", false, null],
  [20, "Construção civil 7.02/7.05/16.1 (interno) — Anexo III, sem retenção, ISS PRÓPRIO município", "III", "INTERNO", false, null],
  [21, "Construção civil 7.02/7.05/16.1 (interno) — Anexo III, com retenção de ISS",                 "III", "INTERNO", false, null],
  [22, "Construção civil 7.02/7.05/16.1 (interno) — Anexo IV, sem retenção, ISS OUTRO município",    "IV",  "INTERNO", false, null],
  [23, "Construção civil 7.02/7.05/16.1 (interno) — Anexo IV, sem retenção, ISS PRÓPRIO município",  "IV",  "INTERNO", false, null],
  [24, "Construção civil 7.02/7.05/16.1 (interno) — Anexo IV, com retenção de ISS",                  "IV",  "INTERNO", false, null],
  [25, "Transporte coletivo municipal (interno) — sem retenção, ISS OUTRO município",                "III", "INTERNO", false, null],
  [26, "Transporte coletivo municipal (interno) — sem retenção, ISS PRÓPRIO município",              "III", "INTERNO", false, null],
  [27, "Transporte coletivo municipal (interno) — com retenção de ISS",                             "III", "INTERNO", false, null],
  [28, "Serviços p/ exterior — escritórios contábeis com ISS fixo",                                 "III", "EXTERNO", false, null],
  [29, "Serviços p/ exterior — Fator R",                                                            "III", "EXTERNO", true,  "SERVICO_FATOR_R"],
  [30, "Serviços p/ exterior — Anexo III (não Fator R)",                                            "III", "EXTERNO", false, "SERVICO_ANEXO_III"],
  [31, "Serviços p/ exterior — Anexo IV",                                                           "IV",  "EXTERNO", false, "SERVICO_ANEXO_IV"],
  [32, "Construção civil 7.02/7.05 p/ exterior — Anexo III",                                        "III", "EXTERNO", false, null],
  [33, "Construção civil 7.02/7.05 p/ exterior — Anexo IV",                                         "IV",  "EXTERNO", false, null],
  [34, "Transporte/comunicação interestadual/intermunicipal (interno) — transporte sem ST ICMS",   "I",   "INTERNO", false, null],
  [35, "Transporte/comunicação interestadual/intermunicipal (interno) — transporte com ST ICMS",   "I",   "INTERNO", false, null],
  [36, "Transporte/comunicação interestadual/intermunicipal (interno) — comunicação sem ST ICMS",  "I",   "INTERNO", false, null],
  [37, "Transporte/comunicação interestadual/intermunicipal (interno) — comunicação com ST ICMS",  "I",   "INTERNO", false, null],
  [38, "Transporte interestadual/intermunicipal p/ exterior — transporte",                          "I",   "EXTERNO", false, null],
  [39, "Comunicação interestadual/intermunicipal p/ exterior — comunicação",                        "I",   "EXTERNO", false, null],
  [40, "Incidência simultânea IPI+ISS (interno) — sem retenção, ISS OUTRO município",                "II",  "INTERNO", false, null],
  [41, "Incidência simultânea IPI+ISS (interno) — sem retenção, ISS PRÓPRIO município",              "II",  "INTERNO", false, null],
  [42, "Incidência simultânea IPI+ISS (interno) — com retenção de ISS",                              "II",  "INTERNO", false, null],
  [43, "Incidência simultânea IPI+ISS para o exterior",                                              "II",  "EXTERNO", false, null],
];

export async function seedAtividadePgdasd(prisma, { log } = {}) {
  let created = 0, updated = 0;
  for (const [idAtividade, descricao, anexoImplicito, mercado, sujeitoFatorR, tipoReceita] of ATIVIDADES) {
    try {
      const existing = await prisma.atividadePgdasd.findFirst({
        where: { idAtividade, vigenciaInicio: VIGENCIA },
        select: { id: true },
      });
      const data = { descricao, anexoImplicito, mercado, sujeitoFatorR, tipoReceita, vigenciaFim: null };
      if (existing) {
        await prisma.atividadePgdasd.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.atividadePgdasd.create({
          data: { idAtividade, ...data, vigenciaInicio: VIGENCIA, verificadoTrial: false },
        });
        created++;
      }
    } catch (err) {
      log?.warn?.({ err: err?.message, idAtividade }, "[AtividadePgdasdSeed] falha");
    }
  }
  log?.info?.({ created, updated, total: ATIVIDADES.length }, "[AtividadePgdasdSeed] concluído");
  return { created, updated, total: ATIVIDADES.length };
}
