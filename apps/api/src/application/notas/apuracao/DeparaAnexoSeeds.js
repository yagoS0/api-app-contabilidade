// Q12.C.1: seeds da tabela DeparaAnexo (escopo GLOBAL).
//
// Base de classificação inicial pra itens de NFS-e (códigos LC116) e
// NF-e (NCM/CFOP) no Simples Nacional.
//
// Regras gerais (LC 123/06 anexada à LC 116/03):
//   - Anexo III: serviços em geral (limpeza, vigilância, transporte municipal, etc)
//                + serviços do Anexo V quando Fator R ≥ 28%
//   - Anexo IV: construção civil, serviços advocatícios, vigilância armada, etc
//                (não usa Fator R — não pode optar pelo III)
//   - Anexo V: serviços intelectuais/profissionais (consultoria, medicina,
//              engenharia, propaganda etc) quando Fator R < 28%
//   - sujeitoFatorR=true: item pode oscilar III↔V conforme RB12/FS12 da empresa
//
// Esta lista é INCOMPLETA — cobre os mais comuns. Contador pode adicionar
// overrides EMPRESA quando algo cair como UNKNOWN.

const ANEXO_III = "III";
const ANEXO_IV = "IV";
const ANEXO_V = "V";

// LC116 — Lista de serviços (códigos mais comuns)
// Formato: { codigo, anexoResolvido, sujeitoFatorR, descricao }
const LC116_SEEDS = [
  // 1.x — Serviços de informática (geralmente Anexo V → III com Fator R ≥28%)
  { codigo: "1.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Análise e desenvolvimento de sistemas" },
  { codigo: "1.02", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Programação" },
  { codigo: "1.03", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Processamento de dados" },
  { codigo: "1.04", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Elaboração de programas de computador" },
  { codigo: "1.05", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Licenciamento de programas (software)" },
  { codigo: "1.06", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Assessoria/consultoria em informática" },
  { codigo: "1.07", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Suporte técnico em informática" },
  { codigo: "1.08", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Planejamento, confecção, manutenção e atualização de páginas web" },

  // 3.x — Serviços de pesquisa e desenvolvimento
  { codigo: "3.04", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Cessão de direito de uso de marcas/sinais de propaganda" },

  // 4.x — Serviços médicos e de saúde (geralmente Anexo III com Fator R)
  { codigo: "4.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Medicina e biomedicina" },
  { codigo: "4.02", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Análises clínicas, patologia, eletricidade médica, etc" },
  { codigo: "4.03", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Hospitais, clínicas, laboratórios, ambulatórios, etc" },
  { codigo: "4.06", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Enfermagem, inclusive serviços auxiliares" },
  { codigo: "4.08", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Terapia ocupacional, fisioterapia e fonoaudiologia" },
  { codigo: "4.11", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Obstetrícia" },
  { codigo: "4.12", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Odontologia" },
  { codigo: "4.13", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Ortóptica" },
  { codigo: "4.14", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Próteses sob encomenda" },
  { codigo: "4.15", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Psicanálise" },
  { codigo: "4.16", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Psicologia" },
  { codigo: "4.17", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Casas de repouso e de recuperação, creches, asilos e congêneres" },
  { codigo: "4.22", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Planos de medicina de grupo ou individual e convênios" },

  // 7.x — Engenharia, arquitetura, urbanismo
  { codigo: "7.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Engenharia, agronomia, agrimensura, arquitetura, geologia" },
  { codigo: "7.02", anexoResolvido: ANEXO_IV, sujeitoFatorR: false, descricao: "Execução de obras de construção civil" },
  { codigo: "7.03", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Elaboração de planos diretores, estudos de viabilidade, etc" },
  { codigo: "7.05", anexoResolvido: ANEXO_IV, sujeitoFatorR: false, descricao: "Reparação, conservação e reforma de edifícios" },

  // 9.x — Serviços de hotelaria
  { codigo: "9.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Hospedagem, motéis, pensões, hotelaria" },
  { codigo: "9.02", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Agenciamento, organização, promoção, execução de turismo" },

  // 10.x — Serviços de intermediação
  { codigo: "10.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Agenciamento/representação comercial" },
  { codigo: "10.02", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Agenciamento, corretagem ou intermediação de títulos" },

  // 11.x — Guarda, estacionamento, armazenamento
  { codigo: "11.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Guarda e estacionamento de veículos terrestres" },
  { codigo: "11.04", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Armazenamento, depósito, carga, descarga, arrumação" },

  // 14.x — Serviços relativos a bens de terceiros (oficinas, manutenção)
  { codigo: "14.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Lubrificação, limpeza, lustração, revisão, etc" },
  { codigo: "14.02", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Assistência técnica" },
  { codigo: "14.05", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Restauração, recondicionamento" },
  { codigo: "14.13", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Carpintaria e serralheria" },

  // 17.x — Serviços de apoio técnico, administrativo, jurídico, contábil
  { codigo: "17.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Assessoria/consultoria de qualquer natureza" },
  { codigo: "17.02", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Datilografia, digitação, expediente, secretaria, etc" },
  { codigo: "17.03", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Planejamento, coordenação, programação ou organização técnica/financeira/administrativa" },
  { codigo: "17.05", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Fornecimento de mão-de-obra" },
  { codigo: "17.06", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Propaganda e publicidade" }, // ← Medical Marketing
  { codigo: "17.10", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Planejamento, organização e administração de feiras, congressos" },
  { codigo: "17.14", anexoResolvido: ANEXO_IV, sujeitoFatorR: false, descricao: "Advocacia" },
  { codigo: "17.18", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Arbitragem" },
  { codigo: "17.19", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Auditoria" },
  { codigo: "17.20", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Análise de organização e métodos" },

  // 33.x — Serviços de magnetização de cartões
  // (raro mas inclui)

  // Default desconhecido → III (mais conservador, contador revisa)
];

// NCM — Nomenclatura Comum do Mercosul (pra NF-e produtos)
// SIMPLES NACIONAL: receita de venda de mercadoria geralmente = Anexo I (não tem
// no nosso modelo ainda — vamos focar em serviços por enquanto, NF-e/NCM ficam
// como "VENDA" sem anexo específico mapeado).
// TODO: expandir quando suportar Comércio (Anexo I) e Indústria (Anexo II).
const NCM_SEEDS = [];

// CFOP — Código Fiscal de Operações e Prestações (pra NF-e)
// Útil pra detectar exportação (7xxx), substituição tributária, etc.
const CFOP_SEEDS = [];

/**
 * Idempotente — usa upsert por (escopo, tipoCodigo, codigo).
 * Roda uma vez no startup do servidor.
 */
export async function seedDeparaAnexoGlobal(prisma, { log } = {}) {
  let created = 0, updated = 0;
  const allSeeds = [
    ...LC116_SEEDS.map((s) => ({ ...s, tipoCodigo: "LC116" })),
    ...NCM_SEEDS.map((s) => ({ ...s, tipoCodigo: "NCM" })),
    ...CFOP_SEEDS.map((s) => ({ ...s, tipoCodigo: "CFOP" })),
  ];

  for (const seed of allSeeds) {
    const result = await prisma.deparaAnexo.upsert({
      where: {
        escopo_portalClientId_tipoCodigo_codigo: {
          escopo: "GLOBAL",
          portalClientId: null,
          tipoCodigo: seed.tipoCodigo,
          codigo: seed.codigo,
        },
      },
      create: {
        escopo: "GLOBAL",
        portalClientId: null,
        tipoCodigo: seed.tipoCodigo,
        codigo: seed.codigo,
        anexoResolvido: seed.anexoResolvido,
        sujeitoFatorR: seed.sujeitoFatorR,
        descricao: seed.descricao || null,
      },
      update: {
        // re-aplica seeds (caso valor mudou na nova versão)
        anexoResolvido: seed.anexoResolvido,
        sujeitoFatorR: seed.sujeitoFatorR,
        descricao: seed.descricao || null,
      },
    }).catch((err) => {
      log?.warn({ err: err?.message, seed }, "[DeparaAnexoSeeds] falha em 1 seed");
      return null;
    });

    if (result) {
      // Prisma upsert não diz se foi create vs update. Comparação simples:
      const elapsed = Date.now() - new Date(result.aprendidoEm).getTime();
      if (elapsed < 5000) created++; // criado nos últimos 5s = create
      else updated++;
    }
  }

  log?.info({ created, updated, total: allSeeds.length }, "[DeparaAnexoSeeds] concluído");
  return { created, updated, total: allSeeds.length };
}
