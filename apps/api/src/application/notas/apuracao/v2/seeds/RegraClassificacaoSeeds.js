// Q14.1.d — Regras de classificação GLOBAL (substitui DeparaAnexoSeeds antiga).
//
// Diferença-chave da antiga: mapeia codigo → TipoReceita (não → anexo direto).
// Anexo passa a ser DERIVADO pelo motor (Q14.3) considerando Fator R mensal.
//
// Estratégia em camadas:
//   1. Itens LC116 específicos (ex: "1.08" → SERVICO_FATOR_R)
//   2. Capítulos LC116 fallback (ex: "17" → SERVICO_FATOR_R)
//   3. Códigos cTribNac comuns (NFS-e Nacional 6 dígitos) — mas o
//      ClassificadorService novo prefere converter cTribNac→LC116
//      via cTribNacToLc116() e bater com (1)/(2).
//
// Convivência: tabela RegraClassificacao convive com DeparaAnexo antiga
// (que continua sendo lida pelo ClassificadorAnexos atual) — desativamos
// a antiga só depois da Fase 6 promovida.

const TR_REVENDA = "REVENDA_MERCADORIA";
const TR_INDUSTRIA = "INDUSTRIALIZACAO";
const TR_ANEXO_III = "SERVICO_ANEXO_III";
const TR_ANEXO_IV = "SERVICO_ANEXO_IV";
const TR_ANEXO_V = "SERVICO_ANEXO_V";
const TR_FATOR_R = "SERVICO_FATOR_R";

const VIGENCIA = new Date("2018-01-01T00:00:00Z");

// ─── ITENS ESPECÍFICOS LC116 ────────────────────────────────────────────────
// Cobertura ampla — mantém as ~60 entradas do DeparaAnexoSeeds antigo
// mas agora com TipoReceita em vez de (anexo + sujeitoFatorR).
const LC116_ITENS = [
  // 1.x — Informática (Fator R)
  ["1.01", TR_FATOR_R, "Análise e desenvolvimento de sistemas"],
  ["1.02", TR_FATOR_R, "Programação"],
  ["1.03", TR_FATOR_R, "Processamento de dados"],
  ["1.04", TR_FATOR_R, "Elaboração de programas de computador"],
  ["1.05", TR_FATOR_R, "Licenciamento de programas (software)"],
  ["1.06", TR_FATOR_R, "Assessoria/consultoria em informática"],
  ["1.07", TR_FATOR_R, "Suporte técnico em informática"],
  ["1.08", TR_FATOR_R, "Planejamento, confecção, manutenção e atualização de páginas web"],

  // 3.x — Locação (mais comum Anexo III sem FR; intelectual cai em 3.04)
  ["3.04", TR_FATOR_R, "Cessão de direito de uso de marcas/sinais de propaganda"],

  // 4.x — Saúde
  ["4.01", TR_FATOR_R, "Medicina e biomedicina"],
  ["4.02", TR_FATOR_R, "Análises clínicas, patologia, eletricidade médica, etc"],
  ["4.03", TR_ANEXO_III, "Hospitais, clínicas, laboratórios, ambulatórios, etc"],
  ["4.06", TR_FATOR_R, "Enfermagem, inclusive serviços auxiliares"],
  ["4.08", TR_FATOR_R, "Terapia ocupacional, fisioterapia e fonoaudiologia"],
  ["4.11", TR_FATOR_R, "Obstetrícia"],
  ["4.12", TR_FATOR_R, "Odontologia"],
  ["4.13", TR_FATOR_R, "Ortóptica"],
  ["4.14", TR_FATOR_R, "Próteses sob encomenda"],
  ["4.15", TR_FATOR_R, "Psicanálise"],
  ["4.16", TR_FATOR_R, "Psicologia"],
  ["4.17", TR_FATOR_R, "Casas de repouso, creches, asilos"],
  ["4.22", TR_ANEXO_III, "Planos de medicina de grupo ou individual"],

  // 5.x — Veterinária
  ["5.01", TR_FATOR_R, "Medicina veterinária e zootecnia"],

  // 6.x — Estética (não-intelectual)
  ["6.01", TR_ANEXO_III, "Barbearia, cabeleireiros, manicuros"],
  ["6.02", TR_ANEXO_III, "Esteticistas, tratamento de pele, depilação"],
  ["6.05", TR_ANEXO_III, "Centros de emagrecimento, spa"],

  // 7.x — Engenharia
  ["7.01", TR_FATOR_R, "Engenharia, agronomia, agrimensura, arquitetura, geologia"],
  ["7.02", TR_ANEXO_IV, "Execução de obras de construção civil"],
  ["7.03", TR_FATOR_R, "Elaboração de planos diretores, estudos de viabilidade"],
  ["7.04", TR_FATOR_R, "Demolição"],
  ["7.05", TR_ANEXO_IV, "Reparação, conservação e reforma de edifícios"],
  ["7.06", TR_ANEXO_IV, "Instalação de tapetes, carpetes, assoalhos, cortinas, revestimentos"],
  ["7.10", TR_ANEXO_III, "Limpeza, manutenção de vias, jardins, piscinas, escadas/elevadores"],
  ["7.11", TR_ANEXO_III, "Decoração e jardinagem, inclusive corte e poda"],
  ["7.16", TR_FATOR_R, "Florestamento, reflorestamento, semeadura, adubação"],

  // 8.x — Educação (Fator R)
  ["8.01", TR_FATOR_R, "Ensino regular pré-escolar, fundamental, médio e superior"],
  ["8.02", TR_FATOR_R, "Instrução, treinamento, orientação pedagógica"],

  // 9.x — Hospedagem/Turismo
  ["9.01", TR_ANEXO_III, "Hospedagem, motéis, pensões, hotelaria"],
  ["9.02", TR_ANEXO_III, "Agenciamento, organização, promoção, execução de turismo"],

  // 10.x — Intermediação
  ["10.01", TR_FATOR_R, "Agenciamento/representação comercial"],
  ["10.02", TR_ANEXO_III, "Agenciamento, corretagem ou intermediação de títulos"],
  ["10.05", TR_FATOR_R, "Agenciamento, corretagem ou intermediação de bens móveis/imóveis"],
  ["10.08", TR_FATOR_R, "Agenciamento de publicidade e propaganda"],
  ["10.09", TR_FATOR_R, "Representação de qualquer natureza, inclusive comercial"],

  // 11.x — Guarda/Vigilância/Estacionamento
  ["11.01", TR_ANEXO_III, "Guarda e estacionamento de veículos"],
  ["11.02", TR_ANEXO_IV, "Vigilância, segurança ou monitoramento (armada — Anexo IV)"],
  ["11.03", TR_ANEXO_IV, "Escolta, inclusive de veículos e cargas"],
  ["11.04", TR_ANEXO_III, "Armazenamento, depósito, carga, descarga, arrumação"],

  // 12.x — Diversões
  ["12.01", TR_ANEXO_III, "Espetáculos teatrais"],
  ["12.07", TR_ANEXO_III, "Shows, ballet, danças, desfiles, bailes"],
  ["12.11", TR_ANEXO_III, "Competições esportivas"],
  ["12.13", TR_ANEXO_III, "Diversões, lazer, entretenimento"],

  // 13.x — Fotografia
  ["13.02", TR_ANEXO_III, "Fonografia ou gravação de sons"],
  ["13.03", TR_ANEXO_III, "Fotografia e cinematografia"],

  // 14.x — Bens de terceiros
  ["14.01", TR_ANEXO_III, "Lubrificação, limpeza, lustração, revisão"],
  ["14.02", TR_ANEXO_III, "Assistência técnica"],
  ["14.05", TR_ANEXO_III, "Restauração, recondicionamento"],
  ["14.06", TR_ANEXO_III, "Instalação e montagem de aparelhos e equipamentos"],
  ["14.07", TR_ANEXO_III, "Colocação de molduras"],
  ["14.09", TR_ANEXO_III, "Alfaiataria e costura"],
  ["14.13", TR_ANEXO_III, "Carpintaria e serralheria"],

  // 16.x — Transporte municipal
  ["16.01", TR_ANEXO_III, "Transporte municipal"],

  // 17.x — Apoio técnico/admin/jurídico/contábil/marketing
  ["17.01", TR_FATOR_R, "Assessoria/consultoria de qualquer natureza"],
  ["17.02", TR_FATOR_R, "Datilografia, digitação, expediente, secretaria"],
  ["17.03", TR_FATOR_R, "Planejamento, coordenação, programação técnica/financeira"],
  ["17.05", TR_ANEXO_III, "Fornecimento de mão-de-obra"],
  ["17.06", TR_FATOR_R, "Propaganda e publicidade"],
  ["17.07", TR_FATOR_R, "Veiculação de propaganda/publicidade"],
  ["17.08", TR_FATOR_R, "Franquia/franchising"],
  ["17.09", TR_FATOR_R, "Perícias, laudos, exames técnicos"],
  ["17.10", TR_FATOR_R, "Planejamento, organização e administração de feiras/congressos"],
  ["17.14", TR_ANEXO_IV, "Advocacia"],
  ["17.18", TR_FATOR_R, "Arbitragem"],
  ["17.19", TR_FATOR_R, "Auditoria"],
  ["17.20", TR_FATOR_R, "Análise de organização e métodos"],
  ["17.22", TR_FATOR_R, "Cobrança em geral"],
  ["17.23", TR_FATOR_R, "Assessoria, análise, avaliação, atendimento financeiro"],
  ["17.24", TR_FATOR_R, "Apresentação de palestras, conferências, seminários"],
  ["17.25", TR_FATOR_R, "Inserção de textos/material publicitário em qualquer meio"],

  // 23.x — Programação visual / design
  ["23.01", TR_FATOR_R, "Programação visual, design industrial"],

  // 24.x — Chaveiros, placas
  ["24.01", TR_FATOR_R, "Confecção de carimbos, placas, sinalização visual"],

  // 26.x — Correios
  ["26.01", TR_ANEXO_III, "Coleta, remessa ou entrega de correspondências"],

  // 27.x — Assistência social
  ["27.01", TR_ANEXO_III, "Assistência social"],

  // 31.x — Telecom técnico
  ["31.01", TR_ANEXO_III, "Serviços técnicos em edificações, eletrônica, telecomunicações"],

  // 32.x — Desenho técnico
  ["32.01", TR_FATOR_R, "Desenhos técnicos"],

  // 35.x — Reportagem
  ["35.01", TR_ANEXO_III, "Reportagem, assessoria de imprensa, jornalismo"],

  // 37.x — Artísticos
  ["37.01", TR_FATOR_R, "Artistas, atletas, modelos e manequins"],
];

// ─── CAPÍTULOS LC116 (fallback de capítulo) ─────────────────────────────────
// Codigo = só o número do capítulo (ex: "17"). Casa quando item específico
// não estiver mapeado. Cobertura: 40 capítulos.
const LC116_CAPITULOS = [
  ["1",  TR_FATOR_R,  "Cap 1 — Informática e congêneres"],
  ["2",  TR_FATOR_R,  "Cap 2 — Pesquisa e desenvolvimento"],
  ["3",  TR_ANEXO_III,"Cap 3 — Locação, cessão de direito de uso"],
  ["4",  TR_FATOR_R,  "Cap 4 — Saúde, assistência médica"],
  ["5",  TR_FATOR_R,  "Cap 5 — Medicina veterinária"],
  ["6",  TR_ANEXO_III,"Cap 6 — Estética, cuidados pessoais"],
  ["7",  TR_FATOR_R,  "Cap 7 — Engenharia, arquitetura, urbanismo"],
  ["8",  TR_FATOR_R,  "Cap 8 — Educação, ensino, instrução"],
  ["9",  TR_ANEXO_III,"Cap 9 — Hospedagem, turismo, viagens"],
  ["10", TR_FATOR_R,  "Cap 10 — Intermediação, agenciamento, representação"],
  ["11", TR_ANEXO_III,"Cap 11 — Guarda, estacionamento, armazenamento"],
  ["12", TR_ANEXO_III,"Cap 12 — Diversões, lazer, entretenimento"],
  ["13", TR_ANEXO_III,"Cap 13 — Fonografia, fotografia, cinematografia"],
  ["14", TR_ANEXO_III,"Cap 14 — Bens de terceiros (oficinas, manutenção)"],
  ["15", TR_FATOR_R,  "Cap 15 — Serviços relacionados ao setor bancário/financeiro"],
  ["16", TR_ANEXO_III,"Cap 16 — Transporte municipal"],
  ["17", TR_FATOR_R,  "Cap 17 — Apoio técnico, admin, jurídico, contábil, marketing"],
  ["18", TR_FATOR_R,  "Cap 18 — Regulação de atividades profissionais"],
  ["19", TR_ANEXO_III,"Cap 19 — Distribuição e venda"],
  ["20", TR_ANEXO_III,"Cap 20 — Portuários, aeroportuários, ferroviários"],
  ["21", TR_ANEXO_III,"Cap 21 — Registros públicos, cartorários"],
  ["22", TR_ANEXO_III,"Cap 22 — Exploração de rodovia (pedágios)"],
  ["23", TR_FATOR_R,  "Cap 23 — Programação visual, design, comunicação"],
  ["24", TR_FATOR_R,  "Cap 24 — Chaveiros, carimbo, placas, sinalização"],
  ["25", TR_ANEXO_III,"Cap 25 — Funerários"],
  ["26", TR_ANEXO_III,"Cap 26 — Coleta, remessa, entrega (correios)"],
  ["27", TR_ANEXO_III,"Cap 27 — Assistência social"],
  ["28", TR_ANEXO_III,"Cap 28 — Avaliação de bens e serviços"],
  ["29", TR_ANEXO_III,"Cap 29 — Biblioteconomia"],
  ["30", TR_FATOR_R,  "Cap 30 — Biologia, biotecnologia, química"],
  ["31", TR_ANEXO_III,"Cap 31 — Telecomunicações"],
  ["32", TR_FATOR_R,  "Cap 32 — Desenho técnico"],
  ["33", TR_ANEXO_III,"Cap 33 — Desembaraço aduaneiro, magnetização cartões"],
  ["34", TR_ANEXO_IV, "Cap 34 — Investigação, segurança privada, vigilância"],
  ["35", TR_ANEXO_III,"Cap 35 — Reportagem, assessoria de imprensa"],
  ["36", TR_ANEXO_III,"Cap 36 — Meteorologia"],
  ["37", TR_FATOR_R,  "Cap 37 — Artísticos"],
  ["38", TR_FATOR_R,  "Cap 38 — Museologia"],
  ["39", TR_ANEXO_III,"Cap 39 — Ourivesaria e lapidação"],
  ["40", TR_FATOR_R,  "Cap 40 — Obras de arte sob encomenda"],
];

export async function seedRegraClassificacaoGlobal(prisma, { log } = {}) {
  let created = 0, updated = 0, failed = 0;

  const all = [
    ...LC116_ITENS.map(([codigo, tipoReceita, descricao]) => ({ tipoCodigo: "LC116", codigo, tipoReceita, descricao, prioridade: 10 })),
    ...LC116_CAPITULOS.map(([codigo, tipoReceita, descricao]) => ({ tipoCodigo: "LC116", codigo, tipoReceita, descricao, prioridade: 5 })),
  ];

  // Workaround Prisma: unique composto com null não dá upsert direto.
  for (const seed of all) {
    try {
      const existing = await prisma.regraClassificacao.findFirst({
        where: {
          escopo: "GLOBAL",
          portalClientId: null,
          tipoCodigo: seed.tipoCodigo,
          codigo: seed.codigo,
          vigenciaInicio: VIGENCIA,
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.regraClassificacao.update({
          where: { id: existing.id },
          data: {
            tipoReceita: seed.tipoReceita,
            descricao: seed.descricao,
            prioridade: seed.prioridade,
            vigenciaFim: null,
          },
        });
        updated++;
      } else {
        await prisma.regraClassificacao.create({
          data: {
            escopo: "GLOBAL",
            portalClientId: null,
            tipoCodigo: seed.tipoCodigo,
            codigo: seed.codigo,
            tipoReceita: seed.tipoReceita,
            descricao: seed.descricao,
            prioridade: seed.prioridade,
            fonte: "SEED_APP",
            vigenciaInicio: VIGENCIA,
          },
        });
        created++;
      }
    } catch (err) {
      failed++;
      log?.warn({ err: err?.message, seed }, "[RegraClassificacaoSeed] falha");
    }
  }

  log?.info({ created, updated, failed, total: all.length }, "[RegraClassificacaoSeed] concluído");
  return { created, updated, failed, total: all.length };
}
