// A REPARTIÇÃO POR TRIBUTO DO EXTRATO DO PGDAS-D — o resto da linha que já era lida e descartada.
//
// ─── O QUE ESTA LINHA É, E POR QUE ELA NÃO É NOVA ───────────────────────────────────────────
//
// `parsePgdasDeclarationPdf` já casava a linha de tributos do extrato para achar o **Total** (que
// vira `CompanyMonthlyCircular.dasTotal`) e descartava os oito valores anteriores na mesma
// instrução — `values[values.length - 1]`. A coluna `ApuracaoSnapshot.tributosPorTributo` existe no
// schema desde sempre para receber esses oito, e estava **morta**.
//
// ⚠ ESTE MÓDULO NÃO INTRODUZ UMA SEGUNDA LEITURA DA MESMA LINHA. Ele é a leitura — devolve o
// `total` (com a MESMA regra de hoje) e a `repartição` (com uma regra mais estrita), e o serviço
// passou a consumir os dois daqui. Duas leituras da mesma linha divergiriam na primeira correção
// de leiaute, e aí `dasTotal` e a repartição descreveriam extratos diferentes — o defeito que mais
// se repetiu neste projeto.
//
// ─── ⚠ O TEXTO É COLADO, E ISSO FOI MEDIDO, NÃO SUPOSTO ─────────────────────────────────────
//
// O `rawText` (pdf-parse) traz o cabeçalho **sem espaço nenhum** e os nove números **sem separador**,
// em duas linhas:
//
//     IRPJCSLLCOFINSPIS/PasepINSS/CPPICMSIPIISSTotal
//     28,8025,2092,3020,02312,480,000,00241,20720,00
//
// Medido em produção (17/08/2026, `scripts/diag-tributos-extrato-pgdas.mjs`, só leitura): **82 de
// 82** extratos guardados casam a linha, **82/82** partem em exatamente 9 valores, **82/82** têm a
// soma dos oito igual ao último, e **82/82** batem com o `dasTotal` já gravado — zero divergências.
// É a mesma forma colada de `parseComprovanteArrecadacao.js` (`"178,3112,941,78193,03"`), e é por
// isso que o grupo `([\d.,]+)` da regex nunca se parte no meio.
//
// ─── ⚠ A SOMA É A AUTOVERIFICAÇÃO, E ELA NÃO PEGA PERMUTAÇÃO ────────────────────────────────
//
// Molde de `parseComprovanteArrecadacao`, que *"só devolve o rateio se principal+juros+multa ==
// total"*: aqui a repartição só existe se a soma dos oito bater com o último valor (1 centavo de
// tolerância). Não batendo, **não há repartição** — nunca uma parcial, que seria pior que a
// ausência, porque parece completa.
//
// Mas trocar ISS por IPI dá **a mesma soma**. A ordem dos oito vem do CABEÇALHO IMPRESSO, e este
// projeto já tem o precedente de um documento em que os valores saem na ordem **inversa** da
// impressa (PAGTOWEB: `principal · MULTA · JUROS · total`, ver `apps/api/CLAUDE.md`). Por isso a
// leitura é **posicional declarada**, e a coluna carrega **`ordemVerificada: false`** — o
// `verificadoTrial: false` desta coluna (regra 3: marcar o não-verificado).
//
// ⚠ **Sinal a favor, que NÃO é prova:** em toda amostra medida `ICMS` e `IPI` vieram `0,00`, o que
// é coerente com empresa de serviço e seria coincidência improvável sob permutação. Confirmar
// contra o PDF é ato de contador — enquanto não for feito, a flag continua `false`.
//
// ─── ⚠ ISTO NÃO PARTE O DAS, E NÃO É ALÍQUOTA ───────────────────────────────────────────────
//
// Regra escrita do dono: *"a guia do Simples vem desmembrada nos impostos, porém contabilizamos
// junto, como DAS Simples Nacional."* O DAS é **UM** lançamento contábil. Isto aqui é dado de
// LEITURA e AUDITORIA: não gera lançamento, não gera provisão, não muda a forma de nenhum
// lançamento existente. E não se deriva alíquota nenhuma daqui — a repartição é de VALORES.

const RE_LINHA_TRIBUTOS =
  /IRPJ\s*CSLL\s*COFINS\s*PIS\S*Pasep\s*INSS\S*CPP\s*ICMS\s*IPI\s*ISS\s*Total\s*([\d.,]+)/i;

// Mesma regex de moeda do serviço. Copiada de propósito junto da de cima: as duas descrevem UMA
// leitura, e separá-las faria uma evoluir sem a outra.
const RE_MOEDA_G = /\d+(?:\.\d{3})*,\d{2}/g;

/**
 * Os oito rótulos, **verbatim como o cabeçalho do extrato os imprime**.
 *
 * ⚠ `PIS/Pasep` e `INSS/CPP` ficam com a barra. O comentário do `schema.prisma` sugere
 * `{ …, PIS, CPP, … }` — decisão do dono (17/08/2026): renomear é **nomenclatura fiscal**, e a
 * escolha que não inventa nada é copiar a fonte. Se ele decidir encurtar, muda aqui e no backfill,
 * num lugar só. A palavra final é dele.
 */
export const ROTULOS_DO_CABECALHO = Object.freeze([
  "IRPJ", "CSLL", "COFINS", "PIS/Pasep", "INSS/CPP", "ICMS", "IPI", "ISS",
]);

/** Vocabulário fechado. "Não deu" tem nome; nunca vira valor provável. */
export const MOTIVO = Object.freeze({
  SEM_LINHA_DE_TRIBUTOS: "SEM_LINHA_DE_TRIBUTOS",
  VALOR_ILEGIVEL: "VALOR_ILEGIVEL",
  /** Partiu num número de valores diferente de 9 (8 tributos + Total). */
  CONTAGEM_INESPERADA: "CONTAGEM_INESPERADA",
  /** Os oito não somam o último. O split colado não é confiável — não se grava nada. */
  SOMA_NAO_FECHA: "SOMA_NAO_FECHA",
});

/** Tolerância da autoverificação, em reais. Mesma de `parseComprovanteArrecadacao`. */
export const TOLERANCIA = 0.01;

function parseValorBR(txt) {
  const n = Number(String(txt).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Lê a linha de tributos do extrato.
 *
 * ⚠ **`total` e `reparticao` têm exigências DIFERENTES, de propósito.** `total` é o último valor,
 * pela regra que já está em produção e cuja saída (`dasTotal`) foi conferida contra a guia real —
 * ele **não** depende da soma fechar. `reparticao` exige 9 valores E a soma. Amarrar o total à
 * autoverificação faria um extrato de leiaute novo perder o `dasTotal` que hoje ele acerta:
 * apertar a leitura do número que já funciona é regressão, não rigor.
 *
 * @param {string} texto  o `rawText` do extrato (pdf-parse)
 * @returns {{
 *   total: number|null,
 *   valores: number[],
 *   reparticao: Record<string, number>|null,
 *   soma: number|null,
 *   somaConfere: boolean,
 *   motivo: string|null,
 * }}
 */
export function parseTributosPgdas(texto) {
  const vazio = {
    total: null, valores: [], reparticao: null, soma: null, somaConfere: false, motivo: null,
  };

  const m = String(texto || "").match(RE_LINHA_TRIBUTOS);
  if (!m) return { ...vazio, motivo: MOTIVO.SEM_LINHA_DE_TRIBUTOS };

  const brutos = m[1].match(RE_MOEDA_G) || [];
  const valores = brutos.map(parseValorBR);
  if (!valores.length || valores.some((v) => v == null)) {
    return { ...vazio, motivo: MOTIVO.VALOR_ILEGIVEL };
  }

  // O total sai daqui para baixo, sempre — é a regra de hoje, preservada letra por letra.
  const total = r2(valores[valores.length - 1]);

  if (valores.length !== ROTULOS_DO_CABECALHO.length + 1) {
    return { ...vazio, total, valores, motivo: MOTIVO.CONTAGEM_INESPERADA };
  }

  const partes = valores.slice(0, -1);
  const soma = r2(partes.reduce((s, v) => s + v, 0));
  if (Math.abs(soma - total) > TOLERANCIA) {
    return { ...vazio, total, valores, soma, motivo: MOTIVO.SOMA_NAO_FECHA };
  }

  const reparticao = {};
  ROTULOS_DO_CABECALHO.forEach((rotulo, i) => { reparticao[rotulo] = r2(partes[i]); });

  return { total, valores, reparticao, soma, somaConfere: true, motivo: null };
}

/**
 * A FORMA DA COLUNA `ApuracaoSnapshot.tributosPorTributo` — aprovada pelo dono em 17/08/2026.
 *
 * Devolve `null` quando não há repartição confiável: **o que não fecha não chega ao banco**.
 *
 * Por que cada campo existe:
 *  · `fonte` — nunca "SERPRO_SIMULACAO". Este número sai do PDF do EXTRATO (a declaração que já
 *    existe na Receita), não da simulação. É a mesma disciplina de procedência das três colunas de
 *    DAS: quem escreveu, e a partir de quê.
 *  · `total` — duplicado com `dasTotal` **de propósito**: é a âncora que permite reconferir a
 *    repartição sem reparsear o PDF (que pode nem existir mais — o volume do Railway é efêmero).
 *  · `somaConfere` — só existe como `true`. Guardar `false` seria guardar uma repartição que o
 *    próprio registro desmente.
 *  · `ordemVerificada` — sempre `false` até um contador conferir contra o PDF. Ver o topo.
 */
export function tributosPorTributoParaColuna(leitura, { lidoEm = new Date() } = {}) {
  if (!leitura?.reparticao || !leitura.somaConfere) return null;
  return {
    fonte: "EXTRATO_PGDAS_D",
    lidoEm: (lidoEm instanceof Date ? lidoEm : new Date(lidoEm)).toISOString(),
    total: leitura.total,
    somaConfere: true,
    ordemVerificada: false,
    tributos: { ...leitura.reparticao },
  };
}
