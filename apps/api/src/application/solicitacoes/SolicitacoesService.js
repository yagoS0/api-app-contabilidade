import { projetarVinculosSolicitacoes } from '../calendario/TarefasUnificadasService.js';
import { randomUUID } from 'node:crypto';
import { SolicitacoesRepository } from './SolicitacoesRepository.js';
import { apresentarSolicitacoes } from './solicitacoesApresentacao.js';
import { carregarEscopo, exigir, normalizarConsultaResponsaveis, normalizarDados, responsaveisElegiveisWhere, texto, validarVinculos } from './solicitacoesPolicy.js';
import { comprovadamenteConcluida, hash, hojeBrasilia, json, normalizarFiltros, projetar, versao } from './solicitacoesProjection.js';

/** Individual application contract. No transport or singleton DB.
 * The authenticated adapter must supply contexto separately from untrusted dados.
 * Existing records remain read-only until explicit, audited adoption.
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
      const projetados = await projetarVinculosSolicitacoes(tx, escopo, [projetar(row)]);
      const [item] = await apresentarSolicitacoes(tx, escopo, projetados);
      return { ...item, eventos: json(eventos), mensagens: json(mensagens) };
    });
  }
  async listarResponsaveis({ contexto, id, query = {} }) {
    const identidade = texto(id, 'id');
    const { busca, limite, cursor } = normalizarConsultaResponsaveis(query);
    return this.repository.transacao(async tx => {
      const escopo = await carregarEscopo(tx, contexto);
      const row = await this.repository.obter(tx, escopo, identidade, hojeBrasilia(this.agora()));
      const fingerprint = hash({ tipo: 'responsaveis', escopo, id: row.id, empresa: row._empresaEfetiva, busca, limite });
      let after = null;
      if (cursor !== null) {
        try {
          exigir(/^[A-Za-z0-9_-]+$/.test(cursor), 'cursor_invalido');
          const decoded = Buffer.from(cursor, 'base64url');
          exigir(decoded.toString('base64url') === cursor, 'cursor_invalido');
          const envelope = JSON.parse(decoded.toString('utf8'));
          exigir(envelope && Object.keys(envelope).sort().join(',') === 'fingerprint,id,v'
            && envelope.v === 1 && envelope.fingerprint === fingerprint
            && typeof envelope.id === 'string' && envelope.id.length > 0 && envelope.id.length <= 200
            && !/[\u0000-\u001f]/.test(envelope.id), 'cursor_invalido');
          after = envelope.id;
        } catch { exigir(false, 'cursor_invalido'); }
      }
      const rows = await tx.user.findMany({
        where: { AND: [responsaveisElegiveisWhere(row._empresaEfetiva),
          ...(busca ? [{ name: { contains: busca, mode: 'insensitive' } }] : []),
          ...(after ? [{ id: { gt: after } }] : []),
        ] },
        orderBy: { id: 'asc' }, take: limite + 1, select: { id: true, name: true },
      });
      const pagina = rows.slice(0, limite);
      return {
        itens: pagina.map(user => ({ id: user.id, nome: user.name?.trim() || null })),
        proximoCursor: rows.length > limite
          ? Buffer.from(JSON.stringify({ v: 1, fingerprint, id: pagina.at(-1).id })).toString('base64url') : null,
      };
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
  async adotar({ contexto, chave, id, versao: expected }) {
    return this.comando({ contexto, chave, id, expected, tipo: 'ADOTADA', dados: {} });
  }
  async vincularMensagem(tx, row, mensagemId, atorId) {
    const vinculo = await tx.solicitacaoMensagem.findUnique({ where: { solicitacaoId_mensagemId: { solicitacaoId: row.id, mensagemId } } });
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
        const { tarefa, ...resultado } = anterior.resultado;
        return (await projetarVinculosSolicitacoes(tx, escopo, [resultado]))[0];
      }
      let before = null;
      let row;
      if (tipo === 'CRIADA') {
        await validarVinculos(tx, escopo, dados);
        let mensagemAncora = dados.mensagemId;
        if (dados.mensagemId) {
          const original = await tx.encaminhamentoSuporte.findUnique({ where: { mensagemId: dados.mensagemId } });
          // A human command identifies a new subject, even for the same message.
          // Preserve the historical unique anchor; additional subjects use links.
          if (original) mensagemAncora = null;
        }
        row = await tx.encaminhamentoSuporte.create({ data: { ...dados, mensagemId: mensagemAncora, id: randomUUID(),
          motivo: 'Solicitação interna', origem: dados.mensagemId ? 'MENSAGEM' : dados.anotacaoId ? 'ANOTACAO' : 'MANUAL',
          contratoVersao: 1, revisao: 1, criadorId: escopo.atorId, estado: 'AGUARDANDO', createdAt: now, updatedAt: now } });
        if (dados.mensagemId) await this.vincularMensagem(tx, row, dados.mensagemId, escopo.atorId);
      } else {
        before = await this.repository.obter(tx, escopo, identity, hoje);
        exigir(tipo === 'ADOTADA' ? before.contratoVersao == null : before.contratoVersao === 1, 'adocao_legado_pendente', 409);
        exigir(versao(before) === expected, 'versao_conflitante', 409);
        const { mensagemComplementarId, ...changes } = dados;
        // Classifying manual triage is explicit. Moving a proven company/source
        // to another company needs its own future reconciliation contract.
        if ('portalClientId' in changes && before.portalClientId !== changes.portalClientId) {
          exigir(!await tx.solicitacaoTarefa.findUnique({ where: { solicitacaoId: before.id } }), 'empresa_original_preservada', 409);
        }
        if ('portalClientId' in changes) exigir(before.portalClientId === null || before.portalClientId === changes.portalClientId, 'empresa_original_preservada', 409);
        if (tipo === 'ADOTADA') {
          exigir(before.estado !== 'RESOLVIDO', 'legado_encerrado_preservado', 409);
          exigir(before.conversaId && before.mensagemId, 'origem_legada_nao_comprovada', 409);
          Object.assign(changes, { contratoVersao: 1, portalClientId: before._empresaEfetiva,
            origem: 'LEGADO_ADOTADO', titulo: before.titulo || before.motivo.slice(0, 200) });
          // No historical creator is inferred from the adopting operator.
          await validarVinculos(tx, escopo, { ...before, ...changes });
          await this.vincularMensagem(tx, before, before.mensagemId, escopo.atorId);
        } else if (tipo === 'CONCLUIDA') {
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
      const { _empresaEfetiva, ...original } = before || {};
      await tx.solicitacaoEvento.create({ data: { id: randomUUID(), solicitacaoId: row.id, revisao: row.revisao,
        tipo, atorId: escopo.atorId, ocorridoEm: now, ...(before ? { antes: json(original) } : {}), depois: json(row) } });
      await tx.solicitacaoComando.create({ data: { id: randomUUID(), atorId: escopo.atorId, chave: commandKey,
        fingerprint, solicitacaoId: row.id, resultado: result, createdAt: now } });
      return (await projetarVinculosSolicitacoes(tx, escopo, [result]))[0];
    });
  }
}
