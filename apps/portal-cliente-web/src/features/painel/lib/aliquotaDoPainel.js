// QUAL ALÍQUOTA O PAINEL MOSTRA — uma leitura só, decidida pelo REGIME.
//
// ## Por que existe (ordem do dono, 24/08/2026)
//
// > *"VAMOS CALCULAR A ALIQUOTA EFETIVA DO PRESUMIDO BASEADO NO LANÇAMENTOS CONTABIL DE PROVISAO E
// > RECEITA."*
//
// Até aqui o card usava `efetiva` (= impostos PAGOS ÷ faturamento) para **todo mundo**. Para o
// Simples isso funciona; para o Lucro Presumido, não — medido em produção em 24/08/2026, **2 de 11**
// empresas do Presumido têm alguma guia paga, porque `SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED`
// não está definida e `PAID` só acontece por clique manual. Em 9 de 11 clientes o card mostrava
// traço permanente.
//
// ## ⚠⚠ AS TRÊS CONTAS CONTINUAM EXISTINDO, E NENHUMA FOI "CONSERTADA"
//
// O `CLAUDE.md` deste app registra, com o motivo, que `efetiva` **está certa onde é usada** e que
// ninguém deve alinhá-la com a da nota. Isto aqui não a altera: acrescenta uma QUARTA fonte
// (`deLancamentos`) e diz **quem usa qual**.
//
// | regime | conta | de onde vem |
// |---|---|---|
// | **Simples** | `efetiva` = impostos pagos ÷ faturamento | guias `PAID` + notas EMIT autorizadas |
// | **Presumido / Real** | `deLancamentos.aliquota` = (impostos incidentes + IRPJ/CSLL) ÷ receita bruta | razão contábil, por prefixo de `codigoCompleto` |
// | **regime desconhecido** | `efetiva` | ⚠ o comportamento de HOJE, preservado — ver abaixo |
//
// ⚠ **REGIME DESCONHECIDO NÃO CAI NA CONTA NOVA, e isso é deliberado.** `efetiva` é
// regime-agnóstica ("o que foi pago sobre o que foi faturado") e é o que a tela já mostra; a conta
// por lançamento pressupõe o plano de contas alimentado, e afirmá-la sobre uma empresa cujo regime
// ninguém sabe seria trocar um número incompleto por outro, sem ninguém ter decidido. Medido:
// 34 de 34 empresas TÊM regime hoje, então este ramo é inalcançável em produção — ele existe
// porque o mock o exercita de propósito.
//
// ⚠⚠ **NUNCA DEVOLVE `0` COMO ALÍQUOTA.** Sempre `{ valor: null, motivo }`. Zero por cento é uma
// AFIRMAÇÃO sobre carga tributária. Mesmo raciocínio de `folhaAusenteNaoEZero` e do `pTotTribSN`.
//
// ⚠ **O backend fabrica zero e este módulo o desfaz.** `efetiva` vem de `d > 0 ? n/d*100 : 0` na
// rota — sem faturamento OU sem guia paga a resposta é `0`, indistinguível de uma alíquota de zero
// por cento. Por isso a leitura confere os DOIS insumos crus antes de aceitar o número, que é o que
// o `PainelPage` já fazia inline e agora vive aqui, testado.

import { REGIME, lerRegime } from "../../emitir/lib/impostosDaNota.js";

/** De onde o número veio. Vocabulário FECHADO. */
export const FONTE = Object.freeze({
  PAGAMENTOS: "pagamentos",
  LANCAMENTOS: "lancamentos",
});

/** Por que não há número. Vocabulário FECHADO — cada motivo pede uma frase diferente na tela. */
export const MOTIVO = Object.freeze({
  SEM_DADOS: "sem_dados",
  SEM_FATURAMENTO: "sem_faturamento",
  SEM_IMPOSTO_PAGO: "sem_imposto_pago",
  SEM_RECEITA_LANCADA: "sem_receita_lancada",
  SEM_IMPOSTO_LANCADO: "sem_imposto_lancado",
  SEM_LANCAMENTO: "sem_lancamento",
  BLOCO_AUSENTE: "bloco_ausente",
});

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** A conta pelos PAGAMENTOS — o caminho do Simples, e o de hoje. */
function porPagamentos(linha) {
  const faturamento = n(linha.faturamento);
  const impostos = n(linha.impostosPagos);
  if (!(faturamento > 0)) {
    return { fonte: FONTE.PAGAMENTOS, valor: null, motivo: MOTIVO.SEM_FATURAMENTO, faturamento, impostos };
  }
  if (!(impostos > 0)) {
    return { fonte: FONTE.PAGAMENTOS, valor: null, motivo: MOTIVO.SEM_IMPOSTO_PAGO, faturamento, impostos };
  }
  return { fonte: FONTE.PAGAMENTOS, valor: n(linha.efetiva), motivo: null, faturamento, impostos };
}

/** A conta pelos LANÇAMENTOS — o caminho do Presumido. */
function porLancamentos(linha) {
  const b = linha.deLancamentos;
  // ⚠ Backend antigo (ou falha isolada do cálculo) não manda o bloco. Isso NÃO é "sem lançamento":
  // é "não perguntei". As duas ausências pedem frases diferentes.
  if (!b) return { fonte: FONTE.LANCAMENTOS, valor: null, motivo: MOTIVO.BLOCO_AUSENTE };

  const comum = {
    fonte: FONTE.LANCAMENTOS,
    base: n(b.base),
    impostos: n(b.impostos),
    impostoSobreReceita: n(b.impostoSobreReceita),
    impostoSobreResultado: n(b.impostoSobreResultado),
    impostosPorConta: Array.isArray(b.impostosPorConta) ? b.impostosPorConta : [],
    // ⚠ QUANTAS LINHAS NÃO PUDERAM SER CLASSIFICADAS. Medido: 11 de 37 provisões do Presumido
    // nascem com a conta VAZIA. Sem este número, uma alíquota calculada por cima de metade das
    // provisões apareceria como se fosse a carga inteira.
    naoClassificadas: Number(b.naoClassificadas) || 0,
  };

  // ⚠ A SITUAÇÃO VEM DO SERVIDOR e é a autoridade — a tela não a recalcula a partir dos números.
  // Recalcular aqui criaria uma segunda regra que divergiria da pura na primeira correção.
  if (b.situacao === "SEM_RECEITA_LANCADA") return { ...comum, valor: null, motivo: MOTIVO.SEM_RECEITA_LANCADA };
  if (b.situacao === "SEM_IMPOSTO_LANCADO") return { ...comum, valor: null, motivo: MOTIVO.SEM_IMPOSTO_LANCADO };
  if (b.situacao === "SEM_LANCAMENTO") return { ...comum, valor: null, motivo: MOTIVO.SEM_LANCAMENTO };
  // ⚠⚠ `Number.isFinite(Number(x))` NÃO SERVE AQUI, e isto foi pego por teste: `Number(null)` é
  // **0**, que é finito — então `situacao: "CALCULADA"` com `aliquota: null` produzia um **0%** na
  // tela, que é exatamente o zero fabricado que este módulo inteiro existe para impedir. O mesmo
  // `Number(null) === 0` que o projeto já documenta em `folhaAusenteNaoEZero` e no
  // `total == null` da auditoria. A conferência é do TIPO, antes de qualquer conversão.
  if (b.situacao !== "CALCULADA" || typeof b.aliquota !== "number" || !Number.isFinite(b.aliquota)) {
    // ⚠ Situação nova que esta tela não conhece NÃO vira número. Falha fechado.
    return { ...comum, valor: null, motivo: MOTIVO.SEM_LANCAMENTO };
  }
  return { ...comum, valor: b.aliquota, motivo: null };
}

/**
 * A alíquota do card, com a fonte e o motivo da ausência.
 *
 * @param {object} p
 * @param {object|null} p.empresa a empresa da casca (o regime sai de `legacyCompany.regimeTributario`)
 * @param {object|null} p.linha   uma linha de `GET /client/companies/:id/aliquotas`
 */
export function aliquotaDoPainel({ empresa, linha }) {
  if (!linha) return { fonte: FONTE.PAGAMENTOS, valor: null, motivo: MOTIVO.SEM_DADOS, regime: lerRegime(empresa) };
  const regime = lerRegime(empresa);
  const leitura = regime === REGIME.OUTRO ? porLancamentos(linha) : porPagamentos(linha);
  return { ...leitura, regime };
}
