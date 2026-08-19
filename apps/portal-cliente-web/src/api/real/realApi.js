// Cliente HTTP real: navegador -> API do contador (Express, rotas /auth e /client).
//
// O contrato aqui não foi deduzido: foi lido de
//   - `apps/api/src/routes/auth.js`            (login / refresh / logout)
//   - `apps/api/src/routes/client/index.js`    (companies, guides, aliquotas, fluxo)
//   - `apps/api/src/routes/portalInvoices.js`  (invoices + summary)
// e conferido contra o app mobile, que já consome esta API em produção
// (`portal-cliente-mobile/src/api.ts`).

import { ApiError } from "../ApiError";
import { exigirContaDeCliente } from "../accountGate";
import { lerSessao, definirTokens, limparSessao } from "../sessionStore";
import { consultarCnpjNaBrasilApi } from "./brasilApi";

const BASE = String(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

async function lerCorpo(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchCru(path, init, token) {
  const headers = {
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (err) {
    // fetch só rejeita por rede/CORS. Status 0 = "não houve resposta".
    throw new ApiError(0, "network_error", err?.message || "network_error");
  }
}

// Single-flight do refresh: várias requisições que caem em 401 ao mesmo tempo
// compartilham UM refresh. Sem isso, N requisições rotacionam o refresh opaco N
// vezes e a última invalida as anteriores (o backend usa ClientSession
// rotativa) — o usuário seria deslogado justamente por ter várias abas/telas.
let refreshEmVoo = null;

async function renovar() {
  if (refreshEmVoo) return refreshEmVoo;
  refreshEmVoo = (async () => {
    const { refreshToken } = lerSessao();
    if (!refreshToken) return false;
    try {
      const res = await fetchCru("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await lerCorpo(res);
      if (data?.accessToken && data?.refreshToken) {
        definirTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshEmVoo = null;
    }
  })();
  return refreshEmVoo;
}

async function pedir(path, { method = "GET", body, auth = true } = {}) {
  const init = { method };
  if (body !== undefined) init.body = JSON.stringify(body);

  const token = auth ? lerSessao().accessToken : null;
  let res = await fetchCru(path, init, token);

  if (res.status === 401 && auth) {
    const renovou = await renovar();
    if (renovou) res = await fetchCru(path, init, lerSessao().accessToken);
    if (res.status === 401) {
      // Refresh falhou ou continua 401: a sessão morreu. Limpa marcando
      // `expirou` para que o login explique o motivo em vez de aparecer do nada.
      limparSessao({ expirou: true });
      throw new ApiError(401, "session_expired");
    }
  }

  if (!res.ok) {
    const data = await lerCorpo(res);
    const code = data?.error || data?.code || null;
    // ⚠ O CORPO INTEIRO VIAJA JUNTO. As recusas de emissão de NFS-e trazem `camada`, `correcao` e
    // `numeroReutilizavel` — sem eles a tela não consegue distinguir as três camadas, e é essa
    // distinção que impede um reenvio depois de uma falha de TRANSPORTE.
    throw new ApiError(res.status, code, data?.message || code, data);
  }

  return lerCorpo(res);
}

function qs(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createRealApi() {
  return {
    // --- Auth ---------------------------------------------------------------
    async login(email, password) {
      const data = await pedir("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      return exigirContaDeCliente(data);
    },

    async logout() {
      try {
        await pedir("/auth/logout", { method: "POST" });
      } catch {
        // Best-effort: mesmo falhando, a casca limpa o token local.
      }
    },

    // --- Recuperação de senha -----------------------------------------------
    //
    // ⚠ `solicitarRedefinicao` responde IGUAL para e-mail cadastrado e não cadastrado — é a regra
    // do backend (`POST /auth/forgot-password`), e a tela não tem como (nem deve) distinguir.
    // Qualquer tentativa de "melhorar" isto aqui, mostrando um aviso quando a conta não existe,
    // reintroduz a enumeração de usuário que o servidor fecha de propósito.
    //
    // -> { ok: true, message } — 503 `mail_not_configured` é o único desfecho diferente, e é
    //    sobre o servidor, não sobre a conta.
    async solicitarRedefinicao(email) {
      return pedir("/auth/forgot-password", {
        method: "POST",
        body: { email },
        auth: false,
      });
    },

    // ⚠ Token inválido, EXPIRADO e JÁ USADO chegam aqui como o MESMO `invalid_token` (400). A tela
    // não recebe motivo porque o servidor não manda motivo — dizer "já usado" contaria ao atacante
    // que o token existiu.
    // -> { ok: true }
    async redefinirSenha(token, password) {
      return pedir("/auth/reset-password", {
        method: "POST",
        body: { token, password },
        auth: false,
      });
    },

    // --- Empresas -----------------------------------------------------------
    // GET /client/companies -> { data: Company[] }; Company.companyId = PortalClient.id
    async getCompanies() {
      const data = await pedir("/client/companies");
      return Array.isArray(data?.data) ? data.data : [];
    },

    // --- Notas --------------------------------------------------------------
    // -> { data, page, limit, total, summary:{ totalInvoices, totalAmount, pageAmount }, sync }
    async getInvoices(companyId, { competencia, page = 1, limit = 25 } = {}) {
      return pedir(
        `/client/companies/${encodeURIComponent(companyId)}/invoices${qs({
          direcao: "emitidas",
          competencia,
          page,
          limit,
        })}`
      );
    },

    // O DANFSe da NFS-e (PDF do Padrão Nacional, NT 008), gerado sob demanda pelo backend.
    // Contrato lido em `apps/api/src/routes/client/index.js` + `apps/api/src/routes/danfseHttp.js`.
    //
    // ⚠⚠ NÃO PODE SER UM `<a href>`: a rota é autenticada e um link não leva o Bearer. Vem como
    // **Blob** e a tela entrega. (Este é o primeiro `res.blob()` deste app — o download de guia usa
    // base64 dentro de JSON porque a rota DELE responde JSON; aqui a rota responde o PDF cru.)
    //
    // ⚠⚠ A RECUSA PRECISA CHEGAR NOMEADA. A rota responde **503 `danfse_sem_qrcode`** (com
    // `motivo`) quando a chave está ausente ou o QR não pôde ser gerado — e isso é deliberado: um
    // DANFSe sem QR Code não é um DANFSe. Um `Error` genérico aqui viraria "falha ao baixar" na
    // tela, que é exatamente a informação errada. Por isso o corpo JSON é lido e
    // `code`/`motivo`/`status` sobem junto, como `pedir()` já faz nas demais rotas.
    //
    // ⚠ NÃO passa por `pedir()` de propósito: aquele faz `res.json()` sempre, e um PDF não é JSON.
    // O preço é não ter o refresh single-flight — por isso o 401 é traduzido para o MESMO
    // `ApiError(401, "unauthorized")` que o resto do app já sabe ler.
    async fetchDanfseBlob(companyId, notaId) {
      const { accessToken } = lerSessao();
      const res = await fetchCru(
        `/client/companies/${encodeURIComponent(companyId)}/notas/${encodeURIComponent(notaId)}/danfse`,
        { method: "GET" },
        accessToken
      );
      if (!res.ok) {
        const corpo = await lerCorpo(res);
        const codigo = String(corpo?.error || "").trim()
          || (res.status === 401 ? "unauthorized" : "danfse_fetch_failed");
        const err = new ApiError(
          res.status,
          codigo,
          String(corpo?.message || "").trim() || `Falha ao gerar o DANFSe (HTTP ${res.status})`,
          corpo
        );
        err.motivo = corpo?.motivo ?? null;
        throw err;
      }
      return res.blob();
    },

    // --- Guias --------------------------------------------------------------
    // GET /client/companies/:id/guides -> { data, page, limit, total }
    // ⚠ A rota já filtra `apenasLiberadas: true` — o cliente só vê guia que o
    // contador liberou. Não existe filtro nosso a acrescentar aqui.
    async getGuides(companyId, { competencia, page = 1, limit = 25 } = {}) {
      return pedir(
        `/client/companies/${encodeURIComponent(companyId)}/guides${qs({ competencia, page, limit })}`
      );
    },

    // -> { url, contentBase64, fileName, mimeType, expiresIn }
    async downloadGuide(companyId, guideId) {
      return pedir(
        `/client/companies/${encodeURIComponent(companyId)}/guides/${encodeURIComponent(guideId)}/download`
      );
    },

    // --- Alíquota / Fluxo (usados no resumo da Home) ------------------------
    async getAliquotas(companyId, { from, to } = {}) {
      const data = await pedir(
        `/client/companies/${encodeURIComponent(companyId)}/aliquotas${qs({ from, to })}`
      );
      return Array.isArray(data?.data) ? data.data : [];
    },

    async getFluxo(companyId) {
      return pedir(`/client/companies/${encodeURIComponent(companyId)}/fluxo`);
    },

    // --- Consulta do tomador na Receita (CNPJ) ------------------------------------------------
    //
    // ⚠ ESTA É A ÚNICA CHAMADA DESTE ARQUIVO QUE **NÃO** VAI PARA A API DO CONTADOR. A BrasilAPI é
    // pública e o pedido sai direto do navegador — sem token, sem `pedir()`, sem sessão. Por isso
    // ela também não derruba sessão nem passa pelo refresh.
    //
    // ⚠ Ela NUNCA lança. A recusa é `{ ok:false, motivo, mensagem }`, e é assim de propósito: um
    // erro lançado daqui entraria no `real_with_mock_fallback` de `api/index.js` e uma queda da
    // BrasilAPI viraria **dados do mock** numa tela que emite nota fiscal de verdade.
    async consultarCnpj(cnpj) {
      return consultarCnpjNaBrasilApi(cnpj);
    },

    // --- Emissão de NFS-e ---------------------------------------------------
    //
    // ⚠⚠ **ESTE É O ÚNICO MÉTODO DESTE ARQUIVO QUE MUDA O MUNDO FORA DO SISTEMA.** Ele bate na
    // fachada `POST /client/companies/:companyId/nfse`, que delega ao MESMO `NfseService.issue`
    // do portal do escritório — e o caminho está apontado para o **sistema nacional de
    // PRODUÇÃO** (`NFSE_ENV=producao`). O que sai daqui vira nota fiscal de verdade, e a NFS-e
    // **não tem inutilização**: o conserto de uma nota errada é cancelamento, não edição.
    //
    // Contrato lido em (não deduzido):
    //   `apps/api/src/routes/client/index.js`                     (a fachada e o portão)
    //   `apps/api/src/application/validators/nfsePayload.js`      (os campos exatos do corpo)
    //   `apps/api/src/routes/nfseEmissaoHttp.js`                  (os desfechos em três camadas)
    //
    // ⚠ `companyId` **não vai no corpo**: ele vem do PATH, e a fachada sobrescreve
    // (`{...body, companyId: path}`) justamente para que um id no corpo não desvie a emissão para
    // outra empresa depois de a permissão ter sido conferida nesta.
    //
    // ⚠ `retryInvoiceId` reaproveita a linha da tentativa anterior em vez de queimar um número
    // novo. Só deve ser mandado quando o servidor disse `numeroReutilizavel: true` — nunca depois
    // de uma falha de TRANSPORTE, em que o próprio servidor recusa com
    // `nfse_numero_em_estado_indeterminado`.
    async emitirNfse(companyId, payload, { retryInvoiceId = null } = {}) {
      const corpo = { ...payload };
      if (retryInvoiceId) corpo.retryInvoiceId = retryInvoiceId;
      return pedir(`/client/companies/${encodeURIComponent(companyId)}/nfse`, {
        method: "POST",
        body: corpo,
      });
    },
  };
}
