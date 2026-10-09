import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diferencaDias } from '../lib/editarJanela';
import { somarDiasAgenda, ocorrenciasDoEstadoDaTarefa } from '../../../../../../packages/shared/src/agenda.js';

const originalDe = item => item.atividadeOriginal || item;
const idsDe = item => item.ocorrenciaIds || (item.itens || [item]).map(i => i.ocorrenciaId).filter(Boolean);

/** Mantém somente mudanças de agenda sobre os dados confirmados, nunca cópias de conclusões. */
export function useEdicoesAgenda({ api, onErro }) {
  const [operacoes, setOperacoes] = useState([]);
  const atuais = useRef([]), filas = useRef(new Map()), versao = useRef(0), contador = useRef(0);
  const montado = useRef(true), erroRef = useRef(onErro);
  erroRef.current = onErro;
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);
  const atualizar = useCallback(fn => {
    atuais.current = fn(atuais.current);
    if (montado.current) setOperacoes(atuais.current);
  }, []);

  const editar = useCallback((item, dados) => {
    const original = originalDe(item);
    const op = { id: ++contador.current, tarefaId: original.tarefaId, cicloChave: original.cicloChave,
      ids: idsDe(original), seed: original.itens?.[0] || original, dados, pendente: true };
    const chaves = op.tarefaId ? [`tarefa:${op.tarefaId}`] : op.ids.map(id => `ocorrencia:${id}`);
    if (!chaves.length) return Promise.resolve(false);
    versao.current++;
    atualizar(lista => [...lista, op]);
    erroRef.current('');
    // Uma tarefa compartilha o JSON de estados; grupos podem compartilhar ocorrências.
    const anteriores = [...new Set(chaves.map(k => filas.current.get(k)).filter(Boolean))];
    const gravacao = Promise.all(anteriores).then(async () => {
      try {
        const out = op.tarefaId
          ? await api.acaoTarefaAgenda(op.tarefaId, { acao: 'EDITAR', cicloChave: op.cicloChave, alteracoes: dados })
          : await api.editarOcorrenciasAgenda(op.ids, dados);
        if (out?.ok === false) throw new Error(out.message || 'Não foi possível atualizar o horário.');
        // Uma janela pessoal ampliada pode gerar chaves diárias novas. Usar a resposta
        // confirmada antes de liberar nova edição evita excluir o ciclo inteiro pelo dia.
        const itensConfirmados = op.tarefaId && out?.tarefa
          ? ocorrenciasDoEstadoDaTarefa(out.tarefa, op.cicloChave) : null;
        atualizar(lista => lista.map(o => o.id === op.id ? { ...o, pendente: false, itensConfirmados } : o));
        return true;
      } catch (e) {
        // Retira só esta alteração: movimentos posteriores e conclusões continuam intactos.
        atualizar(lista => lista.filter(o => o.id !== op.id));
        if (montado.current) erroRef.current(e.message || 'Não foi possível atualizar o horário.');
        return false;
      } finally {
        versao.current++;
      }
    });
    chaves.forEach(k => filas.current.set(k, gravacao));
    gravacao.finally(() => chaves.forEach(k => { if (filas.current.get(k) === gravacao) filas.current.delete(k); }));
    return gravacao;
  }, [api, atualizar]);

  const salvar = useCallback((item, patch) => {
    const original = originalDe(item);
    const delta = diferencaDias(patch.dataInicio, item.dataInicio);
    return editar(item, {
      dataInicio: somarDiasAgenda(original.dataInicio, delta),
      dataFim: somarDiasAgenda(original.dataFim, delta),
      horaInicio: patch.horaInicio, horaFim: patch.horaFim,
    });
  }, [editar]);

  const capturarLeitura = useCallback(() => ({ versao: versao.current, pendente: atuais.current.some(o => o.pendente) }), []);
  const confirmarLeitura = useCallback(leitura => {
    // Uma consulta iniciada antes/durante uma edição não pode apagar a prévia confirmada.
    if (leitura.pendente || leitura.versao !== versao.current) return false;
    atualizar(() => []);
    return true;
  }, [atualizar]);

  const aplicar = useCallback((base, incluirTarefas = true) => {
    let itens = base.itens;
    let obrigacoes = base.obrigacoes;
    for (const op of operacoes) {
      if (op.tarefaId && incluirTarefas) {
        const mesmo = i => i.tarefaId === op.tarefaId && i.cicloChave === op.cicloChave;
        if (op.itensConfirmados) {
          const doCiclo = i => i.tarefaId === op.tarefaId && (i.cicloChave === op.cicloChave || i.cicloChave.startsWith(`${op.cicloChave}@`));
          const atuais = new Map(itens.filter(doCiclo).map(i => [i.cicloChave,i]));
          itens = [...itens.filter(i => !doCiclo(i)), ...op.itensConfirmados.map(i => ({...i,...(atuais.has(i.cicloChave) ? {resolvido:atuais.get(i.cicloChave).resolvido,concluidaEm:atuais.get(i.cicloChave).concluidaEm} : {})}))];
        } else itens = itens.some(mesmo) ? itens.map(i => mesmo(i) ? { ...i, ...op.dados } : i) : [...itens, { ...op.seed, ...op.dados }];
      } else if (!op.tarefaId) {
        const ids = new Set(op.ids);
        obrigacoes = obrigacoes.map(o => ({ ...o, ocorrencias: o.ocorrencias.map(oc => ids.has(oc.ocorrenciaId)
          ? { ...oc, dataInicio: op.dados.dataInicio, dataFim: op.dados.dataFim,
            agendaConfig: { ...oc.agendaConfig, ...Object.fromEntries(['horaInicio','horaFim','titulo','descricao','prioridade'].filter(k => Object.hasOwn(op.dados,k)).map(k => [k,op.dados[k]])),
              ...((oc.dataInicio !== op.dados.dataInicio || oc.dataFim !== op.dados.dataFim) ? {dataInicioOriginal:undefined,dataFimOriginal:undefined,diasAgendados:undefined} : {}) } }
          : oc) }));
      }
    }
    return { ...base, itens, obrigacoes };
  }, [operacoes]);

  const pendentes = useMemo(() => operacoes.filter(o => o.pendente), [operacoes]);
  const pendente = useCallback(item => {
    const original = originalDe(item), ids = idsDe(original);
    return pendentes.some(o => original.tarefaId ? o.tarefaId === original.tarefaId && (o.cicloChave === original.cicloChave || original.cicloChave?.startsWith(`${o.cicloChave}@`)) : o.ids.some(id => ids.includes(id)));
  }, [pendentes]);
  const pendenteSerie = useCallback(serie => {
    const ids = new Set((serie.empresas || []).flatMap(o => o.ocorrencias.map(oc => oc.ocorrenciaId)));
    return pendentes.some(o => (serie.tarefaId && o.tarefaId === serie.tarefaId)
      || (serie.regraId && o.seed.regraId === serie.regraId)
      || (serie.obrigacaoId && o.seed.obrigacaoId === serie.obrigacaoId)
      || o.ids.some(id => ids.has(id)));
  }, [pendentes]);
  return { salvar, editar, aplicar, pendente, pendenteSerie, capturarLeitura, confirmarLeitura, quantidade: pendentes.length, temAlteracoes: operacoes.length > 0 };
}
