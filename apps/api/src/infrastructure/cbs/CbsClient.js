import { criarTransporteDownloadCbs } from './CbsDownloadSeguro.js';
// Contrato público CBS v2 consultado em 11/10/2026. Não há retry, agenda ou cursor local.
// Este adaptador só é construído por uma integração explicitamente homologada.
const BASES = Object.freeze({ HOMOLOGACAO: 'https://api.receitafederal.gov.br/apuracao-cbs-prr/v2', PRODUCAO: 'https://api.receitafederal.gov.br/apuracao-cbs/v2' });
const TIPOS = Object.freeze({ DEBITOS: 'debitos', CREDITOS: 'creditos' });
const MARCA = Symbol('falhaCbs');
const falha = (code, resultadoIncerto = false) => Object.assign(new Error('Não foi possível concluir a operação CBS. Consulte a situação antes de repetir.'), { code, resultadoIncerto, [MARCA]: true });
const ticketValido = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(value);
const objeto = value => value && typeof value === 'object' && !Array.isArray(value);

function httpsPublico(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash || (u.port && u.port !== '443')) throw Error();
    if (!/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.') || /^\d+\./.test(u.hostname) || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local')) throw Error();
    return u;
  } catch { throw falha('CBS_URL_INVALIDA'); }
}

async function lerLimitado(response, limite, controller) {
  const anunciado = Number(response.headers?.get('content-length'));
  if (Number.isFinite(anunciado) && anunciado > limite) {
    controller.abort(); await response.body?.cancel?.().catch(() => {});
    throw falha('CBS_RESPOSTA_EXCEDE_LIMITE');
  }
  if (!response.body?.getReader) throw falha('CBS_RESPOSTA_INVALIDA');
  const reader = response.body.getReader(), partes = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > limite) { controller.abort(); throw falha('CBS_RESPOSTA_EXCEDE_LIMITE'); }
      partes.push(Buffer.from(value));
    }
    return Buffer.concat(partes, tamanho);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function criarClienteCbs({ ambiente, contexto, obterToken, fetchImpl = globalThis.fetch, downloadFetchImpl = criarTransporteDownloadCbs(), urlRetorno, hostsDownloadPermitidos = [], timeoutMs = 30000, maxArquivoBytes = 10 * 1024 * 1024, agora = () => new Date() }) {
  if (!Object.hasOwn(BASES, ambiente) || typeof obterToken !== 'function' || typeof fetchImpl !== 'function' || typeof downloadFetchImpl !== 'function') throw falha('CBS_CONFIGURACAO_INVALIDA');
  const callback = httpsPublico(urlRetorno);
  if (callback.search) throw falha('CBS_CALLBACK_INVALIDO');
  if (!Array.isArray(hostsDownloadPermitidos) || hostsDownloadPermitidos.some(h => typeof h !== 'string' || httpsPublico(`https://${h}`).hostname !== h)) throw falha('CBS_HOST_DOWNLOAD_INVALIDO');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Number.isSafeInteger(maxArquivoBytes) || maxArquivoBytes < 1 || maxArquivoBytes > 10 * 1024 * 1024) throw falha('CBS_LIMITE_INVALIDO');
  const hosts = new Set(hostsDownloadPermitidos);
  async function requisitar(url, { abertura = false, download = false, body } = {}) {
    let token;
    if (!download) {
      const authController = new AbortController(); let authTimer;
      try {
        token = await Promise.race([Promise.resolve().then(() => obterToken({ signal: authController.signal })), new Promise((_, reject) => {
          authTimer = setTimeout(() => { authController.abort(); reject(falha('CBS_CREDENCIAL_INDISPONIVEL')); }, timeoutMs);
          authTimer.unref?.();
        })]);
      } catch { throw falha('CBS_CREDENCIAL_INDISPONIVEL'); }
      finally { clearTimeout(authTimer); }
      if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw falha('CBS_CREDENCIAL_INDISPONIVEL');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
    let enviado = false;
    try {
      enviado = true;
      const response = await (download ? downloadFetchImpl : fetchImpl)(url, { method: abertura ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(!download ? { Authorization: `Bearer ${token}` } : {}), ...(abertura ? { 'Content-Type': 'application/json' } : {}) },
        ...(abertura ? { body: JSON.stringify(body) } : {}) });
      if (response.status !== (abertura ? 201 : 200)) {
        await response.body?.cancel?.().catch(() => {});
        throw falha(`CBS_HTTP_${Number.isInteger(response.status) ? response.status : 'INVALIDO'}`, abertura && (response.status >= 500 || response.status === 408 || response.status < 400));
      }
      const bytes = await lerLimitado(response, download ? maxArquivoBytes : 65536, controller);
      if (download) return bytes;
      try { const data = JSON.parse(bytes.toString('utf8')); if (!objeto(data)) throw Error(); return data; }
      catch { throw falha('CBS_RESPOSTA_INVALIDA', abertura); }
    } catch (e) {
      // Nunca propagar URL pré-assinada, Bearer, erro de transporte ou payload arbitrário.
      if (e?.[MARCA]) { if (abertura && enviado && !e.code.startsWith('CBS_HTTP_')) e.resultadoIncerto = true; throw e; }
      throw falha(controller.signal.aborted ? 'CBS_TEMPO_ESGOTADO' : 'CBS_TRANSPORTE_INDISPONIVEL', abertura && enviado);
    } finally { clearTimeout(timer); token = undefined; }
  }
  return Object.freeze({
    ambiente,
    contexto: contexto ? Object.freeze({ contribuinteId: contexto.contribuinteId, credencialId: contexto.credencialId }) : null,
    async abrir({ cnpjBase, tipo }) {
      // O contrato publicado ainda descreve oito dígitos; não presumir suporte alfanumérico remoto.
      if (typeof cnpjBase !== 'string' || !/^\d{8}$/.test(cnpjBase) || !Object.hasOwn(TIPOS, tipo)) throw falha('CBS_CONTEXTO_NAO_SUPORTADO');
      const data = await requisitar(`${BASES[ambiente]}/${TIPOS[tipo]}/${cnpjBase}`, { abertura: true, body: { urlRetorno: callback.href } });
      if (!ticketValido(data.tiqueteSolicitacao) || typeof data.tEASegundos !== 'string' || !/^\d{1,8}$/.test(data.tEASegundos)) throw falha('CBS_ABERTURA_INVALIDA', true);
      return { tiqueteSolicitacao: data.tiqueteSolicitacao, tEASegundos: data.tEASegundos };
    },
    async consultar({ tiqueteSolicitacao }) {
      if (!ticketValido(tiqueteSolicitacao)) throw falha('CBS_TIQUETE_INVALIDO');
      const data = await requisitar(`${BASES[ambiente]}/situacao/${encodeURIComponent(tiqueteSolicitacao)}`);
      if (!['PENDENTE', 'EM_PROCESSAMENTO', 'CONCLUIDA', 'ERRO'].includes(data.estado)) throw falha('CBS_SITUACAO_INVALIDA');
      if (data.estado === 'CONCLUIDA') {
        const u = httpsPublico(data.urlAssinada);
        if (!hosts.has(u.hostname) || !Number.isFinite(Date.parse(data.urlAssinadaExpiraEm))) throw falha('CBS_DOWNLOAD_NAO_AUTORIZADO');
        return { estado: data.estado, urlAssinada: u.href, urlAssinadaExpiraEm: data.urlAssinadaExpiraEm };
      }
      if (data.estado === 'ERRO') return { estado: data.estado, codigoErro: typeof data.codigoErro === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(data.codigoErro) ? data.codigoErro : 'CBS_ERRO_REMOTO' };
      return { estado: data.estado };
    },
    async baixar({ urlAssinada, urlAssinadaExpiraEm }) {
      const u = httpsPublico(urlAssinada), expira = Date.parse(urlAssinadaExpiraEm);
      if (!hosts.has(u.hostname)) throw falha('CBS_DOWNLOAD_NAO_AUTORIZADO');
      if (!Number.isFinite(expira) || expira <= agora().getTime()) throw falha('CBS_ARQUIVO_EXPIRADO');
      return requisitar(u.href, { download: true });
    },
  });
}
