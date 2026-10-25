import { randomUUID } from 'node:crypto';
import { SolicitacoesRepository } from './SolicitacoesRepository.js';
import { carregarEscopo, exigir, normalizarDados, texto, validarVinculos } from './solicitacoesPolicy.js';
import { comprovadamenteConcluida, hash, hojeBrasilia, json, normalizarFiltros, projetar, versao } from './solicitacoesProjection.js';

/** S1 internal application contract. No routes, workers, transport or singleton DB.
 * The authenticated adapter must supply contexto separately from untrusted dados.
 * Existing records remain read-only until explicit adoption in S2.
 */
export class SolicitacoesService {
  constructor({ client, agora = () => new Date() }) {
    this.repository = new SolicitacoesRepository(client);
    this.agora = agora;
  }
  async listar({ contexto, filtros = {}, limite = 50, cursor = null }) {
    const normalizados = normalizarFiltros(filtros);
    return this.repository.transacao(async tx => {
      const escopo = await carregarEscopo(tx, contexto);
      return this.repository.listar(tx, escopo, normalizados, hojeBrasilia(this.agora()), { limite, cursor });
    });
  }
  async detalhar({ contexto, id }) {
    const identidade = texto(id, 'id');
    return this.repository.transacao(async tx => {
      const escopo = await carregarEscopo(tx, contexto);
      const row = await this.repository.obter(tx, escopo, identidade, hojeBrasilia(this.agora()));
      const eventos = await tx.solicitacaoEvento.findMany({ where: { solicitacaoId: row.id }, orderBy: { revisao: 'asc' } });
      const mensagens = await tx.solicitacaoMensagem.findMany({ where: { solicitacaoId: row.id }, orderBy: [{ createdAt: 'asc' }, { mensagemId: 'asc' }] });
      return { ...projetar(row), eventos: json(eventos), mensagens: json(mensagens) };
    });
  }
  async criar({ contexto, chave, dados }) {
    return this.comando({ contexto, chave, tipo: 'CRIADA', dados: normalizarDados(dados, true) });
  }
  async editar({ contexto, chave, id, versao: expected, dados }) {
    const normalizados = normalizarDados(dados);
    exigir(Object.keys(normalizados).length, 'edicao_vazia');
    return this.comando({ contexto, chave, id, expected, tipo: 'EDITADA', dados: normalizados });
  }
  async concluir({ contexto, chave, id, versao: expected, observacao = null }) {
    const value = typeof observacao === 'string' && !observacao.trim() ? null : observacao;
    return this.comando({ contexto, chave, id, expected, tipo: 'CONCLUIDA', dados: { observacaoConclusao: texto(value, 'observacao', 10000, true) } });
  }
  async reabrir({ contexto, chave, id, versao: expected }) {
    return this.comando({ contexto, chave, id, expected, tipo: 'REABERTA', dados: {} });
  }
  async vincularMensagem(tx, row, mensagemId, atorId) {
    const original = await tx.encaminhamentoSuporte.findUnique({ where: { mensagemId } });
    const vinculo = await tx.solicitacaoMensagem.findUnique({ where: { mensagemId } });
    exigir(!original || original.id === row.id, 'mensagem_ja_vinculada', 409);
    exigir(!vinculo || vinculo.solicitacaoId === row.id, 'mensagem_ja_vinculada', 409);
    if (!vinculo) await tx.solicitacaoMensagem.create({ data: { mensagemId, solicitacaoId: row.id, atorId } });
  }
  comando({ contexto, chave, tipo, dados, id = null, expected = null }) {
    const commandKey = texto(chave, 'chave', 200);
    const identity = tipo === 'CRIADA' ? null : texto(id, 'id');
    if (tipo !== 'CRIADA') exigir(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected), 'versao_obrigatoria');
    const fingerprint = hash({ tipo, dados, id: identity, versao: expected });
    return this.repository.transacao(async tx => {
      const escopo = await carregarEscopo(tx, contexto);
      const now = this.agora();
      const hoje = hojeBrasilia(now);
      const anterior = await tx.solicitacaoComando.findUnique({ where: { atorId_chave: { atorId: escopo.atorId, chave: commandKey } } });
      if (anterior) {
        exigir(anterior.fingerprint === fingerprint, 'chave_divergente', 409);
        // A replay does not bypass revoked access or expose another company's result.
        await this.repository.obter(tx, escopo, anterior.solicitacaoId, hoje);
        return anterior.resultado;
      }
      let before = null;
      let row;
      if (tipo === 'CRIADA') {
        await validarVinculos(tx, escopo, dados);
        if (dados.mensagemId) {
          const original = await tx.encaminhamentoSuporte.findUnique({ where: { mensagemId: dados.mensagemId } });
          const linked = await tx.solicitacaoMensagem.findUnique({ where: { mensagemId: dados.mensagemId } });
          exigir(!original && !linked, 'mensagem_ja_vinculada', 409);
        }
        row = await tx.encaminhamentoSuporte.create({ data: { ...dados, id: randomUUID(),
          motivo: 'Solicitação interna', origem: dados.mensagemId ? 'MENSAGEM' : dados.anotacaoId ? 'ANOTACAO' : 'MANUAL',
          contratoVersao: 1, revisao: 1, criadorId: escopo.atorId, estado: 'AGUARDANDO', createdAt: now, updatedAt: now } });
        if (row.mensagemId) await this.vincularMensagem(tx, row, row.mensagemId, escopo.atorId);
      } else {
        before = await this.repository.obter(tx, escopo, identity, hoje);
        exigir(before.contratoVersao === 1, 'adocao_legado_pendente', 409);
        exigir(versao(before) === expected, 'versao_conflitante', 409);
        const { mensagemComplementarId, ...changes } = dados;
        // Classifying manual triage is explicit. Moving a proven company/source
        // to another company needs its own future reconciliation contract.
        if ('portalClientId' in changes) exigir(before.portalClientId === null || before.portalClientId === changes.portalClientId, 'empresa_original_preservada', 409);
        if (tipo === 'CONCLUIDA') {
          exigir(before.estado !== 'RESOLVIDO', 'solicitacao_ja_encerrada', 409);
          Object.assign(changes, { estado: 'RESOLVIDO', resolvidoEm: now, concluidoEm: now, concluidoPorId: escopo.atorId });
        } else if (tipo === 'REABERTA') {
          exigir(comprovadamenteConcluida(before), 'conclusao_nao_comprovada', 409);
          Object.assign(changes, { estado: 'AGUARDANDO', resolvidoEm: null, concluidoEm: null, concluidoPorId: null, observacaoConclusao: null });
        } else exigir(before.estado !== 'RESOLVIDO', 'reabrir_antes_de_editar', 409);
        await validarVinculos(tx, escopo, { ...before, ...changes });
        if (mensagemComplementarId) {
          await validarVinculos(tx, escopo, { ...before, ...changes, mensagemId: mensagemComplementarId });
          await this.vincularMensagem(tx, before, mensagemComplementarId, escopo.atorId);
        }
        row = await this.repository.atualizar(tx, before, { ...changes, revisao: before.revisao + 1, updatedAt: now });
      }
      const result = projetar(row);
      await tx.solicitacaoEvento.create({ data: { id: randomUUID(), solicitacaoId: row.id, revisao: row.revisao,
        tipo, atorId: escopo.atorId, ocorridoEm: now, ...(before ? { antes: json(before) } : {}), depois: json(row) } });
      await tx.solicitacaoComando.create({ data: { id: randomUUID(), atorId: escopo.atorId, chave: commandKey,
        fingerprint, solicitacaoId: row.id, resultado: result, createdAt: now } });
      return result;
    });
  }
}
