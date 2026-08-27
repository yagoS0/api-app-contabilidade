// AS RECORRÊNCIAS — as rotas do escritório.
//
// Montado em `/firm/companies/:companyId/*` (mergeParams).
//
//   GET  /recorrencia?cicloAtual=AAAA-MM      as séries: observação + marcação (SÓ LEITURA)
//   POST /recorrencia/marcar                  a decisão do contador (ATIVA | RECUSADA | SUSPENSA)
//   POST /recorrencia/:serieId/saida-sugerida registra que o detector sugeriu a saída
//
// ⚠⚠ NENHUMA REGRA MORA AQUI. Quem observa é `application/fluxo/lib/recorrencia.js` (PURO); quem lê
// o banco e grava a marcação é `SerieRecorrenteService.js`. Este arquivo traduz HTTP e nada mais.
//
// ⚠⚠ O `GET` NÃO ESCREVE NADA. A observação é derivada na leitura — nunca coluna. Gravá-la faria a
// tela mostrar um FATO onde há uma SUGESTÃO, e é a distinção que o módulo inteiro existe para
// manter. (Mesmo precedente de `divergenciaDeFonte.js` e da sugestão de conta da Conferência.)

import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import {
  ESTADO_DA_SERIE,
  LADO,
  RECUSA_DA_SERIE,
  SerieRecusada,
  cicloDeHoje,
  listarSeries,
  marcarSerie,
  paraTela,
  registrarSaidaSugerida,
} from "../../application/fluxo/SerieRecorrenteService.js";
import { PERIODICIDADE } from "../../application/fluxo/lib/recorrencia.js";

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

/**
 * ⚠ `404` só para "não existe nesta empresa"; `503` para a tabela ausente (é o mundo que não está
 * pronto, não o pedido que está errado); `400` para o resto. Um 500 apagaria a diferença entre
 * "você mandou errado" e "quebrou".
 */
const STATUS_DA_RECUSA = Object.freeze({
  [RECUSA_DA_SERIE.NAO_ENCONTRADA]: 404,
  [RECUSA_DA_SERIE.INDISPONIVEL]: 503,
});

function responderRecusa(res, e, log) {
  if (e instanceof SerieRecusada) {
    return res.status(STATUS_DA_RECUSA[e.codigo] || 400).json({ ok: false, error: e.codigo, message: e.frase });
  }
  log?.error?.({ err: e }, "recorrencia falhou");
  return res.status(500).json({ ok: false, error: "erro_interno" });
}

/**
 * ⚠⚠ SÓ TRÊS ESTADOS SÃO ESCRITOS POR ESTA ROTA — lista de INCLUSÃO.
 *
 * `PENDENTE` fica de FORA: ele é o estado de quem **espera** a palavra do contador, e esta rota É a
 * palavra dele. Deixá-lo passar permitiria devolver uma série ao limbo por engano, e o caminho para
 * "ainda não decidi" é simplesmente não marcar.
 */
const ESTADOS_QUE_O_CONTADOR_ESCREVE = Object.freeze([
  ESTADO_DA_SERIE.ATIVA,
  ESTADO_DA_SERIE.RECUSADA,
  ESTADO_DA_SERIE.SUSPENSA,
]);

export function createRecorrenciaRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  router.get("/recorrencia", requireFirmCompanyAccess(), async (req, res) => {
    try {
      const bruto = String(req.query.cicloAtual || "").trim();
      // ⚠ Ciclo malformado RECUSA, em vez de cair no mês corrente em silêncio: a leitura inteira
      // (quantos ciclos desde a última observação, se sugere saída) se apoia nele.
      if (bruto && !COMPETENCIA_RE.test(bruto)) {
        return res.status(400).json({ ok: false, error: "ciclo_invalido", message: "O ciclo precisa ser AAAA-MM." });
      }
      const r = await listarSeries({
        portalClientId: String(req.params.companyId),
        cicloAtual: bruto || cicloDeHoje(),
      });
      // ⚠⚠ `indisponivel` VIAJA. Sem ele, "esta empresa não tem recorrência nenhuma" e "a tabela não
      // existe neste banco" ficam idênticos na tela — e o primeiro é uma AFIRMAÇÃO sobre a empresa.
      return res.json({ ok: true, ...r });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  /**
   * ⚠⚠ A MARCAÇÃO — é ela, e só ela, que põe a linha no fluxo de caixa.
   *
   * ⚠ `minRole: ACCOUNTANT`, como toda escrita da Conferência: marcar uma recorrência decide o que
   * o fluxo de caixa vai projetar, e isso é ato de quem responde pela contabilidade.
   */
  router.post("/recorrencia/marcar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const corpo = req.body || {};
      const estado = String(corpo.estado || "").trim();
      if (!ESTADOS_QUE_O_CONTADOR_ESCREVE.includes(estado)) {
        return res.status(400).json({
          ok: false,
          error: "estado_invalido",
          message: `A marcação precisa ser ${ESTADOS_QUE_O_CONTADOR_ESCREVE.join(", ")}.`,
        });
      }
      const serie = await marcarSerie({
        portalClientId: String(req.params.companyId),
        lado: String(corpo.lado || "").trim(),
        chave: corpo.chave,
        rotulo: corpo.rotulo,
        periodicidade: String(corpo.periodicidade || PERIODICIDADE.MENSAL).trim(),
        estado,
        contraparteDoc: corpo.contraparteDoc ?? null,
        // ⚠⚠ A EVIDÊNCIA DO INSTANTE DA DECISÃO vem do corpo, e é o que a tela acabou de mostrar.
        // Recalculá-la aqui congelaria uma leitura DIFERENTE da que o contador viu — e é justamente
        // a que ele viu que responde "por que esta linha está no fluxo?".
        baseDaObservacao: corpo.baseDaObservacao ?? null,
        usuarioId: req.auth?.user?.id || null,
      });
      return res.json({ ok: true, serie: paraTela(serie) });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  /** ⚠ Registra que o detector SUGERIU a saída. Ele não desmarca — quem decide é o contador. */
  router.post("/recorrencia/:serieId/saida-sugerida", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    try {
      const r = await registrarSaidaSugerida({
        portalClientId: String(req.params.companyId),
        serieId: String(req.params.serieId),
      });
      // ⚠ Zero linhas não é erro: a saída já tinha sido registrada antes. Devolver 404 mandaria o
      // contador procurar uma série que existe.
      return res.json({ ok: true, ...r });
    } catch (e) {
      return responderRecusa(res, e, log);
    }
  });

  return router;
}

export { LADO, ESTADO_DA_SERIE };

