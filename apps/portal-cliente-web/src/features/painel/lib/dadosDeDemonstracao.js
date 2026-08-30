// OS NÚMEROS DE DEMONSTRAÇÃO DO PAINEL — fluxo de caixa e DRE.
//
// ⚠⚠ NADA AQUI É DESTA EMPRESA. Não há backend para fluxo de caixa nem para DRE, e não há origem
// nenhuma para ENTRADAS: `POST /companies/:id/ofx/import` e `GET /companies/:id/transactions` são
// stubs 501, e nota emitida não é dinheiro recebido. Esta lib existe para a tela poder ser
// desenhada e conferida antes de o dado existir.
//
// ⚠⚠ E É POR ISSO QUE ELA CARIMBA `demonstracao: true` — e a tela lê `demonstracao !== false`.
// O aviso "Modo demonstração" do login vive de `api.mode`, e `api.mode` **some no modo real**: um
// selo preso a ele não protegeria ninguém em produção. Quem afirma que o dado é fictício é a
// RESPOSTA, não o ambiente. No dia em que o backend existir, ele responde `demonstracao: false` e o
// selo some sozinho — ninguém precisa lembrar de tirá-lo.
//
// ⚠ OS NÚMEROS SÃO REDONDOS DE PROPÓSITO (múltiplos de 500). `R$ 47.312,88` pede para ser lido como
// real; `R$ 18.000,00` não. É a mesma disciplina do resto do app: quando não se sabe, a tela não
// finge que sabe.
//
// ⚠⚠ E ELES NÃO SÃO SEMEADOS COM O FATURAMENTO REAL DA EMPRESA. É a tentação óbvia ("fica
// realista") e é o pior caminho: no instante em que a receita bate com o número verdadeiro, o resto
// do demonstrativo herda a credibilidade dela e a peça inteira passa a ser lida como real. Ou tudo
// é fictício e obviamente fictício, ou nada é.
//
// ⚠ DETERMINÍSTICO por (empresa × competência), como o resto do mock deste app: *"o mesmo seed dá
// sempre os mesmos dados, para que 'a nota 41 sumiu' seja um defeito e não o acaso do
// recarregamento"*.

/** Hash estável de string → inteiro. Sem `Math.random`: recarregar não pode mudar o desenho. */
function semente(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Os N meses que terminam na competência, do mais antigo para o mais novo. */
export function janelaDeMeses(competencia, quantos = 6) {
  const [ano, mes] = String(competencia || "").split("-").map(Number);
  if (!ano || !mes) return [];
  const out = [];
  for (let i = quantos - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const PASSO = 500;
const arredondar = (n) => Math.round(n / PASSO) * PASSO;

// ⚠ O PASSO DIÁRIO É OUTRO, e não é descuido. `arredondar` (múltiplos de 500) serve a valor de MÊS;
// despesa de um dia em múltiplos de 500 seria absurda ("Tarifa bancária R$ 500,00"). 50 mantém o
// número visivelmente fabricado — que é o ponto do arredondamento — sem virar caricatura.
const PASSO_DIARIO = 50;
const arredondarDia = (n) => Math.max(PASSO_DIARIO, Math.round(n / PASSO_DIARIO) * PASSO_DIARIO);

/**
 * Os dias do mês da competência, em `"YYYY-MM-DD"`.
 *
 * ⚠⚠ SEM `toISOString()` SOBRE DATA LOCAL. Este projeto já registrou a armadilha em
 * `features/emitir/EmitirNotaPage.jsx`: *"ele converte para UTC, e às 22h de Brasília (UTC-3)
 * devolveria a data de AMANHÃ"*. Aqui a string é montada com aritmética, e `Date.UTC` só entra para
 * descobrir quantos dias o mês tem (o "dia 0" do mês seguinte) — conta de calendário, sem fuso.
 *
 * ⚠ Não existia gerador de dias em lugar nenhum deste app antes disto: `competenciasRecentes` e
 * `janelaDeMeses` só sabem de MESES.
 */
export function diasDoMes(competencia) {
  const [ano, mes] = String(competencia || "").split("-").map(Number);
  if (!ano || !mes || mes < 1 || mes > 12) return [];
  const quantos = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  const out = [];
  for (let d = 1; d <= quantos; d += 1) out.push(`${ano}-${mm}-${String(d).padStart(2, "0")}`);
  return out;
}

// O vocabulário do demonstrativo. Curto de propósito: a tela é julgada pelo DESENHO, e uma lista
// longa de descrições faria o olho procurar conteúdo onde não existe nenhum.
const ENTRADAS = ["Recebimento de cliente", "Recebimento de nota emitida", "Transferência recebida"];
const SAIDAS = [
  "Aluguel", "Energia elétrica", "Internet e telefone", "Material de escritório",
  "Pagamento a fornecedor", "Tarifa bancária", "Combustível", "Assinatura de software",
];

/**
 * Distribui pelos dias do mês os PAPÉIS que a série precisa ter.
 *
 * ⚠⚠ ISTO É REGRA DA CASA, NÃO ENFEITE: *"este projeto foi mordido QUATRO vezes por ramo que só
 * existia em produção"*. Cada papel aqui é um desenho que alguém precisa poder conferir ANTES —
 * dia vazio, dia só com entrada, dia só com saída, dia com os dois, o dia em que o saldo VIRA
 * NEGATIVO (que decide cor e sinal), o dia com muitos lançamentos (que faz o painel rolar), e
 * movimento no PRIMEIRO e no ÚLTIMO dia, que são as bordas do ‹ › do painel.
 *
 * ⚠ Dois papéis no mesmo índice: o segundo anda para TRÁS, nunca para frente — `ultimo` tem de
 * continuar sendo o último dia. (Com 28 a 31 dias nenhum colide; a guarda é para o mês curto que
 * este app ainda não viu.)
 */
function papeisPorDia(quantosDias) {
  const desejado = [
    ["primeiro", 0],
    ["soSaida", 2],
    ["soEntrada", 4],
    ["grandeSaida", 15],
    ["ambos", 17],
    ["muitos", 21],
    ["ultimo", quantosDias - 1],
  ];
  const porIndice = new Map();
  for (const [papel, alvo] of desejado) {
    let i = Math.min(Math.max(alvo, 0), quantosDias - 1);
    while (i > 0 && porIndice.has(i)) i -= 1;
    if (!porIndice.has(i)) porIndice.set(i, papel);
  }
  return porIndice;
}

/**
 * Fluxo de caixa — dia a dia do mês da competência, com os lançamentos de cada dia.
 *
 * ⚠ Era MENSAL (seis competências) até 23/08/2026. O dono pediu a tela dia a dia, com o dia
 * abrindo: *"mostrando os dias do mês, com ação para abrir o dia e ver quais foram as despesas
 * daquele dia específico"*. A forma antiga NÃO ficou ao lado desta — duas formas para a mesma tela
 * divergem na primeira correção.
 *
 * ⚠⚠ O SALDO NEGATIVO É GARANTIDO POR CONSTRUÇÃO, num passe só: quando a caminhada chega ao dia
 * `grandeSaida`, a saída dele é calculada A PARTIR do saldo acumulado até ali, para terminar
 * embaixo de zero. Nada de "gerar e depois corrigir" — o valor nasce certo, e o ramo não depende de
 * qual seed a empresa tirou.
 *
 * ⚠ O `saldoInicial` é parte da ficção e não finge ser saldo bancário: não existe, em tabela nenhuma
 * deste projeto, o dinheiro que ENTROU (`PortalInvoice` não tem `recebidoEm`; o único movimento de
 * caixa datado é `AccountingEntry`, que o portal do cliente não alcança). O selo cobre o bloco.
 */
export function fluxoDeCaixaDeDemonstracao(companyId, competencia) {
  const dias = diasDoMes(competencia);
  if (!dias.length) {
    return {
      demonstracao: true,
      competencia,
      saldoInicial: 0,
      dias: [],
      totais: { entradas: 0, saidas: 0, saldoFinal: 0 },
    };
  }

  const base = semente(`${companyId}|fluxo`);
  const papeis = papeisPorDia(dias.length);
  const saldoInicial = arredondar(6000 + (base % 9) * PASSO);

  let saldo = saldoInicial;
  let totalEntradas = 0;
  let totalSaidas = 0;

  const linhas = dias.map((dia, i) => {
    const s = semente(`${companyId}|${dia}`);
    const papel = papeis.get(i) || null;
    const lancamentos = [];
    const por = (tipo) => (descricao, valor) =>
      lancamentos.push({ id: `${dia}-${lancamentos.length}`, descricao, valor, tipo });
    const entrada = por("entrada");
    const saida = por("saida");

    if (papel === "primeiro" || papel === "soEntrada") {
      entrada(ENTRADAS[s % ENTRADAS.length], arredondarDia(2500 + (s % 60) * PASSO_DIARIO));
    }
    if (papel === "soSaida" || papel === "ultimo") {
      saida(SAIDAS[s % SAIDAS.length], arredondarDia(400 + (s % 24) * PASSO_DIARIO));
    }
    if (papel === "ambos") {
      entrada(ENTRADAS[(s >> 2) % ENTRADAS.length], arredondarDia(1800 + (s % 40) * PASSO_DIARIO));
      saida(SAIDAS[s % SAIDAS.length], arredondarDia(300 + (s % 12) * PASSO_DIARIO));
      saida(SAIDAS[(s >> 3) % SAIDAS.length], arredondarDia(150 + (s % 8) * PASSO_DIARIO));
    }
    if (papel === "muitos") {
      // O dia que faz o painel rolar. Sete itens pequenos, cada um com nome próprio.
      for (let k = 0; k < 7; k += 1) {
        saida(SAIDAS[(s + k) % SAIDAS.length], arredondarDia(80 + ((s >> k) % 14) * PASSO_DIARIO));
      }
    }
    if (papel === "grandeSaida") {
      // ⚠ AQUI O SALDO VIRA NEGATIVO, e o valor sai do saldo acumulado até este dia — é o que faz o
      // ramo existir para QUALQUER empresa, e não só para a que tirou o seed certo.
      const folga = arredondarDia(900 + (s % 20) * PASSO_DIARIO);
      const total = arredondarDia(saldo + folga);
      // ⚠ "DAS — Simples Nacional" com valor fictício é deliberado: sem um item que o cliente
      // reconheça, não dá para julgar se a tela serve. Os DOIS selos (o do bloco e o do painel do
      // dia) são o que autoriza este nome a aparecer aqui.
      const imposto = arredondarDia(total * 0.45);
      saida("DAS — Simples Nacional", imposto);
      saida("Folha de pagamento", Math.max(PASSO_DIARIO, total - imposto));
    }

    const entradas = lancamentos.filter((l) => l.tipo === "entrada").reduce((n, l) => n + l.valor, 0);
    const saidas = lancamentos.filter((l) => l.tipo === "saida").reduce((n, l) => n + l.valor, 0);

    saldo += entradas - saidas;
    totalEntradas += entradas;
    totalSaidas += saidas;

    return { dia, entradas, saidas, saldo, lancamentos };
  });

  return {
    demonstracao: true,
    competencia,
    saldoInicial,
    dias: linhas,
    totais: { entradas: totalEntradas, saidas: totalSaidas, saldoFinal: saldo },
  };
}

/**
 * ⚠⚠ O DRE DE DEMONSTRAÇÃO — reescrito em 29/08/2026 para o FORMATO REAL.
 *
 * O DRE virou real nesta data (`GET /client/companies/:id/dre`, montado pelo plano de contas), e
 * este arquivo passou a ser o par OFFLINE dele — não mais a única versão que existia.
 *
 * ⚠⚠ **A FORMA TEM DE SER A DO SERVIDOR**, e por isso ela mudou aqui: seis linhas viraram as quinze
 * de `dreGerencial.js`, e entraram `semLancamento` e `naoClassificado`. Um mock com forma própria
 * treina a tela errada — foi o defeito medido no fluxo de caixa no mesmo dia (o mock chamava
 * `base.origem` o que o servidor chama de `base.doCliente`, e a lista saía vazia).
 *
 * ⚠ **`demonstracao: true` FICA**: aqui os números são inventados, e é ele que acende o selo. É a
 * única diferença de contrato em relação ao servidor, e ela é o ponto.
 *
 * ⚠⚠ **OS RAMOS QUE O MOCK PRECISA ALCANÇAR**, porque este projeto já foi mordido oito vezes por
 * ramo que só existia em produção:
 *   • a empresa **SEM LANÇAMENTO** (12 das 34 na base real) — o DRE dela é vazio NOMEADO, nunca zero;
 *   • a linha **NÃO CLASSIFICADA**, com as causas separadas (a conta em branco carrega R$ 687 mil);
 *   • uma linha de receita **NEGATIVA** (o estorno), que aparece com o sinal que tem.
 */
export function dreDeDemonstracao(companyId, competencia) {
  // ⚠ A MESMA empresa magra do fluxo: sem apuração, sem lançamento. Ela é o ramo do vazio nomeado.
  if (companyId === "pc-006") {
    return {
      demonstracao: true,
      competencia,
      semLancamento: true,
      linhas: LINHAS_DO_DRE_DEMO.map((l) => ({ ...l, valor: 0, contas: [] })),
      naoClassificado: [],
    };
  }

  const s = semente(`${companyId}|dre|${competencia}`);
  const receitaBruta = arredondar(30000 + (s % 30) * PASSO);
  // ⚠ O ESTORNO: um débito em conta de RECEITA. Ele é o caso real da validação
  // (`311020002 MANUTENCAO −3.213,00`), e zerá-lo esconderia o estorno.
  const estorno = -arredondar(receitaBruta * 0.04);
  const deducoes = -arredondar(receitaBruta * 0.09);
  const custos = -arredondar(receitaBruta * 0.30);
  const pessoal = -arredondar(receitaBruta * 0.14);
  const gerais = -arredondar(receitaBruta * 0.07);
  const tributarias = -arredondar(receitaBruta * 0.02);
  const receitasFinanceiras = arredondar(receitaBruta * 0.01);
  const despesasFinanceiras = -arredondar(receitaBruta * 0.015);

  const valores = {
    receitaBruta: receitaBruta + estorno,
    deducoes,
    custos,
    pessoal,
    gerais,
    tributarias,
    depreciacao: 0,
    receitasFinanceiras,
    despesasFinanceiras,
    outrasReceitas: 0,
    irpjCsll: 0,
  };
  const receitaLiquida = valores.receitaBruta + valores.deducoes;
  const lucroBruto = receitaLiquida + valores.custos;
  const resultadoOperacional = lucroBruto + valores.pessoal + valores.gerais + valores.tributarias;
  const resultadoDoPeriodo = resultadoOperacional + receitasFinanceiras + despesasFinanceiras;

  const subtotais = { receitaLiquida, lucroBruto, resultadoOperacional, resultadoDoPeriodo };

  return {
    demonstracao: true,
    competencia,
    semLancamento: false,
    linhas: LINHAS_DO_DRE_DEMO.map((l) => ({
      ...l,
      valor: l.tipo === "linha" ? valores[l.chave] : subtotais[l.chave],
      contas: l.chave === "receitaBruta"
        ? [
          { codigo: "31101", nome: "VENDAS DE SERVICOS", valor: receitaBruta },
          // ⚠ A conta com valor NEGATIVO dentro de uma linha de receita.
          { codigo: "311020002", nome: "MANUTENCAO", valor: estorno },
        ]
        : [],
    })),
    // ⚠⚠ A LINHA QUE NUNCA SOME. Duas causas de propósito: elas pedem consertos diferentes, e um
    // mock com uma só faria a tela parecer certa com metade do desenho.
    naoClassificado: [
      {
        causa: "conta_em_branco",
        frase: "Estas linhas ainda não têm conta contábil. É um estado normal — a provisão de guia nasce assim —, e o seu contador ainda vai classificá-las.",
        valor: arredondar(receitaBruta * 0.05),
        contas: [{ codigo: "(sem conta)", nome: null, valor: arredondar(receitaBruta * 0.05), linhas: 3 }],
      },
      {
        causa: "fora_do_plano",
        frase: "Estas linhas usam uma conta que não existe no plano de contas desta empresa.",
        valor: 120,
        contas: [{ codigo: "9999", nome: null, valor: 120, linhas: 1 }],
      },
    ],
  };
}

/**
 * ⚠ As linhas, na MESMA ordem e com os MESMOS rótulos de `dreGerencial.js` (backend).
 *
 * ⚠⚠ Ela é cópia deliberada, e entra na tabela "mudou lá, muda aqui" do `CLAUDE.md`: a alternativa
 * seria importar a constante do `apps/api` para dentro do bundle do cliente, o que arrastaria o
 * serviço e o Prisma junto. O que impede a divergência é o teste, que compara as duas listas.
 */
const LINHAS_DO_DRE_DEMO = [
  { chave: "receitaBruta", rotulo: "Receita bruta", tipo: "linha" },
  { chave: "deducoes", rotulo: "(-) Deduções", tipo: "linha" },
  { chave: "receitaLiquida", rotulo: "= Receita líquida", tipo: "subtotal" },
  { chave: "custos", rotulo: "(-) Custos", tipo: "linha" },
  { chave: "lucroBruto", rotulo: "= Lucro bruto", tipo: "subtotal" },
  { chave: "pessoal", rotulo: "(-) Despesas com pessoal", tipo: "linha" },
  { chave: "gerais", rotulo: "(-) Despesas gerais", tipo: "linha" },
  { chave: "tributarias", rotulo: "(-) Despesas tributárias", tipo: "linha" },
  { chave: "depreciacao", rotulo: "(-) Depreciação/amortização", tipo: "linha" },
  { chave: "resultadoOperacional", rotulo: "= Resultado operacional", tipo: "subtotal" },
  { chave: "receitasFinanceiras", rotulo: "(+) Receitas financeiras", tipo: "linha" },
  { chave: "despesasFinanceiras", rotulo: "(-) Despesas financeiras", tipo: "linha" },
  { chave: "outrasReceitas", rotulo: "(+) Outras receitas operacionais", tipo: "linha" },
  { chave: "irpjCsll", rotulo: "(-) IRPJ/CSLL", tipo: "linha" },
  { chave: "resultadoDoPeriodo", rotulo: "= Resultado do período", tipo: "resultado" },
];
