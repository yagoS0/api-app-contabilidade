// O FLUXO DE CAIXA EM HTTP — e as DUAS portas servem o MESMO payload.
//
// ⚠⚠ UM CÁLCULO SÓ, DOIS CONSUMIDORES. O contador e o cliente veem o mesmo fluxo da mesma empresa;
// duas montagens divergiriam na primeira correção, e aí as duas telas afirmariam coisas diferentes
// sobre o mesmo dinheiro — com o cliente do lado que ninguém do escritório testa.
//
// Por isso este arquivo existe: ele é o corpo COMPARTILHADO das duas rotas. O que muda entre elas é
// só o MIDDLEWARE de acesso (`requireFirmCompanyAccess` × `requireClientCompanyAccess`), que
// responde a perguntas diferentes — e é a única coisa que deve mudar.
//
// ⚠ Mesmo desenho de `nfseEmissaoHttp.js` e `danfseHttp.js`: eles não validam nem decidem nada, só
// traduzem para HTTP.

import { montarFluxoDeCaixa, cicloDeHoje } from "../application/fluxo/FluxoDeCaixaService.js";

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

/**
 * Responde o fluxo de caixa de uma empresa.
 *
 * ⚠ `cicloAtual` malformado RECUSA, em vez de cair no mês corrente em silêncio: os 12 meses, o
 * "quantos ciclos desde a última observação" e o corte do que é passado se apoiam nele.
 */
export async function responderFluxoDeCaixa(req, res, { log } = {}) {
  const bruto = String(req.query?.cicloAtual || "").trim();
  if (bruto && !COMPETENCIA_RE.test(bruto)) {
    return res.status(400).json({ ok: false, error: "ciclo_invalido", message: "O ciclo precisa ser AAAA-MM." });
  }
  try {
    const r = await montarFluxoDeCaixa({
      portalClientId: String(req.params.companyId),
      cicloAtual: bruto || cicloDeHoje(),
    });
    return res.json({ ok: true, ...r });
  } catch (e) {
    log?.error?.({ err: e, companyId: req.params?.companyId }, "fluxo_de_caixa_falhou");
    return res.status(500).json({ ok: false, error: "fluxo_de_caixa_falhou" });
  }
}
