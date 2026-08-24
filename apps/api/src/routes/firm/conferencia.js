// A FILA DE CONFERÊNCIA DE LANÇAMENTOS — as rotas do escritório.
//
// Montado em `/firm/companies/:companyId/*` (mergeParams).
//
//   GET  /conferencia                            a fila
//   GET  /conferencia/varredura                  as invariantes (SÓ LEITURA)
//   POST /conferencia/:declaradoId/informar-pagamento
//   POST /conferencia/:declaradoId/confirmar
//   POST /conferencia/:declaradoId/ajustar
//   POST /conferencia/:declaradoId/recusar
//   POST /conferencia/:declaradoId/reabrir
//   POST /conferencia/:declaradoId/desfazer
//   POST /conferencia/varrer-notas?desde=AAAA-MM-DD   as notas recebidas viram fila
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
  DeclaradoRecusado,
  RECUSA_DO_SERVICO,
  aplicarTransicao,
  listarFila,
  varrerInvariantes,
} from "../../application/declarados/DeclaradoService.js";
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

    decididoPor: d.decididoPor,
    decididoEm: d.decididoEm,
    criadoEm: d.criadoEm,
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
      if (competencia && !COMPETENCIA_RE.test(competencia)) {
        return res.status(400).json({ ok: false, error: "competencia_invalida", message: "Use AAAA-MM." });
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
