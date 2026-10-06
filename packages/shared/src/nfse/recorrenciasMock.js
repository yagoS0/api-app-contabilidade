// Demonstração em memória. Nunca executa nem simula autorização fiscal.
export function criarRecorrenciasMock() {
  const items = [];
  const copiar = value => JSON.parse(JSON.stringify(value));
  return {
    async listarRecorrenciasNfse(companyId) { return { items: copiar(items.filter(i => i.companyId === companyId)), workerAtivo: false }; },
    async criarRecorrenciaNfse(companyId, body) {
      if (!Number.isInteger(body.dia) || body.dia < 1 || body.dia > 31 || !body.inicio || body.confirmada !== true) throw new Error('Confira o dia e a primeira emissão.');
      const existente = items.find(i => i.id === body.requestId && i.companyId === companyId);
      if (existente) return copiar(existente);
      const item = { id: body.requestId, companyId, dia: body.dia, proximaData: body.inicio, modelo: copiar(body.modelo), ambiente: 'homolog', ativa: true, execucoes: [] };
      items.push(item);
      return copiar(item);
    },
    async alterarRecorrenciaNfse(companyId, id, acao, body) {
      const item = items.find(i => i.companyId === companyId && i.id === id);
      if (!item) throw new Error('Recorrência não encontrada.');
      if (acao === 'retomar' && (!body.inicio || !body.confirmada)) throw new Error('Informe a nova primeira emissão.');
      item.ativa = acao === 'retomar';
      if (item.ativa) item.proximaData = body.inicio;
      return { ok: true };
    },
  };
}
