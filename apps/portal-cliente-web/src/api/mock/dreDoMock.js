// O DRE DO MOCK — a MESMA forma que `GET /client/companies/:id/dre` devolve (30/08/2026).
//
// ⚠⚠ ATÉ AQUI O MOCK SERVIA `dreDeDemonstracao`, e isso ficou FALSO quando a rota real nasceu
// (Fase 7): o servidor monta o DRE pelo plano de contas e responde `demonstracao: false`, sem selo.
// Ou seja, a tela que o dono confere offline **não era a tela que o cliente vê** — a divergência
// mock × real que este projeto já pagou várias vezes, e que o `apps/api/CLAUDE.md` registra em
// "AS DUAS ROTAS PUBLICAM A MESMA FORMA": *"o navegador NÃO pegou: o mock já devolvia a forma
// certa"* — aqui foi o inverso, e por isso ninguém veria.
//
// ⚠ `dreDeDemonstracao` NÃO foi apagada: ela continua servindo a `pc-006`, e é o que mantém o
// desenho do SELO alcançável offline. Selo sem caminho para acender é desenho que morre calado.

/** ⚠ Espelho de `LINHAS_DO_DRE` (api: `application/dre/lib/dreGerencial.js`). Mudou lá, muda aqui. */
const LINHAS = [
  { chave: "receitaBruta", rotulo: "Receita bruta", tipo: "linha" },
  { chave: "deducoes", rotulo: "(-) Deduções", tipo: "linha" },
  { chave: "receitaLiquida", rotulo: "= Receita líquida", tipo: "subtotal", soma: ["receitaBruta", "deducoes"] },
  { chave: "custos", rotulo: "(-) Custos", tipo: "linha" },
  { chave: "lucroBruto", rotulo: "= Lucro bruto", tipo: "subtotal", soma: ["receitaLiquida", "custos"] },
  { chave: "pessoal", rotulo: "(-) Despesas com pessoal", tipo: "linha" },
  { chave: "gerais", rotulo: "(-) Despesas gerais", tipo: "linha" },
  { chave: "tributarias", rotulo: "(-) Despesas tributárias", tipo: "linha" },
  { chave: "depreciacao", rotulo: "(-) Depreciação/amortização", tipo: "linha" },
  {
    chave: "resultadoOperacional",
    rotulo: "= Resultado operacional",
    tipo: "subtotal",
    soma: ["lucroBruto", "pessoal", "gerais", "tributarias", "depreciacao"],
  },
  { chave: "receitasFinanceiras", rotulo: "(+) Receitas financeiras", tipo: "linha" },
  { chave: "despesasFinanceiras", rotulo: "(-) Despesas financeiras", tipo: "linha" },
  { chave: "outrasReceitas", rotulo: "(+) Outras receitas operacionais", tipo: "linha" },
  { chave: "irpjCsll", rotulo: "(-) IRPJ/CSLL", tipo: "linha" },
  {
    chave: "resultadoDoPeriodo",
    rotulo: "= Resultado do período",
    tipo: "subtotal",
    soma: ["resultadoOperacional", "receitasFinanceiras", "despesasFinanceiras", "outrasReceitas", "irpjCsll"],
  },
];

/**
 * ⚠⚠ OS VALORES NÃO SÃO REDONDOS, e isso já é regra escrita nesta casa: o mock com múltiplos de
 * 100 escondeu dois ramos inteiros (o parser ×100 e o faturamento zero). Aqui o custo seria menor,
 * mas a disciplina é a mesma.
 * ⚠ `deducoes` é onde o DAS mora — nunca despesa tributária. É a decisão do desenho do DRE, e o
 * mock precisa mostrá-la nesse lugar para ela ser conferível na tela.
 */
const VALORES = {
  receitaBruta: 34918.30,
  deducoes: -3106.42,
  custos: -9847.15,
  pessoal: -5480.00,
  gerais: -2317.88,
  tributarias: -412.60,
  depreciacao: -733.19,
  receitasFinanceiras: 118.44,
  despesasFinanceiras: -96.31,
  outrasReceitas: 0,
  irpjCsll: 0,
};

/**
 * ⚠⚠ AS CONTAS VIAJAM COM A LINHA, como no servidor — é delas que sai o detalhe.
 * ⚠ O código é o `codigoCompleto`, nunca o reduzido: 41 contas do plano real têm os dois apontando
 * para grupos diferentes, e trocar inverte receita com despesa sem erro nenhum.
 */
const CONTAS = {
  receitaBruta: [
    { codigo: "311010001", reduzido: "401", nome: "RECEITA DE SERVIÇOS", valor: 34918.30 },
  ],
  deducoes: [
    { codigo: "331010001", reduzido: "412", nome: "SIMPLES NACIONAL - DAS", valor: -3106.42 },
  ],
  pessoal: [
    { codigo: "411010003", reduzido: "426", nome: "PRÓ-LABORE", valor: -4000.00 },
    { codigo: "411010007", reduzido: "431", nome: "FGTS", valor: -1480.00 },
  ],
  gerais: [
    { codigo: "411020008", reduzido: "464", nome: "SERVIÇOS PRESTADOS POR PJ", valor: -1837.88 },
    { codigo: "411020014", reduzido: "470", nome: "ENERGIA ELÉTRICA", valor: -480.00 },
  ],
};

export function dreDoMock(_companyId, competencia) {
  const valores = new Map();
  const linhas = LINHAS.map((def) => {
    if (def.tipo === "linha") {
      const valor = VALORES[def.chave] ?? 0;
      valores.set(def.chave, valor);
      return { ...def, valor, contas: CONTAS[def.chave] || [] };
    }
    const valor = def.soma.reduce((s, k) => s + (valores.get(k) || 0), 0);
    valores.set(def.chave, valor);
    return { ...def, valor, contas: [] };
  });

  return {
    competencia: competencia || null,
    // ⚠⚠ É ELE que apaga o selo — a leitura da tela é `demonstracao !== false`, nunca `=== true`.
    demonstracao: false,
    linhas,
    semLancamento: false,
    /**
     * ⚠⚠ "FORA DO DRE" É OBRIGATÓRIO, e o mock TEM DE CARREGÁ-LO. Medido em produção: essa linha
     * carrega R$ 321.822,26 de receita e R$ 20.274,56 de DAS — some com ela e a empresa some do
     * DRE. Um mock com a lista vazia deixaria o bloco inteiro inalcançável offline, e ninguém
     * conferiria o desenho dele antes de o cliente ver.
     */
    naoClassificado: [
      {
        causa: "SEM_CODIGO_COMPLETO",
        frase: "Estas contas não têm código completo no plano, e por isso não entram em nenhuma linha acima.",
        valor: 1284.90,
        contas: [{ codigo: "557", nome: "DESPESAS DIVERSAS", valor: 1284.90, linhas: 3 }],
      },
    ],
  };
}

/**
 * ⚠ O DRE VAZIO — 12 das 34 empresas de produção não têm lançamento nenhum.
 *
 * ⚠⚠ Ele **não é `R$ 0,00` em toda linha**: zero AFIRMA que a empresa não faturou nem gastou nada.
 * `semLancamento: true` é o que faz a tela dizer *"seu contador ainda não lançou esta competência"*.
 */
export function dreVazioDoMock(_companyId, competencia) {
  return {
    competencia: competencia || null,
    demonstracao: false,
    linhas: LINHAS.map((def) => ({ ...def, valor: 0, contas: [] })),
    semLancamento: true,
    naoClassificado: [],
  };
}
