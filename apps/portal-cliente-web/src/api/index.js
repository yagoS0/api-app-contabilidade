// Seleção da implementação de API — mesmo padrão de `apps/web/src/api/client.js`.
//
//   VITE_API_MODE=mock                   (default) usa só o mock, sem backend
//   VITE_API_MODE=real                   usa só a API de verdade
//   VITE_API_MODE=real_with_mock_fallback tenta a real e cai para o mock
//
// Nenhum componente chama `fetch` direto: tudo passa por aqui.

import { createMockApi } from "./mock/mockApi";
import { createRealApi } from "./real/realApi";

/**
 * ⚠ O fallback NÃO engole erro de autenticação nem de autorização.
 *
 * Se a real responder 401/403 e o mock atendesse no lugar, qualquer senha do
 * mock abriria a tela como se fosse a API de verdade — e o modo "fallback"
 * viraria um bypass de login. O fallback existe para BACKEND FORA DO AR
 * (rede caiu, porta 3000 vazia, 5xx), não para credencial recusada.
 *
 * ⚠⚠ E ELE TAMBÉM NÃO ENGOLE UMA RECUSA NOMEADA — medido em 19/08/2026, ao
 * ligar o DANFSe. A regra era só `status >= 500`, e há recusas DELIBERADAS do
 * backend nessa faixa. O que acontecia:
 *
 *   • `503 danfse_sem_qrcode` — o servidor recusa de propósito, porque um
 *     DANFSe sem QR Code não é um DANFSe (NT 008 §2.2/§2.4.3). Com o fallback,
 *     o mock devolvia um PDF **válido** no lugar da recusa: exatamente o
 *     documento inválido servido em silêncio que esse 503 existe para impedir.
 *   • `502` da camada **TRANSPORTE** da emissão — desfecho DESCONHECIDO (a DPS
 *     pode ter sido processada). O mock respondia `status: "issued"`, e a tela
 *     dizia ao cliente que a nota saiu quando ninguém sabe se saiu.
 *   • `503 mail_not_configured` — o mock fingia que o e-mail de redefinição de
 *     senha foi enviado.
 *
 * O que separa os dois casos é o CORPO, não o status: um backend fora do ar não
 * responde o nosso JSON. `pedir()` preenche `code` a partir de `error`/`code`
 * do corpo (`realApi.js`), então **`code` presente = o servidor respondeu, e
 * respondeu isto**. Fallback só quando não houve resposta nossa nenhuma.
 */
function deveCairParaMock(err) {
  const status = Number(err?.status);
  if (status === 0) return true; // falha de rede: não houve resposta
  if (err?.code) return false; // recusa NOMEADA: o servidor respondeu, e a resposta é essa
  return Number.isFinite(status) && status >= 500;
}

export function createApiClient() {
  const mode = String(import.meta.env.VITE_API_MODE || "mock").toLowerCase();
  const mock = createMockApi();
  const real = createRealApi();

  if (mode === "real") return { mode: "real", ...real };

  if (mode === "real_with_mock_fallback") {
    const envolvido = { mode: "real_with_mock_fallback" };
    for (const chave of Object.keys(real)) {
      const fnReal = real[chave];
      const fnMock = mock[chave];
      envolvido[chave] =
        typeof fnReal === "function" && typeof fnMock === "function"
          ? async (...args) => {
              try {
                return await fnReal(...args);
              } catch (err) {
                if (!deveCairParaMock(err)) throw err;
                return fnMock(...args);
              }
            }
          : fnReal ?? fnMock;
    }
    return envolvido;
  }

  return { mode: "mock", ...mock };
}

export const api = createApiClient();
