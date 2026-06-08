// Q14.1.b — Tabela versionada das alíquotas Simples Nacional.
//
// Vigência LC 123/06 (atualizada pela LC 155/16, em vigor desde 2018-01-01).
// 5 anexos × 6 faixas = 30 linhas.
//
// Quando a Reforma Tributária mudar limites/alíquotas, basta criar nova
// versão com `vigenciaInicio` = data da nova lei. O motor de apuração
// (Q14.3) escolhe automaticamente a vigência correta pela data da
// competência calculada.
//
// Fonte: Resolução CGSN 140/2018 anexos I-V.
// Alíquota efetiva: (RBT12 × nominal − parcelaDeduzir) / RBT12

const VIGENCIA_LC155 = new Date("2018-01-01T00:00:00Z");

// Estrutura: [anexo, faixa, rbt12Min, rbt12Max, aliquotaNominal, parcelaDeduzir]
// Anexo I — Comércio (revenda de mercadorias)
const ANEXO_I = [
  ["I", 1,        0.00,   180000.00, 0.0400,       0.00],
  ["I", 2,   180000.01,   360000.00, 0.0730,    5940.00],
  ["I", 3,   360000.01,   720000.00, 0.0950,   13860.00],
  ["I", 4,   720000.01,  1800000.00, 0.1070,   22500.00],
  ["I", 5,  1800000.01,  3600000.00, 0.1430,   87300.00],
  ["I", 6,  3600000.01,  4800000.00, 0.1900,  378000.00],
];

// Anexo II — Indústria
const ANEXO_II = [
  ["II", 1,        0.00,   180000.00, 0.0450,       0.00],
  ["II", 2,   180000.01,   360000.00, 0.0780,    5940.00],
  ["II", 3,   360000.01,   720000.00, 0.1000,   13860.00],
  ["II", 4,   720000.01,  1800000.00, 0.1120,   22500.00],
  ["II", 5,  1800000.01,  3600000.00, 0.1470,   85500.00],
  ["II", 6,  3600000.01,  4800000.00, 0.3000,  720000.00],
];

// Anexo III — Serviços (parcela do Fator R quando >= 28% também cai aqui)
const ANEXO_III = [
  ["III", 1,        0.00,   180000.00, 0.0600,       0.00],
  ["III", 2,   180000.01,   360000.00, 0.1120,    9360.00],
  ["III", 3,   360000.01,   720000.00, 0.1350,   17640.00],
  ["III", 4,   720000.01,  1800000.00, 0.1600,   35640.00],
  ["III", 5,  1800000.01,  3600000.00, 0.2100,  125640.00],
  ["III", 6,  3600000.01,  4800000.00, 0.3300,  648000.00],
];

// Anexo IV — Construção civil, advocacia, vigilância armada, etc (sem Fator R)
const ANEXO_IV = [
  ["IV", 1,        0.00,   180000.00, 0.0450,       0.00],
  ["IV", 2,   180000.01,   360000.00, 0.0900,    8100.00],
  ["IV", 3,   360000.01,   720000.00, 0.1020,   12420.00],
  ["IV", 4,   720000.01,  1800000.00, 0.1400,   39780.00],
  ["IV", 5,  1800000.01,  3600000.00, 0.2200,  183780.00],
  ["IV", 6,  3600000.01,  4800000.00, 0.3300,  828000.00],
];

// Anexo V — Serviços intelectuais (Fator R < 28% cai aqui)
const ANEXO_V = [
  ["V", 1,        0.00,   180000.00, 0.1550,       0.00],
  ["V", 2,   180000.01,   360000.00, 0.1800,    4500.00],
  ["V", 3,   360000.01,   720000.00, 0.1950,    9900.00],
  ["V", 4,   720000.01,  1800000.00, 0.2050,   17100.00],
  ["V", 5,  1800000.01,  3600000.00, 0.2300,   62100.00],
  ["V", 6,  3600000.01,  4800000.00, 0.3050,  540000.00],
];

const ALL_ROWS = [...ANEXO_I, ...ANEXO_II, ...ANEXO_III, ...ANEXO_IV, ...ANEXO_V];

/**
 * Idempotente. Insere ou atualiza (anexo, faixa, vigenciaInicio).
 */
export async function seedAliquotaSimplesNacional(prisma, { log } = {}) {
  let created = 0, updated = 0;
  for (const [anexo, faixa, rbt12Min, rbt12Max, aliquotaNominal, parcelaDeduzir] of ALL_ROWS) {
    try {
      const existing = await prisma.aliquotaSimplesNacional.findFirst({
        where: { anexo, faixa, vigenciaInicio: VIGENCIA_LC155 },
        select: { id: true },
      });
      if (existing) {
        await prisma.aliquotaSimplesNacional.update({
          where: { id: existing.id },
          data: { rbt12Min, rbt12Max, aliquotaNominal, parcelaDeduzir, vigenciaFim: null },
        });
        updated++;
      } else {
        await prisma.aliquotaSimplesNacional.create({
          data: {
            anexo, faixa,
            rbt12Min, rbt12Max,
            aliquotaNominal, parcelaDeduzir,
            vigenciaInicio: VIGENCIA_LC155,
            vigenciaFim: null,
          },
        });
        created++;
      }
    } catch (err) {
      log?.warn({ err: err?.message, anexo, faixa }, "[AliquotaSeed] falha");
    }
  }
  log?.info({ created, updated, total: ALL_ROWS.length }, "[AliquotaSeed] concluído");
  return { created, updated, total: ALL_ROWS.length };
}
