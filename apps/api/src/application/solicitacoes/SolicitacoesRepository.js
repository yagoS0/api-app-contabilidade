import { projetarVinculosSolicitacoes } from '../calendario/TarefasUnificadasService.js';
import { exigir } from './solicitacoesPolicy.js';
import { apresentarSolicitacoes } from './solicitacoesApresentacao.js';
import { escopoDasSolicitacoes } from './solicitacoesEscopoWhatsapp.js';
import { criarCursor, hash, lerCursor, predicado, projetar, recortes } from './solicitacoesProjection.js';

export class SolicitacoesRepository {
  constructor(client) { exigir(Boolean(client?.$transaction), 'cliente_transacional_obrigatorio'); this.client = client; }

  // Retrying a DB serialization/uniqueness race is safe: no external effect exists
  // here, and the durable command is read again before executing any mutation.
  async transacao(work) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.client.$transaction(work, { isolationLevel: 'Serializable' }); }
      catch (error) {
        if (!['P2034', 'P2002'].includes(error.code) || attempt >= 2) throw error;
      }
    }
  }
  async obter(tx, escopo, id, hoje) {
    exigir(escopo.empresas.length > 0 || escopo.triagem, 'solicitacao_nao_encontrada', 404);
    escopo = await escopoDasSolicitacoes(tx, escopo);
    const row = await tx.encaminhamentoSuporte.findFirst({ where: { AND: [{ id }, predicado(escopo, {}, hoje, tx.encaminhamentoSuporte.fields)] } });
    exigir(row, 'solicitacao_nao_encontrada', 404);
    return { ...row, _empresaEfetiva: escopo.empresasEfetivas[row.id] };
  }
  async listar(tx, escopo, filtros, hoje, { limite = 50, cursor = null } = {}) {
    exigir(Number.isInteger(limite) && limite >= 1 && limite <= 100, 'limite_invalido');
    escopo = await escopoDasSolicitacoes(tx, escopo);
    const where = predicado(escopo, filtros, hoje, tx.encaminhamentoSuporte.fields);
    const fingerprint = hash({ atorId: escopo.atorId, empresas: escopo.empresas, triagem: escopo.triagem, filtros, hoje });
    const after = lerCursor(cursor, fingerprint);
    const rows = await tx.encaminhamentoSuporte.findMany({ where: after ? { AND: [where, after] } : where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limite + 1 });
    const total = await tx.encaminhamentoSuporte.count({ where });
    const resumo = {};
    for (const [nome, filtro] of Object.entries(recortes(hoje))) resumo[nome] = await tx.encaminhamentoSuporte.count({ where: { AND: [where, filtro] } });
    const porPrioridade = {};
    for (const prioridade of ['ALTA', 'MEDIA', 'BAIXA', null]) {
      porPrioridade[prioridade ?? 'NAO_CLASSIFICADA'] = await tx.encaminhamentoSuporte.count({ where: { AND: [where, { estado: { not: 'RESOLVIDO' }, prioridade }] } });
    }
    const pagina = rows.slice(0, limite);
    const porEmpresa = {};
    const conjunto = await tx.encaminhamentoSuporte.findMany({ where, select: { id: true } });
    for (const item of conjunto) {
      const empresa = escopo.empresasEfetivas[item.id];
      if (empresa) porEmpresa[empresa] = (porEmpresa[empresa] || 0) + 1;
    }
    const projetados = await projetarVinculosSolicitacoes(tx, escopo, pagina.map(row => projetar({ ...row, _empresaEfetiva: escopo.empresasEfetivas[row.id] })));
    return { itens: await apresentarSolicitacoes(tx, escopo, projetados), total, resumo, porPrioridade, porEmpresa, hoje, proximoCursor: rows.length > limite ? criarCursor(pagina.at(-1), fingerprint) : null };
  }
  async atualizar(tx, before, data) {
    const result = await tx.encaminhamentoSuporte.updateMany({ where: {
      id: before.id, contratoVersao: before.contratoVersao, revisao: before.revisao, updatedAt: before.updatedAt,
      estado: before.estado, responsavelId: before.responsavelId, resolvidoEm: before.resolvidoEm,
    }, data });
    exigir(result.count === 1, 'versao_conflitante', 409);
    return tx.encaminhamentoSuporte.findUnique({ where: { id: before.id } });
  }
}
