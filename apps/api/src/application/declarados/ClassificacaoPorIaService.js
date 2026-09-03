// ⚠⚠ A CLASSIFICAÇÃO DE LANÇAMENTOS POR IA — a LIGAÇÃO (02/09/2026). O botão «Sugerir contas com
// IA» da Conferência chega aqui, e daqui saem PROPOSTAS gravadas em colunas próprias.
//
// > Dono: *"a IA é um botão em cima de tudo, ao clicar ela passa por todos os lançamentos colocando
// > os códigos que ela decide (…) apenas naqueles que não entraram a regra."*
//
// ⚠⚠ O QUE ESTE SERVIÇO NUNCA FAZ, e há teste para cada um:
//   - NUNCA escreve `contaAplicada`, `contaCredito` nem `estado` — isso é o ATO, e é do contador
//     (`aplicarTransicao`). O que ele escreve são `contaSugeridaIa`/`creditoSugeridoIa`/
//     `justificativaIa`/`sugeridaIaModelo`/`sugeridaIaEm`, que a tela desenha como proposta.
//   - NUNCA toca em linha que tem sugestão de regra ou de histórico — `linhasParaIa` decide, e o
//     `where` do `updateMany` reconfere o estado no instante da escrita.
//   - NUNCA chama o modelo sem a guarda autorizar (falha fechado: sem chave, teto, ou contagem que
//     falhou ⇒ nada é chamado e o relatório diz o motivo).
//   - NUNCA deixa uma chamada sem registro: `concluirChamadaIa` roda deu certo ou não.
//   - NUNCA derruba a fila: erro do modelo vira relatório, nunca exceção para a rota.
//
// ⚠ A regra (quem vai, catálogo, leitura conferida) mora em `lib/classificacaoPorIa.js` e não é
// reescrita aqui. Este arquivo só liga: fila → lotes → guarda → modelo → leitura → gravação.

import { prisma } from "../../infrastructure/db/prisma.js";
import { INTEGRACAO_IA_CLASSIFICACAO, IA_MAX_TOKENS_CLASSIFICACAO, IA_MODELO, log as logPadrao } from "../../config.js";
import { AssistenteClient, traduzirErro } from "../assistente/AssistenteClient.js";
import { FINALIDADE_IA, autorizarChamadaIa, concluirChamadaIa } from "../assistente/GuardaIaService.js";
import { custoEstimadoCentavos } from "../assistente/precosIa.js";
import { listarFila } from "./DeclaradoService.js";
import { memoriaDaEmpresa, planoDaEmpresa } from "./RegraService.js";
import { ESTADO } from "./lib/estadosDeclarado.js";
import { LOTE_MAXIMO, emLotes, lerResposta, linhasParaIa, montarPedido } from "./lib/classificacaoPorIa.js";

/** Por que a classificação NÃO rodou (o relatório nomeia; a tela traduz). */
export const RECUSA_CLASSIFICACAO = Object.freeze({
  /** A flag do ambiente está OFF — o servidor recusa, não a tela. */
  DESLIGADA: "ia_classificacao_desligada",
});

/** A página máxima de `listarFila` — a fila inteira é lida em páginas de 200. */
const POR_PAGINA = 200;
/** Teto de páginas: 200 × 50 = 10.000 linhas. Acima disso a pergunta é outra (e não é de IA). */
const MAXIMO_DE_PAGINAS = 50;

/** Só o que ainda pode virar lançamento recebe proposta — e o `where` reconfere isso na escrita. */
const ESTADOS_LANCAVEIS = Object.freeze([ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR]);

/**
 * Lê a fila inteira da empresa (na competência, se houver), página a página.
 * ⚠ `listarFila` já traz `sugestao` derivada por linha — é ela que `linhasParaIa` lê.
 */
async function filaInteira({ portalClientId, competencia, client }) {
  const itens = [];
  for (let pagina = 1; pagina <= MAXIMO_DE_PAGINAS; pagina += 1) {
    const r = await listarFila({ portalClientId, competencia, estados: ESTADOS_LANCAVEIS, pagina, porPagina: POR_PAGINA, client });
    itens.push(...(r?.itens || []));
    if (!r?.itens?.length || itens.length >= (r.total || 0)) break;
  }
  return itens;
}

/**
 * ⚠⚠ Grava as propostas de UM lote. Colunas `*Ia` e nada mais.
 * O `where` leva `portalClientId` (escopo) e `estado in lançáveis` (a linha pode ter sido lançada ou
 * recusada entre a leitura e a escrita — aí não há mais o que propor).
 */
async function gravarPropostas({ propostas, portalClientId, modelo, agora, client }) {
  let gravadas = 0;
  for (const p of propostas) {
    const r = await client.lancamentoDeclarado.updateMany({
      where: { id: p.id, portalClientId: String(portalClientId), estado: { in: ESTADOS_LANCAVEIS } },
      data: {
        contaSugeridaIa: p.debito,
        creditoSugeridoIa: p.credito ?? null,
        justificativaIa: p.justificativa ?? null,
        sugeridaIaModelo: modelo,
        sugeridaIaEm: agora,
      },
    });
    gravadas += Number(r?.count || 0);
  }
  return gravadas;
}

/**
 * ⚠⚠ O BOTÃO. Passa pela fila da empresa, separa quem não tem regra nem histórico, e pede ao modelo
 * uma proposta de débito/crédito para cada — em lotes, cada lote autorizado pela guarda.
 *
 * @param {object} p
 * @param {string} p.portalClientId
 * @param {string|null} [p.competencia] `AAAA-MM`, `sem-competencia`, ou nulo = todas
 * @param {Date} [p.agora]        o carimbo de `sugeridaIaEm` — INJETADO, como no resto do módulo
 * @param {object} [p.client]     prisma
 * @param {object} [p.cliente]    um `AssistenteClient` (injetável para teste)
 * @param {boolean} [p.ligado]    a flag (injetável para teste)
 * @param {object} [p.guarda]     `{ autorizar, concluir }` (injetável para teste)
 * @param {object} [p.log]
 * @returns relatório: `{ ok, recusa, semLinhas, linhasOlhadas, linhasEnviadas, lotes, propostas,
 *          gravadas, recusadas: [{id, motivo, frase}], ilegiveis, erros: [{lote, codigo, mensagem}],
 *          recusadaPelaGuarda: {motivo, mensagem}|null, custoEstimadoCentavos, modelo }`
 */
export async function classificarFila({
  portalClientId,
  competencia = null,
  agora = new Date(),
  client = prisma,
  cliente = null,
  ligado = INTEGRACAO_IA_CLASSIFICACAO,
  guarda = { autorizar: autorizarChamadaIa, concluir: concluirChamadaIa },
  log = logPadrao,
} = {}) {
  const relatorio = {
    ok: true,
    recusa: null,
    semLinhas: false,
    linhasOlhadas: 0,
    linhasEnviadas: 0,
    lotes: 0,
    propostas: 0,
    gravadas: 0,
    recusadas: [],
    ilegiveis: 0,
    erros: [],
    recusadaPelaGuarda: null,
    custoEstimadoCentavos: 0,
    modelo: IA_MODELO,
  };

  // ⚠⚠ A FLAG É DO SERVIDOR. Um `curl` passaria por cima de um botão escondido.
  if (!ligado) return { ...relatorio, ok: false, recusa: RECUSA_CLASSIFICACAO.DESLIGADA };

  const itens = await filaInteira({ portalClientId, competencia, client });
  relatorio.linhasOlhadas = itens.length;

  const alvo = linhasParaIa(itens);
  if (!alvo.length) return { ...relatorio, semLinhas: true };

  // O plano e a memória são os MESMOS do motor — uma segunda consulta divergiria.
  const [plano, historico] = await Promise.all([
    planoDaEmpresa(portalClientId, client),
    memoriaDaEmpresa(portalClientId, client),
  ]);

  const modelo = cliente || new AssistenteClient({ maxTokens: IA_MAX_TOKENS_CLASSIFICACAO, log });
  const lotes = emLotes(alvo, LOTE_MAXIMO);

  for (let i = 0; i < lotes.length; i += 1) {
    const lote = lotes[i];

    // ⚠⚠ A GUARDA, POR LOTE — cada lote é uma chamada paga, e o teto pode chegar no meio.
    const autorizacao = await guarda.autorizar({ portalClientId, finalidade: FINALIDADE_IA.CLASSIFICACAO_LANCAMENTOS, agora, client, log });
    if (!autorizacao?.ok) {
      relatorio.recusadaPelaGuarda = { motivo: autorizacao?.motivo || null, mensagem: autorizacao?.mensagem || null, apartirDoLote: i + 1 };
      break;
    }

    const pedido = montarPedido({ linhas: lote, plano, historico });
    relatorio.lotes += 1;
    relatorio.linhasEnviadas += lote.length;

    let resposta;
    try {
      resposta = await modelo.responder({ system: pedido.system, messages: pedido.messages, ferramentas: [] });
    } catch (err) {
      const traduzido = traduzirErro(err);
      // ⚠ Registra SEMPRE — deu errado também custa (e conta contra o teto quando houve usage).
      await guarda.concluir(autorizacao.contexto, { usage: err?.usage || null, erroCodigo: traduzido?.codigo || "erro", erroMensagem: String(err?.message || "").slice(0, 300) }, { client, log });
      relatorio.erros.push({ lote: i + 1, codigo: traduzido?.codigo || "erro", mensagem: traduzido?.message || String(err?.message || "") });
      log?.warn?.({ portalClientId, lote: i + 1, err: err?.message }, "classificação por IA: o modelo falhou neste lote");
      continue;
    }

    await guarda.concluir(autorizacao.contexto, { usage: resposta?.usage || null, iteracoes: resposta?.iteracoes || 1, stopReason: resposta?.stopReason || null }, { client, log });
    if (resposta?.usage) relatorio.custoEstimadoCentavos += Number(custoEstimadoCentavos(resposta.usage, IA_MODELO) || 0);

    if (resposta?.recusou) {
      relatorio.erros.push({ lote: i + 1, codigo: "recusou", mensagem: "O modelo recusou responder este lote." });
      continue;
    }

    const leitura = lerResposta(resposta?.texto, { plano, idsEsperados: pedido.idsEsperados });
    if (leitura.ilegivel) {
      relatorio.ilegiveis += 1;
      relatorio.erros.push({ lote: i + 1, codigo: "resposta_ilegivel", mensagem: "A resposta do modelo não veio no formato pedido; nada foi gravado deste lote." });
      continue;
    }

    relatorio.propostas += leitura.propostas.length;
    relatorio.recusadas.push(...leitura.recusadas);
    relatorio.gravadas += await gravarPropostas({ propostas: leitura.propostas, portalClientId, modelo: IA_MODELO, agora, client });
  }

  return relatorio;
}
