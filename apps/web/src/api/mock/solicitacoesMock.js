import { criarMockTarefasCalendario, acessoTarefasMock } from './tarefasCalendarioMock.js';
// Isolated demonstration state; never changes chat ownership or transports data.
export function criarSolicitacoesMock(empresas = [], estadoTarefas = { tarefas: [], vinculos: new Map() }, calendario = criarMockTarefasCalendario(empresas, estadoTarefas)) {
  const empresa = empresas[0];
  const empresaId = empresa?.companyId || empresa?.id || empresa?.portalClientId;
  let seq = 1;
  const rows = empresaId ? [{ id: 'solicitacao-demo-1', portalClientId: empresaId, empresaId,
    empresa: empresa.razao || empresa.nome || 'Empresa de demonstração', conversaId: null,
    titulo: 'Conferir documento recebido', motivo: 'Conferir documento recebido', resumo: 'Pedido de demonstração, sem envio externo.',
    contratoVersao: 1, adocaoPendente: false, estado: 'AGUARDANDO', situacao: 'NOVA', revisao: 1, versao: '1'.padStart(64, '0') }] : [];
  const comandos = new Map();
  const acl = acessoTarefasMock(empresas, estadoTarefas);
  const permitido = row => acl.origem({ solicitacaoId: row.id, empresaOrigemId: row.portalClientId ?? null });
  const tarefaVinculada = row => estadoTarefas.tarefas.find(t => estadoTarefas.vinculos.get(t.id)?.solicitacaoId === row.id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const vinculo = row => {
    const tarefa = tarefaVinculada(row);
    return tarefa && permitido(row) && acl.tarefa(tarefa) ? { tarefa: { id: tarefa.id, podeAbrir: true,
      estado: tarefa.excluidaEm ? 'EXCLUIDA' : tarefa.config.recorrencia === 'AVULSA' && tarefa.estados?.[tarefa.config.dataInicio]?.canceladaEm ? 'CANCELADA' : 'ATIVA',
      ciclosCancelados: Object.keys(tarefa.estados || {}).filter(k => tarefa.estados[k].canceladaEm) } } : {};
  };
  let conversao = Promise.resolve();
  const dto = row => clone({ prioridade: null, prazoCivil: null, responsavelId: null, criadorId: 'mock-contador',
    concluidoPorId: null, concluidoEm: null, observacaoConclusao: null, anotacaoId: null, mensagemId: null,
    origem: 'MANUAL', origemDados: null, adocaoPendente: row.contratoVersao !== 1,
    createdAt: '2026-10-25T12:00:00.000Z', updatedAt: '2026-10-25T12:00:00.000Z',
    ...row, ...vinculo(row), triagem: !row.portalClientId, estadoLegado: row.estado });
  // Presentation belongs to reads, never to commands/replays or their versions.
  const apresentar = item => {
    const nome = value => typeof value === 'string' && value.trim() ? value : null;
    const usuarios = estadoTarefas.acesso?.usuarios || [
      { id: 'mock', name: 'Operador de demonstração', ativo: true },
      { id: 'mock-contador', name: 'Contador de demonstração', ativo: true },
    ];
    const pessoa = id => {
      const ref = usuarios.find(u => u.id === id && u.ativo && (!u.accountType || u.accountType === 'FIRM' || u.role === 'admin'));
      return ref ? { id, nome: nome(ref.name) } : null;
    };
    const ref = empresas.find(e => (e.companyId || e.id || e.portalClientId) === item.portalClientId);
    return { ...item, apresentacao: {
      empresa: ref ? { id: item.portalClientId, nome: nome(ref.razao) } : null,
      responsavel: pessoa(item.responsavelId), criador: pessoa(item.criadorId),
    } };
  };
  const alterar = (acao, id, body) => {
    const row = rows.find(r => r.id === id);
    if (!row || !permitido(row)) throw new Error('Solicitação não encontrada.');
    const fingerprint = JSON.stringify({ acao, id, body });
    if (!body?.chave) throw new Error('Chave obrigatória.');
    const anterior = comandos.get(`${acl.atorId()}:${body.chave}`);
    if (anterior) { if (anterior.fingerprint !== fingerprint) throw new Error('Chave divergente.'); return { ok: true, item: dto(row) }; }
    if (body.versao !== row.versao) throw new Error('A solicitação mudou. Atualize a fila.');
    if (acao === 'adotar') throw new Error('Este registro já usa o contrato individual.');
    if (row.estado === 'RESOLVIDO' && acao !== 'reabrir') throw new Error('Reabra a solicitação antes de editar.');
    if (acao === 'reabrir' && row.situacao !== 'CONCLUIDA') throw new Error('Conclusão não comprovada.');
    if (acao === 'concluir') Object.assign(row, { estado: 'RESOLVIDO', situacao: 'CONCLUIDA', concluidoPorId: 'mock-contador', concluidoEm: new Date().toISOString(), observacaoConclusao: body.observacao?.trim() || null });
    if (acao === 'assumir') Object.assign(row, { responsavelId: 'mock-contador', estado: 'EM_ATENDIMENTO', situacao: 'EM_ATENDIMENTO' });
    if (acao === 'reabrir') Object.assign(row, { estado: 'AGUARDANDO', situacao: 'NOVA', concluidoPorId: null, concluidoEm: null, observacaoConclusao: null });
    if (acao === 'editar') {
      const dados = body.dados || {};
      const campos = ['titulo', 'resumo', 'prioridade', 'prazoCivil', 'responsavelId', 'portalClientId', 'situacao'];
      if (!Object.keys(dados).length || Object.keys(dados).some(k => !campos.includes(k))) throw new Error('Campo não permitido.');
      if (dados.portalClientId && row.portalClientId && dados.portalClientId !== row.portalClientId) throw new Error('Empresa original preservada.');
      if ('portalClientId' in dados && dados.portalClientId !== row.portalClientId && tarefaVinculada(row)) throw new Error('Empresa original preservada.');
      const estados = { NOVA: 'AGUARDANDO', EM_ATENDIMENTO: 'EM_ATENDIMENTO', AGUARDANDO_CLIENTE: 'AGUARDANDO_CLIENTE' };
      if (dados.situacao && !estados[dados.situacao]) throw new Error('Situação inválida.');
      Object.assign(row, dados, dados.situacao ? { estado: estados[dados.situacao] } : {});
    }
    row.revisao++; row.versao = (++seq).toString(16).padStart(64, '0');
    row.updatedAt = new Date().toISOString();
    const result = { ok: true, item: dto(row) };
    comandos.set(`${acl.atorId()}:${body.chave}`, { fingerprint, result });
    return result;
  };
  return {
    converterSolicitacaoEmTarefa(id, body) {
      const run = conversao.then(async () => {
        const row = rows.find(r => r.id === id);
        if (!row || !permitido(row)) throw new Error('Solicitação não encontrada.');
        if (!body?.chave || Object.keys(body).some(k => !['chave', 'versao', 'dados'].includes(k))) throw new Error('Comando inválido.');
        const fingerprint = JSON.stringify({ acao: 'tarefa', id, body });
        const anterior = comandos.get(`${acl.atorId()}:${body.chave}`);
        if (anterior) {
          if (anterior.fingerprint !== fingerprint) throw new Error('Chave divergente.');
          if (!tarefaVinculada(row) || !acl.tarefa(tarefaVinculada(row))) throw new Error('Tarefa não encontrada.');
          return { ok: true, item: dto(row) };
        }
        if (row.contratoVersao !== 1 || body.versao !== row.versao) throw new Error('Versão conflitante.');
        if (tarefaVinculada(row)) throw new Error('Solicitação já vinculada.');
        const dados = body.dados;
        if (!dados || !Object.hasOwn(dados, 'responsavelId') || Object.keys(dados).some(k => !['titulo', 'descricao', 'empresasIds', 'subtarefas', 'config', 'responsavelId'].includes(k))) throw new Error('Dados inválidos.');
        if (row.portalClientId ? dados.empresasIds?.length !== 1 || dados.empresasIds[0] !== row.portalClientId : dados.empresasIds?.length) throw new Error('Empresa original preservada.');
        acl.validar(dados, { solicitacaoId: id, empresaOrigemId: row.portalClientId ?? null });
        const { tarefa } = await calendario.criarTarefaCalendario({ ...dados, subtarefas: (dados.subtarefas || []).map(s => ({ ...s, id: s.id || crypto.randomUUID() })) });
        estadoTarefas.vinculos.set(tarefa.id, { solicitacaoId: id, empresaOrigemId: row.portalClientId ?? null });
        row.revisao++; row.versao = (++seq).toString(16).padStart(64, '0'); row.updatedAt = new Date().toISOString();
        comandos.set(`${acl.atorId()}:${body.chave}`, { fingerprint });
        return { ok: true, item: dto(row) };
      });
      conversao = run.catch(() => {});
      return run;
    },
    async getPendenciasSuporte(companyId, { cursor = null } = {}) {
      const lista = await this.listarSolicitacoes({ ...(companyId ? { portalClientId: companyId } : {}), situacao: 'ABERTAS', limite: 100, cursor });
      return { ok: true, total: lista.total, porEmpresa: lista.porEmpresa, proximoCursor: lista.proximoCursor,
        itens: lista.itens.map(item => ({ ...item, estado: item.estadoLegado, empresaId: item.portalClientId,
          empresa: empresas.find(e => (e.companyId || e.id || e.portalClientId) === item.portalClientId)?.razao || item.empresa || '' })) };
    },
    async listarSolicitacoes({ limite = 50, cursor = null, ...filtros } = {}) {
      if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw new Error('Limite inválido.');
      if (Object.keys(filtros).some(k => !['portalClientId', 'triagem', 'situacao', 'prioridade', 'responsavelId', 'busca', 'recorte'].includes(k))) throw new Error('Filtro inválido.');
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const recortes = { novas: r => r.estado === 'AGUARDANDO', prioritarias: r => r.estado !== 'RESOLVIDO' && r.prioridade === 'ALTA',
        atrasadas: r => r.estado !== 'RESOLVIDO' && r.prazoCivil && r.prazoCivil < hoje, semResponsavel: r => r.estado !== 'RESOLVIDO' && !r.responsavelId };
      const conjunto = rows.filter(permitido).map(dto).filter(r => (!filtros.portalClientId || r.portalClientId === filtros.portalClientId)
        && (!('triagem' in filtros) || r.triagem === filtros.triagem)
        && (!filtros.situacao || (filtros.situacao === 'ABERTAS' ? r.estado !== 'RESOLVIDO' : r.situacao === filtros.situacao))
        && (!('prioridade' in filtros) || r.prioridade === filtros.prioridade)
        && (!('responsavelId' in filtros) || r.responsavelId === filtros.responsavelId)
        && (!filtros.busca || `${r.titulo} ${r.resumo} ${r.empresa || ''}`.toLowerCase().includes(filtros.busca.toLowerCase()))
        && (!filtros.recorte || recortes[filtros.recorte]?.(r)));
      const assinatura = JSON.stringify(filtros);
      let inicio = 0;
      if (cursor) { const c = JSON.parse(cursor); if (c.assinatura !== assinatura || !Number.isInteger(c.inicio) || c.inicio < 0) throw new Error('Cursor inválido.'); inicio = c.inicio; }
      const porEmpresa = {}, porPrioridade = { ALTA: 0, MEDIA: 0, BAIXA: 0, NAO_CLASSIFICADA: 0 };
      for (const r of conjunto) { if (r.portalClientId) porEmpresa[r.portalClientId] = (porEmpresa[r.portalClientId] || 0) + 1; if (r.estado !== 'RESOLVIDO') porPrioridade[r.prioridade || 'NAO_CLASSIFICADA']++; }
      return { ok: true, total: conjunto.length, itens: conjunto.slice(inicio, inicio + limite).map(apresentar), hoje, porEmpresa, porPrioridade,
        resumo: Object.fromEntries(Object.entries(recortes).map(([key, match]) => [key, conjunto.filter(match).length])),
        proximoCursor: inicio + limite < conjunto.length ? JSON.stringify({ assinatura, inicio: inicio + limite }) : null };
    },
    async detalharSolicitacao(id) { const row = rows.find(r => r.id === id); if (!row || !permitido(row)) throw new Error('Solicitação não encontrada.'); return { ok: true, item: { ...apresentar(dto(row)), eventos: [], mensagens: [] } }; },
    async criarSolicitacao({ chave, dados }) {
      if (!chave || !dados?.titulo || !dados?.resumo) throw new Error('Dados incompletos.');
      const fingerprint = JSON.stringify({ chave, dados });
      const anterior = comandos.get(`${acl.atorId()}:${chave}`);
      if (anterior) {
        if (anterior.fingerprint !== fingerprint) throw new Error('Chave divergente.');
        const atual = rows.find(r => r.id === anterior.result.item.id);
        if (!atual || !permitido(atual)) throw new Error('Solicitação não encontrada.');
        return { ok: true, item: dto(atual) };
      }
      const item = { ...dados, id: `solicitacao-demo-${++seq}`, motivo: 'Solicitação interna', contratoVersao: 1, estado: 'AGUARDANDO', situacao: 'NOVA', revisao: 1, versao: seq.toString(16).padStart(64, '0') };
      if (!permitido(item)) throw new Error('Solicitação não encontrada.');
      rows.push(item); const result = { ok: true, item: dto(item) }; comandos.set(`${acl.atorId()}:${chave}`, { fingerprint, result }); return result;
    },
    async assumirSolicitacao(id, body) { return alterar('assumir', id, body); },
    async concluirSolicitacao(id, body) { return alterar('concluir', id, body); },
    async reabrirSolicitacao(id, body) { return alterar('reabrir', id, body); },
    async adotarSolicitacao(id, body) { return alterar('adotar', id, body); },
    async editarSolicitacao(id, body) { return alterar('editar', id, body); },
  };
}
