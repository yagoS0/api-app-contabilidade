// Receita Integra v1.4: client_credentials, cache e até duas emissões/hora.
// A reserva deve ser atômica/durável e compartilhada por todas as réplicas.
const TOKEN_URL = 'https://api.receitafederal.gov.br/token';
const erro = code => Object.assign(new Error('Autenticação CBS indisponível.'), { code });

export function criarProvedorTokenCbs({ credencialId, lerCredencial, reservarEmissao, fetchImpl = globalThis.fetch, agora = Date.now, timeoutMs = 15000 }) {
  if (typeof credencialId !== 'string' || !credencialId || typeof lerCredencial !== 'function' || typeof reservarEmissao !== 'function' || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw erro('CBS_OAUTH_CONFIGURACAO');
  let cache = null, emAndamento = null;
  async function emitir() {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([ (async () => {
        const inicio = agora();
        const credencial = await lerCredencial({ credencialId, signal: controller.signal });
        if (controller.signal.aborted) throw erro('CBS_OAUTH_TIMEOUT');
        if (!credencial || typeof credencial.clientId !== 'string' || !credencial.clientId || /[:\r\n]/.test(credencial.clientId) || typeof credencial.clientSecret !== 'string' || !credencial.clientSecret || /[\r\n]/.test(credencial.clientSecret)) throw erro('CBS_OAUTH_CREDENCIAL');
        // Janela móvel, sem devolver a reserva após falha: emissão remota pode ter ocorrido.
        const reservado = await reservarEmissao({ credencialId, agora: agora(), janelaMs: 3600000, limite: 2, signal: controller.signal });
        if (controller.signal.aborted) throw erro('CBS_OAUTH_TIMEOUT');
        if (reservado !== true) throw erro('CBS_OAUTH_LIMITE');
        const response = await fetchImpl(TOKEN_URL, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Basic ${Buffer.from(`${credencial.clientId}:${credencial.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: 'grant_type=client_credentials' });
        if (response.status !== 200 || Number(response.headers?.get('content-length')) > 16384) { await response.body?.cancel?.().catch(() => {}); throw erro('CBS_OAUTH_RESPOSTA'); }
        if (!response.body?.getReader) throw erro('CBS_OAUTH_RESPOSTA');
        const reader = response.body.getReader(), partes = []; let tamanho = 0;
        try {
          for (;;) { const { value, done } = await reader.read(); if (done) break; tamanho += value.byteLength; if (tamanho > 16384) throw erro('CBS_OAUTH_RESPOSTA'); partes.push(Buffer.from(value)); }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const data = JSON.parse(Buffer.concat(partes, tamanho).toString('utf8'));
        if (typeof data?.access_token !== 'string' || !data.access_token || /[\r\n]/.test(data.access_token) || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 60 || data.expires_in > 3600) throw erro('CBS_OAUTH_RESPOSTA');
        if (controller.signal.aborted || agora() >= inicio + (data.expires_in - 60) * 1000) throw erro('CBS_OAUTH_TIMEOUT');
        cache = { token: data.access_token, expira: inicio + (data.expires_in - 60) * 1000 };
        return cache.token;
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(erro('CBS_OAUTH_TIMEOUT')); }, timeoutMs); }) ]);
    } catch (e) { throw erro(['CBS_OAUTH_LIMITE', 'CBS_OAUTH_TIMEOUT', 'CBS_OAUTH_CREDENCIAL', 'CBS_OAUTH_RESPOSTA'].includes(e?.code) ? e.code : 'CBS_OAUTH_INDISPONIVEL'); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  return async function obterToken({ signal } = {}) {
    if (signal?.aborted) throw erro('CBS_OAUTH_CANCELADO');
    if (cache && agora() < cache.expira) return cache.token;
    if (!emAndamento) emAndamento = emitir().finally(() => { emAndamento = null; });
    if (!signal) return emAndamento;
    // Cancelar um consumidor não cancela a emissão compartilhada dos demais.
    let abortar;
    try { return await Promise.race([emAndamento, new Promise((_, reject) => { abortar = () => reject(erro('CBS_OAUTH_CANCELADO')); signal.addEventListener('abort', abortar, { once: true }); if (signal.aborted) abortar(); })]); }
    finally { signal.removeEventListener('abort', abortar); }
  };
}
