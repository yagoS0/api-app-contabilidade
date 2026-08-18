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
 */
function deveCairParaMock(err) {
  const status = Number(err?.status);
  if (status === 0) return true; // falha de rede: não houve resposta
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
