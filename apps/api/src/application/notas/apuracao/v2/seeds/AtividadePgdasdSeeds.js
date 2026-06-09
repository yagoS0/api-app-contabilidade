// Q15.2 — Tabela de-para versionada: atividade do PGDAS-D → anexo/mercado.
//
// idAtividade é o ID que vai no payload TRANSDECLARACAO11
// (declaracao.estabelecimentos[].atividades[]). Carrega implicitamente o anexo
// e o mercado — a gente NÃO envia "Anexo III", envia "receita de R$ X na atividade Y".
//
// ⚠ IMPORTANTE: os idAtividade abaixo são os documentados/comumente usados, mas
// PRECISAM ser confirmados no ambiente TRIAL do Integra Contador antes de transmitir
// em produção (uma chamada com indicadorTransmissao:false + payload incompleto
// devolve mensagens de validação que ajudam a mapear os IDs reais).
// Por isso cada linha tem `verificadoTrial: false` — vira true após confirmação.
//
// Versionado por vigência (igual AliquotaSimplesNacional): muda quando a RFB
// altera o programa PGDAS-D.

const VIGENCIA = new Date("2018-01-01T00:00:00Z");

// [idAtividade, descricao, anexoImplicito, mercado, sujeitoFatorR, tipoReceita]
// tipoReceita = enum do nosso classificador (pra default automático no modal).
const ATIVIDADES = [
  // ─── Comércio (Anexo I) ──────────────────────────────────────────────────
  [1,  "Revenda de mercadorias (Anexo I) — mercado interno",                "I",   "INTERNO", false, "REVENDA_MERCADORIA"],
  [2,  "Revenda de mercadorias com substituição tributária (Anexo I)",      "I",   "INTERNO", false, "REVENDA_MERCADORIA"],
  [3,  "Revenda de mercadorias — mercado externo (exportação)",             "I",   "EXTERNO", false, "REVENDA_MERCADORIA"],

  // ─── Indústria (Anexo II) ────────────────────────────────────────────────
  [4,  "Venda de mercadorias industrializadas (Anexo II) — mercado interno", "II",  "INTERNO", false, "INDUSTRIALIZACAO"],
  [5,  "Venda de mercadorias industrializadas com ST (Anexo II)",            "II",  "INTERNO", false, "INDUSTRIALIZACAO"],
  [6,  "Venda de mercadorias industrializadas — exportação",                 "II",  "EXTERNO", false, "INDUSTRIALIZACAO"],

  // ─── Serviços Anexo III (não sujeitos a Fator-R) ─────────────────────────
  [7,  "Prestação de serviços (Anexo III) — sem retenção/ST",               "III", "INTERNO", false, "SERVICO_ANEXO_III"],
  [8,  "Prestação de serviços (Anexo III) — exportação",                    "III", "EXTERNO", false, "SERVICO_ANEXO_III"],

  // ─── Serviços Anexo IV (construção, advocacia, vigilância — sem Fator-R) ──
  [9,  "Prestação de serviços (Anexo IV)",                                   "IV",  "INTERNO", false, "SERVICO_ANEXO_IV"],
  [10, "Prestação de serviços (Anexo IV) — exportação",                     "IV",  "EXTERNO", false, "SERVICO_ANEXO_IV"],

  // ─── Serviços sujeitos a Fator-R (Anexo III se R≥28%, V se R<28%) ─────────
  // A RFB decide III↔V pela folha; o anexoImplicito aqui é só informativo.
  [11, "Prestação de serviços sujeitos ao Fator R (Anexo III/V)",            "V",   "INTERNO", true,  "SERVICO_FATOR_R"],
  [12, "Prestação de serviços sujeitos ao Fator R — exportação",            "V",   "EXTERNO", true,  "SERVICO_FATOR_R"],

  // ─── Serviços Anexo V puro (raro) ────────────────────────────────────────
  [13, "Prestação de serviços (Anexo V)",                                    "V",   "INTERNO", false, "SERVICO_ANEXO_V"],
  [14, "Prestação de serviços (Anexo V) — exportação",                       "V",   "EXTERNO", false, "SERVICO_ANEXO_V"],
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
