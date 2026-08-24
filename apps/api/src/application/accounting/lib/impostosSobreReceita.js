/**
 * A ALÍQUOTA EFETIVA A PARTIR DOS LANÇAMENTOS — provisão de impostos ÷ receita. Módulo PURO
 * (sem prisma, sem rede).
 *
 * A regra, uma frase: **quem diz se uma conta é receita ou imposto é o PREFIXO do `codigoCompleto`,
 * nunca o nome nem o `tipo` do lançamento.** Mesmo molde de `disponibilidades.js` — e pelo mesmo
 * motivo: casar nome de conta contra lista de texto é palpite, e aqui o resultado vai para a tela
 * do cliente como percentual de carga tributária.
 *
 * ## Por que existe (ordem do dono, 24/08/2026)
 *
 * > *"VAMOS CALCULAR A ALIQUOTA EFETIVA DO PRESUMIDO BASEADO NO LANÇAMENTOS CONTABIL DE PROVISAO E
 * > RECEITA."*
 *
 * O que havia antes, para o Lucro Presumido, era `impostosPagos ÷ faturamento` — guias com
 * `paymentStatus: "PAID"` sobre notas emitidas. Medido em produção em 24/08/2026: **2 de 11**
 * empresas do Presumido têm alguma guia paga, porque
 * `SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED` não está definida e `PAID` só acontece por clique
 * manual. Ou seja: em 9 de 11 clientes o número simplesmente não existia.
 *
 * ⚠ **A conta do SIMPLES NÃO MUDA.** Ela sai do extrato do PGDAS-D (`CompanyMonthlyCircular.
 * dasTotal`), que é a declaração transmitida à Receita — prova mais forte que qualquer lançamento
 * nosso. Este módulo é a resposta para quem **não tem** PGDAS-D. Ver o cabeçalho de
 * `apps/portal-cliente-web/src/features/emitir/lib/aliquotaEfetiva.js` para as contas que já
 * existiam e qual tela usa qual.
 *
 * ## ⚠⚠ A ESTRUTURA NÃO FOI INVENTADA — ELA JÁ ESTAVA NO PLANO DE CONTAS
 *
 * Medido em produção (24/08/2026, somente leitura), no plano global que atende 33 dos 34 clientes:
 *
 * | prefixo | nome no plano | papel aqui |
 * |---|---|---|
 * | `311`   | RECEITA BRUTA DE VENDA E PRESTACAO DE SERVICOS | **denominador** |
 * | `33101` | DEVOLUCOES DE VENDAS E SERVIÇOS | reduz o denominador — **não é imposto** |
 * | `33102` | ABATIMENTOS E DESCONTOS CONCEDIDOS | idem |
 * | `33103` | **IMPOSTOS INCIDENTES** (`(-) ISS`, `(-) PIS`, `(-) COFINS`, `(-) ICMS`, `(-) IPI`, `(-) ICMS ST`, `(-) ISS RETIDO`, `(-) INSS S/RECEITA`, `(-) DAS`) | **numerador** |
 * | `5`     | o ramo INTEIRO é `(-) IRPJ/CSLL` (6 contas, nenhuma outra coisa) | **numerador** |
 * | `312`   | RECEITAS FINANCEIRAS | fora |
 * | `32`    | OUTRAS RECEITAS OPERACIONAIS (aluguéis, sucata, dividendos, venda de ativo) | fora |
 *
 * ⚠ **`33101`/`33102` são irmãs de `33103` dentro de "(-) DEDUCOES DE RECEITAS", e mesmo assim NÃO
 * entram no numerador.** Devolução e desconto reduzem a receita; imposto é o que se paga sobre ela.
 * Somá-los inflaria a alíquota com dinheiro que nunca foi tributo. Eles reduzem o DENOMINADOR —
 * incluir no denominador uma venda cancelada diluiria a alíquota com receita que não existiu.
 * ⚠ Medido: hoje as duas têm **movimento zero** nas empresas do Presumido, então a escolha é
 * INERTE. Está escrita assim porque é o que o plano estrutura, e para que a reversão seja de uma
 * linha caso o dono decida o contrário.
 *
 * ⚠ **O ramo `4` (DESPESAS) fica inteiro de fora, e o INSS sobre FOLHA junto** — é a mesma regra
 * que o dono deu para o Simples em 18/08/2026 (*"apenas a DAS, o INSS não entraria"*). ⚠ Não
 * confundir com `331030008 (-) INSS S/RECEITA LEI 12.546/2011`, que é a CPRB: essa incide sobre a
 * RECEITA e por isso está dentro. São dois tributos diferentes com a mesma sigla.
 *
 * ⚠ **NADA AQUI OLHA O `tipo` DO LANÇAMENTO.** Medido: as provisões de PIS/COFINS/ISS chegam com
 * `tipo: "PROVISAO"`, mas há linha em conta de receita dentro de lançamento `tipo: "DESPESA"`. O
 * `tipo` é rótulo de tela; a conta é o fato contábil.
 *
 * ⚠⚠ **E O MAIOR LIMITE É A CONTA VAZIA.** `AccountingEntryLine.conta` é TEXTO sem FK, e medido nas
 * empresas do Presumido: **11 de 37 provisões têm pelo menos uma perna SEM conta** (nascem assim
 * quando não há memória em `AccountingHistorico`). Essas linhas são invisíveis para qualquer regra
 * baseada em conta — então elas **voltam contadas em `naoClassificadas`**, nunca somem. Uma
 * alíquota calculada por cima de metade das provisões seria menor que a real, e nada na tela
 * diria isso.
 */

/** Grupos, vocabulário FECHADO. */
export const GRUPO = Object.freeze({
  RECEITA_BRUTA: "RECEITA_BRUTA",
  DEDUCAO_NAO_TRIBUTARIA: "DEDUCAO_NAO_TRIBUTARIA",
  IMPOSTO_SOBRE_RECEITA: "IMPOSTO_SOBRE_RECEITA",
  IMPOSTO_SOBRE_RESULTADO: "IMPOSTO_SOBRE_RESULTADO",
  FORA_DA_CONTA: "FORA_DA_CONTA",
  INDETERMINADO: "INDETERMINADO",
});

/** Situação da alíquota, vocabulário FECHADO. ⚠ Nenhuma delas é "zero por cento". */
export const SITUACAO = Object.freeze({
  CALCULADA: "CALCULADA",
  SEM_RECEITA_LANCADA: "SEM_RECEITA_LANCADA",
  SEM_IMPOSTO_LANCADO: "SEM_IMPOSTO_LANCADO",
  SEM_LANCAMENTO: "SEM_LANCAMENTO",
});

// ⚠ ORDEM IMPORTA: os prefixos mais LONGOS primeiro. `33103` tem de ser testado antes de `33101`
// não por colisão entre eles, mas porque qualquer encurtamento futuro desta lista para `33`
// mandaria "impostos incidentes" para "deduções" e esvaziaria o numerador em silêncio.
const PREFIXOS = Object.freeze([
  ["33101", GRUPO.DEDUCAO_NAO_TRIBUTARIA],
  ["33102", GRUPO.DEDUCAO_NAO_TRIBUTARIA],
  ["33103", GRUPO.IMPOSTO_SOBRE_RECEITA],
  ["311", GRUPO.RECEITA_BRUTA],
  ["5", GRUPO.IMPOSTO_SOBRE_RESULTADO],
]);

/**
 * Em que grupo esta conta entra.
 *
 * ⚠ Conta SEM `codigoCompleto` responde `INDETERMINADO`, nunca `FORA_DA_CONTA`. "Não sei o que é"
 * e "sei que não entra" são respostas diferentes, e a primeira precisa aparecer na tela — é a
 * mesma disciplina do `analitica` tri-estado e do `DISPONIVEL_NAO_CLASSIFICADO`.
 */
export function classificarConta(conta) {
  const cc = String(conta?.codigoCompleto ?? "").trim();
  if (!cc) return GRUPO.INDETERMINADO;
  for (const [prefixo, grupo] of PREFIXOS) if (cc.startsWith(prefixo)) return grupo;
  return GRUPO.FORA_DA_CONTA;
}

const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Soma as linhas e devolve os componentes da alíquota.
 *
 * @param linhas  `[{ conta, tipo: "D"|"C", valor, parcelamentoId? }]` — a conta já RESOLVIDA no
 *                plano (`{ codigo, nome, codigoCompleto }`) ou `null` quando não foi possível
 *                resolver.
 *
 * ⚠ O SINAL segue a natureza da conta, não o `tipo` da linha. Receita é CREDORA (C soma, D
 * subtrai); as contas de imposto e de dedução são retificadoras, natureza DEVEDORA (D soma, C
 * subtrai). Trocar isso faria um estorno virar aumento.
 */
export function somarComponentes(linhas) {
  const zero = () => ({ total: 0, porConta: new Map() });
  const acc = {
    [GRUPO.RECEITA_BRUTA]: zero(),
    [GRUPO.DEDUCAO_NAO_TRIBUTARIA]: zero(),
    [GRUPO.IMPOSTO_SOBRE_RECEITA]: zero(),
    [GRUPO.IMPOSTO_SOBRE_RESULTADO]: zero(),
  };
  const naoClassificadas = [];

  for (const l of Array.isArray(linhas) ? linhas : []) {
    // ⚠ PARCELAMENTO NÃO É A CARGA DO MÊS. A provisão de abertura de um parcelamento é dívida
    // ANTIGA sendo reconhecida; somá-la aqui faria a alíquota do mês estourar por causa de imposto
    // de outros anos. Fora, e fora ANTES da classificação — o motivo não é a conta.
    if (l?.parcelamentoId) continue;

    const grupo = l?.conta ? classificarConta(l.conta) : GRUPO.INDETERMINADO;
    if (grupo === GRUPO.INDETERMINADO) {
      naoClassificadas.push({
        conta: String(l?.conta?.codigo ?? l?.contaCodigo ?? "").trim() || null,
        valor: numero(l?.valor),
        tipo: l?.tipo === "C" ? "C" : "D",
        motivo: l?.conta ? "conta_sem_codigo_completo" : "conta_fora_do_plano",
      });
      continue;
    }
    if (grupo === GRUPO.FORA_DA_CONTA) continue;

    const credora = grupo === GRUPO.RECEITA_BRUTA;
    const sinal = (l?.tipo === "C" ? 1 : -1) * (credora ? 1 : -1);
    const v = sinal * numero(l?.valor);
    acc[grupo].total += v;
    const cod = String(l.conta.codigo ?? "").trim() || String(l.conta.codigoCompleto);
    const antes = acc[grupo].porConta.get(cod) || { codigo: cod, nome: l.conta.nome ?? null, total: 0 };
    antes.total += v;
    acc[grupo].porConta.set(cod, antes);
  }

  const emLista = (g) => [...acc[g].porConta.values()].sort((a, b) => b.total - a.total);
  return {
    receitaBruta: acc[GRUPO.RECEITA_BRUTA].total,
    receitaBrutaPorConta: emLista(GRUPO.RECEITA_BRUTA),
    devolucoesEDescontos: acc[GRUPO.DEDUCAO_NAO_TRIBUTARIA].total,
    impostoSobreReceita: acc[GRUPO.IMPOSTO_SOBRE_RECEITA].total,
    impostoSobreResultado: acc[GRUPO.IMPOSTO_SOBRE_RESULTADO].total,
    impostosPorConta: [...emLista(GRUPO.IMPOSTO_SOBRE_RECEITA), ...emLista(GRUPO.IMPOSTO_SOBRE_RESULTADO)],
    naoClassificadas,
  };
}

/**
 * A alíquota efetiva, com a situação que a explica.
 *
 * ⚠⚠ **NUNCA DEVOLVE `0` COMO ALÍQUOTA.** Sem receita ou sem imposto lançado, `aliquota` é `null`
 * e `situacao` diz qual das duas faltou. Zero por cento é uma AFIRMAÇÃO sobre carga tributária —
 * é o mesmo raciocínio do `pTotTribSN` da nota e do `folhaAusenteNaoEZero`.
 *
 * ⚠ Base = receita bruta **menos devoluções e descontos**. Ver o cabeçalho: escolha estrutural do
 * plano, hoje inerte (movimento zero nessas contas).
 */
export function aliquotaEfetivaDeLancamentos(linhas) {
  const c = somarComponentes(linhas);
  const base = c.receitaBruta - c.devolucoesEDescontos;
  const impostos = c.impostoSobreReceita + c.impostoSobreResultado;

  let situacao = SITUACAO.CALCULADA;
  if (base <= 0 && impostos <= 0) situacao = SITUACAO.SEM_LANCAMENTO;
  else if (base <= 0) situacao = SITUACAO.SEM_RECEITA_LANCADA;
  else if (impostos <= 0) situacao = SITUACAO.SEM_IMPOSTO_LANCADO;

  return {
    ...c,
    base,
    impostos,
    aliquota: situacao === SITUACAO.CALCULADA ? (impostos / base) * 100 : null,
    situacao,
  };
}
