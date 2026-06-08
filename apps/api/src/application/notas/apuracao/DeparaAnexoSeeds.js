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

// ─── LC116 CAPÍTULOS (fallback quando item específico não está mapeado) ─────
// Cobertura completa dos 40 capítulos da LC 116/03.
// Convenção de chave: codigo = só o capítulo ("1", "17", "40"), tipoCodigo = "LC116"
// (mesmo tipo do item específico — facilita lookup no classificador).
// ClassificadorAnexos consulta primeiro o item exato ("17.25"), depois o capítulo ("17").
//
// Regra Simples Nacional (LC 123/06 + Resolução CGSN 140/18):
//   - Serviços INTELECTUAIS / profissionais regulamentados → Anexo V + Fator R
//     (informática, engenharia, saúde, contabilidade, marketing, educação, biotech, arte)
//   - Serviços GERAIS / operacionais → Anexo III sem Fator R
//     (limpeza, turismo, hotelaria, manutenção, transporte, oficinas, estacionamento)
//   - Construção civil pesada / advocacia → Anexo IV
//   - Quando duvidoso → III (mais conservador; contador revisa caso a caso)
const LC116_CHAPTERS = [
  { codigo: "1",  anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 1 — Informática e congêneres" },
  { codigo: "2",  anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 2 — Pesquisa e desenvolvimento" },
  { codigo: "3",  anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 3 — Locação, cessão de direito de uso (intangíveis)" },
  { codigo: "4",  anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 4 — Saúde, assistência médica e congêneres" },
  { codigo: "5",  anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 5 — Medicina veterinária e zootecnia" },
  { codigo: "6",  anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 6 — Estética, atividades físicas, cuidados pessoais" },
  { codigo: "7",  anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 7 — Engenharia, arquitetura, urbanismo (projetos)" },
  { codigo: "8",  anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 8 — Educação, ensino, instrução" },
  { codigo: "9",  anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 9 — Hospedagem, turismo, viagens" },
  { codigo: "10", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 10 — Intermediação, agenciamento, representação" },
  { codigo: "11", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 11 — Guarda, estacionamento, armazenamento" },
  { codigo: "12", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 12 — Diversões, lazer, entretenimento" },
  { codigo: "13", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 13 — Fonografia, fotografia, cinematografia, reprografia" },
  { codigo: "14", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 14 — Bens de terceiros (oficinas, manutenção, reforma)" },
  { codigo: "15", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 15 — Serviços relacionados a setor bancário/financeiro" },
  { codigo: "16", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 16 — Transporte municipal" },
  { codigo: "17", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 17 — Apoio técnico, administrativo, jurídico, contábil, marketing" },
  { codigo: "18", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 18 — Regulação de atividades profissionais" },
  { codigo: "19", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 19 — Distribuição e venda (não comércio)" },
  { codigo: "20", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 20 — Portuários, aeroportuários, ferroviários, terminais" },
  { codigo: "21", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 21 — Registros públicos, cartorários, notariais" },
  { codigo: "22", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 22 — Exploração de rodovia (pedágios)" },
  { codigo: "23", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 23 — Programação visual, design, comunicação" },
  { codigo: "24", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 24 — Chaveiros, confecção carimbo, placas, sinalização" },
  { codigo: "25", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 25 — Funerários" },
  { codigo: "26", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 26 — Coleta, remessa, entrega (correios)" },
  { codigo: "27", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 27 — Assistência social" },
  { codigo: "28", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 28 — Avaliação de bens e serviços" },
  { codigo: "29", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 29 — Biblioteconomia" },
  { codigo: "30", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 30 — Biologia, biotecnologia, química" },
  { codigo: "31", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 31 — Telecomunicações" },
  { codigo: "32", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 32 — Desenho técnico" },
  { codigo: "33", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 33 — Desembaraço aduaneiro, magnetização de cartões" },
  { codigo: "34", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 34 — Investigação, segurança privada, vigilância" },
  { codigo: "35", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 35 — Reportagem, assessoria de imprensa, jornalismo" },
  { codigo: "36", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 36 — Meteorologia" },
  { codigo: "37", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 37 — Artísticos" },
  { codigo: "38", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 38 — Museologia" },
  { codigo: "39", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Cap 39 — Ourivesaria e lapidação" },
  { codigo: "40", anexoResolvido: ANEXO_V,   sujeitoFatorR: true,  descricao: "Cap 40 — Obras de arte sob encomenda" },
];

// LC116 — Lista de serviços (cobertura ampla — itens específicos)
// Quando falta item específico, ClassificadorAnexos usa LC116_CHAPTERS abaixo.
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
  { codigo: "17.07", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Veiculação de propaganda/publicidade (exceto livros/jornais/periódicos)" },
  { codigo: "17.08", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Franquia/franchising" },
  { codigo: "17.09", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Perícias, laudos, exames técnicos" },
  { codigo: "17.10", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Planejamento, organização e administração de feiras, congressos" },
  { codigo: "17.24", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Apresentação de palestras, conferências, seminários" },
  { codigo: "17.25", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Inserção de textos/desenhos/material publicitário em qualquer meio" }, // ← LENTE
  { codigo: "17.14", anexoResolvido: ANEXO_IV, sujeitoFatorR: false, descricao: "Advocacia" },
  { codigo: "17.18", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Arbitragem" },
  { codigo: "17.19", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Auditoria" },
  { codigo: "17.20", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Análise de organização e métodos" },
  { codigo: "17.22", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Cobrança em geral" },
  { codigo: "17.23", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Assessoria, análise, avaliação, atendimento, consulta, cadastro, seleção, gerenciamento de informações, administração de contas a receber/pagar e em geral, relacionados a operações financeiras" },

  // 5.x — Medicina veterinária
  { codigo: "5.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Medicina veterinária e zootecnia" },

  // 6.x — Estética/cuidados pessoais
  { codigo: "6.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Barbearia, cabeleireiros, manicuros, pedicuros e congêneres" },
  { codigo: "6.02", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Esteticistas, tratamento de pele, depilação e congêneres" },
  { codigo: "6.05", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Centros de emagrecimento, spa e congêneres" },

  // 7.x — Engenharia (continuação)
  { codigo: "7.04", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Demolição" },
  { codigo: "7.06", anexoResolvido: ANEXO_IV, sujeitoFatorR: false, descricao: "Colocação e instalação de tapetes, carpetes, assoalhos, cortinas, revestimentos de parede" },
  { codigo: "7.10", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Limpeza, manutenção e conservação de vias, jardins, piscinas, escadas rolantes e elevadores" },
  { codigo: "7.11", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Decoração e jardinagem, inclusive corte e poda de árvores" },
  { codigo: "7.16", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Florestamento, reflorestamento, semeadura, adubação" },

  // 8.x — Educação
  { codigo: "8.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Ensino regular pré-escolar, fundamental, médio e superior" },
  { codigo: "8.02", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Instrução, treinamento, orientação pedagógica e educacional, avaliação de conhecimentos de qualquer natureza" },

  // 10.x — Intermediação (mais)
  { codigo: "10.05", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Agenciamento, corretagem ou intermediação de bens móveis/imóveis" },
  { codigo: "10.08", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Agenciamento de publicidade e propaganda, inclusive conveniência de espaços, tempos e assuntos" },
  { codigo: "10.09", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Representação de qualquer natureza, inclusive comercial" },

  // 11.x — Guarda/estacionamento (mais)
  { codigo: "11.02", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Vigilância, segurança ou monitoramento de bens, pessoas e semoventes" },
  { codigo: "11.03", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Escolta, inclusive de veículos e cargas" },

  // 12.x — Diversões
  { codigo: "12.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Espetáculos teatrais" },
  { codigo: "12.07", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Shows, ballet, danças, desfiles, bailes, óperas, concertos, recitais, festivais" },
  { codigo: "12.11", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Competições esportivas ou de destreza física/intelectual, com ou sem a participação do espectador" },
  { codigo: "12.13", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Diversões, lazer, entretenimento e congêneres" },

  // 13.x — Fonografia/fotografia
  { codigo: "13.02", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Fonografia ou gravação de sons, inclusive trucagem, dublagem, mixagem e congêneres" },
  { codigo: "13.03", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Fotografia e cinematografia, inclusive revelação, ampliação, cópia, reprodução, trucagem" },

  // 14.x — Bens de terceiros (mais)
  { codigo: "14.06", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Instalação e montagem de aparelhos, máquinas e equipamentos, inclusive montagem industrial" },
  { codigo: "14.07", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Colocação de molduras e congêneres" },
  { codigo: "14.09", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Alfaiataria e costura, quando o material for fornecido pelo usuário final, exceto aviamento" },

  // 16.x — Transporte municipal
  { codigo: "16.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Serviços de transporte municipal de natureza estritamente municipal" },

  // 17.x já bem coberto acima

  // 23.x — Programação visual / design
  { codigo: "23.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Serviços de programação e comunicação visual, desenho industrial e congêneres" },

  // 24.x — Confecção de placas, sinalização
  { codigo: "24.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Serviços de chaveiros, confecção de carimbos, placas, sinalização visual, banners, adesivos" },

  // 26.x — Correios/coleta
  { codigo: "26.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Serviços de coleta, remessa ou entrega de correspondências, documentos, objetos, bens ou valores" },

  // 27.x — Assistência social
  { codigo: "27.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Serviços de assistência social" },

  // 31.x — Telecomunicações
  { codigo: "31.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Serviços técnicos em edificações, eletrônica, eletrotécnica, mecânica, telecomunicações" },

  // 32.x — Desenho técnico
  { codigo: "32.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Serviços de desenhos técnicos" },

  // 35.x — Reportagem
  { codigo: "35.01", anexoResolvido: ANEXO_III, sujeitoFatorR: false, descricao: "Serviços de reportagem, assessoria de imprensa, jornalismo e relações públicas" },

  // 37.x — Artísticos
  { codigo: "37.01", anexoResolvido: ANEXO_V, sujeitoFatorR: true, descricao: "Serviços de artistas, atletas, modelos e manequins" },

  // Default desconhecido → cai no fallback de capítulo (LC116_CHAPTERS) → se nem isso bater, III conservador
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
    ...LC116_CHAPTERS.map((s) => ({ ...s, tipoCodigo: "LC116" })), // chaves "1".."40" — fallback de capítulo
    ...NCM_SEEDS.map((s) => ({ ...s, tipoCodigo: "NCM" })),
    ...CFOP_SEEDS.map((s) => ({ ...s, tipoCodigo: "CFOP" })),
  ];

  // Limitação Prisma: upsert por unique composto com campo nullable (portalClientId)
  // não funciona (NULL != NULL em SQL). Usamos findFirst + create/update manual.
  for (const seed of allSeeds) {
    try {
      const existing = await prisma.deparaAnexo.findFirst({
        where: {
          escopo: "GLOBAL",
          portalClientId: null,
          tipoCodigo: seed.tipoCodigo,
          codigo: seed.codigo,
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.deparaAnexo.update({
          where: { id: existing.id },
          data: {
            anexoResolvido: seed.anexoResolvido,
            sujeitoFatorR: seed.sujeitoFatorR,
            descricao: seed.descricao || null,
          },
        });
        updated++;
      } else {
        await prisma.deparaAnexo.create({
          data: {
            escopo: "GLOBAL",
            portalClientId: null,
            tipoCodigo: seed.tipoCodigo,
            codigo: seed.codigo,
            anexoResolvido: seed.anexoResolvido,
            sujeitoFatorR: seed.sujeitoFatorR,
            descricao: seed.descricao || null,
          },
        });
        created++;
      }
    } catch (err) {
      log?.warn({ err: err?.message, seed }, "[DeparaAnexoSeeds] falha em 1 seed");
    }
  }

  log?.info({ created, updated, total: allSeeds.length }, "[DeparaAnexoSeeds] concluído");
  return { created, updated, total: allSeeds.length };
}
