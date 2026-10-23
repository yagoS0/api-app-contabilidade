import { erroGuru } from './cobrancaManual.js';
import { periodoGuru } from './transacaoGuru.js';

// Não há método genérico de URL, POST, redirects, retry ou fallback de provedor.
export function criarGuruHttpClient({ fetchImpl = globalThis.fetch, timeoutMs = 8000, maxBytes = 2_000_000 } = {}) {
  return {
    async pagina({ token, periodo, cursor = null }) {
      const filtro = periodoGuru(periodo);
      if (typeof token !== 'string' || !token || /\s/.test(token)) throw erroGuru('guru_desconectado', 409);
      if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 2048)) throw erroGuru('guru_envelope_invalido', 502);
      const url = new URL('https://digitalmanager.guru/api/v2/transactions/');
      url.searchParams.set(`${filtro.campo}_ini`, filtro.inicio);
      url.searchParams.set(`${filtro.campo}_end`, filtro.fim);
      if (cursor) url.searchParams.set('cursor', cursor);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), { method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (response.status >= 300 && response.status < 400) throw erroGuru('guru_redirect_recusado', 502);
        if ([401, 403].includes(response.status)) throw erroGuru('guru_credencial_recusada', 502);
        if (response.status === 429) throw erroGuru('guru_limite_requisicoes', 429);
        if (response.status !== 200) throw erroGuru('guru_origem_indisponivel', 502);
        if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw erroGuru('guru_envelope_invalido', 502);
        if (Number(response.headers.get('content-length')) > maxBytes) throw erroGuru('guru_resposta_excessiva', 502);
        if (!response.body?.getReader) throw erroGuru('guru_envelope_invalido', 502);
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) { controller.abort(); throw erroGuru('guru_resposta_excessiva', 502); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw erroGuru('guru_envelope_invalido', 502); }
        if (!data || !Array.isArray(data.data) || ![true, false, 0, 1].includes(data.has_more_pages)
          || (data.total_rows != null && (!Number.isSafeInteger(data.total_rows) || data.total_rows < 0))
          || (Boolean(data.has_more_pages) && (typeof data.next_cursor !== 'string' || !data.next_cursor || data.next_cursor.length > 2048))) {
          throw erroGuru('guru_envelope_invalido', 502);
        }
        return { data: data.data, hasMore: Boolean(data.has_more_pages), nextCursor: data.next_cursor || null, total: data.total_rows ?? null };
      } catch (error) {
        // Nunca devolver error.message/cause/body do transporte: podem conter token.
        if (['guru_redirect_recusado', 'guru_credencial_recusada', 'guru_limite_requisicoes',
          'guru_origem_indisponivel', 'guru_envelope_invalido', 'guru_resposta_excessiva'].includes(error?.code)) throw erroGuru(error.code, error.status);
        throw erroGuru(controller.signal.aborted ? 'guru_timeout' : 'guru_origem_indisponivel', 502);
      } finally { clearTimeout(timer); controller.abort(); }
    },
  };
}
