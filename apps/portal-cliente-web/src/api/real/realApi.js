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
import { competenciaPadrao } from "../../lib/format";
import { fluxoDeCaixaDeDemonstracao, dreDeDemonstracao } from "../../features/painel/lib/dadosDeDemonstracao";

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
  // ⚠ `FormData` NÃO leva `Content-Type` nosso: o navegador precisa escrever o dele, com o
  // `boundary` do multipart. Cravar `application/json` aqui faria o servidor receber um corpo que
  // ele não consegue separar — e o `multer` devolveria "arquivo ausente" sobre um arquivo enviado.
  const ehFormulario = typeof FormData !== "undefined" && init.body instanceof FormData;
  const headers = {
    ...(ehFormulario ? {} : { "Content-Type": "application/json" }),
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
  // ⚠ `FormData` vai INTEIRO, sem `JSON.stringify` — que devolveria `"{}"` e mandaria um corpo
  // vazio com cara de sucesso. Passar por `pedir()` (e não por um `fetch` à parte) é o que dá a
  // esta chamada o mesmo refresh single-flight do resto do app.
  if (body !== undefined) {
    init.body = typeof FormData !== "undefined" && body instanceof FormData ? body : JSON.stringify(body);
  }

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

    // O ZIP COM OS DANFSe DE VÁRIAS NOTAS — `GET /client/companies/:id/invoices/danfse/bulk`.
    //
    // > Pedido do dono (19/08/2026): *"a possibilidade de baixar notas em lote (…) quero o download
    // > no portal do cliente, e fazer o download dos DANFSe e não do XML."*
    //
    // ⚠ NENHUMA LISTA DE IDS VAI DAQUI. O que viaja é o FILTRO (a competência que está na tela), e
    // quem resolve quais notas entram é o servidor, com o mesmo `where` da listagem — é isso que
    // impede o zip de conter nota de outra empresa e que o mantém igual ao que a tabela mostra.
    //
    // ⚠ `direcao: "emitidas"` é o MESMO recorte de `getInvoices`, e tem de continuar sendo: o lote
    // que baixasse "todas" traria nota recebida que a tela nunca listou.
    //
    // ⚠⚠ A RECUSA PRECISA CHEGAR NOMEADA, com os NÚMEROS. **400 `lote_muito_grande`** traz
    // `encontradas` e `maximo` no corpo, e é o que a tela mostra em vez de "falha ao baixar" — o
    // teto existe justamente para a pessoa saber quantas notas há antes de o download morrer no
    // meio. Por isso o corpo inteiro sobe em `ApiError.corpo`, como `pedir()` já faz.
    //
    // ⚠ NÃO passa por `pedir()` de propósito, mesma razão do DANFSe individual: aquele faz
    // `res.json()` sempre, e um zip não é JSON.
    async baixarDanfseEmLote(companyId, { competencia } = {}) {
      const { accessToken } = lerSessao();
      const res = await fetchCru(
        `/client/companies/${encodeURIComponent(companyId)}/invoices/danfse/bulk${qs({
          direcao: "emitidas",
          competencia,
        })}`,
        { method: "GET" },
        accessToken
      );
      if (!res.ok) {
        const corpo = await lerCorpo(res);
        const codigo = String(corpo?.error || "").trim()
          || (res.status === 401 ? "unauthorized" : "danfse_lote_fetch_failed");
        throw new ApiError(
          res.status,
          codigo,
          String(corpo?.message || "").trim() || `Falha ao baixar o lote (HTTP ${res.status})`,
          corpo
        );
      }
      return res.blob();
    },

    // ⚠⚠ CANCELAR UMA NFS-e — ATO FISCAL IRREVERSÍVEL. Uma nota cancelada não volta.
    //
    // Contrato lido em `apps/api/src/routes/client/index.js` +
    // `apps/api/src/routes/nfseCancelamentoHttp.js`. A chave de acesso **não vai no corpo**: ela é
    // lida no servidor, de uma nota escopada pelo cliente. Mandá-la daqui deixaria qualquer um
    // cancelar a nota de outra empresa conhecendo a chave — que sai impressa no DANFSe.
    //
    // ⚠ `tipoEvento` também não vai: esta porta faz UMA coisa (`e101101`). A substituição é escopo
    // FECHADO por decisão do dono (19/08/2026).
    //
    // ⚠⚠ A RECUSA PRECISA CHEGAR INTEIRA. O corpo traz `camada` (NOSSA/TRANSPORTE/RECEITA),
    // `correcao`, `motivosAceitos` e — o mais importante — **`podeTentarDeNovo`**, que é `false`
    // no TRANSPORTE, onde o desfecho é DESCONHECIDO. `pedir()` já sobe o corpo inteiro no
    // `ApiError.corpo`; reduzir isso a um código apagaria justamente o que separa "corrija e tente"
    // de "NÃO tente de novo".
    async cancelarNota(companyId, notaId, { cMotivo, justificativa } = {}) {
      return pedir(
        `/client/companies/${encodeURIComponent(companyId)}/notas/${encodeURIComponent(notaId)}/cancelar`,
        { method: "POST", body: { cMotivo, justificativa } }
      );
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

    /**
     * ⚠⚠ ESTAS DUAS NÃO CHAMAM O SERVIDOR, E ISSO É DELIBERADO — não é código esquecido.
     *
     * Não existe rota de fluxo de caixa nem de DRE. ⚠ Não confundir com `getFluxo` acima: aquela é
     * a lista de guias liberadas EM ABERTO (só saídas, sem entradas, sem saldo) — o próprio backend
     * a descreve como "fluxo de caixa futuro a partir das obrigações fiscais". Não é a mesma coisa,
     * e somar as duas seria a tela discordando de si mesma.
     *
     * Elas existem AQUI, e não só no mock, por um motivo mecânico: `createApiClient` monta o
     * wrapper iterando `Object.keys(real)` — função ausente daqui **some do objeto** no modo
     * `real_with_mock_fallback`, e a tela quebra com `is not a function`.
     *
     * ⚠ O `demonstracao: true` que elas devolvem é o que acende o selo na tela. Quando a rota
     * existir, troque o corpo por `pedir(...)` e o backend passa a responder `demonstracao: false`
     * — o selo some sozinho, sem ninguém precisar lembrar.
     */
    async getFluxoCaixa(companyId, { competencia } = {}) {
      return fluxoDeCaixaDeDemonstracao(companyId, competencia || competenciaPadrao());
    },

    async getDre(companyId, { competencia } = {}) {
      return dreDeDemonstracao(companyId, competencia || competenciaPadrao());
    },

    /**
     * A SITUAÇÃO FISCAL — LEITURA do que o escritório já gravou.
     *
     * ⚠⚠ SÓ EXISTE ESTE VERBO, e é assim de propósito. Não há POST de situação fiscal no portal do
     * cliente: a consulta ao SERPRO é PAGA e o limite AV02 do `/Apoiar` é **por CONTRATANTE** —
     * uma consulta à toa de UMA empresa consome o limite da carteira inteira do escritório. Quem
     * consulta é o contador, na tela dele. **Não acrescente uma função que chame o SERPRO aqui.**
     *
     * ⚠ O servidor responde 403 `insufficient_role` abaixo de `CLIENT_ADMIN` — o relatório traz os
     * dados cadastrais e o quadro societário, e o piso escrito deste projeto para dado de sócio é
     * `CLIENT_ADMIN`. A tela já não chama por baixo disso; esta é a segunda barreira, não a única.
     */
    async getSituacaoFiscal(companyId) {
      return pedir(`/client/companies/${encodeURIComponent(companyId)}/situacao-fiscal`);
    },

    // --- Os tomadores para quem esta empresa JÁ emitiu -----------------------------------------
    //
    // ⚠ **SÓ LEITURA, E NÃO EXISTE OUTRA PORTA.** A memória é escrita por cada emissão autorizada
    // (`apps/api/src/application/nfse/tomadorEmitido.js`); não há POST, PATCH nem DELETE de tomador
    // no portal do cliente, e este arquivo não pode inventar um.
    //
    // Contrato LIDO de `apps/api/src/routes/client/index.js` (não deduzido):
    //   GET /client/companies/:companyId/nfse/tomadores -> { data: [...], total, recortada }
    //
    // ⚠ O `:companyId` é o `PortalClient.id`, como em toda rota `/client` — quem traduz para o id
    // da `Company` legada (que é o escopo da tabela) é `resolveLegacyCompanyId`, no SERVIDOR. Não
    // resolva nada aqui: esta confusão de ids já mordeu quatro vezes, e sempre em silêncio.
    async getTomadoresEmitidos(companyId) {
      const data = await pedir(
        `/client/companies/${encodeURIComponent(companyId)}/nfse/tomadores`
      );
      return Array.isArray(data?.data) ? data.data : [];
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

    // --- O LOTE POR PLANILHA: baixar o modelo e conferir o preenchido ------------------------
    //
    // ⚠⚠ **NENHUMA DAS DUAS EMITE NADA.** Uma baixa um .xlsx; a outra manda a planilha preenchida
    // e recebe as linhas CLASSIFICADAS. A emissão em lote é fase seguinte e não existe nesta tela.
    //
    // Contrato lido em `apps/api/src/routes/nfseLoteRoutes.js` (não deduzido):
    //   GET  /client/companies/:companyId/nfse/lote/modelo   -> o .xlsx cru
    //   POST /client/companies/:companyId/nfse/lote/leitura  -> multipart: arquivo + consultas + ajustes

    /**
     * O MODELO da planilha.
     *
     * ⚠⚠ NÃO PODE SER UM `<a href>`: a rota é autenticada e um link comum não leva o Bearer —
     * ele receberia 401 e o cliente veria um arquivo quebrado. Vem como **Blob** e a tela entrega
     * com `lib/baixarBlob.js`. Mesma razão do DANFSe.
     *
     * ⚠ NÃO passa por `pedir()` de propósito: aquele lê o corpo como JSON, e um .xlsx não é JSON.
     * O preço é não ter o refresh single-flight — por isso o 401 é traduzido para o MESMO
     * `ApiError(401, "unauthorized")` que o resto do app já sabe ler.
     */
    async baixarModeloDoLote(companyId) {
      const { accessToken } = lerSessao();
      const res = await fetchCru(
        `/client/companies/${encodeURIComponent(companyId)}/nfse/lote/modelo`,
        { method: "GET" },
        accessToken
      );
      if (!res.ok) {
        const corpo = await lerCorpo(res);
        const codigo = String(corpo?.error || "").trim()
          || (res.status === 401 ? "unauthorized" : "modelo_lote_fetch_failed");
        throw new ApiError(
          res.status,
          codigo,
          String(corpo?.message || "").trim() || `Não foi possível baixar o modelo (HTTP ${res.status})`,
          corpo
        );
      }
      return res.blob();
    },

    /**
     * A LEITURA da planilha preenchida — classificação linha a linha. **Não emite e não grava.**
     *
     * ⚠⚠ **O SEGUNDO PASSE VAI NO MESMO PEDIDO.** `consultas` é o mapa `documento -> resultado já
     * resolvido` das consultas que ESTE navegador fez (a Receita é consultada aqui, não no
     * servidor), e `ajustes` é `numeroDaLinhaNoExcel -> células que a pessoa digitou por cima`. Os
     * dois são **parciais por natureza**: 40 linhas resolvidas e 160 ainda em `consultar` é o
     * estado normal de uma planilha de 200, e é o que impede a tela de travar esperando tudo.
     *
     * ⚠ **O ARQUIVO VAI DE NOVO a cada passe**, e é isso que mantém a regra num lugar só: quem
     * classifica é sempre o backend, sobre o arquivo inteiro. Remontar o .xlsx no navegador exigiria
     * o SheetJS no bundle deste portal, que hoje **não tem nenhuma dependência fora do React**.
     *
     * ⚠ `companyId` vem do PATH, nunca do corpo — escopo por empresa é lei.
     */
    async lerPlanilhaDoLote(companyId, arquivo, { consultas = null, ajustes = null } = {}) {
      const form = new FormData();
      form.append("arquivo", arquivo);
      // ⚠ Só entram quando há algo: um `"{}"` a mais no corpo não muda o resultado, mas um `"null"`
      // literal chegaria como a string "null" e o servidor tentaria lê-la como JSON.
      if (consultas && Object.keys(consultas).length) form.append("consultas", JSON.stringify(consultas));
      if (ajustes && Object.keys(ajustes).length) form.append("ajustes", JSON.stringify(ajustes));
      return pedir(`/client/companies/${encodeURIComponent(companyId)}/nfse/lote/leitura`, {
        method: "POST",
        body: form,
      });
    },

    // --- O EXTRATO BANCÁRIO (OFX) ------------------------------------------------------------
    //
    // Contrato lido em `apps/api/src/routes/client/index.js` (não deduzido):
    //   POST /client/companies/:companyId/ofx/import  -> multipart, campo `file`
    //
    // ⚠⚠ NÃO EXISTE PREVIEW: este POST **JÁ GRAVA**. Não há "conferir antes de enviar" a prometer —
    // quem torna o reenvio seguro é o dedupe por TRANSAÇÃO (`lib/dedupeOfx.js`), no banco, não uma
    // etapa de conferência. A tela não pode sugerir o contrário.
    //
    // ⚠ O que entra é DÉBITO. O crédito volta contado em `foraDoEscopo` — nunca descartado em
    // silêncio. E nada disto vira lançamento contábil: tudo nasce na fila do contador.
    async importarExtratoOfx(companyId, arquivo) {
      const form = new FormData();
      // ⚠⚠ O CAMPO É `file`, NÃO `arquivo`. O lote (logo acima) usa `arquivo`, e copiar aquela
      // linha verbatim devolve **`400 file_required`** — é o erro mais provável de quem mexer aqui.
      // O nome sai do `upload.single("file")` da rota, não de convenção nossa.
      form.append("file", arquivo);
      return pedir(`/client/companies/${encodeURIComponent(companyId)}/ofx/import`, {
        method: "POST",
        body: form,
      });
    },

    // --- ⚠⚠ A EMISSÃO EM LOTE — AQUI SAI NOTA FISCAL DE VERDADE, EM SÉRIE ---------------------
    //
    // ⚠⚠ Cada linha da planilha vira um ato IRREVERSÍVEL no sistema nacional de produção. Nota
    // emitida não se apaga: cancela-se, e cancelar é outro ato.
    //
    // Contrato lido em `apps/api/src/routes/nfseLoteRoutes.js` (não deduzido):
    //   POST /client/companies/:id/nfse/lote/emissao              -> 202 {lote} | 200 {reconhecido}
    //   GET  /client/companies/:id/nfse/lote/emissao/:loteId      -> {lote}
    //   POST /client/companies/:id/nfse/lote/emissao/:loteId/retomar -> 202 {lote}
    //   POST /client/companies/:id/nfse/lote/emissao/:loteId/retentar -> 202 {lote, retentativa}
    //                                                                   422 `nada_a_retentar`
    //
    // ⚠ Com `INTEGRACAO_NFSE_LOTE` desligada as três respondem **503 `emissao_lote_desligada`**, e
    // essa recusa é NOMEADA — ou seja, o fallback do mock **não a engole** (ver `api/index.js`).

    /**
     * ⚠⚠ EMITE. Manda a MESMA planilha conferida; o servidor **reclassifica** e emite as prontas.
     *
     * ⚠ O ARQUIVO VAI DE NOVO, e não a lista de linhas. Mandar "o que emitir" deixaria o navegador
     * escolher por cima da regra — a linha que a classificação recusou entraria com um campo a mais
     * no JSON. Quem decide o que é `pronta` é o servidor, sempre.
     *
     * ⚠ A resposta é **202** (o lote está correndo; acompanhe por `consultarLoteEmissao`) ou **200**
     * com `reconhecido: true` — a mesma planilha já foi emitida e este é o relatório dela.
     */
    async emitirLoteDeNotas(companyId, arquivo, { consultas = null, ajustes = null } = {}) {
      const form = new FormData();
      form.append("arquivo", arquivo);
      if (consultas && Object.keys(consultas).length) form.append("consultas", JSON.stringify(consultas));
      if (ajustes && Object.keys(ajustes).length) form.append("ajustes", JSON.stringify(ajustes));
      return pedir(`/client/companies/${encodeURIComponent(companyId)}/nfse/lote/emissao`, {
        method: "POST",
        body: form,
      });
    },

    /** O relatório do lote. Só leitura — é o que a tela consulta enquanto o laço corre. */
    async consultarLoteEmissao(companyId, loteId) {
      return pedir(
        `/client/companies/${encodeURIComponent(companyId)}/nfse/lote/emissao/${encodeURIComponent(loteId)}`
      );
    },

    /**
     * ⚠⚠ RETOMA — e o servidor **jamais** reprocessa a linha indeterminada.
     *
     * A seleção lá é `numeroLinha > linhaIndeterminada`. Quem decide o que fazer com a linha cujo
     * desfecho não se sabe é o contador, olhando o portal nacional — não esta tela, e não sozinho.
     */
    async retomarLoteEmissao(companyId, loteId) {
      return pedir(
        `/client/companies/${encodeURIComponent(companyId)}/nfse/lote/emissao/${encodeURIComponent(loteId)}/retomar`,
        { method: "POST" }
      );
    },

    /**
     * ⚠⚠ RETENTA — emite de novo **só as linhas cujo desfecho PROVA que não existe nota**
     * (recusadas e não tentadas). `emitida` e `indeterminada` NUNCA entram, e quem garante isso é o
     * servidor, no `where` da reserva atômica: esta chamada não manda lista de linhas nenhuma.
     *
     * ⚠ Lote em que nada é retentável responde **422 `nada_a_retentar`** — recusa NOMEADA, logo o
     * fallback do mock não a engole. É por ela que passa a idempotência de sempre: subir a mesma
     * planilha depois de emitir com sucesso continua não reemitindo nada.
     */
    async retentarLoteEmissao(companyId, loteId) {
      return pedir(
        `/client/companies/${encodeURIComponent(companyId)}/nfse/lote/emissao/${encodeURIComponent(loteId)}/retentar`,
        { method: "POST" }
      );
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
