// QUEM ENTREGA A EFD-CONTRIBUIÇÕES — e, principalmente, quem NÃO entrega.
//
// Fonte: IN RFB 1.252/2012 (obrigatoriedade e dispensas) e Guia Prático da EFD-Contribuições
// v1.35, Cap. I, Seção 3. O artefato oficial está versionado em `docs/leiaute-efd-contribuicoes/`.
//
// ⚠ POR QUE ISTO EXISTE COMO REGRA, E NÃO COMO UM `if` NA TELA:
// a tela anterior mostrava a EFD para TODA empresa, com o argumento de que decidir dispensa seria
// julgar em silêncio. O argumento estava certo sobre o RISCO e errado sobre o REMÉDIO: o remédio
// não é mostrar para todos, é dizer a dispensa em voz alta, com a fonte. Optante do Simples
// Nacional NUNCA entrega EFD-Contribuições — mostrar três passos de entrega para ela não é
// prudência, é pedir trabalho que a lei não pede.
//
// ⚠ E O CONTRÁRIO TAMBÉM É REGRA: dispensa que o sistema NÃO consegue avaliar não vira `dispensada`.
// Ela vira nota nomeada, ao lado da obrigação que continua de pé. Afirmar dispensa sem poder
// verificá-la é o erro caro; a nota é o barato.

/** Guia Prático v1.35, Cap. I, Seção 3 — início da obrigatoriedade por regime. */
const INICIO_OBRIGATORIEDADE = Object.freeze({
  LUCRO_REAL: "2012-01",
  LUCRO_PRESUMIDO: "2013-01",
  LUCRO_ARBITRADO: "2013-01",
});

/**
 * Regimes que dispensam por definição, enquanto durar o enquadramento.
 * ⚠ "Nos períodos abrangidos pelo regime" — empresa que SAIU do Simples passa a dever a partir da
 * saída. Por isso a decisão é por COMPETÊNCIA, e não um atributo fixo da empresa.
 */
const DISPENSADOS_POR_REGIME = Object.freeze({
  SIMPLES: "optante pelo Simples Nacional",
  SIMPLES_NACIONAL: "optante pelo Simples Nacional",
  MEI: "microempreendedor individual",
});

/**
 * As dispensas que dependem de dado que o sistema NÃO tem. Ficam nomeadas para o contador
 * conferir — nunca aplicadas sozinhas.
 *
 * ⚠ A de "mês sem receita" é a mais tentadora de automatizar, e a que mais custaria errar: ela
 * exige receita zero E ausência de operação com crédito, e tem a EXCEÇÃO DE DEZEMBRO, cuja
 * escrituração é obrigatória e consolida no registro 0120 os meses dispensados do ano. Marcar o
 * mês como dispensado sem lembrar de dezembro produziria um ano inteiro sem a consolidação.
 */
const DISPENSAS_NAO_AVALIADAS = Object.freeze([
  {
    chave: "imuneIsenta",
    titulo: "Imune ou isenta de IRPJ com contribuições de até R$ 10.000 no mês",
    detalhe:
      "A soma mensal de PIS, Cofins e CPRB (sem o PIS sobre a folha) até R$ 10.000 dispensa. Ultrapassado o limite, a obrigação nasce naquele mês e permanece até o fim do ano-calendário.",
  },
  {
    chave: "semReceita",
    titulo: "Mês sem receita auferida e sem operação com crédito",
    detalhe:
      "Dispensa o mês — exceto dezembro, cuja escrituração é obrigatória e consolida no registro 0120 os meses dispensados do ano.",
  },
  {
    chave: "inativaOuOrgaoPublico",
    titulo: "Inativa, órgão público e demais hipóteses do rol da IN RFB 1.252/2012",
    detalhe: "O rol completo está na Instrução Normativa; o sistema não guarda esses enquadramentos.",
  },
]);

const FONTE = "IN RFB 1.252/2012 · Guia Prático EFD-Contribuições v1.35, Cap. I, Seção 3";

function normalizarRegime(regime) {
  return String(regime || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/**
 * Responde se a empresa deve a EFD-Contribuições NAQUELA competência.
 *
 * Três respostas, e a terceira é tão importante quanto as outras duas:
 *  - `obrigada`    — deve entregar; a tela mostra o fluxo dos três passos.
 *  - `dispensada`  — não deve, e o motivo aparece com a fonte no lugar do fluxo.
 *  - `indefinida`  — o regime não está cadastrado. NÃO afirma nem uma coisa nem outra: um default
 *                    para "obrigada" pediria trabalho inexistente, e um para "dispensada" esconderia
 *                    obrigação real. Ausência de dado é o terceiro estado, não um empate a desempatar.
 *
 * @param {{regime?: string, competencia?: string}} entrada
 */
export function obrigatoriedadeEfdContribuicoes({ regime, competencia } = {}) {
  const r = normalizarRegime(regime);

  if (!r) {
    return {
      situacao: "indefinida",
      motivo: "O regime tributário da empresa não está cadastrado.",
      acao: "Cadastre o regime na ficha da empresa para saber se esta competência é devida.",
      fonte: FONTE,
      dispensasNaoAvaliadas: [],
    };
  }

  const dispensaRegime = DISPENSADOS_POR_REGIME[r];
  if (dispensaRegime) {
    return {
      situacao: "dispensada",
      motivo: `Empresa ${dispensaRegime} — a EFD-Contribuições não é devida nos períodos abrangidos pelo regime.`,
      // ⚠ A saída do Simples é o caso que faz esta resposta ser por competência, e ele acontece
      // de verdade: a empresa que estoura o limite passa a dever a partir da exclusão.
      acao: "Se a empresa deixou o Simples Nacional, atualize o regime — a obrigação passa a valer a partir da saída.",
      fonte: FONTE,
      dispensasNaoAvaliadas: [],
    };
  }

  const inicio = INICIO_OBRIGATORIEDADE[r];
  if (!inicio) {
    return {
      situacao: "indefinida",
      motivo: `O regime "${regime}" não está entre os que o sistema sabe classificar para a EFD-Contribuições.`,
      acao: "Confira o enquadramento na IN RFB 1.252/2012 antes de entregar ou deixar de entregar.",
      fonte: FONTE,
      dispensasNaoAvaliadas: [],
    };
  }

  // Competência ausente ou malformada não vira "obrigada" por descuido: sem o mês não dá para
  // comparar com o início da obrigatoriedade.
  const comp = String(competencia || "").trim();
  if (comp && /^\d{4}-\d{2}$/.test(comp) && comp < inicio) {
    return {
      situacao: "dispensada",
      motivo: `A obrigatoriedade para este regime começou em ${inicio.replace("-", "/")}; a competência ${comp.replace("-", "/")} é anterior.`,
      acao: null,
      fonte: FONTE,
      dispensasNaoAvaliadas: [],
    };
  }

  return {
    situacao: "obrigada",
    motivo: null,
    acao: null,
    fonte: FONTE,
    // As dispensas que dependem de dado que não temos viajam JUNTO com a obrigação — é o que
    // impede que "obrigada" seja lido como "sem saída".
    dispensasNaoAvaliadas: DISPENSAS_NAO_AVALIADAS,
  };
}

/**
 * Dezembro consolida o ano no registro 0120, então a competência de dezembro nunca é dispensável
 * por falta de movimento. Fica separado porque é aviso de TELA sobre um mês específico, não a
 * resposta sobre quem entrega.
 */
export function ehCompetenciaQueConsolidaOAno(competencia) {
  return /^\d{4}-12$/.test(String(competencia || "").trim());
}

export const EFD_FONTE = FONTE;
export const EFD_DISPENSAS_NAO_AVALIADAS = DISPENSAS_NAO_AVALIADAS;
