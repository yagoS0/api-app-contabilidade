// TRILHA DE ETAPAS por origem — o que o ESCRITÓRIO precisa fazer para trazer o cliente para dentro.
//
// ⚠ ESTE CATÁLOGO MORA SÓ NO SERVIDOR, e isso é deliberado. Se ele viesse do cliente (ou fosse
// escolhido no formulário), quem preenche a ficha estaria escolhendo o que o escritório tem de
// conferir. A trilha sai da ORIGEM declarada, e a origem é a única variável do funil.
//
// ⚠ TÍTULO E DESCRIÇÃO SÃO COPIADOS para `OnboardingEtapa` no momento do "finalizar" — a checklist
// de quem já está em trilha NÃO é uma leitura viva deste arquivo. Editar o catálogo depois muda o
// que os próximos onboardings recebem, nunca o que já foi materializado. Mesma disciplina do
// `OcorrenciaObrigacao.competenciaRef`: um catálogo que reescreve o passado apaga o rastro que a
// tabela existe para guardar.
//
// ⚠ `acao` liga a etapa a um efeito colateral do sistema. Os três primeiros
// (SITFIS · CERTIFICADO_A1 · DOCUMENTOS) exigem um `PortalClient` e portanto só funcionam DEPOIS da
// conversão — a tela desabilita o botão com o motivo enquanto `portalClientId` for nulo. A ordem
// abaixo é a ordem de TRABALHO do escritório, não uma garantia de que o botão está habilitado.

export const ACOES = ["SITFIS", "CERTIFICADO_A1", "DOCUMENTOS", "CONVERSAO"];

export const ORIGENS = ["ABERTURA", "TRANSFERENCIA", "INATIVA"];

export const ETAPAS_POR_ORIGEM = Object.freeze({
  // Empresa que ainda vai existir: não há CNPJ, não há endereço, não há CNAE. Quase tudo que a
  // conversão exige só aparece quando o registro sai — por isso "CNPJ definitivo" é etapa própria
  // e vem ANTES da conversão.
  ABERTURA: Object.freeze([
    {
      chave: "contato_inicial",
      titulo: "Contato inicial registrado",
      descricao: "Quem procurou o escritório, por qual canal e o que foi combinado.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "definicao_societaria",
      titulo: "Definição societária e de atividade",
      descricao:
        "Sócios, participações, capital social e a atividade pretendida. É o que a viabilidade "
        + "e o contrato social vão consumir.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "viabilidade_registro",
      titulo: "Viabilidade e registro na Junta",
      descricao:
        "Consulta de viabilidade, DBE e registro. Acontece FORA do sistema — aqui só se marca "
        + "que saiu.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "cnpj_definitivo",
      titulo: "CNPJ definitivo em mãos",
      descricao:
        "Sem ele não há empresa a criar: CNPJ, endereço completo e CNAE principal são exigidos "
        + "pelo cadastro, e é a consulta à Receita que os traz de uma vez.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "conversao",
      titulo: "Empresa criada no portal",
      descricao: "Converte a ficha em empresa da carteira. Daqui em diante os botões abaixo funcionam.",
      obrigatoria: true,
      acao: "CONVERSAO",
    },
    {
      chave: "certificado_a1",
      titulo: "Certificado A1 da empresa instalado",
      descricao:
        "Sem o certificado A1 a captura de NFS-e falha em silêncio — a empresa parece sem nota. "
        + "O A1 do escritório NÃO serve: quem consulta o ADN é o dono do certificado.",
      obrigatoria: true,
      acao: "CERTIFICADO_A1",
    },
    {
      chave: "documentos",
      titulo: "Documentos societários arquivados",
      descricao: "Contrato social, CNPJ, documentos dos sócios e alvarás.",
      obrigatoria: false,
      acao: "DOCUMENTOS",
    },
  ]),

  // Empresa que já opera e está trocando de contador. É a trilha mais longa: a papelada chega em
  // partes e o passado fiscal é herdado junto.
  TRANSFERENCIA: Object.freeze([
    {
      chave: "contato_inicial",
      titulo: "Contato inicial registrado",
      descricao: "Quem procurou, por qual canal, e o motivo declarado da troca de contador.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "procuracao_ecac",
      titulo: "Procuração eletrônica no e-CAC",
      descricao:
        "Autoriza o escritório a agir no e-CAC em nome da empresa. ⚠ NÃO substitui o certificado "
        + "A1 da empresa nas capturas de nota: nem o ADN nem a SEFAZ aceitam o certificado do "
        + "escritório.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "certificado_a1",
      titulo: "Certificado A1 da empresa instalado",
      descricao:
        "Sem o certificado A1 a captura de NFS-e falha em silêncio — a empresa parece sem nota.",
      obrigatoria: true,
      acao: "CERTIFICADO_A1",
    },
    {
      chave: "documentos",
      titulo: "Documentos recebidos do contador anterior",
      descricao:
        "Contrato social e alterações, balancetes, livros, folha e as últimas declarações "
        + "entregues.",
      obrigatoria: true,
      acao: "DOCUMENTOS",
    },
    {
      chave: "sitfis",
      titulo: "Situação fiscal consultada (SITFIS)",
      descricao: "Relatório de situação fiscal do contribuinte, direto da Receita.",
      obrigatoria: true,
      acao: "SITFIS",
    },
    {
      chave: "conferencia_debitos",
      titulo: "Débitos declarados conferidos contra o SITFIS",
      descricao:
        "O que o cliente declarou dever × o que o relatório mostra. A divergência aqui é o achado "
        + "que muda a conversa — e ela precisa de olho humano: o relatório é a fonte, o declarado "
        + "é memória.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "conversao",
      titulo: "Empresa criada no portal",
      descricao: "Converte a ficha em empresa da carteira.",
      obrigatoria: true,
      acao: "CONVERSAO",
    },
  ]),

  // Empresa parada. O trabalho aqui é decidir: reativa ou dá baixa. As duas saídas são legítimas,
  // e é por isso que a decisão é etapa própria — sem ela a ficha fica em trilha para sempre.
  INATIVA: Object.freeze([
    {
      chave: "contato_inicial",
      titulo: "Contato inicial registrado",
      descricao: "Quem procurou e há quanto tempo a empresa está parada.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "procuracao_ecac",
      titulo: "Procuração eletrônica no e-CAC",
      descricao: "Necessária para levantar o passivo antes de decidir qualquer coisa.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "sitfis",
      titulo: "Situação fiscal consultada (SITFIS)",
      descricao:
        "Empresa parada acumula pendência sem ninguém ver. O relatório é o que dimensiona o "
        + "passivo antes da decisão.",
      obrigatoria: true,
      acao: "SITFIS",
    },
    {
      chave: "levantamento_obrigacoes",
      titulo: "Obrigações em atraso levantadas",
      descricao:
        "Quais declarações e guias ficaram para trás. ⚠ Levantamento, não cálculo: multa e juros "
        + "de obrigação atrasada vêm da fonte oficial, nunca de estimativa nossa.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "decisao_reativar_ou_baixar",
      titulo: "Decisão: reativar ou dar baixa",
      descricao:
        "Decisão do CLIENTE, registrada aqui com a data. Sem ela a ficha fica em trilha para "
        + "sempre; com ela o caminho seguinte é um só.",
      obrigatoria: true,
      acao: null,
    },
    {
      chave: "conversao",
      titulo: "Empresa criada no portal",
      descricao:
        "Só faz sentido se a decisão foi REATIVAR. Se foi dar baixa, encerre a ficha em "
        + "\"desistiu\" com o motivo — a baixa não vira empresa na carteira.",
      obrigatoria: false,
      acao: "CONVERSAO",
    },
    {
      chave: "certificado_a1",
      titulo: "Certificado A1 da empresa instalado",
      descricao: "Só na reativação, e só depois da conversão.",
      obrigatoria: false,
      acao: "CERTIFICADO_A1",
    },
  ]),
});

/**
 * As etapas da origem, já com `ordem` calculada (a posição no array é a ordem — manter os dois em
 * sincronia à mão seria uma numeração que envelhece na primeira inserção no meio).
 *
 * Origem desconhecida devolve `[]`: uma trilha genérica inventada seria pior que nenhuma.
 */
export function etapasDaOrigem(origem) {
  const chave = String(origem || "").trim().toUpperCase();
  const lista = ETAPAS_POR_ORIGEM[chave];
  if (!Array.isArray(lista)) return [];
  return lista.map((etapa, indice) => ({
    chave: etapa.chave,
    titulo: etapa.titulo,
    descricao: etapa.descricao || null,
    ordem: indice + 1,
    acao: etapa.acao || null,
    obrigatoria: etapa.obrigatoria !== false,
  }));
}
