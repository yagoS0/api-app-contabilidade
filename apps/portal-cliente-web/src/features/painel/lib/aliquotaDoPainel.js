// QUAL ALÍQUOTA O PAINEL MOSTRA — uma leitura só, e ela vem SEMPRE do que foi LANÇADO.
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
// ## ⚠⚠ ISTO MUDOU EM 30/08/2026 — A CONTA É SEMPRE A DOS LANÇAMENTOS
//
// > Dono: *"use sempre o que foi lançada, ou seja, veio do extrato do simples nacional, ou veio do
// > presumido, para cálculo a alíquota."*
//
// **A tabela abaixo virou uma linha só: `deLancamentos`, para todo regime.** O que era do Simples
// (`efetiva` = guias PAGAS ÷ faturamento) SAIU — e não por gosto, por medição em produção
// (ERISANGELA, somente leitura, `scripts/diag-aliquota-lancada.mjs`):
//
// | competência | pelo LANÇADO | `efetiva`, o que a tela mostrava |
// |---|---|---|
// | 2026-04 | **6,21%** | 0,88% |
// | 2026-05 | **6,23%** | 7,56% |
// | 2026-06 | **6,24%** | 7,01% |
// | 2026-07 | **6,24%** | **0,77%** |
//
// ⚠⚠ **`efetiva` NÃO ERRAVA POR ARREDONDAMENTO — ela era refém de QUAL GUIA ALGUÉM MARCOU COMO
// PAGA.** Em 07/2026 a única guia `PAID` da empresa era o INSS de R$ 178,31, e o card anunciou
// **0,77%** de carga tributária. É a mesma família do *"1,41%"* que o dono relatou como impossível.
// O número pelo lançado bate com o extrato do PGDAS-D nos quatro meses — que é literalmente o que
// ele mandou usar: *"veio do extrato do simples nacional"*, e o extrato vira lançamento.
//
// ⚠ **A frase antiga dizia o contrário e ficou registrada aqui de propósito:** *"a conta do SIMPLES
// não muda; ela sai do extrato do PGDAS-D, prova mais forte que qualquer lançamento nosso"*. O
// argumento não caiu por estar errado — ele caiu porque a tela nunca usou o extrato: ela usava as
// GUIAS PAGAS. `deReceita` (o extrato puro) e a conta pelo lançado deram o MESMO número nos quatro
// meses medidos, então trocar o extrato pelo lançamento não perdeu prova nenhuma; ganhou os meses
// em que a circular ainda não chegou.
//
// ## ⚠⚠ E O INSS ENTRA JUNTO — `aliquotaComFolha`
//
// > Dono, no mesmo dia: *"a porcentagem do imposto líquido sumiu, **não calcula o INSS junto**"*.
//
// O card lê `deLancamentos.aliquotaComFolha`, que é (imposto sobre receita + IRPJ/CSLL + **INSS
// patronal**) ÷ receita. Na ERISANGELA de 07/2026: 1.437,15 + 178,31 sobre 23.040,26 ⇒ **7,01%**,
// contra 6,24% só do DAS. ⚠ Esses **são** os dois números que o `CLAUDE.md` deste app já
// registrava para uma empresa com INSS em guia à parte — *"6,24% × 7,01%"*.
//
// ⚠⚠ **A REGRA DA NOTA NÃO MUDOU, e não pode:** *"apenas a DAS, o INSS não entraria"* (18/08/2026)
// é sobre o `pTotTribSN`, e ela continua lendo `deReceita`. As duas perguntas seguem separadas:
// o PAINEL é *quanto esta empresa paga de imposto?* (tudo); a NOTA é *quanto desta nota é tributo
// do Simples?* (só o DAS). O que este módulo faz é parar de aplicar a regra da nota ao painel.
//
// ⚠ De onde o INSS sai, e por que só o crédito de uma conta de passivo: está medido e escrito em
// `apps/api/src/application/accounting/lib/impostosSobreReceita.js`. ⚠ A forma do lançamento **não
// foi tocada** — mexer nela sem pedido explícito do dono é proibido nesta casa.
//
// ## ⚠⚠ AS OUTRAS CONTAS CONTINUAM EXISTINDO, E NENHUMA FOI "CONSERTADA"
//
// O `CLAUDE.md` deste app registra, com o motivo, que `efetiva` **está certa onde é usada** e que
// ninguém deve alinhá-la com a da nota. Isto aqui não a altera: acrescenta uma QUARTA fonte
// (`deLancamentos`) e diz **quem usa qual**.
//
// | regime | conta | de onde vem |
// |---|---|---|
// | **todos** | `deLancamentos.aliquota` = (impostos incidentes + IRPJ/CSLL) ÷ receita bruta | razão contábil, por prefixo de `codigoCompleto` |
//
// ⚠⚠ **O REGIME DEIXOU DE DECIDIR, e isso é a mudança de forma.** Antes ele escolhia a fonte; hoje
// a fonte é uma só, e o regime não é lido em lugar nenhum deste módulo. ⚠ Com isso o ramo *"regime
// desconhecido"* — que existia para não afirmar nada sobre empresa sem regime — some por não ter
// mais o que decidir: a conta pelo lançado não pergunta o regime da empresa, ela lê o razão dela.
//
// ⚠⚠ **NUNCA DEVOLVE `0` COMO ALÍQUOTA.** Sempre `{ valor: null, motivo }`. Zero por cento é uma
// AFIRMAÇÃO sobre carga tributária. Mesmo raciocínio de `folhaAusenteNaoEZero` e do `pTotTribSN`.
//
// ⚠ **O backend fabrica zero e este módulo o desfaz.** `efetiva` vem de `d > 0 ? n/d*100 : 0` na
// rota — sem faturamento OU sem guia paga a resposta é `0`, indistinguível de uma alíquota de zero
// por cento. Por isso a leitura confere os DOIS insumos crus antes de aceitar o número, que é o que
// o `PainelPage` já fazia inline e agora vive aqui, testado.

// ⚠ `REGIME` saiu do import em 30/08/2026 junto com o ramo que ele decidia; `lerRegime` fica
// porque o regime continua viajando na leitura (ver o fim do arquivo).
import { lerRegime } from "../../emitir/lib/impostosDaNota.js";

/**
 * De onde o número veio. Vocabulário FECHADO.
 *
 * ⚠ `PAGAMENTOS` SAIU em 30/08/2026, com a conta que ele nomeava. Uma fonte só continua sendo um
 * vocabulário — e não um `boolean` — porque a tela IMPRIME a procedência do número, e o dia em que
 * existir uma segunda ela precisa entrar por aqui, nomeada.
 */
export const FONTE = Object.freeze({
  LANCAMENTOS: "lancamentos",
});

/** Por que não há número. Vocabulário FECHADO — cada motivo pede uma frase diferente na tela. */
export const MOTIVO = Object.freeze({
  SEM_DADOS: "sem_dados",
  // ⚠ `SEM_FATURAMENTO` e `SEM_IMPOSTO_PAGO` saíram em 30/08/2026 — eram as ausências da conta por
  // PAGAMENTO. As de agora falam de contabilidade, e as frases delas são outras.
  SEM_RECEITA_LANCADA: "sem_receita_lancada",
  SEM_IMPOSTO_LANCADO: "sem_imposto_lancado",
  SEM_LANCAMENTO: "sem_lancamento",
  BLOCO_AUSENTE: "bloco_ausente",
});

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** A conta pelos LANÇAMENTOS — desde 30/08/2026, o caminho de TODO regime. */
function porLancamentos(linha) {
  const b = linha.deLancamentos;
  // ⚠ Backend antigo (ou falha isolada do cálculo) não manda o bloco. Isso NÃO é "sem lançamento":
  // é "não perguntei". As duas ausências pedem frases diferentes.
  if (!b) return { fonte: FONTE.LANCAMENTOS, valor: null, motivo: MOTIVO.BLOCO_AUSENTE };

  // ⚠⚠ O NÚMERO DO CARD É O **COM FOLHA**. Backend anterior a 30/08/2026 não manda o campo — e aí
  // o card volta ao número sem INSS, **dizendo que é sem INSS** (`comFolha`). Cair no número antigo
  // calado seria a tela afirmar que o INSS está dentro quando ele não está: campo escondido que
  // continua viajando é o defeito pior, e este app já tem essa frase escrita.
  // ⚠ `typeof === "number"` e não `Number.isFinite(Number(x))`: `Number(null)` é **0**, finito, e
  // devolveria 0% — o zero fabricado que este módulo inteiro existe para impedir.
  const comFolha = typeof b.aliquotaComFolha === "number" && Number.isFinite(b.aliquotaComFolha);
  const comum = {
    fonte: FONTE.LANCAMENTOS,
    comFolha,
    // ⚠ DE QUE MÊS É ESTE NÚMERO. A frase do card o nomeia, e sem ele ela só poderia dizer
    // "a última" — que é o que ela dizia, e ficou falso quando a fonte deixou de ser a apuração.
    competencia: linha.competencia || null,
    base: n(b.base),
    impostos: comFolha ? n(b.impostosComFolha) : n(b.impostos),
    impostoSobreFolha: n(b.impostoSobreFolha),
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
  const valor = comFolha ? b.aliquotaComFolha : b.aliquota;
  if (b.situacao !== "CALCULADA" || typeof valor !== "number" || !Number.isFinite(valor)) {
    // ⚠ Situação nova que esta tela não conhece NÃO vira número. Falha fechado.
    return { ...comum, valor: null, motivo: MOTIVO.SEM_LANCAMENTO };
  }
  return { ...comum, valor, motivo: null };
}

/**
 * A alíquota do card, com a fonte e o motivo da ausência.
 *
 * @param {object} p
 * @param {object|null} p.empresa a empresa da casca (o regime sai de `legacyCompany.regimeTributario`)
 * @param {object|null} p.linha   uma linha de `GET /client/companies/:id/aliquotas`
 */
export function aliquotaDoPainel({ empresa, linha }) {
  // ⚠ O REGIME CONTINUA VIAJANDO NA LEITURA, e não é sobra: a tela o usa para nomear a empresa em
  // outros lugares, e tirá-lo daqui obrigaria quem lê a alíquota a fazer uma segunda leitura da
  // empresa. O que ele NÃO faz mais é escolher a fonte.
  const regime = lerRegime(empresa);
  if (!linha) return { fonte: FONTE.LANCAMENTOS, valor: null, motivo: MOTIVO.SEM_DADOS, regime };
  return { ...porLancamentos(linha), regime };
}
