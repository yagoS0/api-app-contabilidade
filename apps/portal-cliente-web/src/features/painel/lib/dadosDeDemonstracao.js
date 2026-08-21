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

/**
 * Fluxo de caixa — entradas, saídas e saldo, mês a mês.
 *
 * ⚠ A SÉRIE ALCANÇA OS RAMOS QUE A TELA PRECISA DESENHAR, e isso é regra deste app, não capricho:
 * *"este projeto foi mordido QUATRO vezes por ramo que só existia em produção"*. Aqui, por
 * construção, sempre há **um mês com saldo NEGATIVO** (é ele que decide cor e sinal) e **um mês sem
 * entrada nenhuma**. Sem eles, ninguém confere esses dois desenhos antes de produção.
 */
export function fluxoDeCaixaDeDemonstracao(companyId, competencia, quantos = 6) {
  const meses = janelaDeMeses(competencia, quantos);
  const base = semente(`${companyId}|fluxo`);

  const linhas = meses.map((m, i) => {
    const s = semente(`${companyId}|${m}`);
    // O penúltimo mês é o do saldo negativo; o primeiro da janela é o mês sem entradas.
    const semEntrada = i === 0;
    const negativo = i === meses.length - 2;

    const entradas = semEntrada ? 0 : arredondar(8000 + (s % 22) * PASSO);
    const saidas = negativo
      ? arredondar(entradas + 2000 + (s % 5) * PASSO)
      : arredondar(3000 + ((s >> 3) % 12) * PASSO);
    return { competencia: m, entradas, saidas, saldo: entradas - saidas };
  });

  const totais = linhas.reduce(
    (acc, l) => ({
      entradas: acc.entradas + l.entradas,
      saidas: acc.saidas + l.saidas,
      saldo: acc.saldo + l.saldo,
    }),
    { entradas: 0, saidas: 0, saldo: 0 },
  );

  return { demonstracao: true, competencia, base, meses: linhas, totais };
}

/**
 * DRE — as linhas com nome próprio, na ordem em que se lê um resultado.
 *
 * ⚠⚠ "DRE" É NOME DE PEÇA CONTÁBIL, e este repositório já registrou o cuidado com isso: no portal
 * do ESCRITÓRIO, *"balanço e balancete não aparecem nem desabilitados"*, porque entregá-los a
 * partir de dado insuficiente *"seria um demonstrativo com NOME DE PEÇA CONTÁBIL"*. Lá o dado era
 * insuficiente; aqui ele é **inventado**. O selo na tela é o que separa uma maquete de uma
 * afirmação contábil — ele não é enfeite, é o que autoriza esta tela a existir.
 *
 * ⚠ E é por isso que a visão de DRE **não oferece exportar, imprimir nem baixar**: o risco não é a
 * tela, é ela SAIR da tela (print, PDF, e-mail ao banco) sem o selo junto.
 *
 * ⚠ DE ONDE CADA LINHA VIRÁ, quando existir: receita e deduções saem de `CompanyMonthlyCircular`
 * (faturamento + extrato do PGDAS-D) e das guias pagas; custo, despesa e resultado exigem
 * `AccountingEntry` com plano de contas classificado — que hoje só existe do lado do escritório —
 * e só são verdade **depois do fechamento contábil do mês**. Antes disso o número muda depois de
 * mostrado.
 */
export function dreDeDemonstracao(companyId, competencia) {
  const s = semente(`${companyId}|dre|${competencia}`);
  const receita = arredondar(30000 + (s % 30) * PASSO);
  const deducoes = arredondar(receita * 0.09);
  const liquida = receita - deducoes;
  const custos = arredondar(liquida * 0.36);
  const despesas = arredondar(liquida * 0.24);
  const resultado = liquida - custos - despesas;

  return {
    demonstracao: true,
    competencia,
    linhas: [
      { chave: "receita", rotulo: "Receita bruta de serviços", valor: receita, tipo: "entrada" },
      { chave: "deducoes", rotulo: "(−) Impostos sobre a receita", valor: -deducoes, tipo: "saida" },
      { chave: "liquida", rotulo: "= Receita líquida", valor: liquida, tipo: "subtotal" },
      { chave: "custos", rotulo: "(−) Custo dos serviços prestados", valor: -custos, tipo: "saida" },
      { chave: "despesas", rotulo: "(−) Despesas operacionais", valor: -despesas, tipo: "saida" },
      { chave: "resultado", rotulo: "= Resultado do período", valor: resultado, tipo: "resultado" },
    ],
  };
}
