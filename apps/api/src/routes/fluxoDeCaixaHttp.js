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
import { avaliarCiencia, lerGuiasComCiencia } from "../application/guides/cienciaDeGuias.js";

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
  /**
   * ⚠⚠ `janelaInicio` É OUTRA PERGUNTA, e por isso é outro parâmetro (28/08/2026).
   *
   * `cicloAtual` responde *"que dia é hoje?"* — é ele que decide o que é passado, quantos ciclos se
   * passaram desde a última observação e qual mês a tela pinta de ciano. `janelaInicio` responde
   * *"onde a tabela começa?"*, que é só navegação com as setas ‹ ›.
   *
   * ⚠ Enquanto era um parâmetro só, andar com a seta movia o "hoje" junto: a tabela recuava e o mês
   * marcado como corrente recuava com ela. Reusar `cicloAtual` para navegar é reintroduzir isso.
   * ⚠ Malformado RECUSA, pelo mesmo motivo do outro — cair na posição padrão em silêncio faria a
   * seta parecer que não respondeu.
   */
  const janela = String(req.query?.janelaInicio || "").trim();
  if (janela && !COMPETENCIA_RE.test(janela)) {
    return res.status(400).json({ ok: false, error: "janela_invalida", message: "O início da janela precisa ser AAAA-MM." });
  }
  try {
    const r = await montarFluxoDeCaixa({
      portalClientId: String(req.params.companyId),
      cicloAtual: bruto || cicloDeHoje(),
      janelaInicio: janela || null,
    });
    /**
     * ⚠⚠ O "JÁ AVISAMOS?" É OUTRA PERGUNTA, COM OUTRO DONO — por isso ela é respondida AQUI, e não
     * dentro do `montarFluxoDeCaixa`. Aquele módulo responde *"quais guias estão pegando fogo?"*,
     * que é um fato sobre dinheiro; este trecho responde *"esta pessoa já foi avisada?"*, que é um
     * fato sobre a conversa. Misturá-los faria o fluxo de caixa depender de uma tabela de avisos.
     */
    const alerta = r.alertaDeGuias;
    const { precisaAvisar } = avaliarCiencia({
      itens: alerta.itens,
      cientes: await cientesDaEmpresa(req.params.companyId, log),
    });
    return res.json({ ok: true, ...r, alertaDeGuias: { ...alerta, ackPending: precisaAvisar } });
  } catch (e) {
    log?.error?.({ err: e, companyId: req.params?.companyId }, "fluxo_de_caixa_falhou");
    return res.status(500).json({ ok: false, error: "fluxo_de_caixa_falhou" });
  }
}

/**
 * ⚠⚠ A TABELA PODE NÃO EXISTIR — a migration é ato do dono, e não há banco alcançável na máquina
 * onde ela foi escrita. Sem esta guarda, o fluxo de caixa inteiro cairia com **P2021** no primeiro
 * deploy que subisse o código sem a migration.
 *
 * ⚠⚠ E A QUEDA É PARA O LADO DE **AVISAR**, nunca para o de calar: sem a tabela ninguém deu ciência
 * de nada, então o conjunto de reconhecidas é VAZIO e o pop-up abre. Cair para "já avisamos" é o
 * modo de falhar caro — esconderia uma guia vencida de quem precisa pagá-la.
 * ⚠ É a mesma disciplina de `recorrenciaIndisponivel`: o que falta é DITO, e o que não se sabe
 * nunca vira silêncio.
 */
async function cientesDaEmpresa(companyId, log) {
  try {
    return await lerGuiasComCiencia({ portalClientId: String(companyId) });
  } catch (e) {
    if (e?.code !== "P2021") throw e;
    log?.warn?.({ companyId }, "ciencia_de_guias_sem_tabela");
    return new Set();
  }
}
