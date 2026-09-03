// Parser do "Recibo da negociação" da RFB — o documento que o contador tem na mão ao aderir a um
// parcelamento (e-CAC → Pagamentos e Parcelamentos).
//
// > Dono (01/09/2026): *"parcelamento do lucro presumido está completamente incorreto, nele devemos
// > provisionar cada tipo de imposto separado"* · *"em anexo um PDF do relatório de um parcelamento
// > (…) é apenas para ver de onde extraímos as informações"*.
//
// Função **PURA** (texto → dado), no molde de `parseDctfwebDeclaracao.js`. Não decide nada fiscal,
// não grava nada, não chama ninguém: estrutura o que está escrito no papel. Quem lê o PDF é o
// `pdf-parse` na rota, como já se faz no SITFIS e no comprovante de arrecadação.
//
// ⚠⚠ NADA AQUI É AUTORIDADE. O que sai daqui vai PREENCHER o wizard, e o contador confere e corrige
// cada campo antes de gravar — é ato contábil, e o PDF é sugestão com procedência.
//
// ── A ESTRUTURA, confirmada no recibo real (`003692667808887.pdf`, 3 páginas) ───────────────────
//
//   Parcelamento: 0211.00012.0104884128.26-54     Modalidade: Parcelamento Simplificado
//   Data da consolidação: 17/08/2026              Quantidade de parcelas: 60
//   Saldo a parcelar (BRL): 282.850,29            Valor das parcelas (BRL): 4.714,17
//
//   Dívida consolidada → Principal 232.466,40 · Multa 46.493,25 · Juros 3.890,64 · Total 282.850,29
//
//   Lista de débitos — uma linha por débito, nesta ordem de campos:
//     <código-sufixo> <período> <vencimento> BRL <saldo> <principal> <multa> <juros> <consolidado> <CNPJ>
//     2089-01  1º Trimestre/2026  30/04/2026  BRL 27.874,56  27.874,56  5.574,91  1.229,26  34.678,73  55…
//
// ⚠ O texto extraído põe **cada célula em uma linha** — a mesma armadilha do SITFIS. Por isso a
// leitura é por SEQUÊNCIA de campos a partir do código de receita, nunca por colunas de largura.

// ⚠ REUSO, NÃO CÓPIA: o mapa código→tributo e a leitura pelo NOME já existem e são a fonte do
// projeto. Uma segunda tabela aqui divergiria da do LP na primeira correção.
import { tributoDaDescricao } from "./parseDctfwebDeclaracao.js";

/** Código de receita (4 primeiros dígitos) → tributo. Mesmos valores de `parseDctfwebDeclaracao`. */
const CODIGO_TRIBUTO = Object.freeze({
  "8109": "PIS",
  "2172": "COFINS",
  "2089": "IRPJ",
  "2372": "CSLL",
  "3208": "IRRF",
});

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "27.874,56" → 27874.56. ⚠ Devolve `null` para o que não é número — nunca 0, que é afirmação. */
export function valorBR(bruto) {
  const s = String(bruto ?? "").trim().replace(/^BRL\s*/i, "");
  if (!/^-?[\d.]+,\d{2}$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? round2(n) : null;
}

/**
 * O índice da linha que CONTÉM um rótulo.
 *
 * ⚠ `includes`, nunca `startsWith`: no recibo real dois rótulos vêm COLADOS numa linha só
 * (`"Nome empresarial:Data da consolidação:"`). Ancorar pelo começo perdia a data em silêncio.
 */
function indiceDoRotulo(linhas, rotulo) {
  const alvo = rotulo.toLowerCase();
  return linhas.findIndex((l) => l.replace(/\s+/g, " ").trim().toLowerCase().includes(alvo));
}

/**
 * O tributo de um débito. Código primeiro (é o que o recibo sempre traz); o nome como reserva.
 *
 * ⚠ Código FORA do mapa devolve `null` — e `null` é a resposta certa, não um palpite. A linha
 * continua aparecendo na tela para o contador nomeá-la; inventar tributo aqui seria inventar em
 * qual conta a dívida dele entra.
 */
export function tributoDoDebito({ codigoReceita, descricao } = {}) {
  const quatro = String(codigoReceita || "").replace(/\D+/g, "").slice(0, 4);
  if (CODIGO_TRIBUTO[quatro]) return CODIGO_TRIBUTO[quatro];
  const pelaDescricao = descricao ? tributoDaDescricao(descricao) : null;
  return pelaDescricao && pelaDescricao !== "OUTROS_TRIBUTOS" ? pelaDescricao : null;
}

/**
 * Lê o recibo da negociação.
 *
 * @param {string} pdfTexto texto extraído do PDF (pdf-parse)
 * @returns {{
 *   numeroParcelamento: string|null, modalidade: string|null, dataConsolidacao: string|null,
 *   quantidadeParcelas: number|null, valorParcela: number|null,
 *   consolidado: {principal: number|null, multa: number|null, juros: number|null, total: number|null},
 *   debitos: Array, porTributo: Array, divergencias: Array<string>
 * }}
 */
export function parseReciboParcelamento(pdfTexto) {
  const linhas = String(pdfTexto || "").split("\n").map((l) => l.trim()).filter(Boolean);

  const numeroParcelamento = acharNumeroParcelamento(linhas);
  const modalidade = acharModalidade(linhas);
  const dataConsolidacao = acharData(linhas, "Data da consolidação");
  const { quantidadeParcelas, valorParcela, saldoAParcelar } = acharFormaDePagamento(linhas);
  const consolidado = acharConsolidado(linhas);
  const debitos = acharDebitos(linhas);
  const porTributo = agruparPorTributo(debitos);
  const divergencias = conferir({ consolidado, debitos, quantidadeParcelas, valorParcela });

  return {
    numeroParcelamento,
    modalidade,
    dataConsolidacao,
    quantidadeParcelas,
    valorParcela,
    saldoAParcelar,
    consolidado,
    debitos,
    porTributo,
    divergencias,
  };
}

/** `0211.00012.0104884128.26-54` — o formato do SIEFPAR, o mesmo que o SITFIS imprime. */
function acharNumeroParcelamento(linhas) {
  const i = linhas.findIndex((l) => /^Parcelamento:$/i.test(l));
  const candidatas = i >= 0 ? linhas.slice(i + 1, i + 4) : linhas;
  const achou = candidatas.find((l) => /^[\d.]{4,}[\d.\-]*\d{2}-\d{2}$/.test(l.trim()));
  return achou ? achou.trim() : null;
}

function acharModalidade(linhas) {
  const i = linhas.findIndex((l) => /^Modalidade:/i.test(l));
  if (i === -1) return null;
  const mesmaLinha = linhas[i].replace(/^Modalidade:\s*/i, "").trim();
  if (mesmaLinha) return mesmaLinha;
  // ⚠ No recibo real a modalidade vem COLADA no nome empresarial na linha seguinte
  // ("Parcelamento SimplificadoSINTROPIA TECNOLOGIA LTDA"). Corta no primeiro CamelCase depois de
  // uma minúscula — mesmo idioma do "rótulo colado" que o SITFIS já trata.
  const seguinte = String(linhas[i + 1] || "").trim();
  const m = seguinte.match(/^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-Za-zà-úÀ-Ú]+?)*?)(?=[A-ZÀ-Ú]{2,}|$)/);
  return m ? m[1].trim() : seguinte || null;
}

function acharData(linhas, rotulo) {
  const i = indiceDoRotulo(linhas, rotulo);
  if (i === -1) return null;
  for (let j = i + 1; j <= i + 3 && j < linhas.length; j += 1) {
    const v = String(linhas[j] || "").trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  }
  return null;
}

/**
 * ⚠⚠ O BLOCO "FORMA DE PAGAMENTO" TEM RÓTULOS E VALORES DESENCONTRADOS, e ler cada rótulo pela
 * "linha seguinte" devolve o número do VIZINHO. Medido no recibo real, nesta ordem exata:
 *
 *   Forma de pagamento
 *   60                        ← Quantidade de parcelas
 *   282.850,29                ← Saldo a parcelar
 *   Saldo a parcelar (BRL)
 *   Valor das parcelas (BRL)
 *   4.714,17                  ← Valor das parcelas
 *   Quantidade de parcelas
 *
 * É o layout de duas colunas achatado: os dois rótulos ficam ENTRE os três valores. A leitura
 * ancora nos rótulos e vai para o lado certo de cada um — o saldo é o último número ANTES de
 * "Saldo a parcelar", a parcela é o primeiro DEPOIS de "Valor das parcelas", e a quantidade é o
 * inteiro que precede o saldo.
 *
 * ⚠ Nada é derivado por divisão: `total ÷ parcelas` daria um número plausível e errado (a RFB
 * arredonda cada prestação), e é justamente esse número que vai descontar do passivo todo mês.
 */
function acharFormaDePagamento(linhas) {
  const iSaldo = indiceDoRotulo(linhas, "Saldo a parcelar");
  const iParcela = indiceDoRotulo(linhas, "Valor das parcelas");
  const vazio = { quantidadeParcelas: null, valorParcela: null, saldoAParcelar: null };
  if (iSaldo === -1 || iParcela === -1) return vazio;

  // O saldo: o número mais próximo ACIMA do rótulo dele.
  let saldoAParcelar = null;
  let iValorSaldo = -1;
  for (let j = iSaldo - 1; j >= Math.max(0, iSaldo - 4); j -= 1) {
    const v = valorBR(linhas[j]);
    if (v !== null) { saldoAParcelar = v; iValorSaldo = j; break; }
  }

  // A parcela: o número mais próximo ABAIXO do rótulo dela.
  let valorParcela = null;
  for (let j = iParcela + 1; j <= Math.min(linhas.length - 1, iParcela + 4); j += 1) {
    const v = valorBR(linhas[j]);
    if (v !== null) { valorParcela = v; break; }
  }

  // A quantidade: o inteiro logo acima do valor do saldo.
  let quantidadeParcelas = null;
  const inicio = iValorSaldo === -1 ? iSaldo : iValorSaldo;
  for (let j = inicio - 1; j >= Math.max(0, inicio - 4); j -= 1) {
    const v = String(linhas[j] || "").trim();
    if (/^\d{1,3}$/.test(v)) { quantidadeParcelas = Number(v); break; }
  }

  return { quantidadeParcelas, valorParcela, saldoAParcelar };
}

/** O bloco "Dívida consolidada" — Principal · Multa · Juros · Total, cada um com seu rótulo. */
function acharConsolidado(linhas) {
  const i = linhas.findIndex((l) => /^D[íi]vida consolidada$/i.test(l.trim()));
  const escopo = i === -1 ? linhas : linhas.slice(i, i + 20);
  const doRotulo = (rotulo) => {
    const k = escopo.findIndex((l) => new RegExp(`^${rotulo}\\s*\\(BRL\\)$`, "i").test(l.trim()));
    return k === -1 ? null : valorBR(escopo[k + 1]);
  };
  return {
    principal: doRotulo("Principal"),
    multa: doRotulo("Multa"),
    juros: doRotulo("Juros"),
    total: doRotulo("Total"),
  };
}

/**
 * A lista de débitos.
 *
 * ⚠ A leitura é por SEQUÊNCIA a partir do código de receita: `<código> <período> <vencimento>
 * BRL <saldo> <principal> <multa> <juros> <consolidado>`. Um débito que não render os quatro
 * valores é DESCARTADO da lista e denunciado em `divergencias` — nunca completado por suposição.
 */
function acharDebitos(linhas) {
  const debitos = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const m = String(linhas[i]).trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) continue;
    const periodo = String(linhas[i + 1] || "").trim();
    const vencimento = String(linhas[i + 2] || "").trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(vencimento)) continue;
    // A célula "Saldo originário" vem como "BRL 27.874,56"; os quatro valores seguem depois dela.
    const principal = valorBR(linhas[i + 4]);
    const multa = valorBR(linhas[i + 5]);
    const juros = valorBR(linhas[i + 6]);
    const total = valorBR(linhas[i + 7]);
    if (principal === null || total === null) continue;
    debitos.push({
      codigoReceita: `${m[1]}-${m[2]}`,
      codigo: m[1],
      tributo: tributoDoDebito({ codigoReceita: m[1], descricao: periodo }),
      periodo,
      vencimento,
      principal,
      multa: multa ?? 0,
      juros: juros ?? 0,
      total,
    });
  }
  return debitos;
}

/**
 * Agrupa e SOMA por tributo, guardando os períodos — é como o contador escreve o histórico:
 * *"VR REF PARC CSLL 1.TRIM.03/2025, 2.TRIM.06/2025 E 3.TRIM.09/2025 PARC EM 60 PARCELAS"*.
 *
 * ⚠ Débito sem tributo reconhecido NÃO é jogado num balde "outros": ele vira um grupo próprio com
 * `tributo: null`, para aparecer na tela pedindo nome. Somá-lo a outro seria perder a dívida dele.
 */
export function agruparPorTributo(debitos) {
  const porChave = new Map();
  for (const d of debitos || []) {
    const chave = d.tributo || `__SEM_TRIBUTO__${d.codigo}`;
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        tributo: d.tributo,
        codigo: d.codigo,
        principal: 0,
        multa: 0,
        juros: 0,
        total: 0,
        periodos: [],
      });
    }
    const g = porChave.get(chave);
    g.principal = round2(g.principal + d.principal);
    g.multa = round2(g.multa + d.multa);
    g.juros = round2(g.juros + d.juros);
    g.total = round2(g.total + d.total);
    if (d.periodo && !g.periodos.includes(d.periodo)) g.periodos.push(d.periodo);
  }
  return [...porChave.values()];
}

/**
 * ⚠⚠ A CONTAGEM NÃO É PROVA — a conferência é de VALOR, e é ela que separa "li o recibo" de
 * "li o recibo direito". Um débito perdido e outro duplicado dariam a mesma quantidade de linhas.
 *
 * ⚠ Divergência NÃO aborta: o recibo é a fonte, e recusá-lo deixaria o contador sem caminho. Ela
 * volta NOMEADA e a tela avisa antes de gravar — quem decide é ele.
 */
function conferir({ consolidado, debitos, quantidadeParcelas, valorParcela }) {
  const avisos = [];
  const soma = (campo) => round2((debitos || []).reduce((s, d) => s + (Number(d[campo]) || 0), 0));
  const compara = (rotulo, doBloco, dosDebitos) => {
    if (doBloco === null || !debitos.length) return;
    if (Math.abs(round2(doBloco - dosDebitos)) > 0.02) {
      avisos.push(
        `${rotulo}: a lista de débitos soma ${dosDebitos.toFixed(2)} e o bloco "Dívida consolidada" `
        + `diz ${doBloco.toFixed(2)}.`,
      );
    }
  };
  compara("Principal", consolidado.principal, soma("principal"));
  compara("Multa", consolidado.multa, soma("multa"));
  compara("Juros", consolidado.juros, soma("juros"));
  compara("Total", consolidado.total, soma("total"));

  // ⚠ O produto `parcelas × valor` é o que faz o passivo ZERAR na última parcela (decisão do dono:
  // *"o valor da parcela é que desconta do 588"*). Conferi-lo aqui é conferir a premissa contábil
  // do contrato inteiro. Tolerância de 1 centavo por parcela: a RFB arredonda cada prestação.
  if (consolidado.total !== null && quantidadeParcelas && valorParcela) {
    const produto = round2(quantidadeParcelas * valorParcela);
    if (Math.abs(round2(produto - consolidado.total)) > round2(quantidadeParcelas * 0.01) + 0.02) {
      avisos.push(
        `Parcelas: ${quantidadeParcelas} × ${valorParcela.toFixed(2)} = ${produto.toFixed(2)}, `
        + `mas o total consolidado é ${consolidado.total.toFixed(2)}.`,
      );
    }
  }

  const semTributo = (debitos || []).filter((d) => !d.tributo);
  if (semTributo.length) {
    const codigos = [...new Set(semTributo.map((d) => d.codigoReceita))].join(", ");
    avisos.push(`Código de receita não reconhecido: ${codigos}. Informe o tributo dessas linhas.`);
  }
  return avisos;
}
