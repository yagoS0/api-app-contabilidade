export function criarGuruConferenciaApi(request) {
  const base = companyId => `/nfse/guru-conferencia/${encodeURIComponent(companyId)}`;
  return {
    listarGuruConferencia: (companyId, pagina = 1, filtros = {}) => {
      const query = new URLSearchParams({ pagina: String(pagina) });
      for (const campo of ['campo', 'inicio', 'fim', 'estado']) if (filtros[campo]) query.set(campo, filtros[campo]);
      return request(`${base(companyId)}/preparacoes?${query}`);
    },
    obterGuruConferencia: (companyId, id) => request(`${base(companyId)}/preparacoes/${encodeURIComponent(id)}`),
    importarGuruConferencia: (companyId, periodo) => request(`${base(companyId)}/importacoes`, { method: 'POST', body: JSON.stringify(periodo) }),
    conferirGuruConferencia: (companyId, id, body) => request(`${base(companyId)}/preparacoes/${encodeURIComponent(id)}/conferir`, { method: 'POST', body: JSON.stringify(body) }),
    buscarNotasGuru: (companyId, busca = '', pagina = 1) => request(`${base(companyId)}/notas?${new URLSearchParams({ busca, pagina: String(pagina) })}`),
    obterNotaGuru: (companyId, notaId) => request(`${base(companyId)}/notas/${encodeURIComponent(notaId)}`),
    vincularNotaGuru: (companyId, id, body) => request(`${base(companyId)}/preparacoes/${encodeURIComponent(id)}/notas`, { method: 'POST', body: JSON.stringify(body) }),
    baixarNotaGuru: (companyId, id, notaId, formato) => {
      if (!['xml', 'danfse'].includes(formato)) return Promise.reject(new Error('Formato inválido'));
      return request(`${base(companyId)}/preparacoes/${encodeURIComponent(id)}/notas/${encodeURIComponent(notaId)}/${formato}`, { responseType: 'blob' });
    },
  };
}
