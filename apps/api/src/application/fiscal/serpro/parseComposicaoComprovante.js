// A COMPOSIÇÃO POR CÓDIGO DE RECEITA do comprovante de arrecadação (PAGTOWEB/COMPARRECADACAO72).
//
// PARA QUE SERVE
// `parseComprovanteArrecadacao.js` lê o bloco "Totais" — principal/multa/juros do documento
// INTEIRO. Isso basta para confirmar pagamento, e não basta para dar baixa: um DARF traz vários
// códigos de receita, e numa parcela de parcelamento eles têm naturezas contábeis DIFERENTES.
//
//   2089 IRPJ - Lucro presumido            163,40   32,66   14,52   210,58   ← dívida consolidada
//   0380 TJLP - IRPJ - Parcelamentos            -       -   11,78    11,78   ← encargo do mês
//
// Somar os dois como "juros" superestima a despesa e deixa o passivo errado. Quem separa é o
// CÓDIGO, e é isso que este parser entrega.
//
// ⚠ POR QUE NÃO REUSAR `parseArrecadacaoComposicao` (parseArrecadacao.js)
// Ele faz a mesma coisa para a GUIA, onde o pdf-parse quebra código e valores em linhas
// separadas. No COMPROVANTE vem tudo na MESMA linha, e ele procura os valores na linha seguinte —
// medido contra 5 comprovantes reais, isso desloca TODOS os itens em um: o 2089 fica com os
// valores do 0380, e o último código fica com a linha de Totais. Vinte e três itens, todos
// plausíveis e todos errados. São dois layouts, e cada um precisa do seu leitor.
//
// ⚠ O CABEÇALHO SAI INVERTIDO da extração:
//     "CódigoDescriçãoTotalJurosMultaPrincipal"
// enquanto os valores vêm em ordem VISUAL (principal · multa · juros · total). A ordem aqui está
// fixada por EVIDÊNCIA — cada item fecha `principal + multa + juros == total` nos 5 documentos —
// e nunca deve ser derivada do cabeçalho. É a mesma inversão já documentada para o comprovante em
// `apps/api/CLAUDE.md`.
//
// ⚠ E A SOMA NÃO PEGA TROCA ENTRE JUROS E MULTA (o total é o mesmo nos dois sentidos). Por isso a
// ordem é evidência, não autoverificação. Mesma disciplina de `parseComprovanteArrecadacao`.

// Um token de coluna: um valor no formato BR, ou "-" quando a coluna NÃO tem valor.
const TOKEN = String.raw`(?:-|\d[\d.]*,\d{2})`;

// ⚠ OS QUATRO TOKENS VÊM COLADOS NO FIM DA LINHA, sem separador:
//     "2089IRPJ - Lucro presumido163,4032,6614,52210,58"
//     "0380TJLP - IRPJ - Parcelamentos--11,7811,78"
// Ancorar no fim é o que permite separar a denominação (que também contém "-") dos valores.
const RE_CAUDA = new RegExp(`(${TOKEN})(${TOKEN})(${TOKEN})(${TOKEN})$`);

// Código de receita: 4 dígitos no início da linha. As linhas de extensão ("01 - TJLP IRPJ -
// PARCELAMENTO") têm 2 dígitos e não casam — que é o que as mantém fora da composição.
const RE_ITEM = /^(\d{4})(.*)$/;

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * "1.104,17" → 1104.17 · "-" → 0.
 *
 * ⚠ O TRAÇO É POSICIONAL, e é por isso que ele precisa virar token em vez de ser ignorado: em
 * "--11,7811,78" são ele os dois primeiros tokens, e é só por causa deles que 11,78 cai em JUROS
 * e não em PRINCIPAL. Descartá-lo deslocaria a linha inteira — silenciosamente, com valores que
 * continuariam somando certo.
 */
function valorDoToken(token) {
  const t = String(token || "").trim();
  if (t === "-") return 0;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? r2(n) : null;
}

function lerCauda(resto) {
  const m = RE_CAUDA.exec(resto);
  if (!m) return null;
  const [principal, multa, juros, total] = m.slice(1, 5).map(valorDoToken);
  if ([principal, multa, juros, total].some((v) => v === null)) return null;
  return { principal, multa, juros, total, denominacao: resto.slice(0, m.index).trim() || null };
}

/**
 * Lê a composição por código de UM comprovante de arrecadação.
 *
 * @param {string} pdfTexto texto do PDF (pdf-parse)
 * @returns {{itens: Array, totais: object|null, confiavel: boolean, motivo: string|null}}
 *
 * ⚠ `confiavel: false` DEVOLVE `itens: []`. Composição meio lida é pior que composição nenhuma:
 * cada item vira um lançamento contábil em conta própria, e um item deslocado não parece errado —
 * parece um tributo com valor diferente. Sem confiança, o consumidor cai no caminho do total
 * (`parseComprovanteArrecadacao`), que continua correto.
 */
export function parseComposicaoComprovante(pdfTexto) {
  const texto = String(pdfTexto || "");
  const recusa = (motivo) => ({ itens: [], totais: null, confiavel: false, motivo });

  const inicio = texto.search(/Composição do Documento de Arrecadação/i);
  if (inicio < 0) return recusa("sem_secao_de_composicao");

  // UM comprovante por vez: a composição termina no "Totais". Sem esse corte, um PDF com vários
  // comprovantes emendados leria a composição de todos como se fosse de um documento só.
  const linhas = texto.slice(inicio).split(/\r?\n/);
  const iTotais = linhas.findIndex((l) => /^\s*Totais\s*$/i.test(l));
  if (iTotais < 0) return recusa("sem_linha_de_totais");

  const itens = [];
  for (const linha of linhas.slice(0, iTotais)) {
    const m = RE_ITEM.exec(linha.trim());
    if (!m) continue;
    const cauda = lerCauda(m[2]);
    if (!cauda) return recusa(`item_ilegivel:${m[1]}`);
    const { denominacao, principal, multa, juros, total } = cauda;

    // ⚠ CADA ITEM FECHA SOZINHO. É a verificação forte: se a denominação terminar em dígito, a
    // captura da cauda pode comer um dígito a mais no principal — e é exatamente aqui que isso
    // aparece, porque o total do próprio item deixa de bater.
    if (r2(principal + multa + juros) !== total) return recusa(`item_nao_fecha:${m[1]}`);
    itens.push({ codigo: m[1], denominacao, principal, multa, juros, total });
  }

  if (!itens.length) return recusa("nenhum_item_reconhecido");

  // A linha "Totais" fica sozinha; os valores vêm na SEGUINTE.
  const totais = lerCauda(String(linhas[iTotais + 1] || "").trim());
  if (!totais) return recusa("totais_ilegiveis");

  // ⚠ E A SOMA DOS ITENS TEM DE BATER COM O "Totais" IMPRESSO. Item perdido continua fechando
  // sozinho; só o confronto com o total do documento denuncia a ausência.
  for (const campo of ["principal", "multa", "juros", "total"]) {
    const soma = r2(itens.reduce((acc, it) => acc + it[campo], 0));
    if (soma !== totais[campo]) return recusa(`soma_nao_confere:${campo}`);
  }

  return {
    itens,
    totais: { principal: totais.principal, multa: totais.multa, juros: totais.juros, total: totais.total },
    confiavel: true,
    motivo: null,
  };
}
