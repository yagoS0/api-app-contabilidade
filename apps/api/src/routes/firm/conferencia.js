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
//   GET  /conferencia/casamentos                 debito do extrato x nota (SO SUGERE)
//   POST /conferencia/casamentos/fundir          o debito data a nota, e some absorvido
//
// ⚠⚠ NENHUMA REGRA MORA AQUI. Quem decide se um ato pode acontecer é
// `application/declarados/lib/estadosDeclarado.js`; quem monta o lançamento é
// `lib/formaDoLancamento.js`; quem grava é `DeclaradoService.js`. Este arquivo traduz HTTP e nada
// mais — reimplementar qualquer pedaço daria duas regras que divergem na primeira correção, e aqui
// a divergência sai como lançamento contábil errado.

import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { dataCivilDe, dataCivilISO } from "../../utils/dataCivil.js";
import {
  COMPETENCIA_AUSENTE,
  DeclaradoRecusado,
  RECUSA_DO_SERVICO,
  aplicarTransicao,
  fundirPagamentoNaNota,
  listarFila,
  sugestoesDePagamento,
  varrerInvariantes,
} from "../../application/declarados/DeclaradoService.js";
import { alternarRegra, listarRegras } from "../../application/declarados/RegraService.js";
import { varrerNotasDaEmpresa } from "../../application/declarados/VarreduraDeNotasService.js";
import { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO } from "../../application/declarados/lib/estadosDeclarado.js";

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

  escrita("informar-pagamento", {
    transicao: TRANSICAO.INFORMAR_PAGAMENTO,
    dados: (b) => lerPagamentoDoCorpo(b),
  });

  escrita("confirmar", {
    transicao: TRANSICAO.CONFIRMAR,
    dados: (b) => ({ ...lerPagamentoDoCorpo(b), contaAplicada: b.contaAplicada }),
  });

  escrita("ajustar", {
    transicao: TRANSICAO.AJUSTAR,
    dados: (b) => ({ ...lerPagamentoDoCorpo(b), contaAplicada: b.contaAplicada, valorAjustado: b.valorAjustado }),
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
          sugestao: l.sugestao
            ? {
              nota: serializar(l.sugestao.nota),
              pista: l.sugestao.pista,
              frase: l.sugestao.frase,
              leitura: l.sugestao.leitura,
              podeFundir: l.sugestao.podeFundir,
              fraseDaCandidata: l.sugestao.fraseDaCandidata,
            }
            : null,
          candidatos: l.candidatos.map((c) => ({
            nota: serializar(c.nota),
            pista: c.pista,
            frase: c.frase,
            leitura: c.leitura,
            podeFundir: c.podeFundir,
            fraseDaCandidata: c.fraseDaCandidata,
          })),
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

  // ── AS REGRAS (Fase C) ─────────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ NENHUMA DELAS CONTABILIZA. A regra SUGERE a conta; quem leva ao razão continua sendo o
  // contador, confirmando na fila. A automação por regra (lançar sem clique) NÃO existe — é
  // decisão do dono, e está nomeada no `CLAUDE.md` do módulo.
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

  // ── A VARREDURA DAS NOTAS ──────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ A DATA-PISO É OBRIGATÓRIA, e a exigência é o ponto. São 1.897 NFS-e recebidas na base: sem
  // piso, a primeira varredura produz a base inteira de uma vez — e isso não é fila, é muro.
  // Deixá-la opcional com um default faria o sistema escolher, em silêncio, o tamanho do trabalho
  // que o contador vai encontrar na tela.
  //
  // ⚠ `POST` porque ESCREVE (cria declarados), mas ela NÃO cria lançamento nenhum: tudo nasce em
  // `AGUARDANDO_PAGAMENTO`.
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

      const r = await varrerNotasDaEmpresa({
        portalClientId: String(req.params.companyId),
        dataPiso,
        criadoPor: req.auth?.user?.id || null,
        agora: new Date(),
      });
      // ⚠ O relatório INTEIRO volta — inclusive `fora` e `recusados`. Uma varredura que só dissesse
      // "criei 12" faria as outras sumirem sem ninguém saber por quê, e "não veio nada" ficaria
      // indistinguível de "deu erro".
      return res.json({ ok: true, desde, ...r });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  return router;
}

/** ⚠ Reexportado para a tela e os testes não escreverem um segundo vocabulário. */
export { ESTADO, ORIGEM_PAGAMENTO, TRANSICAO };
