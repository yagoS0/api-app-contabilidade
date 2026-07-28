// Q14.1.c — Tabela de referência CNAE → TipoReceita sugerido.
//
// Apoio pra cadastro/sugestão, NÃO decide apuração. Quem decide é a regra
// vigente em RegraClassificacao no momento da classificação da nota.
//
// Cobertura: top ~150 CNAEs mais comuns em escritórios contábeis brasileiros.
// CNAEs ambíguos (que comportam mais de um anexo dependendo do enquadramento
// específico) ficam marcados — a UI exige decisão humana no cadastro fiscal.
//
// Fonte: Resolução CGSN 140/2018 + lista de CNAEs RFB consolidada.
// Formato CNAE: 7 dígitos sem separador (ex: "6201500" = 6201-5/00).

const TR_REVENDA = "REVENDA_MERCADORIA";
const TR_INDUSTRIA = "INDUSTRIALIZACAO";
const TR_ANEXO_III = "SERVICO_ANEXO_III";
const TR_ANEXO_IV = "SERVICO_ANEXO_IV";
const TR_FATOR_R = "SERVICO_FATOR_R";

const VIGENCIA = new Date("2018-01-01T00:00:00Z");

// Alguns códigos entraram por CONSISTÊNCIA, não por classificação nova: quando a subclasse já
// estava na tabela e era unânime, o irmão faltante herda o mesmo critério (ex.: 4399-1/03 "Obras
// de alvenaria" já era Anexo IV → /01 e /99 idem). Os que NÃO têm irmão aqui ficam de fora até o
// contador decidir — `scripts/cnaes-faltantes.mjs` lista os dois grupos separados.
//
// Formato: [cnae, descrição, tipoReceitaSugerido, ambiguo]
const CNAES = [
  // ─── COMÉRCIO (Anexo I) ─────────────────────────────────────────────────
  ["4711301", "Hipermercados", TR_REVENDA, false],
  ["4711302", "Supermercados", TR_REVENDA, false],
  ["4712100", "Minimercados/mercearias", TR_REVENDA, false],
  ["4721102", "Padaria e confeitaria", TR_REVENDA, false],
  ["4744099", "Comércio varejista de mat. construção n.e.", TR_REVENDA, false],
  ["4751201", "Comércio varejista de computadores", TR_REVENDA, false],
  ["4753900", "Comércio varejista eletrodomésticos", TR_REVENDA, false],
  ["4754701", "Móveis", TR_REVENDA, false],
  ["4755502", "Tecidos", TR_REVENDA, false],
  ["4761003", "Papelaria", TR_REVENDA, false],
  ["4763604", "Brinquedos", TR_REVENDA, false],
  ["4771701", "Farmácias sem manipulação", TR_REVENDA, false],
  ["4772500", "Cosméticos e higiene", TR_REVENDA, false],
  ["4774100", "Óticas", TR_REVENDA, false],
  ["4781400", "Vestuário e acessórios", TR_REVENDA, false],
  ["4782201", "Calçados", TR_REVENDA, false],
  ["4789005", "Joias e bijuterias", TR_REVENDA, false],
  ["4789099", "Comércio varejista de outros produtos n.e.", TR_REVENDA, false],

  // Atacadistas → mesmo Anexo I de revenda
  ["4646002", "Comércio atacadista cosméticos", TR_REVENDA, false],
  ["4651601", "Comércio atacadista de equipamentos de informática", TR_REVENDA, false],
  ["4647801", "Comércio atacadista artigos escritório", TR_REVENDA, false],
  ["4639701", "Comércio atacadista produtos alimentícios", TR_REVENDA, false],

  // ─── INDÚSTRIA (Anexo II) ───────────────────────────────────────────────
  ["1011201", "Frigorífico bovinos", TR_INDUSTRIA, false],
  ["1052000", "Fabricação laticínios", TR_INDUSTRIA, false],
  ["1091102", "Fabricação produtos panificação industrial", TR_INDUSTRIA, false],
  ["1411802", "Confecção peças vestuário", TR_INDUSTRIA, false],
  ["1610203", "Serrarias com desdobramento de madeira", TR_INDUSTRIA, false],
  ["1721400", "Fabricação papel", TR_INDUSTRIA, false],
  ["1813001", "Impressão livros, revistas, periódicos", TR_INDUSTRIA, false],
  ["2222600", "Fabricação embalagens plástico", TR_INDUSTRIA, false],
  ["2511000", "Fabricação estruturas metálicas", TR_INDUSTRIA, false],
  ["3101200", "Fabricação móveis madeira", TR_INDUSTRIA, false],
  ["3211603", "Lapidação gemas", TR_INDUSTRIA, false],

  // ─── SERVIÇOS ANEXO III (sem Fator R) ──────────────────────────────────
  ["5510801", "Hotéis", TR_ANEXO_III, false],
  ["5510802", "Pousadas", TR_ANEXO_III, false],
  ["5611201", "Restaurantes", TR_ANEXO_III, false],
  ["5611203", "Lanchonetes/casas de chá", TR_ANEXO_III, false],
  ["5611204", "Bares", TR_ANEXO_III, false],
  ["5620101", "Catering", TR_ANEXO_III, false],
  ["8121400", "Limpeza de prédios em geral", TR_ANEXO_III, false],
  ["8129000", "Limpeza n.e.", TR_ANEXO_III, false],
  ["8130300", "Paisagismo", TR_ANEXO_III, false],
  ["4520001", "Manutenção e reparação de automóveis", TR_ANEXO_III, false],
  ["4520006", "Borracharias", TR_ANEXO_III, false],
  ["4520007", "Serviços lava-jato", TR_ANEXO_III, false],
  ["4520008", "Capotaria", TR_ANEXO_III, false],
  ["9602501", "Cabeleireiros, manicuro, pedicuro", TR_ANEXO_III, false],
  ["9602502", "Atividades esteticista", TR_ANEXO_III, false],
  ["9329899", "Outras atividades recreação/lazer n.e.", TR_ANEXO_III, false],
  ["8011101", "Atividades de vigilância NÃO armada", TR_ANEXO_III, false],
  ["8511200", "Educação infantil — creche", TR_ANEXO_III, true], // ambíguo: alguns enquadram V
  ["5320202", "Serviços de entrega rápida", TR_ANEXO_III, false],

  // ─── SERVIÇOS ANEXO IV (sem Fator R) ───────────────────────────────────
  ["4120400", "Construção de edifícios", TR_ANEXO_IV, false],
  ["4211101", "Construção de rodovias e ferrovias", TR_ANEXO_IV, false],
  ["4221902", "Construção de estações e redes de telecomunicações", TR_ANEXO_IV, false],
  ["4322303", "Instalações hidráulicas, sanitárias", TR_ANEXO_IV, false],
  ["4321500", "Instalações elétricas", TR_ANEXO_IV, false],
  ["4330404", "Serviços de pintura predial e similar", TR_ANEXO_IV, false],
  ["4213800", "Obras de urbanização — ruas, praças e calçadas", TR_ANEXO_IV, false],
  ["4292801", "Montagem de estruturas metálicas", TR_ANEXO_IV, false],
  ["4299599", "Outras obras de engenharia civil n.e.", TR_ANEXO_IV, false],
  ["4311801", "Demolição de edifícios e outras estruturas", TR_ANEXO_IV, false],
  ["4313400", "Obras de terraplenagem", TR_ANEXO_IV, false],
  ["4322301", "Instalações hidráulicas, sanitárias e de gás", TR_ANEXO_IV, false],
  ["4330403", "Obras de acabamento em gesso e estuque", TR_ANEXO_IV, false],
  ["4399101", "Administração de obras", TR_ANEXO_IV, false],
  ["4399103", "Obras de alvenaria", TR_ANEXO_IV, false],
  ["4399199", "Serviços especializados para construção n.e.", TR_ANEXO_IV, false],
  ["6911701", "Advocacia", TR_ANEXO_IV, false],
  ["7490104", "Atividades de intermediação e agenciamento serviços/negócios em geral", TR_ANEXO_IV, true],
  ["8011102", "Atividades de vigilância ARMADA", TR_ANEXO_IV, false],
  ["8012900", "Atividades de transporte de valores", TR_ANEXO_IV, false],

  // ─── SERVIÇOS FATOR R (informática) ────────────────────────────────────
  ["6201500", "Desenvolvimento de programas customizáveis", TR_FATOR_R, false],
  ["6201501", "Desenvolvimento de programas customizáveis", TR_FATOR_R, false],
  ["6201502", "Web design", TR_FATOR_R, false],
  ["6202300", "Desenvolvimento e licenciamento de programas customizáveis", TR_FATOR_R, false],
  ["6203100", "Desenvolvimento e licenciamento de programas NÃO customizáveis", TR_FATOR_R, false],
  ["6204000", "Consultoria em tecnologia da informação", TR_FATOR_R, false],
  ["6209100", "Suporte técnico, manutenção em TI", TR_FATOR_R, false],
  ["6311900", "Tratamento de dados, hospedagem", TR_FATOR_R, false],
  ["6319400", "Portais, provedores conteúdo e outros serviços de informação na internet", TR_FATOR_R, false],
  ["6391700", "Agências de notícias", TR_FATOR_R, false],
  ["7311400", "Agências de publicidade", TR_FATOR_R, false],
  ["7312200", "Agenciamento de espaços publicitários", TR_FATOR_R, false],
  // 7319-0/02 e /03 faltavam e são da MESMA subclasse do /99 já listado acima (7319-0), com a
  // família 73xx inteira aqui classificada igual. Sem eles, 3 empresas reais da carteira ficavam
  // sem sugestão de anexo na Aba Fiscal — o CNAE estava preenchido, mas não existia linha aqui.
  ["7319002", "Promoção de vendas", TR_FATOR_R, false],
  ["7319003", "Marketing direto", TR_FATOR_R, false],
  ["7319004", "Consultoria em publicidade", TR_FATOR_R, false],

  // ─── APOIO ADMINISTRATIVO / INTERMEDIAÇÃO / EVENTOS ─────────────────────
  // Enquadramento definido pelo dono (28/07/2026). Sem irmão de subclasse na tabela, então NÃO
  // foram deduzidos daqui — são decisão do contador, registrada.
  ["4619200", "Representantes comerciais e agentes do comércio", TR_FATOR_R, false],
  ["8211300", "Serviços combinados de escritório e apoio administrativo", TR_FATOR_R, false],
  ["8219999", "Preparação de documentos e serviços de apoio administrativo n.e.", TR_FATOR_R, false],
  ["8220200", "Atividades de teleatendimento", TR_FATOR_R, false],
  ["8230001", "Organização de feiras, congressos, exposições e festas", TR_FATOR_R, false],
  ["8291100", "Atividades de cobranças e informações cadastrais", TR_FATOR_R, false],
  ["7319099", "Outras atividades de publicidade", TR_FATOR_R, false],
  ["7320300", "Pesquisa de mercado e opinião pública", TR_FATOR_R, false],

  // ─── SERVIÇOS FATOR R (engenharia / arquitetura) ───────────────────────
  ["7111100", "Serviços de arquitetura", TR_FATOR_R, false],
  ["7112000", "Serviços de engenharia", TR_FATOR_R, false],
  ["7119701", "Serviços de cartografia, topografia, geodésia", TR_FATOR_R, false],
  ["7119703", "Serviços de desenho técnico relacionados arquitetura/engenharia", TR_FATOR_R, false],

  // ─── SERVIÇOS FATOR R (saúde) ──────────────────────────────────────────
  ["8610101", "Atividades de atendimento hospitalar (com Fator R quando profissional)", TR_FATOR_R, true],
  ["8630501", "Atividade médica ambulatorial com recursos pra exames", TR_FATOR_R, false],
  ["8630502", "Atividade médica ambulatorial restrita a consulta", TR_FATOR_R, false],
  ["8630503", "Atividade médica ambulatorial com recursos para exames complementares", TR_FATOR_R, false],
  ["8630504", "Atividade odontológica", TR_FATOR_R, false],
  ["8650001", "Atividades de fisioterapia", TR_FATOR_R, false],
  ["8650002", "Atividades de profissionais nutrição", TR_FATOR_R, false],
  ["8650003", "Atividades de psicologia e psicanálise", TR_FATOR_R, false],
  ["8650004", "Atividades de fonoaudiologia", TR_FATOR_R, false],
  ["8650005", "Atividades de terapia ocupacional", TR_FATOR_R, false],
  ["8650007", "Atividades de profissionais educação física", TR_FATOR_R, false],
  ["8690903", "Atividades de acupuntura", TR_FATOR_R, false],
  ["7500100", "Atividades veterinárias", TR_FATOR_R, false],

  // ─── SERVIÇOS FATOR R (consultoria/auditoria) ──────────────────────────
  ["6920601", "Atividades contabilidade", TR_FATOR_R, false],
  ["6920602", "Atividades de consultoria e auditoria contábil/tributária", TR_FATOR_R, false],
  ["7020400", "Atividades de consultoria em gestão empresarial", TR_FATOR_R, false],
  ["7490199", "Outras atividades profissionais, científicas e técnicas n.e.", TR_FATOR_R, true],

  // ─── SERVIÇOS FATOR R (educação) ───────────────────────────────────────
  ["8512100", "Educação infantil — pré-escola", TR_FATOR_R, true],
  ["8513900", "Ensino fundamental", TR_FATOR_R, false],
  ["8520100", "Ensino médio", TR_FATOR_R, false],
  ["8531700", "Educação superior — graduação", TR_FATOR_R, false],
  ["8599603", "Treinamento em informática", TR_FATOR_R, false],
  ["8599604", "Treinamento em desenvolvimento profissional", TR_FATOR_R, false],
  ["8599699", "Outras atividades de ensino n.e.", TR_FATOR_R, true],

  // ─── SERVIÇOS FATOR R (intermediação especializada) ────────────────────
  ["6822600", "Gestão e administração de propriedade imobiliária", TR_FATOR_R, false],
  ["6810202", "Aluguel de imóveis próprios (anexo III locação, não FR)", TR_ANEXO_III, false],
  ["6831700", "Corretagem de imóveis", TR_FATOR_R, false],

  // ─── AMBÍGUOS (forçam decisão humana no cadastro) ─────────────────────
  ["9999999", "CNAE não cadastrado/genérico", TR_FATOR_R, true],
];

export async function seedCnaeAnexo(prisma, { log } = {}) {
  let created = 0, updated = 0;
  for (const [cnae, descricao, tipoReceitaSugerido, ambiguo] of CNAES) {
    try {
      const existing = await prisma.cnaeAnexo.findUnique({ where: { cnae } });
      if (existing) {
        await prisma.cnaeAnexo.update({
          where: { cnae },
          data: { descricao, tipoReceitaSugerido, ambiguo, vigenciaInicio: VIGENCIA, vigenciaFim: null },
        });
        updated++;
      } else {
        await prisma.cnaeAnexo.create({
          data: { cnae, descricao, tipoReceitaSugerido, ambiguo, vigenciaInicio: VIGENCIA },
        });
        created++;
      }
    } catch (err) {
      log?.warn({ err: err?.message, cnae }, "[CnaeAnexoSeed] falha");
    }
  }
  log?.info({ created, updated, total: CNAES.length }, "[CnaeAnexoSeed] concluído");
  return { created, updated, total: CNAES.length };
}
