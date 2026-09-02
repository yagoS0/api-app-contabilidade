// A FILA DE CONFERÊNCIA DE LANÇAMENTOS — as rotas do escritório.
//
// Montado em `/firm/companies/:companyId/*` (mergeParams).
//
//   GET  /conferencia?competencia=AAAA-MM|sem-competencia   a fila (+ resumo por estado)
//   GET  /conferencia/varredura                  as invariantes (SÓ LEITURA)
//   POST /conferencia/:declaradoId/informar-pagamento
//   POST /conferencia/:declaradoId/confirmar
//   POST /conferencia/:declaradoId/ajustar
//   POST /conferencia/:declaradoId/recusar
//   POST /conferencia/:declaradoId/reabrir
//   POST /conferencia/:declaradoId/desfazer
//   POST /conferencia/varrer-notas?desde=AAAA-MM-DD   as notas recebidas viram fila
//   GET/POST/DELETE /conferencia/varredura-automatica   trazer as notas sozinho, a partir de X
//   GET  /conferencia/casamentos                 debito do extrato x nota (SO SUGERE)
//   POST /conferencia/casamentos/fundir          o debito data a nota, e some absorvido
//   POST /conferencia/casamentos/absorver        a nota JA foi lancada: o debito so some
//
// ⚠⚠ NENHUMA REGRA MORA AQUI. Quem decide se um ato pode acontecer é
// `application/declarados/lib/estadosDeclarado.js`; quem monta o lançamento é
// `lib/formaDoLancamento.js`; quem grava é `DeclaradoService.js`. Este arquivo traduz HTTP e nada
// mais — reimplementar qualquer pedaço daria duas regras que divergem na primeira correção, e aqui
// a divergência sai como lançamento contábil errado.

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { dataCivilDe, dataCivilISO } from "../../utils/dataCivil.js";
import {
  COMPETENCIA_AUSENTE,
  DeclaradoRecusado,
  RECUSA_DO_SERVICO,
  absorverDebitoJaContabilizado,
  aplicarTransicao,
  fundirPagamentoNaNota,
  listarFila,
  sugestoesDePagamento,
  varrerInvariantes,
} from "../../application/declarados/DeclaradoService.js";
import {
  RegraRecusada,
  RECUSA_DA_REGRA,
  alternarRegra,
  criarRegraManual,
  definirLancamentoAutomatico,
  listarRegras,
} from "../../application/declarados/RegraService.js";
import {
  desligarVarreduraAutomatica,
  lerVarreduraAutomatica,
  ligarVarreduraAutomatica,
  varrerNotasDaEmpresa,
} from "../../application/declarados/VarreduraDeNotasService.js";
import {
  desfazerLancadosPorRegra,
  extratoDeLancadosPorRegra,
  lancarPorRegraNaEmpresa,
} from "../../application/declarados/LancamentoPorRegraService.js";
import { listarMapeamentos, salvarMapeamento } from "../../application/declarados/MapeamentoExtratoService.js";
import { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO } from "../../application/declarados/lib/estadosDeclarado.js";
import {
  ESTADO_DA_SERIE,
  reverterExclusaoDoCliente,
  autoAtivarSeriesEstaveis,
  cicloDeHoje,
  listarSeries,
} from "../../application/fluxo/SerieRecorrenteService.js";
import {
  SaidaRecusada,
  RECUSA_DA_SAIDA,
  decidirSaidaAvulsa,
  lancarSaidaAvulsa,
  listarSaidasPendentes,
} from "../../application/fluxo/SaidaAvulsaService.js";

/**
 * ⚠ Tabela que ainda não existe (P2021) e MODELO que o Prisma não conhece (P2022/P2023 numa
 * migration pela metade). As migrations desta casa são ato do DONO, então este estado é normal —
 * e ele não pode derrubar a contagem que a barra de Lançamentos pede.
 */
const tabelaAusenteNaContagem = (e) => ["P2021", "P2022"].includes(e?.code);

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

/**
 * O HTTP de cada recusa.
 *
 * ⚠ `404` só para "não existe nesta empresa"; `409` para o mês fechado (é conflito de estado do
 * mundo, e tem conserto: reabrir); `400` para o resto, que é o pedido estando errado. Devolver 500
 * para qualquer um deles apagaria a diferença entre "você não pode" e "quebrou".
 */
const STATUS_DA_RECUSA = Object.freeze({
  [RECUSA_DO_SERVICO.NAO_ENCONTRADO]: 404,
  [RECUSA_DO_SERVICO.MES_FECHADO]: 409,
});

function decimalParaTexto(v) {
  if (v == null) return null;
  return typeof v === "object" && typeof v.toString === "function" ? v.toString() : String(v);
}

/**
 * ⚠⚠ A DIVERGÊNCIA DE DATAS DA ABSORÇÃO — a única perda daquele ato, e por isso ela SAI na resposta.
 *
 * ⚠ `diverge: null` é *"não sei"* (faltou uma das datas) e nunca vira `false`. As duas afirmações
 * são diferentes: "conferi, é o mesmo dia" e "não consegui conferir".
 * ⚠ As datas saem como DIA, pelo mesmo motivo de `serializar`.
 */
function serializarDivergencia(d) {
  if (!d) return null;
  return {
    diverge: d.diverge,
    dias: d.dias,
    dataDoLancamento: d.dataDoLancamento ? dataCivilISO(d.dataDoLancamento) : null,
    dataDoExtrato: d.dataDoExtrato ? dataCivilISO(d.dataDoExtrato) : null,
  };
}

/**
 * ⚠⚠ A CANDIDATA DO CASAMENTO — e cada campo daqui existe porque a tela decide com ele.
 *
 * `podeFundir` e `podeAbsorver` são DOIS VERBOS DIFERENTES e nunca são verdade juntos: a nota em
 * aberto se casa, a nota já lançada se absorve. Campo fora do serializador some sem erro nenhum, e
 * este projeto já foi mordido três vezes por isso — sem eles a tela ofereceria «Casar» numa nota
 * contabilizada, e o clique voltaria recusado.
 */
function serializarCandidata(c) {
  return {
    nota: serializar(c.nota),
    pista: c.pista,
    frase: c.frase,
    leitura: c.leitura,
    podeFundir: c.podeFundir,
    podeAbsorver: c.podeAbsorver,
    fraseDaCandidata: c.fraseDaCandidata,
    divergencia: serializarDivergencia(c.divergencia),
  };
}

/**
 * ⚠ As datas saem como DIA (`AAAA-MM-DD`), nunca como ISO completa. Elas são datas civis, e mandar
 * o instante faz o navegador convertê-lo para o fuso do usuário — o deslize de um dia que este
 * projeto já pagou duas vezes (ver `utils/dataCivil.js`).
 */
function serializar(d) {
  return {
    id: d.id,
    origem: d.origem,
    estado: d.estado,
    tipo: d.tipo,
    valor: decimalParaTexto(d.valor),
    valorAjustado: decimalParaTexto(d.valorAjustado),
    competencia: d.competencia,

    notaRecebidaId: d.notaRecebidaId,
    dataDocumento: d.dataDocumento ? dataCivilISO(d.dataDocumento) : null,
    cnpjFornecedor: d.cnpjFornecedor,
    descricaoOriginal: d.descricaoOriginal,
    detalheServico: d.detalheServico,

    dataPagamento: d.dataPagamento ? dataCivilISO(d.dataPagamento) : null,
    // ⚠ A PROCEDÊNCIA DA DATA VAI PARA A TELA. É ela que permite dizer "declarado" em vez de deixar
    // o contador achar que o banco confirmou o pagamento.
    origemPagamento: d.origemPagamento,

    contaSugerida: d.contaSugerida,
    contaAplicada: d.contaAplicada,
    // ⚠⚠ A CONTA DE CRÉDITO ESCOLHIDA. `null` = ninguém escolheu, e vale o caixa cravado — a tela
    // precisa da distinção para mostrar "Caixa (padrão)" em vez de um campo vazio, que se lê como
    // "faltou preencher". ⚠ Campo fora do serializador some sem erro nenhum: este módulo já pagou
    // isso três vezes.
    contaCredito: d.contaCredito ?? null,
    accountingEntryId: d.accountingEntryId,
    regraId: d.regraId,
    motivoRecusa: d.motivoRecusa,

    // ⚠ O PRÉ-VOO. A tela desabilita o botão COM O MOTIVO em vez de oferecer um clique que o
    // servidor vai recusar com 409 — o precedente do menu SERPRO: *"a resposta do POST chegaria
    // tarde demais"*. ⚠ Ele NÃO é a guarda: quem recusa continua sendo `aplicarTransicao`, que
    // enxerga o estado do momento do clique.
    mesFechado: Boolean(d.mesFechado),

    // ⚠ O contador confere a fila contra o documento PELO NÚMERO. `null` quando a nota foi apagada
    // (a FK é `SetNull`) — a tela desabilita o link com o motivo, nunca o esconde.
    nota: d.notaRecebida
      ? {
          numero: d.notaRecebida.numero,
          serie: d.notaRecebida.serie,
          chaveAcesso: d.notaRecebida.chaveAcesso,
          tipo: d.notaRecebida.type,
        }
      : null,

    // ⚠⚠ A SUGESTÃO DE CONTA (Fase C). Ela é DERIVADA por `listarFila` a cada leitura, e este
    // serializador a descartava — a Fase C inteira era calculada e jogada fora antes de sair da
    // API. Achado por auditoria em 25/08/2026.
    //
    // ⚠ `serializar` monta uma lista FECHADA de chaves (de propósito: `...d` mandaria colunas
    // internas ao navegador). O preço é este: campo novo que não for acrescentado AQUI não existe
    // para a tela, e não há erro nenhum — ele só some.
    sugestao: d.sugestao ?? null,

    decididoPor: d.decididoPor,
    decididoEm: d.decididoEm,
    criadoEm: d.criadoEm,
    // ⚠⚠ HOJE ISTO É SEMPRE `[]`: `AnexoDeclarado` não tem escritor — nenhuma rota, nenhum serviço.
    // A tela NÃO pode oferecer "anexar comprovante"; desenhar o botão prometeria um caminho que não
    // existe. O campo viaja para o contrato não mudar quando ele existir.
    anexos: d.anexos || [],
  };
}

function responderRecusa(res, erro, log) {
  if (erro instanceof DeclaradoRecusado) {
    const status = STATUS_DA_RECUSA[erro.codigo] || 400;
    return res.status(status).json({ ok: false, error: erro.codigo, message: erro.frase });
  }
  /**
   * ⚠⚠ A FILA DAS SAÍDAS DO CLIENTE ENTROU NESTA TELA EM 29/08/2026, e ela recusa com OUTRA classe
   * de erro. Sem este ramo, `saida_ja_decidida` (uma recusa NOSSA, que a pessoa pode entender)
   * viraria um 500 "não foi possível concluir" — o defeito de engolir o motivo.
   *
   * ⚠ Os status são os mesmos critérios da outra rota: 503 quando a TABELA não existe (a migration
   * é ato do dono), 404 para o que não existe NESTA empresa, 400 para o que a pessoa pode corrigir.
   */
  /**
   * ⚠⚠ A RECUSA DA REGRA MANUAL — sem este ramo, `credito_nao_e_disponibilidade` viraria um 500
   * "não foi possível concluir", e o contador não saberia QUE conta trocar.
   * ⚠ 503 só quando a TABELA não existe; o resto é 400, porque a pessoa pode corrigir.
   */
  if (erro instanceof RegraRecusada) {
    // ⚠ Três status, três consertos: 503 = a migration não foi aplicada (não é culpa de quem
    // clicou); 404 = a regra não é desta empresa; 400 = o pedido está errado e dá para corrigir.
    const status = erro.codigo === RECUSA_DA_REGRA.INDISPONIVEL
      ? 503
      : erro.codigo === RECUSA_DA_REGRA.NAO_ENCONTRADA ? 404 : 400;
    return res.status(status).json({ ok: false, error: erro.codigo, message: erro.frase });
  }
  if (erro instanceof SaidaRecusada) {
    const status = erro.codigo === RECUSA_DA_SAIDA.INDISPONIVEL ? 503
      : erro.codigo === RECUSA_DA_SAIDA.NAO_ENCONTRADA ? 404
        : 400;
    return res.status(status).json({ ok: false, error: erro.codigo, message: erro.frase });
  }
  log?.error?.({ err: erro }, "conferencia_falhou");
  // ⚠ A aba não pode quebrar calada: erro nomeado, e o motivo no log.
  return res.status(500).json({ ok: false, error: "conferencia_falhou", message: "Não foi possível concluir." });
}

/**
 * Lê o bloco de pagamento do corpo.
 *
 * ⚠⚠ A DATA VEM DO CORPO, NUNCA DO RELÓGIO. `new Date()` aqui gravaria a data do CLIQUE como a
 * data em que o dinheiro saiu — o lançamento credita o caixa, então isso é uma afirmação falsa
 * sobre quando a empresa pagou. Ausente, o campo simplesmente não viaja, e a regra pura recusa.
 *
 * ⚠ `origemPagamento` NÃO tem padrão. Prova (`OFX`) e declaração (`DECLARADO_PELO_CONTADOR`) não
 * podem virar a mesma coisa por omissão de quem chamou.
 */
function lerPagamentoDoCorpo(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, "dataPagamento")) return {};
  const bruta = body.dataPagamento;
  if (bruta === null) return { dataPagamento: null, origemPagamento: null };
  return {
    // ⚠ `dataCivilDe` é ESTRITO: recusa formato americano, mês sem zero e dia que não existe.
    // `null` daqui cai na recusa nomeada da regra, e não vira "hoje".
    dataPagamento: dataCivilDe(bruta),
    origemPagamento: body.origemPagamento ?? null,
  };
}

export function createConferenciaRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  // ── LEITURA ────────────────────────────────────────────────────────────────────────────────

  // ⚠ ROTA LITERAL ANTES DA DE CURINGA — senão `/conferencia/varredura` seria lido como um
  // `declaradoId`. Mesmo cuidado de `annual` e `fechamento` em `routes/firm/index.js`.
  router.get("/conferencia/varredura", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const r = await varrerInvariantes({ portalClientId: String(req.params.companyId) });
      return res.json({ ok: true, ...r });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ QUANTAS PENDÊNCIAS A CONFERÊNCIA TEM — e a resposta soma TRÊS filas (29/08/2026).
   *
   * Ela nasceu porque a Conferência deixou de ser aba e virou um BOTÃO na barra de Lançamentos
   * (decisão do dono: *"essa aba deve estar dentro dos lançamentos, como um botão com aviso quando
   * há conferência a ser feita, como notas recebidas"*). O botão precisa de um número, e a barra de
   * Lançamentos **não pode carregar a fila inteira para desenhar um selo**.
   *
   * ⚠⚠ **AS TRÊS FILAS, e contar só a primeira é o defeito que esta rota existe para não cometer:**
   *
   *   1. **`LancamentoDeclarado`** aguardando pagamento ou a conferir — a fila clássica;
   *   2. **séries `PENDENTE`** — o que o detector achou e o que o cliente declarou;
   *   3. **saídas avulsas `PENDENTE`** — o que o cliente escreveu no fluxo dele.
   *
   * Um número que conte só a (1) faria o contador **nunca ver o que o cliente digitou** — que é
   * justamente o que o pedido do dono existe para resolver.
   *
   * ⚠ **CADA FILA VOLTA SEPARADA, além do total.** O rótulo do botão usa o total; a tela de dentro
   * usa as partes. Um número só faria "3 pendências" ser indistinguível de "3 notas para conferir",
   * e as três pedem trabalhos diferentes.
   *
   * ⚠⚠ **NENHUMA DAS TRÊS DERRUBA AS OUTRAS.** Tabela ausente (a migration é ato do dono) devolve
   * zero **e se declara** em `indisponiveis` — o selo some, mas a barra de Lançamentos não quebra.
   * Sem isso, uma migration não aplicada tiraria do ar a aba mais usada do sistema.
   */
  router.get("/conferencia/pendencias", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const indisponiveis = [];

    /**
     * ⚠⚠ A COMPETÊNCIA É OPCIONAL, E É ELA QUE CONSERTA O "19 QUE NÃO APARECE" (01/09/2026).
     *
     * > Dono, sobre a ALBATROZ em produção: *"aparecem 19 a lançar mas ao abrir não aparece isso
     * > tudo"*.
     *
     * O selo do botão **não filtra por competência, de propósito** — a fila é o que espera alguém
     * em QUALQUER mês, e contar só o mês visível esconderia a nota de julho que ninguém conferiu.
     * Já a TELA abre filtrada pela competência. Os dois estão certos e **descrevem populações
     * diferentes**, e é essa diferença que se lia como número errado.
     *
     * Com `?competencia=`, esta rota devolve TAMBÉM o recorte — e é a tela que passa a dizer
     * quantos ficaram fora do mês aberto. ⚠ O selo continua chamando SEM competência: o número
     * dele não muda.
     */
    const competencia = req.query.competencia ? String(req.query.competencia) : null;
    if (competencia && competencia !== COMPETENCIA_AUSENTE && !COMPETENCIA_RE.test(competencia)) {
      return res.status(400).json({
        ok: false,
        error: "competencia_invalida",
        message: `Use AAAA-MM, ou "${COMPETENCIA_AUSENTE}" para as que chegaram sem competência.`,
      });
    }

    // ⚠ `count`, nunca `findMany().length`: a barra pede este número a cada abertura da aba, e
    // trazer a fila inteira para medir o tamanho dela é o custo que esta rota existe para evitar.
    const declarados = await prisma.lancamentoDeclarado
      .count({
        where: {
          portalClientId,
          estado: { in: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR] },
        },
      })
      .catch((e) => {
        if (!tabelaAusenteNaContagem(e)) throw e;
        indisponiveis.push("declarados");
        return 0;
      });

    const series = await prisma.serieRecorrente
      .count({ where: { portalClientId, estado: ESTADO_DA_SERIE.PENDENTE } })
      .catch((e) => {
        if (!tabelaAusenteNaContagem(e)) throw e;
        indisponiveis.push("series");
        return 0;
      });

    // ⚠ O DELEGATE pode não existir (o `prisma generate` que não rodou — EPERM no Windows com o
    // servidor de dev de pé). É estado REAL, e `undefined.count` derrubaria a resposta inteira.
    const saidas = !prisma.saidaAvulsaCliente?.count
      ? (indisponiveis.push("saidas"), 0)
      : await prisma.saidaAvulsaCliente
        .count({ where: { portalClientId, estado: "PENDENTE" } })
        .catch((e) => {
          if (!tabelaAusenteNaContagem(e)) throw e;
          indisponiveis.push("saidas");
          return 0;
        });

    /**
     * ⚠⚠ QUANTOS DELES ESTÃO NO MÊS QUE A TELA ABRIU. `null` quando ninguém perguntou — e `null`
     * não é zero: "não pedi o recorte" e "não há nenhum neste mês" são respostas diferentes, e
     * desenhar as duas iguais faria a tela afirmar que o mês está limpo sem ter contado.
     * ⚠ `sem-competencia` é RECORTE, não competência: `competencia = null` no banco. Sem este ramo
     * a nota que chegou sem competência ficaria fora dos dois lados da conta.
     */
    const declaradosNaCompetencia = !competencia || indisponiveis.includes("declarados")
      ? null
      : await prisma.lancamentoDeclarado
        .count({
          where: {
            portalClientId,
            estado: { in: [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR] },
            competencia: competencia === COMPETENCIA_AUSENTE ? null : competencia,
          },
        })
        .catch((e) => {
          if (!tabelaAusenteNaContagem(e)) throw e;
          return null;
        });

    return res.json({
      ok: true,
      total: declarados + series + saidas,
      /**
       * ⚠⚠ `aLancar` × `noFluxo` — a separação que o rótulo do botão exigia (01/09/2026).
       *
       * > Dono: *"tudo que virar lançamento deve entrar no fluxo, mas nem tudo do fluxo
       * > necessariamente deve ser um lançamento"*.
       *
       * O botão se chama **"A lançar"** e mostrava `total`, que soma as TRÊS filas — sendo que
       * recorrências e saídas do cliente **nunca viram lançamento** (o próprio serviço delas diz
       * *"CONFIRMAR NÃO LANÇA NADA"*). O número prometia um trabalho que não existia.
       * ⚠ `total` FICA, e não é sobra: ele é a resposta a *"quanto há para decidir nesta tela?"*.
       * O que mudou é que quem desenha "A lançar" usa `aLancar`.
       */
      aLancar: declarados,
      noFluxo: series + saidas,
      declaradosNaCompetencia,
      declaradosForaDaCompetencia:
        declaradosNaCompetencia == null ? null : declarados - declaradosNaCompetencia,
      declarados,
      series,
      saidas,
      // ⚠ A lista de quem não pôde ser contado viaja: "0 pendências" e "não consegui contar" são
      // respostas diferentes, e a segunda não pode se disfarçar da primeira.
      indisponiveis,
    });
  });

  /**
   * ⚠⚠ O QUE O CLIENTE MEXEU NAS SAÍDAS QUE ELE NÃO CRIOU — a QUARTA fila (31/08/2026).
   *
   * > Dono: *"pode ser excluído uma saída pelo usuário. ou alterado a data"* e, sobre esta tela:
   * > *"planeje e pense, como isso vai ser mostrado ao contador."*
   *
   * ⚠⚠ **POR QUE ELA EXISTE.** A linha de 3.200 da SINCROSAT não foi o cliente que criou — foi a
   * regra dos 10%, sozinha. Se ele a exclui e ela simplesmente some, o escritório continua achando
   * que a projeção existe, e o fluxo que os dois olham deixa de ser o mesmo fluxo. Aqui ele vê o
   * que era, o que virou, quem fez e quando — e pode desfazer.
   *
   * ⚠⚠ **ELA NÃO ENTRA NA CONTAGEM ÂMBAR** de `/conferencia/pendencias`, de propósito. As três
   * filas de lá pedem uma DECISÃO do contador; esta é CIÊNCIA. Âmbar permanente treina o olho a
   * ignorar a cor que significa "falta fazer" — é a regra que já governa aquele botão.
   *
   * ⚠ Sem `minRole`: ler é leitura, como as outras filas. Quem desfaz tem piso próprio, abaixo.
   */
  router.get("/conferencia/mexidas-do-cliente", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const linhas = await prisma.serieRecorrente.findMany({
        where: {
          portalClientId,
          // ⚠ Só o que o CLIENTE tocou. A série que o contador confirmou e ninguém mexeu não é
          // notícia — encher esta fila com o estado normal é o mesmo que apagá-la.
          OR: [{ excluidaPeloClienteEm: { not: null } }, { diaDefinidoEm: { not: null } }],
        },
        orderBy: { atualizadaEm: "desc" },
      });
      return res.json({
        ok: true,
        indisponivel: false,
        mexidas: linhas.map((l) => ({
          id: l.id,
          rotulo: l.rotulo,
          contraparteDoc: l.contraparteDoc,
          estadoDaSerie: l.estado,
          origem: l.origem,
          // ⚠ O QUE ERA: a estimativa pelas emissões continua guardada em `baseDaObservacao`, então
          // a tela mostra "dia 4 → dia 10" e não só "dia 10". Um "depois" sem "antes" não é notícia.
          diaEstimado: Number.isInteger(l.baseDaObservacao?.dia) ? l.baseDaObservacao.dia : null,
          diaDoCliente: l.diaDoMes ?? null,
          diaDefinidoPor: l.diaDefinidoPor || null,
          diaDefinidoEm: l.diaDefinidoEm ? l.diaDefinidoEm.toISOString() : null,
          excluidaPeloClienteEm: l.excluidaPeloClienteEm ? l.excluidaPeloClienteEm.toISOString() : null,
          excluidaPeloClientePor: l.excluidaPeloClientePor || null,
        })),
      });
    } catch (e) {
      // ⚠ Tabela/coluna ausente devolve LISTA VAZIA + `indisponivel`, nunca 503 — a mesma assimetria
      // deliberada das outras filas: derrubar esta leitura tiraria do ar a tela inteira.
      if (tabelaAusenteNaContagem(e)) return res.json({ ok: true, indisponivel: true, mexidas: [] });
      log.error({ err: e }, "Falha ao listar o que o cliente mexeu");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /**
   * ⚠ O DESFAZER — a série excluída pelo cliente volta ao fluxo dele.
   *
   * Sem ele, a exclusão seria definitiva na prática: o contador veria o que aconteceu e não teria o
   * que fazer a respeito. ⚠ Ele NÃO toca no `estado` — a decisão do contador sobre a série continua
   * a que era antes de o cliente mexer.
   * ⚠ `ACCOUNTANT`, como toda escrita desta tela.
   */
  router.post("/conferencia/mexidas-do-cliente/:serieId/desfazer", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      await reverterExclusaoDoCliente({
        portalClientId: String(req.params.companyId),
        serieId: String(req.params.serieId),
      });
      return res.json({ ok: true });
    } catch (e) {
      if (e?.codigo) return res.status(400).json({ ok: false, error: e.codigo, message: e.message });
      log.error({ err: e }, "Falha ao desfazer a exclusão do cliente");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /**
   * ⚠⚠ AS SAÍDAS QUE O CLIENTE ESCREVEU — a fila do contador (29/08/2026).
   *
   * > Dono: *"essas saídas que o cliente digitar aparecem para o contador na aba de conferência"*.
   *
   * ⚠ **LER É LEITURA**: sem `minRole`, como a fila dos declarados. Quem decide tem piso próprio,
   * na rota de escrita abaixo.
   * ⚠ Tabela ou delegate ausentes devolvem LISTA VAZIA + `indisponivel`, nunca 503: esta leitura
   * convive com as outras na mesma tela, e derrubá-la tiraria do ar também o que o declarado tem a
   * dizer. É a assimetria deliberada de `listarSaidasPendentes`.
   */
  router.get("/conferencia/saidas-do-cliente", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const r = await listarSaidasPendentes({ portalClientId: String(req.params.companyId) });
      return res.json({
        ok: true,
        indisponivel: r.indisponivel === true,
        saidas: (r.saidas || []).map((s) => ({
          id: s.id,
          // ⚠ Data CIVIL na resposta (`YYYY-MM-DD`), nunca o ISO com hora: ela é o DIA que a pessoa
          // escolheu, e o ISO deslocaria o dia no fuso de quem lê.
          data: dataCivilISO(s.data),
          valor: s.valor,
          descricao: s.descricao,
          estado: s.estado,
          criadaEm: s.criadaEm,
        })),
      });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ O CONTADOR DECIDE — e **confirmar NÃO LANÇA NADA**.
   *
   * O que se confirma é uma PREVISÃO de caixa do cliente: ela já está no fluxo dele (pendente entra,
   * ver `FluxoDeCaixaService`), e a decisão diz se ela FICA. Não há `AccountingEntry` neste caminho,
   * e há teste no serviço varrendo a fonte para provar — o lançamento continua sendo o caminho do
   * declarado, que exige `dataPagamento` porque afirma que o dinheiro saiu.
   *
   * ⚠ `minRole: "ACCOUNTANT"` — é o piso das decisões desta tela, o mesmo das transições do
   * declarado. ⚠ **RECUSAR EXIGE MOTIVO** (o serviço recusa sem ele): ausência nunca é resposta, e o
   * cliente precisa saber por que a linha dele saiu.
   */
  /**
   * ⚠⚠⚠ A SAÍDA DO CLIENTE VIRA LANÇAMENTO CONTÁBIL — decisão do dono, 01/09/2026.
   *
   * > *"alguma coisa só aparecem para o fluxo, não me dando opção de colocar como lançamentos"*, e,
   * > entre mandar para a fila ou lançar direto: **"vira lançamento contábil direto"**.
   *
   * ⚠ `minRole: "ACCOUNTANT"` como o decidir — isto ESCREVE NO RAZÃO, e é o ato mais pesado desta
   * rota. ⚠ A conta vem do CORPO porque é escolha de quem clica; o sistema não elege nenhuma.
   * ⚠ O `portalClientId` sai do PATH, nunca do corpo: é a guarda de multi-tenancy de sempre.
   */
  router.post("/conferencia/saidas-do-cliente/:saidaId/lancar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const saida = await lancarSaidaAvulsa({
        portalClientId: String(req.params.companyId),
        saidaId: String(req.params.saidaId),
        contaDespesa: req.body?.contaDespesa,
        usuarioId: String(req.auth?.user?.id || ""),
      });
      return res.json({
        ok: true,
        saida: { id: saida.id, estado: saida.estado, accountingEntryId: saida.accountingEntryId },
      });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  router.post("/conferencia/saidas-do-cliente/:saidaId/decidir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const saida = await decidirSaidaAvulsa({
        portalClientId: String(req.params.companyId),
        saidaId: String(req.params.saidaId),
        estado: String(req.body?.estado || "").trim().toUpperCase(),
        motivoRecusa: req.body?.motivoRecusa,
        usuarioId: String(req.auth?.user?.id || ""),
      });
      return res.json({ ok: true, saida: { id: saida.id, estado: saida.estado } });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  router.get("/conferencia", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const competencia = req.query.competencia ? String(req.query.competencia) : null;
      // ⚠⚠ `sem-competencia` é um RECORTE, não uma competência. Sem ele a nota que chegou sem
      // competência fica invisível para sempre — `where.competencia = "2026-07"` não casa com NULL
      // em SQL. É o defeito que a auditoria de notas já pagou e consertou.
      if (competencia && competencia !== COMPETENCIA_AUSENTE && !COMPETENCIA_RE.test(competencia)) {
        return res.status(400).json({
          ok: false,
          error: "competencia_invalida",
          message: `Use AAAA-MM, ou "${COMPETENCIA_AUSENTE}" para as que chegaram sem competência.`,
        });
      }
      // ⚠ Sem filtro de estado, a fila mostra só o que espera alguém — mostrar CONTABILIZADO e
      // RECUSADO por padrão encheria a tela do que já foi resolvido. Os dois continuam alcançáveis
      // pelo filtro explícito.
      const estados = req.query.estado
        ? String(req.query.estado).split(",").map((s) => s.trim()).filter(Boolean)
        : [ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR];

      const r = await listarFila({
        portalClientId: String(req.params.companyId),
        estados,
        competencia,
        pagina: req.query.pagina,
        porPagina: req.query.porPagina,
      });
      return res.json({ ok: true, ...r, itens: r.itens.map(serializar) });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  // ── ESCRITA ────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ `minRole: "ACCOUNTANT"`. Confirmar aqui CRIA lançamento contábil — é o mesmo piso que
  // `POST /chart-of-accounts` e o import de OFX já exigem. Ler a fila, não: conferir o que está
  // pendente é leitura.

  const escrita = (nome, montarDados) =>
    router.post(`/conferencia/:declaradoId/${nome}`, requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
      try {
        const atualizado = await aplicarTransicao({
          portalClientId: String(req.params.companyId),
          declaradoId: String(req.params.declaradoId),
          transicao: montarDados.transicao,
          dados: montarDados.dados(req.body || {}),
          usuarioId: req.auth?.user?.id || null,
          // ⚠ `agora` é o carimbo de AUDITORIA (`decididoEm`) — quando a decisão foi tomada. Ele
          // NÃO é, e nunca pode virar, a data do pagamento.
          agora: new Date(),
        });
        return res.json({ ok: true, declarado: serializar(atualizado) });
      } catch (e) {
        return responderRecusa(res, e, log);
      }
    });

  // ── O EXTRATO DE "LANÇADOS POR REGRA" ──────────────────────────────────────────────────────
  //
  // ⚠⚠ ESTE É O PRÉ-REQUISITO QUE O PRÓPRIO `motorDeSugestao.js` NOMEOU, e sem ele ligar a
  // automação seria ligar algo que ninguém consegue auditar: *"o que falta é a DECISÃO DO DONO de
  // ligar, e o extrato mensal 'lançados por regra' para ele poder desfazer em lote."*
  //
  // ⚠ O recorte é a COMPETÊNCIA, porque a pergunta é *"o que entrou sem eu clicar neste mês?"* — e
  // o critério é a ORIGEM do pagamento, nunca o `regraId`: um lançamento que o contador confirmou
  // À MÃO sobre uma nota com regra também tem `regraId`, e oferecer "desfazer" sobre o trabalho
  // dele seria o oposto do que este extrato existe para fazer.

  router.get("/conferencia/lancados-por-regra", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const competencia = String(req.query.competencia || "");
      if (!COMPETENCIA_RE.test(competencia)) {
        return res.status(400).json({
          ok: false,
          error: "competencia_invalida",
          message: "Informe a competência no formato AAAA-MM.",
        });
      }
      const r = await extratoDeLancadosPorRegra({
        portalClientId: String(req.params.companyId),
        competencia,
      });
      return res.json({ ok: true, ...r });
    } catch (e) {
      // ⚠ Sem as migrations aplicadas as colunas não existem. "Não há lançamento por regra" e "não
      // consigo olhar" são respostas DIFERENTES, e por isso `indisponivel`.
      if (["P2021", "P2022"].includes(e?.code)) {
        return res.json({
          ok: true, competencia: String(req.query.competencia || ""), total: 0, valor: 0, linhas: [], indisponivel: true,
        });
      }
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ DESFAZER EM LOTE — e é ele que torna a decisão do dono REVERSÍVEL.
   *
   * ⚠ `minRole: "ACCOUNTANT"`: apagar lançamento do razão é o mesmo peso de criá-lo.
   * ⚠⚠ **A REGRA NÃO MORA AQUI.** Quem desfaz é `desfazerLancadosPorRegra`, um a um, por dentro de
   * `aplicarTransicao(DESFAZER)` — com as guardas de mês fechado e a exclusão do `AccountingEntry`
   * na mesma transação. Um `deleteMany` nesta rota deixaria lançamento órfão no razão.
   * ⚠ **O que falha volta NOMEADO e o lote NÃO PARA** — por isso a resposta é 200 com o relatório,
   * e não um erro: uma linha em mês fechado não pode esconder que as outras vinte foram desfeitas.
   */
  router.post(
    "/conferencia/lancados-por-regra/desfazer",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      try {
        const ids = req.body?.ids;
        if (!Array.isArray(ids) || !ids.length) {
          return res.status(400).json({
            ok: false,
            error: "ids_obrigatorios",
            message: "Informe `ids` com as linhas a desfazer.",
          });
        }
        const r = await desfazerLancadosPorRegra({
          portalClientId: String(req.params.companyId),
          ids,
          usuarioId: req.auth?.user?.id || null,
          agora: new Date(),
        });
        return res.json({ ok: true, ...r });
      } catch (e) {
        return responderRecusa(res, e, log);
      }
    },
  );

  escrita("informar-pagamento", {
    transicao: TRANSICAO.INFORMAR_PAGAMENTO,
    dados: (b) => lerPagamentoDoCorpo(b),
  });

  /**
   * ⚠⚠ A CONTA DE CRÉDITO VIAJA SÓ QUANDO O CORPO A TRAZ (01/09/2026) — decisão do dono: *"aqueles
   * que viram lançamento contábil devem ter opção de colocar débito e crédito"*.
   *
   * ⚠⚠ `hasOwnProperty`, NUNCA `b.contaCredito` cru: a máquina de estados distingue `undefined`
   * ("não mexer") de `null` ("voltar ao caixa"), e mandar `undefined` em todo request apagaria a
   * distinção — toda confirmação passaria a dizer "não mexer", e nunca haveria como desfazer uma
   * escolha errada.
   */
  const credito = (b) => (
    Object.prototype.hasOwnProperty.call(b || {}, "contaCredito")
      ? { contaCredito: b.contaCredito }
      : {}
  );

  escrita("confirmar", {
    transicao: TRANSICAO.CONFIRMAR,
    dados: (b) => ({ ...lerPagamentoDoCorpo(b), contaAplicada: b.contaAplicada, ...credito(b) }),
  });

  escrita("ajustar", {
    transicao: TRANSICAO.AJUSTAR,
    dados: (b) => ({
      ...lerPagamentoDoCorpo(b), contaAplicada: b.contaAplicada, valorAjustado: b.valorAjustado, ...credito(b),
    }),
  });

  escrita("recusar", { transicao: TRANSICAO.RECUSAR, dados: (b) => ({ motivoRecusa: b.motivo ?? b.motivoRecusa }) });
  escrita("reabrir", { transicao: TRANSICAO.REABRIR, dados: () => ({}) });
  escrita("desfazer", { transicao: TRANSICAO.DESFAZER, dados: () => ({}) });

  // ── O CASAMENTO DÉBITO × NOTA ──────────────────────────────────────────────────────────────
  //
  // ⚠ Rota LITERAL, antes da de curinga.
  router.get("/conferencia/casamentos", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const r = await sugestoesDePagamento({ portalClientId: String(req.params.companyId) });
      return res.json({
        ok: true,
        totalDebitos: r.totalDebitos,
        totalNotas: r.totalNotas,
        // ⚠⚠ `sugestao` só vem quando há UM candidato. Com dois, ela é NULA e os dois voltam em
        // `candidatos`, com o motivo — o sistema não escolhe entre notas.
        linhas: r.linhas.map((l) => ({
          debito: serializar(l.debito),
          // ⚠⚠ `podeFundir` e `fraseDaCandidata` VIAJAM — sem eles a tela ofereceria "Casar" numa
          // nota já contabilizada, e o clique voltaria recusado. Campo fora do serializador some
          // sem erro nenhum, e este projeto já foi mordido três vezes por isso.
          sugestao: l.sugestao ? serializarCandidata(l.sugestao) : null,
          candidatos: l.candidatos.map(serializarCandidata),
          motivo: l.motivo,
          frase: l.frase,
        })),
      });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  // ⚠⚠ FUNDIR NÃO CRIA LANÇAMENTO. O débito preenche o pagamento da nota e some absorvido; quem
  // contabiliza continua sendo o contador, num segundo ato. Por isso o piso é o de ESCRITA, mas a
  // guarda de mês fechado não se aplica aqui — nada chega ao razão.
  router.post("/conferencia/casamentos/fundir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const { declaradoOfxId, declaradoNotaId } = req.body || {};
      if (!declaradoOfxId || !declaradoNotaId) {
        return res.status(400).json({
          ok: false,
          error: "par_incompleto",
          message: "Informe qual débito e qual nota devem ser casados.",
        });
      }
      const nota = await fundirPagamentoNaNota({
        portalClientId: String(req.params.companyId),
        declaradoOfxId: String(declaradoOfxId),
        declaradoNotaId: String(declaradoNotaId),
        usuarioId: req.auth?.user?.id || null,
        agora: new Date(),
      });
      return res.json({ ok: true, declarado: serializar(nota) });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ ABSORVER — o quarto verbo, e o único que NÃO mexe no outro lado (decisão do dono, 01/09/2026).
   *
   * > *"eu posso ter feito os lançamentos através da nota, e depois importar o extrato (…) como não
   * > duplicar isso?"*
   *
   * A nota já virou lançamento; o débito do extrato é o pagamento dela. Absorver tira o débito da
   * fila **sem criar lançamento e sem tocar no que já está no razão**. Antes disto, esse caso não
   * tinha saída nenhuma: o débito ficava para sempre, e a única porta aberta era a errada.
   *
   * ⚠ A resposta devolve a DIVERGÊNCIA DE DATAS. O lançamento continua com a data que o contador
   * usou, e o extrato prova outra — absorver não corrige isso, e a decisão do dono foi AVISAR.
   * ⚠ Piso de ESCRITA, e sem guarda de mês fechado: nada aqui chega ao razão.
   */
  router.post("/conferencia/casamentos/absorver", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const { declaradoOfxId, declaradoNotaId } = req.body || {};
      if (!declaradoOfxId || !declaradoNotaId) {
        return res.status(400).json({
          ok: false,
          error: "par_incompleto",
          message: "Informe qual débito e qual nota já lançada devem ser absorvidos.",
        });
      }
      const r = await absorverDebitoJaContabilizado({
        portalClientId: String(req.params.companyId),
        declaradoOfxId: String(declaradoOfxId),
        declaradoNotaId: String(declaradoNotaId),
        usuarioId: req.auth?.user?.id || null,
        agora: new Date(),
      });
      return res.json({
        ok: true,
        declarado: serializar(r.debito),
        // ⚠ A nota volta INTEIRA e inalterada: é a prova, na resposta, de que a absorção não a tocou.
        nota: serializar(r.nota),
        divergencia: serializarDivergencia(r.divergencia),
      });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  // ── AS REGRAS (Fase C) ─────────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ NENHUMA DELAS CONTABILIZA. A regra SUGERE a conta; quem leva ao razão continua sendo o
  // contador, confirmando na fila. A automação por regra (lançar sem clique) NÃO existe — é
  // decisão do dono, e está nomeada no `CLAUDE.md` do módulo.
  /**
   * ⚠⚠ A REGRA QUE O CONTADOR ESCREVE À MÃO — a porta que faltava (29/08/2026).
   *
   * > Dono: *"a Lente tem todo mês um pagamento a Alessandro Nigro, CNPJ, que vai se tornar uma
   * > recorrência no fluxo deles. O contador deve poder colocar o código de débito e crédito nessa
   * > despesa."*
   *
   * ⚠⚠ **A TABELA JÁ EXISTIA E SÓ NASCIA `APRENDIDA`** — `RegraService.reavaliarAprendizado` era o
   * único escritor, e este arquivo tinha `GET` e o `PATCH` que liga/desliga, mas nenhum `POST`.
   *
   * ⚠ `minRole: "ACCOUNTANT"` — é o mesmo piso das transições do declarado. Escrever uma regra é
   * decidir como uma despesa será classificada daqui em diante.
   * ⚠⚠ **CRIAR A REGRA NÃO LANÇA NADA.** Ela passa a existir para o motor consultar; o que lança
   * tem outra trava, e ela nasce DESLIGADA.
   */
  router.post("/conferencia/regras", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const regra = await criarRegraManual({
        portalClientId: String(req.params.companyId),
        cnpjFornecedor: req.body?.cnpjFornecedor,
        padraoDescricao: req.body?.padraoDescricao,
        valorMin: req.body?.valorMin,
        valorMax: req.body?.valorMax,
        contaDestino: req.body?.contaDestino,
        contaCredito: req.body?.contaCredito,
        // ⚠⚠ `=== true` EXATO, e não `Boolean(...)`: a string `"false"` de um formulário é
        // verdadeira em JS, e ligaria o lançamento automático por um campo mal tipado. O serviço
        // repete a comparação — as duas são a mesma decisão, e nenhuma das duas confia na outra.
        lancaSozinha: req.body?.lancaSozinha === true,
        diaDoLancamento: req.body?.diaDoLancamento ?? null,
        usuarioId: req.auth?.user?.id || null,
        // ⚠ O relógio vem DAQUI, nunca de dentro do serviço — a regra deste módulo, com varredura
        // de fonte no teste dele.
        agora: new Date(),
      });
      return res.status(201).json({ ok: true, regra: { id: regra.id, origemRegra: regra.origemRegra } });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  router.get("/conferencia/regras", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const regras = await listarRegras({ portalClientId: String(req.params.companyId) });
      return res.json({ ok: true, regras });
    } catch (e) {
      // ⚠ Sem a migration aplicada a tabela não existe (P2021). A tela mostra "nenhuma regra", que
      // é a verdade, em vez de quebrar.
      if (e?.code === "P2021") return res.json({ ok: true, regras: [], indisponivel: true });
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ LIGAR O LANÇAMENTO AUTOMÁTICO DE UMA REGRA QUE JÁ EXISTE (29/08/2026).
   *
   * ⚠ Ela é uma rota SEPARADA do `PATCH` que liga/desliga a regra, e a separação é o ponto: são
   * dois atos de peso muito diferente. `ativa` decide se o sistema SUGERE; `lancaSozinha` decide se
   * ele LANÇA sem ninguém clicar. Um `PATCH` que aceitasse os dois campos faria a tela poder ligar
   * o segundo achando que estava ligando o primeiro.
   *
   * ⚠⚠ **A REGRA NÃO MORA AQUI**: quem exige o CNPJ e o dia é `definirLancamentoAutomatico`, com a
   * MESMA conferência que a criação usa.
   */
  router.patch(
    "/conferencia/regras/:regraId/automatico",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      try {
        const { lancaSozinha } = req.body || {};
        if (typeof lancaSozinha !== "boolean") {
          return res.status(400).json({
            ok: false,
            error: "lanca_sozinha_obrigatoria",
            message: "Informe `lancaSozinha` (true ou false).",
          });
        }
        const regra = await definirLancamentoAutomatico({
          portalClientId: String(req.params.companyId),
          regraId: String(req.params.regraId),
          lancaSozinha,
          diaDoLancamento: req.body?.diaDoLancamento ?? null,
        });
        return res.json({
          ok: true,
          regra: { id: regra.id, lancaSozinha: regra.lancaSozinha, diaDoLancamento: regra.diaDoLancamento },
        });
      } catch (e) {
        return responderRecusa(res, e, log);
      }
    },
  );

  // ⚠ Desligar/religar é ESCRITA e mexe no que o sistema sugere — mesmo piso das outras escritas.
  router.patch("/conferencia/regras/:regraId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const { ativa } = req.body || {};
      if (typeof ativa !== "boolean") {
        return res.status(400).json({ ok: false, error: "ativa_obrigatoria", message: "Informe `ativa` (true ou false)." });
      }
      const regra = await alternarRegra({
        portalClientId: String(req.params.companyId),
        regraId: String(req.params.regraId),
        ativa,
      });
      if (!regra) return res.status(404).json({ ok: false, error: "regra_nao_encontrada", message: "Regra não encontrada." });
      return res.json({ ok: true, regra: { id: regra.id, ativa: regra.ativa } });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  // ── O MAPEAMENTO DO EXTRATO EM EXCEL ───────────────────────────────────────────────────────
  //
  // ⚠⚠ ESTA É A ÚNICA PORTA QUE LIGA `confirmado`, e é o que torna a trava um FATO e não uma
  // convenção. O import grava PROPOSTA e para aí; sem o clique de uma pessoa, planilha nenhuma vira
  // lançamento. Decisão do dono (27/08/2026): *"o contador mapeia as colunas, e o mapeamento fica
  // salvo por empresa"*.
  //
  // ⚠ A REGRA NÃO MORA AQUI. Quem valida é `validarMapeamento` (puro, com teste próprio); quem
  // grava é `MapeamentoExtratoService`. A rota traduz HTTP, e nada mais.

  router.get("/conferencia/mapeamentos-extrato", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const r = await listarMapeamentos(String(req.params.companyId));
      return res.json({ ok: true, ...r });
    } catch (e) {
      // ⚠ Sem a migration aplicada a tabela não existe (P2021). A tela diz o que houve — "não há
      // mapeamento" e "a tabela não existe" são respostas DIFERENTES, e por isso `indisponivel`.
      if (e?.code === "P2021") return res.json({ ok: true, mapeamentos: [], indisponivel: true });
      return responderRecusa(res, e, log);
    }
  });

  // ⚠ `minRole: ACCOUNTANT` — confirmar um mapeamento decide como TODO extrato futuro daquele banco
  // será lido. É a mesma exigência das outras escritas desta aba.
  router.put(
    "/conferencia/mapeamentos-extrato/:assinatura",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      try {
        const corpo = req.body || {};
        const mapeamento = await salvarMapeamento({
          portalClientId: String(req.params.companyId),
          // ⚠ A assinatura vem do PATH, nunca do corpo — corpo sobrescrevendo path é o furo de
          // multi-tenancy que a F1 do WhatsApp mediu.
          assinatura: decodeURIComponent(String(req.params.assinatura)),
          colunas: corpo.colunas,
          sinal: corpo.sinal,
          rotulo: corpo.rotulo,
          cabecalhoVisto: corpo.cabecalhoVisto ?? null,
          // ⚠ `=== true`: salvar sem confirmar é permitido (o contador ajusta em duas sessões) e
          // NUNCA liga o `confirmado`. Coerção de tipo aqui abriria a trava por um `"false"`.
          confirmar: corpo.confirmar === true,
          confirmadoPor: req.auth?.user?.id || null,
          agora: new Date(),
        });
        return res.json({ ok: true, mapeamento });
      } catch (e) {
        // ⚠ A recusa de confirmação volta com os ERROS NOMEADOS, cada um com a frase pronta: sem
        // eles o contador descobriria qual coluna falta só no próximo envio, com o extrato inteiro
        // recusado.
        if (e?.codigo && e?.erros) {
          return res.status(400).json({ ok: false, error: e.codigo, message: e.frase, erros: e.erros });
        }
        return responderRecusa(res, e, log);
      }
    },
  );

  // ── A VARREDURA DAS NOTAS ──────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ A DATA-PISO É OBRIGATÓRIA, e a exigência é o ponto. São 1.897 NFS-e recebidas na base: sem
  // piso, a primeira varredura produz a base inteira de uma vez — e isso não é fila, é muro.
  // Deixá-la opcional com um default faria o sistema escolher, em silêncio, o tamanho do trabalho
  // que o contador vai encontrar na tela.
  //
  // ⚠ `POST` porque ESCREVE (cria declarados), mas ela NÃO cria lançamento nenhum: tudo nasce em
  // `AGUARDANDO_PAGAMENTO`.
  /**
   * ⚠⚠ A SEQUÊNCIA DA VARREDURA, NUM LUGAR SÓ — duas portas, um corpo (01/09/2026).
   *
   * As portas são o botão «Trazer notas» (varredura avulsa) e o «trazer sozinho daqui em diante»
   * (que grava a escolha e varre na hora, senão o contador escolhe a data e não vê nada acontecer
   * até o próximo ciclo do worker).
   *
   * ⚠ Duas cópias divergiriam na primeira correção, e aqui a divergência sairia como série
   * auto-ativada por um caminho e não pelo outro — invisível até alguém comparar as duas telas.
   */
  async function varrerAgora(req, dataPiso) {
    const r = await varrerNotasDaEmpresa({
      portalClientId: String(req.params.companyId),
      dataPiso,
      criadoPor: req.auth?.user?.id || null,
      agora: new Date(),
    });

    /**
     * ⚠⚠ A AUTO-ATIVAÇÃO DAS SÉRIES ESTÁVEIS ENTRA AQUI — e o LUGAR foi escolhido, não sobrou.
     *
     * > Dono: *"se a variação for = ou menor que 10%, pode ser lançado no fluxo automaticamente."*
     *
     * ⚠⚠ **POR QUE NA VARREDURA, E NÃO NA LEITURA.** `listarSeries` é o detector, e o eixo escrito
     * daquele módulo é *"observar NÃO GRAVA"* — uma escrita ali faria toda abertura de tela
     * cadastrar série, e o contador não saberia o que disparou o quê. A varredura é o passo em que
     * o contador já mandou o sistema **processar o que chegou**: é escrita explícita, com piso de
     * papel (`ACCOUNTANT`) e resposta que diz o que aconteceu.
     *
     * ⚠ Do ponto de vista do dono continua sendo automático: ele não decide série a série — que é
     * exatamente o que ele pediu para deixar de fazer.
     *
     * ⚠⚠ **ELA NÃO PODE DERRUBAR A VARREDURA.** As notas já viraram fila neste ponto; perder essa
     * resposta por causa da recorrência faria o contador varrer de novo, e o relatório de "criei
     * 12" some. Falhou ⇒ `autoAtivadas: null`, que é "não sei", e o resto responde.
     */
    let autoAtivadas = null;
    try {
      const detectadas = await listarSeries({
        portalClientId: String(req.params.companyId),
        cicloAtual: cicloDeHoje(),
      });
      const ativacao = await autoAtivarSeriesEstaveis({
        portalClientId: String(req.params.companyId),
        series: detectadas?.series || [],
      });
      autoAtivadas = ativacao.ativadas;
    } catch (e) {
      log?.warn?.({ err: e, companyId: req.params?.companyId }, "auto_ativacao_de_series_falhou");
    }

    /**
     * ⚠⚠ O LANÇAMENTO AUTOMÁTICO ENTRA AQUI — e este é o CHAMADOR que faltava (29/08/2026).
     *
     * > Dono: *"todo mês que essa nota aparecer ela já é lançada em despesa."* A nota "aparece"
     * na varredura; é aqui que ela pode virar despesa sem clique.
     *
     * ⚠⚠ **ELE CONTINUA COM AS TRÊS TRAVAS**, e nenhuma mora nesta rota: a FLAG do ambiente, a
     * marca `lancaSozinha` daquele fornecedor e a FAIXA de valor da regra. Quem recusa é o
     * SERVIDOR, dentro de `podeLancarSozinho` — um `curl` nesta rota bate na mesma decisão.
     *
     * ⚠⚠ **ELE NÃO PODE DERRUBAR A VARREDURA**, pelo mesmo motivo da auto-ativação: as notas já
     * viraram fila neste ponto. Falhou ⇒ `lancadosPorRegra: null`, que é "não sei" — e "não
     * lancei nada" não pode se disfarçar de zero.
     */
    let lancadosPorRegra = null;
    try {
      lancadosPorRegra = await lancarPorRegraNaEmpresa({
        portalClientId: String(req.params.companyId),
        agora: new Date(),
      });
    } catch (e) {
      log?.warn?.({ err: e, companyId: req.params?.companyId }, "lancamento_por_regra_falhou");
    }

    // ⚠ O relatório INTEIRO volta — inclusive `fora` e `recusados`. Uma varredura que só dissesse
    // "criei 12" faria as outras sumirem sem ninguém saber por quê, e "não veio nada" ficaria
    // indistinguível de "deu erro".
    // ⚠⚠ `autoAtivadas` viaja SEPARADO e pode ser `null`: "nenhuma série entrou sozinha" e "não
    // consegui olhar as séries" são respostas diferentes, e a segunda não pode se disfarçar de
    // zero.
    return { ...r, autoAtivadas, lancadosPorRegra };
  }

  /**
   * ⚠⚠ A VARREDURA AUTOMÁTICA — decisão do dono, 01/09/2026: *"elas devem ser trazidas
   * automaticamente, como tem na aba de notas fiscais deve aparecer ali"*.
   *
   * ⚠⚠ **A LEITURA RESPONDE TRÊS COISAS DIFERENTES**, e amassá-las numa só seria o defeito:
   * `ligada: false` (ninguém escolheu a data ainda) · `ligada: true` com `ultimaTentativaEm` (olhei)
   * · `ultimoResultadoEm` (trouxe algo). "Olhei e não veio nada" e "ninguém olhou" foi exatamente a
   * confusão que deixou a captura 29 dias parada em produção sem ninguém perceber.
   */
  router.get("/conferencia/varredura-automatica", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const r = await lerVarreduraAutomatica({ portalClientId: String(req.params.companyId) });
      return res.json({
        ok: true,
        ligada: r.ligada,
        // ⚠ `indisponivel` viaja: sem ele, "esta empresa não tem varredura automática" e "não sei
        // olhar (banco sem a migration)" ficariam idênticos na tela — e o primeiro é uma AFIRMAÇÃO.
        indisponivel: r.indisponivel,
        desde: r.config?.dataPiso ? dataCivilISO(r.config.dataPiso) : null,
        ligadaEm: r.config?.ligadaEm ?? null,
        ultimaTentativaEm: r.config?.ultimaTentativaEm ?? null,
        ultimoResultadoEm: r.config?.ultimoResultadoEm ?? null,
        ultimoCriados: r.config?.ultimoCriados ?? null,
        ultimoErro: r.config?.ultimoErro ?? null,
      });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ LIGAR **E VARRER AGORA**, num ato só — e a segunda metade não é conveniência.
   *
   * Ligar sem varrer deixaria a fila vazia até o próximo ciclo do worker de captura (1h), e o
   * contador que acabou de escolher a data veria... nada. Ele leria isso como "não funcionou".
   *
   * ⚠ Por isso este handler reusa `varrerAgora`, o MESMO corpo do botão manual: uma sequência só,
   * com duas portas. Duas cópias divergiriam na primeira correção — e aqui a divergência sai como
   * série auto-ativada num caminho e não no outro.
   */
  router.post("/conferencia/varredura-automatica", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const desde = req.body?.desde ?? req.query.desde;
      if (!desde) {
        return res.status(400).json({
          ok: false,
          error: "data_piso_obrigatoria",
          message:
            "Informe a partir de que data as notas devem entrar na fila (`desde=AAAA-MM-DD`). Sem esse corte, toda a base de notas recebidas entraria de uma vez.",
        });
      }
      const dataPiso = dataCivilDe(desde);
      if (!dataPiso) {
        return res.status(400).json({ ok: false, error: "data_piso_invalida", message: "Use AAAA-MM-DD." });
      }

      await ligarVarreduraAutomatica({
        portalClientId: String(req.params.companyId),
        dataPiso,
        usuarioId: req.auth?.user?.id || null,
      });
      const relatorio = await varrerAgora(req, dataPiso);
      return res.json({ ok: true, ligada: true, desde, ...relatorio });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ DESLIGAR APAGA A LINHA — não existe coluna `ativa`, e é escolha.
   *
   * Uma linha desligada guardaria uma data-piso que ninguém aplica, e a próxima pessoa a religaria
   * sem reescolher — herdando, sem saber, uma decisão tomada em outro contexto.
   * ⚠ **Nada do que a varredura já criou é tocado**: a fila é fato consumado, e apagá-la desfaria
   * decisões que o contador já tomou sobre aquelas notas.
   */
  router.delete("/conferencia/varredura-automatica", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const r = await desligarVarreduraAutomatica({ portalClientId: String(req.params.companyId) });
      return res.json({ ok: true, ligada: false, desligadas: r.desligadas });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  router.post("/conferencia/varrer-notas", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const desde = req.query.desde ?? req.body?.desde;
      if (!desde) {
        return res.status(400).json({
          ok: false,
          error: "data_piso_obrigatoria",
          message:
            "Informe a partir de que data as notas devem entrar na fila (`desde=AAAA-MM-DD`). Sem esse corte, toda a base de notas recebidas entraria de uma vez.",
        });
      }
      const dataPiso = dataCivilDe(desde);
      if (!dataPiso) {
        return res.status(400).json({ ok: false, error: "data_piso_invalida", message: "Use AAAA-MM-DD." });
      }

      const relatorio = await varrerAgora(req, dataPiso);
      return res.json({ ok: true, desde, ...relatorio });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  return router;
}

/** ⚠ Reexportado para a tela e os testes não escreverem um segundo vocabulário. */
export { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO };
