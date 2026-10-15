import { useMemo } from 'react';
import { Button } from '../../../components/ui/Button';
import { CalendarioAgenda } from './CalendarioAgendaLegado';

/** Compatibility boundary: historical manual work never reads fiscal projections. */
export function adaptarApiTarefasAnteriores(api, idsMigrados = []) {
  const migradas = new Set(idsMigrados.filter(id => String(id).startsWith('legado:')).map(id => String(id).slice(7)));
  const impedirCriacao = async () => { throw new Error('Crie novas tarefas no calendário unificado.'); };
  return {
    ...api,
    async listObrigacoes(filtros) {
      const out = await api.listObrigacoes(filtros);
      if (out?.ok === false) return out;
      return { ...out, obrigacoes: (out.obrigacoes || []).filter(o => o.tipo === 'TAREFA' && !o.verificador && !o.conclusaoAutomatica) };
    },
    async getTarefasAgenda(inicio, fim) {
      const out = await api.getTarefasAgenda(inicio, fim);
      if (out?.ok === false) return out;
      return {
        ...out,
        tarefas: (out.tarefas || []).filter(t => !migradas.has(String(t.id))),
        itens: (out.itens || []).filter(i => i.tipo === 'tarefa' && i.tarefaId && !migradas.has(String(i.tarefaId))),
        ocultos: [],
      };
    },
    listRegrasObrigacao: async () => ({ ok: true, regras: [] }),
    getAgendaCarteira: async () => ({ ok: true, itens: [] }),
    listMarcosFiscais: async () => ({ ok: true, marcos: [] }),
    getCalendario: async () => ({ ok: true, dias: [] }),
    // The excluded-occurrence endpoint mixes fiscal and manual records without a reliable type.
    getOcorrenciasExcluidas: undefined,
    createRegraObrigacao: impedirCriacao,
    createObrigacao: impedirCriacao,
    salvarTarefaAgenda: impedirCriacao,
    converterTarefaEmObrigacao: impedirCriacao,
    vincularTarefasEmpresas: impedirCriacao,
  };
}

export function TarefasAnterioresCalendario({ api, idsMigrados = [], empresas = [], onVoltar, onNovaTarefa, onOpenCompany, companyIdFixo, initialContext }) {
  const chaveMigrados = idsMigrados.join('|');
  const apiHistorico = useMemo(() => adaptarApiTarefasAnteriores(api, chaveMigrados ? chaveMigrados.split('|') : []), [api, chaveMigrados]);
  return <section aria-label="Histórico de tarefas anteriores">
    <div className="agenda-toolbar"><div><h2>Tarefas anteriores</h2><p className="tce-hint">Tarefas manuais preservadas com suas conclusões e alterações anteriores.</p></div><Button type="button" variant="secondary" onClick={onVoltar}>Voltar ao calendário</Button></div>
    <CalendarioAgenda api={apiHistorico} empresas={empresas} onOpenCompany={onOpenCompany} companyIdFixo={companyIdFixo} initialContext={{ visao: 'lista', ...initialContext }} onNovaTarefa={onNovaTarefa} />
  </section>;
}
