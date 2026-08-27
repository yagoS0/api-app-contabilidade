/**
 * O PAYLOAD DO FLUXO DE CAIXA, NO MODO OFFLINE.
 *
 * ⚠⚠ ISTO NÃO É "DADO DE DEMONSTRAÇÃO", e por isso não mora em `features/painel/lib/dadosDeDemonstracao.js`.
 * O fluxo de caixa PASSOU A SER REAL em 27/08/2026: este arquivo reproduz o CONTRATO que o servidor
 * responde (`GET /client/companies/:id/fluxo-de-caixa`), para a tela poder ser exercida sem backend.
 * O que continua sendo ficção é o DRE, e ele ficou lá.
 *
 * ⚠⚠ `demonstracao: false`, como o servidor responde — é ele que apaga o selo. Devolver `true` aqui
 * faria a visão de fluxo aparecer com selo offline e sem selo em produção, e aí ninguém conseguiria
 * conferir na tela o desenho que chega ao cliente.
 *
 * ⚠⚠ NÃO EXISTE `total`, nem `saldo`, nem `saldoAcumulado`. Sem saldo inicial não há o que acumular,
 * e um número único a doze meses de distância é o que alguém imprime e leva ao banco
 * (`docs/dre-fluxo-caixa.md`). Acrescentar um aqui faria a tela offline mostrar o número que a de
 * produção se recusa a entregar.
 *
 * ⚠⚠ ELE NÃO É DERIVADO DAS GUIAS DE `estado.guias`, E ISSO É ESCOLHA — com o custo NOMEADO.
 *
 * Consequência visível offline: o card "A vencer" (que sai de `getFluxo`, a lista de guias
 * liberadas em aberto) e a ressalva "N guias já venceram" mostram números DIFERENTES na mesma
 * página. Em PRODUÇÃO eles concordam: as duas leituras varrem a MESMA população
 * (`liberadaCliente: true` + `paymentStatus in OPEN|OVERDUE`).
 *
 * ⚠ Derivar daqui custaria RAMOS, e ramo perdido é a falha mais cara deste projeto: a fixture de
 * guias não tem nenhuma **sem vencimento** (o `semMes` ficaria inalcançável) e todas as
 * competências dela estão no PASSADO (a linha de FATO com dia próprio, dentro dos meses abertos,
 * ficaria inalcançável também).
 *
 * ⚠ FICA NOMEADO PARA O DONO: mesmo em produção os dois números podem divergir em UM caso legítimo
 * — a guia que vence mais adiante no mês CORRENTE e cujo dia já passou. O card a chama de "vencida"
 * (ele compara com HOJE); o fluxo a mantém no mês corrente (ele compara com o MÊS). Não é defeito
 * de nenhum dos dois: são perguntas diferentes.
 *
 * ⚠ TODOS OS RAMOS DA TELA SÃO ALCANÇÁVEIS: FATO com dia próprio · PREVISÃO por mês (`dia: null`
 * com o motivo) · a faixa mín/máx · o CONFRONTO do que o cliente declarou · o imposto previsto com
 * a frase da alíquota · a guia VENCIDA · o que não tem mês · o prazo NÃO configurado · o mês vazio ·
 * o bloco recolhido. Este projeto foi mordido oito vezes por ramo que só existia em produção.
 */

/** ⚠ A empresa do fluxo MAGRO — é a única forma de alcançar `semImposto` e `recorrenciaIndisponivel`. */
const EMPRESA_SEM_APURACAO = "pc-006";

const FRASE_SERIE_SEM_DIA = "A recorrência diz de quanto em quanto tempo, não em que dia do mês.";

function somarMeses(competencia, n) {
  const [a, m] = String(competencia).split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function linhasDoFluxo(ciclo) {
  const mes = (n) => somarMeses(ciclo, n);
  return [
    // ⚠ FATO com dia próprio: a guia tem vencimento de verdade.
    {
      fonte: "GUIA", direcao: "SAIDA", procedencia: "FATO", competencia: mes(0), dia: 20,
      diaDesconhecido: null, valor: 1847.55, rotulo: "SIMPLES",
      base: { frase: `SIMPLES gerada, competência ${somarMeses(ciclo, -1)}` },
      referencia: { tipo: "guia", id: "g-1" },
    },
    {
      fonte: "GUIA", direcao: "SAIDA", procedencia: "FATO", competencia: mes(1), dia: 20,
      diaDesconhecido: null, valor: 1912, rotulo: "INSS",
      base: { frase: `INSS gerada, competência ${mes(0)}` },
      referencia: { tipo: "guia", id: "g-2" },
    },
    // ⚠⚠ PREVISÃO por MÊS: a nota prova o FATURAMENTO, nunca o RECEBIMENTO — e o dia não existe.
    {
      fonte: "NOTA_EMITIDA", direcao: "ENTRADA", procedencia: "PREVISAO", competencia: mes(1),
      dia: null,
      diaDesconhecido: {
        motivo: "projecao_por_mes",
        frase: "O prazo de recebimento é contado em meses, então esta linha cai no mês — não num dia.",
      },
      valor: 12500, rotulo: "Recebimento — CLINICA LAIF LTDA",
      base: {
        frase: `nota nº 1.234, competência ${mes(0)} · prazo de 1 mês `
          + "(padrão — ninguém configurou o prazo desta empresa)",
        documental: true, prazoConfigurado: false,
      },
      referencia: { tipo: "nota", id: "n-1" },
    },
    // ⚠⚠ A FAIXA mín/máx — a mediana sozinha erraria por um terço rotineiramente.
    {
      fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(1),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 130, rotulo: "ANTHROPIC PBC",
      base: {
        frase: "recorrência marcada · MENSAL", n: 3, min: 120, max: 140, cv: 0.0769,
        origem: "DETECTADA", valorDeclarado: null, valorObservado: 130,
      },
      referencia: { tipo: "serie", id: "s-1" },
    },
    // ⚠⚠ O CONFRONTO: o cliente declarou R$ 1.000 e apareceu R$ 1.180 — "o observado vence" (dono).
    {
      fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(1),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 1180, rotulo: "Jantar com clientes",
      base: {
        frase: "recorrência marcada · MENSAL", n: 3, min: 900, max: 1400, cv: 0.21,
        origem: "DECLARADA", valorDeclarado: 1000, valorObservado: 1180,
      },
      referencia: { tipo: "serie", id: "s-4" },
    },
    // ⚠ RECEITA recorrente com valor CONSTANTE — a tela não inventa "entre X e Y".
    {
      fonte: "SERIE_RECEITA", direcao: "ENTRADA", procedencia: "PREVISAO", competencia: mes(2),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 8000, rotulo: "CLINICA LAIF LTDA",
      base: {
        frase: "recorrência marcada · MENSAL", n: 5, min: 8000, max: 8000, cv: 0,
        origem: "DETECTADA", valorDeclarado: null, valorObservado: 8000,
      },
      referencia: { tipo: "serie", id: "s-2" },
    },
    // ⚠⚠ "Imposto PREVISTO", nunca "imposto calculado" — e a frase da alíquota é OBRIGATÓRIA.
    {
      fonte: "IMPOSTO_PROJETADO", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(2),
      dia: null,
      diaDesconhecido: {
        motivo: "imposto_segue_a_receita",
        frase: "O imposto projetado acompanha o mês da receita que o gerou.",
      },
      valor: 883.2, rotulo: "Imposto previsto sobre a receita prevista",
      base: {
        frase: `com base na alíquota de ${somarMeses(ciclo, -2)} (declaração transmitida)`,
        aliquota: 0.1104, competenciaDaAliquota: somarMeses(ciclo, -2),
        procedenciaDaAliquota: "TRANSMITIDA", receitaPrevista: 8000,
      },
      referencia: null,
    },
    // ⚠ Uma linha no BLOCO RECOLHIDO. Sem ela o total do bloco sairia zerado, e o desenho dos nove
    // meses distantes nasceria sem poder ser visto.
    {
      fonte: "SERIE_DESPESA", direcao: "SAIDA", procedencia: "PREVISAO", competencia: mes(7),
      dia: null,
      diaDesconhecido: { motivo: "serie_sem_dia", frase: FRASE_SERIE_SEM_DIA },
      valor: 890, rotulo: "COPIADORA SAO JORGE LTDA",
      base: {
        frase: "recorrência marcada · MENSAL", n: 6, min: 850, max: 920, cv: 0.03,
        origem: "DETECTADA", valorDeclarado: null, valorObservado: 890,
      },
      referencia: { tipo: "serie", id: "s-5" },
    },
  ];
}

export function fluxoDeCaixaDoMock(companyId, competencia) {
  const ciclo = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(competencia || "")) ? String(competencia) : "2026-08";
  const magro = companyId === EMPRESA_SEM_APURACAO;
  const linhas = magro ? [] : linhasDoFluxo(ciclo);

  // ⚠ Os 12 meses nascem TODOS, inclusive os vazios: mês sem linha é resposta, não ausência.
  const meses = Array.from({ length: 12 }).map((_, k) => {
    const comp = somarMeses(ciclo, k);
    const doMes = linhas.filter((l) => l.competencia === comp);
    const soma = (proc, dir) => doMes
      .filter((l) => l.procedencia === proc && l.direcao === dir)
      .reduce((s, l) => s + (Number(l.valor) || 0), 0);
    return {
      competencia: comp,
      linhas: doMes,
      // ⚠⚠ SEM A CHAVE `total`, aqui também.
      totais: {
        fato: { entrada: soma("FATO", "ENTRADA"), saida: soma("FATO", "SAIDA") },
        previsao: { entrada: soma("PREVISAO", "ENTRADA"), saida: soma("PREVISAO", "SAIDA") },
        desconhecido: { quantas: 0 },
      },
    };
  });

  return {
    // ⚠⚠ É ESTE CAMPO que apaga o selo, e ele espelha o do servidor.
    demonstracao: false,
    cicloAtual: ciclo,
    horizonte: 12,
    meses,
    // ⚠⚠ NADA SOME EM SILÊNCIO: o que não coube em mês nenhum sai NOMEADO, com o conserto.
    semMes: magro ? [] : [
      {
        motivo: "guia_sem_vencimento",
        frase: "Esta guia está em aberto e não tem data de vencimento gravada, então não dá para "
          + "dizer em que mês o dinheiro sai. Recapture a guia para trazer o vencimento.",
        rotulo: "SIMPLES", valor: 1233.9, referencia: { tipo: "guia", id: "g-9" },
      },
    ],
    // ⚠⚠ A GUIA VENCIDA é a linha mais urgente do fluxo, e ela não mora em mês nenhum.
    vencidas: magro
      ? { quantas: 0, valor: 0, linhas: [] }
      : { quantas: 2, valor: 18638.39, linhas: [] },
    foraDoHorizonte: magro ? 0 : 1,
    // ⚠⚠ "ninguém configurou" ≠ "configurado como 1" — a tela precisa alcançar os dois.
    prazoRecebimento: magro ? { meses: 2, configurado: true } : { meses: 1, configurado: false },
    // ⚠⚠ A ausência do imposto previsto é NOMEADA — nunca uma linha que simplesmente não aparece.
    semImposto: magro
      ? {
        motivo: "sem_apuracao",
        frase: "Não há apuração com receita e DAS para medir a alíquota efetiva, então o imposto "
          + "sobre a receita prevista não é projetado. Um número aqui sairia de uma alíquota que "
          + "ninguém mediu.",
      }
      : null,
    aliquotaUsada: magro ? null : {
      valor: 0.1104, competencia: somarMeses(ciclo, -2), procedencia: "TRANSMITIDA",
      frase: `com base na alíquota de ${somarMeses(ciclo, -2)} (declaração transmitida)`,
    },
    // ⚠⚠ "não pudemos ler" ≠ "esta empresa não tem nada que se repete".
    recorrenciaIndisponivel: magro,
    notas: { canceladas: magro ? 0 : 1 },
  };
}
