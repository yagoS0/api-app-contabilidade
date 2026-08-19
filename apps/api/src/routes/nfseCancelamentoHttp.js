// OS DESFECHOS HTTP DO CANCELAMENTO DE NFS-e — os MESMOS nas duas portas.
//
// ⚠ POR QUE ISTO EXISTE. O cancelamento passou a ter **duas portas**: `POST /nfse/:chave/eventos`
// (a do escritório, que existe desde sempre) e `POST /client/companies/:id/notas/:notaId/cancelar`
// (a do app do cliente, 19/08/2026). É o terceiro par de portas do projeto a receber o mesmo
// tratamento — `nfseEmissaoHttp.js` e `danfseHttp.js` são os outros dois —, e pelo mesmo motivo: as
// duas discordariam na primeira correção, e a que o cliente usa é a que ninguém do escritório testa.
//
// ⚠ **NÃO HÁ REGRA DE CANCELAMENTO AQUI.** Este módulo não valida nada, não decide nada e não fala
// com o banco. Quem valida o motivo e a justificativa é `application/nfse/motivosDeEvento.js`
// (antes de assinar); quem autoriza é `ensureEmissaoNfseAutorizada`; quem envia é
// `NfseService.sendEvent`.
//
// ═══ ⚠⚠ AS TRÊS CAMADAS SÃO AS MESMAS DA EMISSÃO, E O MAPA NÃO É UM SEGUNDO MAPA ═════════════
//
// A classificação vem de `classificarFalha` (`application/nfse/desfechoEmissao.js`) — a MESMA
// função, com a mesma leitura de 4xx × 5xx × rede. O status HTTP é o mesmo de
// `nfseEmissaoHttp.js`:
//
//   | camada       | status | error                        | o que significa                      |
//   |--------------|--------|------------------------------|--------------------------------------|
//   | `NOSSA`      | 400    | `nfse_cancelamento_local`    | nada saiu da máquina                 |
//   | `TRANSPORTE` | 502    | `nfse_cancelamento_transporte` | **desfecho DESCONHECIDO**          |
//   | `RECEITA`    | 422    | `nfse_cancelamento_rejeitado`| o sistema nacional analisou e recusou |
//
// ⚠⚠ O QUE **NÃO** SE REUSA É O TEXTO DA `correcao` DA CAMADA TRANSPORTE, e a diferença é de
// fato, não de estilo. Na emissão ele fala de NUMERAÇÃO ("não reemita com número novo; número
// pulado é buraco permanente"), porque lá o que fica em estado indeterminado é um número de DPS
// reservado. **Cancelar não consome número nenhum.** O que fica indeterminado aqui é outra coisa:
// se a nota já está cancelada ou não. Repetir o texto da emissão mandaria o cliente consultar um
// Id de DPS que não tem nada a ver com o problema dele.

// ⚠ O TEXTO DA CORREÇÃO DA CAMADA TRANSPORTE **NÃO MORA AQUI** — ele é da APLICAÇÃO
// (`CORRECAO_TRANSPORTE_EVENTO`, em `desfechoEmissao.js`, ao lado do texto equivalente da emissão,
// para que a diferença entre os dois fique à vista). Uma rota não é lugar de regra, e a camada de
// aplicação não pode importar de `routes/` — foi o que a primeira versão deste arquivo fez.
import { CAMADA } from "../application/nfse/desfechoEmissao.js";

/** As recusas NOSSAS, nomeadas — nenhuma delas chegou a sair da máquina. */
const RECUSAS_LOCAIS = Object.freeze({
  NFSE_CHAVE_REQUIRED: { status: 400, error: "chave_required" },
  NFSE_TIPO_EVENTO_REQUIRED: { status: 400, error: "tipo_evento_required" },
  NFSE_JUSTIFICATIVA_REQUIRED: { status: 400, error: "justificativa_required" },
  // ⚠ As duas travas de leiaute, conferidas ANTES de assinar (`motivosDeEvento.js`).
  NFSE_JUSTIFICATIVA_CURTA: { status: 400, error: "justificativa_curta" },
  NFSE_JUSTIFICATIVA_LONGA: { status: 400, error: "justificativa_longa" },
  NFSE_CMOTIVO_REQUIRED: { status: 400, error: "c_motivo_required" },
  NFSE_CMOTIVO_INVALIDO: { status: 400, error: "c_motivo_invalido" },
  NFSE_CHAVE_SUBSTITUTA_REQUIRED: { status: 400, error: "chave_substituta_required" },
  NFSE_CNPJ_AUTOR_REQUIRED: { status: 400, error: "cnpj_autor_required" },
  NFSE_NOT_CONFIGURED: { status: 400, error: "nfse_not_configured" },
  NFSE_NOT_FOUND: { status: 404, error: "nfse_not_found" },
  COMPANY_NOT_FOUND: { status: 404, error: "company_not_found" },
  // Sem o A1 da empresa não há pedido de registro válido a montar: o evento também é assinado
  // pelo certificado do autor (E0718).
  NO_COMPANY_CERT: { status: 422, error: "nfse_sem_certificado" },
  CERT_SENHA_INVALIDA: { status: 422, error: "nfse_sem_certificado" },
  CERT_CNPJ_DIVERGENTE: { status: 422, error: "nfse_sem_certificado" },
});

/**
 * Traduz a exceção de `NfseService.sendEvent` em resposta HTTP.
 *
 * @returns {boolean} `false` quando o erro não é conhecido (o chamador responde 500).
 */
export function responderErroCancelamento(res, err) {
  const recusa = RECUSAS_LOCAIS[String(err?.code || "")];
  if (recusa) {
    res.status(recusa.status).json({
      ok: false,
      error: recusa.error,
      camada: CAMADA.NOSSA,
      codigo: err?.code || null,
      message: err?.message || null,
      // ⚠ NADA SAIU DA MÁQUINA nestas recusas, então tentar de novo (depois de corrigir) é seguro.
      podeTentarDeNovo: true,
      // ⚠ A LISTA FECHADA VIAJA JUNTO da recusa do motivo. Sem ela, a tela que recebeu
      // `c_motivo_invalido` não tem como se corrigir — e a lista é do LEIAUTE, não da tela.
      ...(err?.motivosAceitos ? { motivosAceitos: err.motivosAceitos } : {}),
    });
    return true;
  }

  // A falha do envio já vem classificada nas três camadas por `classificarFalha`.
  if (err?.camada) {
    const status = err.camada === CAMADA.TRANSPORTE ? 502 : err.camada === CAMADA.RECEITA ? 422 : 400;
    const error =
      err.camada === CAMADA.TRANSPORTE
        ? "nfse_cancelamento_transporte"
        : err.camada === CAMADA.RECEITA
          ? "nfse_cancelamento_rejeitado"
          : "nfse_cancelamento_local";
    res.status(status).json({
      ok: false,
      error,
      camada: err.camada,
      codigo: err.codigo || null,
      message: err.message || null,
      correcao: err.correcao || null,
      // ⚠⚠ O QUE A TELA PRECISA PARA NÃO CONVIDAR A REPETIR. `false` na camada TRANSPORTE, e é a
      // única das três em que ele é `false`: nas outras duas ou nada saiu da máquina, ou o sistema
      // nacional analisou e recusou — nos dois casos a nota certamente NÃO foi cancelada.
      podeTentarDeNovo: err.camada !== CAMADA.TRANSPORTE,
      providerData: err.providerData ?? null,
    });
    return true;
  }

  return false;
}
