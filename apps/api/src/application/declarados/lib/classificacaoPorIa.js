// A CLASSIFICAÇÃO DE LANÇAMENTOS POR IA — a regra PURA (02/09/2026). Nada aqui toca banco nem rede.
//
// > Dono: *"a IA é um botão em cima de tudo, ao clicar ela passa por todos os lançamentos colocando
// > os códigos que ela decide, baseado nos históricos, no treino que ela tem, baseado no plano de
// > contas da empresa. As regras são superiores à IA (…) ela deve colocar os códigos apenas naqueles
// > que não entraram a regra."*
//
// ⚠⚠ AS QUATRO TRAVAS, e cada uma é uma função deste arquivo:
//
//   1. **Quem vai para a IA** (`linhasParaIa`): só a linha em que NEM regra NEM histórico
//      responderam (`SEM_SUGESTAO.NADA_CONHECIDO`). `DIVIDIDO` e `FORA_DA_FAIXA` ficam de FORA —
//      ali alguém sabe e recusou por motivo; decidir por cima seria a IA arbitrando um conflito
//      humano. Regra > histórico > IA, e a ordem é do dono.
//   2. **O que a IA pode escolher** (`catalogoDeContas`): só conta ANALÍTICA do plano DESTA empresa;
//      para o crédito, só DISPONIBILIDADE (caixa/banco — *"continua sendo caixa/banco"*, 29/08).
//   3. **O que a IA respondeu** (`lerResposta`): cada conta é CONFERIDA contra o plano com as MESMAS
//      guardas de `montarLancamento` — existe, é analítica, não é ambígua, crédito é disponibilidade.
//      Conta que o modelo inventou ⇒ recusada COM MOTIVO, nunca vira sugestão.
//   4. **O que sai daqui é PROPOSTA**: `{ debito, credito, justificativa }` por linha. Quem grava é o
//      serviço, em colunas próprias (`*Ia`) — nunca `contaAplicada`. Nenhum lançamento nasce disto.
//
// ⚠⚠ SEM "CONFIANÇA" NUMÉRICA, e é decisão: o número que um modelo dá para a própria certeza não é
// calibrado — soa preciso e não é. Um "92%" na tela treinaria o contador a confirmar sem ler. O que
// viaja é a JUSTIFICATIVA, em texto, que ele consegue conferir.
//
// ⚠ O bloco ESTÁVEL do prompt não carrega data, hora, nome de empresa nem plano — só assim ele é
// idêntico entre chamadas e o cache do modelo vale (a mesma disciplina de `promptDoAssistente.js`).

import { SEM_SUGESTAO } from "./motorDeSugestao.js";
import { ehContaSintetica } from "../../accounting/lib/gateContaSintetica.js";
import { entraNoFluxoDeCaixa } from "../../accounting/lib/disponibilidades.js";
import { ESTADO } from "./estadosDeclarado.js";

/** Para o registro em `chamadas_ia` — o teto do escritório precisa saber para onde o dinheiro foi. */
export const FINALIDADE = "classificacao_lancamentos";

/**
 * ⚠ Quantas linhas por chamada. Cada linha volta com duas contas e uma justificativa curta; 40 cabe
 * com folga em `IA_MAX_TOKENS_CLASSIFICACAO` e ainda deixa o modelo ver PADRÕES (a mesma
 * descrição repetida três vezes no lote é informação).
 */
export const LOTE_MAXIMO = 40;

/** Tamanho máximo da justificativa gravada — é uma frase para o contador ler, não um laudo. */
export const JUSTIFICATIVA_MAXIMA = 300;

/** Por que uma proposta do modelo foi RECUSADA. Vocabulário FECHADO; cada um aponta um conserto. */
export const MOTIVO_RECUSA = Object.freeze({
  /** O modelo devolveu um id que não estava no lote — ou repetiu um. */
  LINHA_DESCONHECIDA: "linha_desconhecida",
  /** Sem conta de débito, não há proposta. */
  SEM_DEBITO: "sem_debito",
  /** A conta não existe no plano desta empresa — o modelo inventou, ou usou outro plano. */
  CONTA_FORA_DO_PLANO: "conta_fora_do_plano",
  /** Conta SINTÉTICA (de agregação) não recebe lançamento — `montarLancamento` recusaria. */
  CONTA_SINTETICA: "conta_sintetica",
  /** Duas contas do plano têm o mesmo `codigoCompleto`; o sistema não escolhe entre elas. */
  CONTA_AMBIGUA: "conta_ambigua",
  /** O crédito não é caixa/banco — o lançamento afirma de onde o dinheiro saiu. */
  CREDITO_NAO_E_DISPONIBILIDADE: "credito_nao_e_disponibilidade",
});

export const FRASE_DA_RECUSA = Object.freeze({
  [MOTIVO_RECUSA.LINHA_DESCONHECIDA]: "A IA respondeu sobre uma linha que não estava no lote.",
  [MOTIVO_RECUSA.SEM_DEBITO]: "A IA não indicou a conta de débito.",
  [MOTIVO_RECUSA.CONTA_FORA_DO_PLANO]: "A IA indicou uma conta que não existe no plano desta empresa.",
  [MOTIVO_RECUSA.CONTA_SINTETICA]: "A IA indicou uma conta sintética (de agregação), que não recebe lançamento.",
  [MOTIVO_RECUSA.CONTA_AMBIGUA]: "Duas contas do plano têm o mesmo código completo — o sistema não escolhe entre elas.",
  [MOTIVO_RECUSA.CREDITO_NAO_E_DISPONIBILIDADE]: "A IA indicou como crédito uma conta que não é caixa nem banco.",
});

const texto = (v) => String(v ?? "").trim();

/** Só o que ainda pode virar lançamento — o resto não tem conta a propor. */
const ESTADOS_LANCAVEIS = Object.freeze([ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR]);

/**
 * ⚠⚠ QUEM VAI PARA A IA — só onde NINGUÉM sabe.
 *
 * `sugestao.conta` preenchida = regra ou histórico responderam: a IA não opina. `sugestao.motivo`
 * diferente de `NADA_CONHECIDO` = alguém SABE e recusou por motivo (regras brigando, valor fora da
 * faixa, conta da regra torta): também não é caso de IA — é caso de o contador olhar a regra.
 *
 * ⚠ `sugestao` ausente (`null`) é lido como "ninguém sabe": é o que `listarFila` devolve quando o
 * motor não teve o que dizer — e é o caso de toda linha nova.
 */
export function linhasParaIa(itens) {
  return (Array.isArray(itens) ? itens : []).filter((d) => {
    if (!d || !ESTADOS_LANCAVEIS.includes(d.estado)) return false;
    const s = d.sugestao;
    if (s?.conta) return false;
    const motivo = s?.motivo ?? SEM_SUGESTAO.NADA_CONHECIDO;
    return motivo === SEM_SUGESTAO.NADA_CONHECIDO;
  });
}

/** Parte um conjunto em lotes de `LOTE_MAXIMO`. Determinístico — a ordem da fila é a ordem do lote. */
export function emLotes(linhas, tamanho = LOTE_MAXIMO) {
  const t = Math.max(1, Number(tamanho) || LOTE_MAXIMO);
  const lotes = [];
  for (let i = 0; i < linhas.length; i += t) lotes.push(linhas.slice(i, i + t));
  return lotes;
}

/**
 * O índice do plano por `codigoCompleto`, com a MESMA leitura de ambiguidade de
 * `formaDoLancamento.indicePorCodigoCompleto`: dois reduzidos para o mesmo completo ⇒ ambíguo.
 */
function indiceDoPlano(plano) {
  const indice = new Map();
  for (const c of Array.isArray(plano) ? plano : []) {
    const completo = texto(c?.codigoCompleto);
    const reduzido = texto(c?.codigo);
    if (!completo || !reduzido) continue;
    const atual = indice.get(completo);
    if (atual && atual.reduzido !== reduzido) indice.set(completo, { ...atual, ambiguo: true });
    else if (!atual) indice.set(completo, { reduzido, conta: c, ambiguo: false });
  }
  return indice;
}

/**
 * ⚠⚠ O QUE A IA PODE ESCOLHER — o catálogo que vai no pedido.
 *
 * Só conta ANALÍTICA com `codigoCompleto` (as sem código não podem receber lançamento por aqui —
 * `montarLancamento` recusa). O crédito é um subconjunto: só DISPONIBILIDADE. E o catálogo é
 * NOMEADO (código + nome): é pelo nome que o modelo entende o que a conta é.
 */
export function catalogoDeContas(plano) {
  const vistas = new Set();
  const debitos = [];
  for (const c of Array.isArray(plano) ? plano : []) {
    const completo = texto(c?.codigoCompleto);
    if (!completo || vistas.has(completo)) continue;
    if (ehContaSintetica(c)) continue;
    vistas.add(completo);
    debitos.push({ codigoCompleto: completo, codigo: texto(c.codigo), nome: texto(c.nome) });
  }
  const creditos = debitos.filter((d) => entraNoFluxoDeCaixa({ codigoCompleto: d.codigoCompleto }));
  return { debitos, creditos };
}

/**
 * ⚠ Os EXEMPLOS da memória — o "treino" que o dono citou. `AccountingHistorico` guarda o REDUZIDO;
 * aqui ele é traduzido para o completo pelo plano, e o par que não traduz fica de fora (um exemplo
 * com conta inexistente ensinaria o modelo a inventar).
 * ⚠ Ordenados por uso e limitados: o prompt não é um despejo da memória inteira.
 */
export function exemplosDaMemoria(historico, plano, { maximo = 60 } = {}) {
  const porReduzido = new Map();
  for (const c of Array.isArray(plano) ? plano : []) {
    const reduzido = texto(c?.codigo);
    const completo = texto(c?.codigoCompleto);
    if (reduzido && completo && !porReduzido.has(reduzido)) porReduzido.set(reduzido, completo);
  }
  const lista = (Array.isArray(historico) ? historico : [])
    .map((h) => ({
      descricao: texto(h?.text),
      debito: porReduzido.get(texto(h?.contaDebito)) || null,
      credito: porReduzido.get(texto(h?.contaCredito)) || null,
      usos: Number(h?.usageCount || 0),
    }))
    .filter((e) => e.descricao && e.debito)
    .sort((a, b) => b.usos - a.usos)
    .slice(0, Math.max(0, Number(maximo) || 0));
  return lista.map(({ descricao, debito, credito }) => ({ descricao, debito, credito }));
}

/**
 * ⚠⚠ O BLOCO ESTÁVEL DO PROMPT — idêntico entre chamadas, byte a byte. Sem data, sem empresa, sem
 * plano: tudo que varia vai na mensagem. É o que torna o cache do modelo barato, e há teste
 * comparando duas montagens.
 */
export const SYSTEM_ESTAVEL = `Você é o assistente de classificação contábil de um escritório de contabilidade brasileiro. Sua tarefa: para cada despesa listada, indicar a conta contábil de DÉBITO (a natureza do gasto) e, opcionalmente, a de CRÉDITO (de onde o dinheiro saiu), escolhendo SOMENTE dentro do catálogo de contas fornecido na mensagem.

REGRAS ABSOLUTAS
- Use apenas códigos completos que apareçam LITERALMENTE no catálogo. Nunca invente, adapte ou "corrija" um código. Se nenhuma conta do catálogo servir, não proponha essa linha.
- O crédito, quando indicado, tem de estar na lista de CRÉDITOS do catálogo (caixa/banco). Se não souber de onde o dinheiro saiu, deixe o crédito como null — o caixa é o padrão.
- Os exemplos do histórico são decisões anteriores do contador desta empresa: quando a descrição casar com um exemplo, siga o exemplo.
- Você propõe; o contador confirma. Não afirme certeza. A justificativa é uma frase curta dizendo POR QUE aquela conta cabe (ex.: "serviço de nuvem = despesa com software"), sem porcentagens.
- Nada além de JSON na resposta.

FORMATO DA RESPOSTA (JSON estrito, sem markdown):
{"propostas":[{"id":"<id da linha>","debito":"<codigoCompleto>","credito":"<codigoCompleto ou null>","justificativa":"<frase curta>"}]}
Inclua apenas as linhas para as quais você tem uma proposta. Cada id no máximo uma vez.`;

/**
 * Monta o pedido de UM lote: o `system` estável e a mensagem com catálogo, exemplos e linhas.
 * ⚠ As linhas viajam enxutas — id, descrição, CNPJ, valor, competência. Nada do razão, nada da empresa.
 */
export function montarPedido({ linhas, plano, historico = [] }) {
  const catalogo = catalogoDeContas(plano);
  const exemplos = exemplosDaMemoria(historico, plano);
  const itens = (Array.isArray(linhas) ? linhas : []).map((d) => ({
    id: texto(d?.id),
    descricao: texto(d?.descricaoOriginal),
    cnpjFornecedor: texto(d?.cnpjFornecedor) || null,
    valor: d?.valorAjustado ?? d?.valor ?? null,
    competencia: texto(d?.competencia) || null,
  }));

  const conteudo = [
    "CATÁLOGO DE CONTAS (débito — qualquer uma destas):",
    JSON.stringify(catalogo.debitos),
    "",
    "CONTAS DE CRÉDITO PERMITIDAS (caixa/banco):",
    JSON.stringify(catalogo.creditos),
    "",
    exemplos.length
      ? `EXEMPLOS DO HISTÓRICO DESTA EMPRESA (descrição → débito/crédito já usados pelo contador):\n${JSON.stringify(exemplos)}`
      : "EXEMPLOS DO HISTÓRICO DESTA EMPRESA: nenhum ainda.",
    "",
    "LINHAS A CLASSIFICAR:",
    JSON.stringify(itens),
  ].join("\n");

  return {
    system: SYSTEM_ESTAVEL,
    messages: [{ role: "user", content: conteudo }],
    idsEsperados: itens.map((i) => i.id),
  };
}

/** Tira cercas de markdown que alguns modelos insistem em pôr, e acha o primeiro objeto JSON. */
function extrairJson(textoBruto) {
  const t = texto(textoBruto).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const inicio = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(t.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

/**
 * ⚠⚠ O QUE A IA RESPONDEU, CONFERIDO — cada proposta passa pelas mesmas guardas de `montarLancamento`.
 *
 * Devolve `{ propostas, recusadas, ilegivel }`. `ilegivel: true` = a resposta não era JSON no
 * formato pedido — nenhuma proposta, e o serviço relata (não é o mesmo que "nenhuma linha").
 *
 * @param {string} textoBruto o texto da resposta do modelo
 * @param {{ plano: Array, idsEsperados: string[] }} ctx
 */
export function lerResposta(textoBruto, { plano, idsEsperados }) {
  const dados = extrairJson(textoBruto);
  const lista = Array.isArray(dados?.propostas) ? dados.propostas : null;
  if (!lista) return { propostas: [], recusadas: [], ilegivel: true };

  const indice = indiceDoPlano(plano);
  const esperados = new Set((idsEsperados || []).map(texto));
  const vistos = new Set();
  const propostas = [];
  const recusadas = [];
  const recusa = (id, motivo) => recusadas.push({ id: id || null, motivo, frase: FRASE_DA_RECUSA[motivo] });

  for (const p of lista) {
    const id = texto(p?.id);
    if (!id || !esperados.has(id) || vistos.has(id)) { recusa(id, MOTIVO_RECUSA.LINHA_DESCONHECIDA); continue; }
    vistos.add(id);

    const debito = texto(p?.debito);
    if (!debito) { recusa(id, MOTIVO_RECUSA.SEM_DEBITO); continue; }
    const d = indice.get(debito);
    if (!d) { recusa(id, MOTIVO_RECUSA.CONTA_FORA_DO_PLANO); continue; }
    if (d.ambiguo) { recusa(id, MOTIVO_RECUSA.CONTA_AMBIGUA); continue; }
    if (ehContaSintetica(d.conta)) { recusa(id, MOTIVO_RECUSA.CONTA_SINTETICA); continue; }

    const creditoTexto = p?.credito == null ? "" : texto(p.credito);
    let credito = null;
    if (creditoTexto && creditoTexto.toLowerCase() !== "null") {
      const c = indice.get(creditoTexto);
      if (!c) { recusa(id, MOTIVO_RECUSA.CONTA_FORA_DO_PLANO); continue; }
      if (c.ambiguo) { recusa(id, MOTIVO_RECUSA.CONTA_AMBIGUA); continue; }
      if (ehContaSintetica(c.conta)) { recusa(id, MOTIVO_RECUSA.CONTA_SINTETICA); continue; }
      // ⚠⚠ A invariante do caixa: o lançamento AFIRMA de onde o dinheiro saiu. Só disponibilidade.
      if (!entraNoFluxoDeCaixa(c.conta)) { recusa(id, MOTIVO_RECUSA.CREDITO_NAO_E_DISPONIBILIDADE); continue; }
      credito = creditoTexto;
    }

    propostas.push({
      id,
      debito,
      credito,
      justificativa: texto(p?.justificativa).slice(0, JUSTIFICATIVA_MAXIMA) || null,
    });
  }

  return { propostas, recusadas, ilegivel: false };
}
