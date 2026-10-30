import { randomUUID } from 'node:crypto';
import { SolicitacoesRepository } from './SolicitacoesRepository.js';
import { carregarEscopo, exigir, texto } from './solicitacoesPolicy.js';
import { hash, hojeBrasilia, json, projetar, versao } from './solicitacoesProjection.js';
import { criarTarefaUnificada, podeVerTarefa, projetarVinculosSolicitacoes, validarResponsavelTarefa, TarefaCalendarioError } from '../calendario/TarefasUnificadasService.js';
import { normalizarTarefaCalendario } from '../../../../../packages/shared/src/tarefasCalendario.js';

export class SolicitacaoTarefaService {
  constructor({ client, agora = () => new Date() }) {
    this.repository = new SolicitacoesRepository(client);
    this.agora = agora;
  }
  async converter({ contexto, id, chave, versao: expected, dados }) {
    id = texto(id, 'id'); chave = texto(chave, 'chave');
    exigir(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected), 'versao_obrigatoria');
    exigir(dados && typeof dados === 'object' && !Array.isArray(dados), 'dados_invalidos');
    exigir(Object.keys(dados).every(k => ['titulo', 'descricao', 'empresasIds', 'subtarefas', 'config', 'responsavelId'].includes(k)), 'campo_nao_permitido');
    exigir(Object.hasOwn(dados, 'responsavelId'), 'responsavel_explicito_obrigatorio');
    // Fingerprint the original proposal, before server-generated subtask IDs.
    const fingerprint = hash({ tipo: 'TAREFA_VINCULADA', id, versao: expected, dados });
    try {
      return await this.repository.transacao(async tx => {
        const escopo = await carregarEscopo(tx, contexto);
        const now = this.agora();
        const before = await this.repository.obter(tx, escopo, id, hojeBrasilia(now));
        const anterior = await tx.solicitacaoComando.findUnique({ where: { atorId_chave: { atorId: escopo.atorId, chave } } });
        const resposta = async row => {
          const link = await tx.solicitacaoTarefa.findUnique({ where: { solicitacaoId: id }, include: { tarefa: true } });
          exigir(link?.tarefa && podeVerTarefa(link.tarefa, escopo.atorId, escopo.empresas), 'tarefa_nao_encontrada', 404);
          const item = (await projetarVinculosSolicitacoes(tx, escopo, [projetar(row)]))[0];
          return item;
        };
        if (anterior) {
          exigir(anterior.fingerprint === fingerprint && anterior.solicitacaoId === id, 'chave_divergente', 409);
          // Rehydrate current permissions/state; original revision is not a replay gate.
          return resposta(before);
        }
        exigir(before.contratoVersao === 1, 'adocao_legado_pendente', 409);
        exigir(versao(before) === expected, 'versao_conflitante', 409);
        let normalizados;
        try {
          normalizados = normalizarTarefaCalendario({ ...dados,
            subtarefas: (dados.subtarefas || []).map(s => ({ ...s, id: s.id || randomUUID() })) });
        } catch { exigir(false, 'tarefa_invalida'); }
        const empresa = before._empresaEfetiva ?? before.portalClientId ?? null;
        exigir(empresa ? normalizados.empresasIds.length === 1 && normalizados.empresasIds[0] === empresa : normalizados.empresasIds.length === 0,
          'empresa_original_preservada', 409);
        await validarResponsavelTarefa(tx, normalizados, { solicitacaoId: id });
        const existente = await tx.solicitacaoTarefa.findUnique({ where: { solicitacaoId: id } });
        exigir(!existente, 'solicitacao_ja_vinculada', 409);
        const row = await this.repository.atualizar(tx, before, { revisao: before.revisao + 1, updatedAt: now });
        const tarefa = await criarTarefaUnificada({ userId: escopo.atorId, portalIds: escopo.empresas, dados: normalizados }, tx);
        await tx.solicitacaoTarefa.create({ data: { solicitacaoId: id, tarefaId: tarefa.id, empresaOrigemId: empresa, criadoPorId: escopo.atorId, createdAt: now } });
        const { _empresaEfetiva, ...original } = before;
        await tx.solicitacaoEvento.create({ data: { id: randomUUID(), solicitacaoId: id, revisao: row.revisao,
          tipo: 'TAREFA_VINCULADA', atorId: escopo.atorId, ocorridoEm: now, antes: json(original), depois: json(row) } });
        const result = await resposta(row);
        // Durable identity only; a saved sensitive DTO is never replayed unchecked.
        await tx.solicitacaoComando.create({ data: { id: randomUUID(), atorId: escopo.atorId, chave, fingerprint,
          solicitacaoId: id, resultado: { tarefaId: tarefa.id }, createdAt: now } });
        return result;
      });
    } catch (e) {
      if (e instanceof TarefaCalendarioError) { exigir(false, 'tarefa_invalida', e.status); }
      throw e;
    }
  }
}
