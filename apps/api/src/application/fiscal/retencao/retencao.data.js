// GERADO por apps/api/scripts/gerar-tabelas-retencao.mjs — NÃO EDITE À MÃO.
//
// Fonte: docs/retencao-fonte/ (ver o README de lá: URL, data, codificação e hash de cada artefato).
// Toda linha abaixo foi conferida LITERALMENTE contra o documento oficial pelo gate do gerador.
//
// ⚠⚠ ESTE ARQUIVO NÃO CALCULA NADA. Ele é a tabela; a conta e a decisão de reter moram em quem o
// consome. E o que NÃO está aqui está nomeado em `NAO_VERSIONADO`, de propósito.

/** Serviços do caput do art. 30 — transcrição literal, para a tela do contador citar. */
export const SERVICOS_ART30 = Object.freeze([
  "limpeza",
  "conservação",
  "manutenção",
  "segurança",
  "vigilância",
  "transporte de valores",
  "locação de mão-de-obra",
  "assessoria creditícia",
  "assessoria mercadológica",
  "gestão de crédito",
  "seleção e riscos",
  "administração de contas a pagar e a receber",
  "remuneração de serviços profissionais",
]);

/**
 * As três contribuições retidas na fonte, e a soma.
 *
 * ⚠ Percentuais, nunca valores: o valor sai da multiplicação pelo montante da nota, por nota.
 * Fonte: Lei 10.833/2003, art. 31, caput.
 */
export const ALIQUOTAS_ART30 = Object.freeze({
  csll: 1,
  cofins: 3,
  pisPasep: 0.65,
  total: 4.65,
  fonte: "Lei 10.833/2003, art. 31, caput",
  verificadoNaFonte: true,
});

/**
 * ⚠⚠ O PISO É DE R$ 10,00, E O ANTIGO LIMITE DE R$ 5.000 NÃO EXISTE MAIS.
 *
 * A Lei 13.137/2015 deu nova redação ao § 3º e **revogou o § 4º** — que era exatamente a regra de
 * somar os pagamentos do mês à mesma PJ para aferir o limite antigo. Sistema que ainda a aplique
 * DEIXA DE RETER o que é devido.
 */
export const PISO_DISPENSA = Object.freeze({
  valor: 10.0,
  comparacao: "menor ou igual",
  excecao: "DARF eletrônico efetuado por meio do Siafi",
  fonte: "Lei 10.833/2003, art. 31, § 3º (redação da Lei 13.137/2015)",
  somaMensalRevogada: Object.freeze({
    revogada: true,
    fonte: "Lei 10.833/2003, art. 31, § 4º — (Revogado) pela Lei 13.137/2015",
  }),
  verificadoNaFonte: true,
});

/**
 * ⚠⚠ OPTANTE DO SIMPLES NACIONAL NÃO SOFRE RETENÇÃO FEDERAL SOBRE SERVIÇOS.
 *
 * Está na LEI, não só na Instrução Normativa — a IN regulamenta e atualiza o nome do regime.
 *
 * ⚠ NÃO CONFUNDIR COM O ART. 30, § 2º: aquele fala de quem PAGA (fonte pagadora optante não é
 * obrigada a reter). Para a NFS-e o que vale é o art. 32, III — nosso cliente é o PRESTADOR.
 */
export const DISPENSA_SIMPLES_NACIONAL = Object.freeze({
  pisCofinsCsll: Object.freeze({
    dispensada: true,
    fonte: "Lei 10.833/2003, art. 32, III; IN SRF 459/2004, art. 3º, II",
    escopo: "em relação às suas receitas próprias",
    verificadoNaFonte: true,
  }),
  irrf: Object.freeze({
    dispensada: true,
    fonte: "IN RFB 765/2007, art. 1º",
    excecao:
      "rendimentos ou ganhos líquidos de aplicações de renda fixa ou variável "
      + "(LC 123/2006, art. 13, § 1º, V)",
    verificadoNaFonte: true,
  }),
  /** ⚠ A dispensa tem uma obrigação acessória do lado do prestador. */
  declaracaoAoTomador: Object.freeze({
    exigida: true,
    forma: "declaração na forma do Anexo I, em 2 (duas) vias, assinadas pelo representante legal",
    fonte: "IN SRF 459/2004, art. 11",
    verificadoNaFonte: true,
  }),
});

/**
 * ⚠⚠ O QUE NÃO ESTÁ AQUI, E POR QUÊ — regra 1 do projeto: o que não está provado não é preenchido.
 *
 * Cada entrada é uma decisão de NÃO inventar. Quem for preencher uma delas versiona a norma em
 * `docs/retencao-fonte/` primeiro, e o gate do gerador passa a conferi-la.
 */
export const NAO_VERSIONADO = Object.freeze({
  irrfAliquotaServicos: Object.freeze({
    porque:
      "A alíquota do IRRF sobre serviços não está na Lei 10.833. Ela vive na legislação do imposto "
      + "de renda (Lei 7.713/1988 e RIR), não versionada aqui. A IN 765 prova a DISPENSA para o "
      + "Simples — não a alíquota aplicável ao Presumido.",
  }),
  retencaoPrevidenciaria: Object.freeze({
    porque:
      "Lei 8.212/1991, art. 31 (cessão de mão de obra e empreitada) e a interação com o Anexo IV "
      + "do Simples não foram confirmadas. O campo vRetCP existe no leiaute e fica SEM PRODUTOR.",
  }),
  listaServicosProfissionais: Object.freeze({
    porque:
      "O caput do art. 30 remete ao rol de 'serviços profissionais' da legislação do IR, não "
      + "versionado. Quem declara se o serviço está na lista é o CONTADOR, por perfil — derivar do "
      + "CNAE erraria nos dois sentidos: declarar retenção indevida, ou omitir a devida.",
  }),
  orgaosPublicosFederais: Object.freeze({
    porque:
      "IN RFB 1.234/2012 tem tabela e alíquotas próprias por natureza do serviço. É outro regime "
      + "de retenção, não um caso do art. 30.",
  }),
  issRetidoNoSimples: Object.freeze({
    porque:
      "LC 123/2006, arts. 13 § 1º, 18 § 6º e 21 § 4º — retenção MUNICIPAL, pertence à fase do "
      + "grupo tribMun. A LC 123 não está versionada neste repositório.",
  }),
});
