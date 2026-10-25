import { statusApresentacao } from '@contabilidade/shared/fluxo-carteira';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { useManualInss } from '../../../operacoes/useManualInss';
import { resumirEtapasOperacoes } from '../../../operacoes/operacoes';

function Etapa({ tarefa, detalhe, salvar, ocupado }) {
  const pendentes = (detalhe.lancamentos || []).filter(e => !e.importado);
  const importacaoBloqueada = tarefa.chave === 'importar' && (!pendentes.length || pendentes.some(e => !e.importavel));
  const podeReabrir = Boolean(tarefa.dados?.conclusao);
  const bloqueada = tarefa.automatica || (tarefa.concluida ? !podeReabrir : tarefa.aguardando?.length || importacaoBloqueada);
  return <li>
    <label className="carteira-task-check">
      <input type="checkbox" checked={Boolean(tarefa.concluida)} disabled={ocupado || Boolean(bloqueada)}
        onChange={() => salvar(tarefa, { acao: tarefa.concluida ? 'reabrir' : 'concluir',
          ...(tarefa.chave === 'importar' && !tarefa.concluida ? { entryIds: pendentes.map(e => e.id) } : {}) })} />
      <span>{tarefa.titulo}</span>
      <small>{tarefa.concluida ? 'Concluída' : 'Pendente'}</small>
    </label>
    {tarefa.revisar && <p>Os dados mudaram desde a última confirmação. Confira novamente.</p>}
    {!tarefa.concluida && tarefa.aguardando?.length > 0 && <p>Aguardando: {tarefa.aguardando.map(k => detalhe.fluxo.tarefas.find(t => t.chave === k)?.titulo || k).join(', ')}.</p>}
    {(tarefa.automatica || (tarefa.concluida && !podeReabrir)) && <small>Acompanha a operação registrada na empresa.</small>}
    {tarefa.chave === 'importar' && !tarefa.concluida && <p>{importacaoBloqueada
      ? 'Feche o mês e exporte os lançamentos antes de confirmar a importação.'
      : `Marcar como concluída confirma que os ${pendentes.length} lançamentos pendentes foram importados no ERP.`}</p>}
    {!!tarefa.historico?.length && <details><summary>Histórico ({tarefa.historico.length})</summary><ul>{[...tarefa.historico].reverse().map(h => <li key={h.id}>{new Date(h.em).toLocaleString('pt-BR')} · {h.acao} · usuário {h.por}{h.dados?.conclusao?.evidencia ? ` · ${h.dados.conclusao.evidencia}` : ''}</li>)}</ul></details>}
  </li>;
}

export function FluxoCarteiraDetalhe({ company, competencia, api, onFechar, onChanged, onOpenCompany, tarefaChave = null }) {
  const manualInss = useManualInss(api, competencia, company);
  const [detalhe, setDetalhe] = useState(null), [erro, setErro] = useState(''), [ocupado, setOcupado] = useState(false), [revisao, setRevisao] = useState(0);
  const gravando = useRef(false);
  const id = company.companyId;
  useEffect(() => {
    let ativo = true;
    setDetalhe(null); setErro('');
    Promise.resolve().then(() => api.getFluxoCarteira(id, competencia)).then(r => {
      if (r?.ok === false) throw new Error(r.message);
      if (ativo) setDetalhe(r);
    }).catch(e => { if (ativo) setErro(e.message); });
    return () => { ativo = false; };
  }, [id, competencia, api, revisao]);
  async function salvar(tarefa, dados) {
    if (gravando.current) return;
    gravando.current = true; setOcupado(true); setErro('');
    try {
      const r = await api.salvarFluxoTarefa(id, tarefa.chave, { ...dados, competencia, versao: tarefa.versao || 0, hash: tarefa.hash });
      if (r?.ok === false) throw new Error(r.message);
      setRevisao(x => x + 1); onChanged?.();
    } catch (e) { setErro(e.message); } finally { gravando.current = false; setOcupado(false); }
  }
  const tarefas = detalhe?.fluxo.tarefas.filter(t => !tarefaChave || t.chave === tarefaChave) || [];
  const titulo = tarefaChave ? tarefas[0]?.titulo || 'Tarefa' : 'Fluxo da empresa';
  const row = detalhe && resumirEtapasOperacoes([{company,fluxo:detalhe.fluxo}],[],manualInss.items).items[0];
  const presentation = detalhe && (manualInss.loading || manualInss.error
    ? statusApresentacao(detalhe.fluxo,{guiasConhecidas:false}) : row.presentation);
  return <Modal titulo={`${titulo} · ${company.razao || 'Empresa'} · ${competencia}`} tamanho={tarefaChave ? 'md' : 'lg'} aoFechar={onFechar} ocupado={ocupado}>
    {erro && <p role="alert">{erro} <button type="button" onClick={() => setRevisao(x => x + 1)}>Atualizar</button></p>}
    {!detalhe && !erro && <p role="status">Carregando tarefa…</p>}
    {detalhe && <>
      {!tarefaChave && <p>{detalhe.fluxo.regime} · Próxima etapa: <strong>{presentation.rotulo}</strong></p>}
      {manualInss.error && <p role="alert">{manualInss.error} <Button variant="secondary" onClick={manualInss.reload}>Atualizar INSS manual</Button></p>}
      {['PENDING_DOCUMENT','DOCUMENT_REVIEW'].includes(row.manualInss?.status) && <p>INSS manual: {row.manualInss.status === 'DOCUMENT_REVIEW' ? 'documento para revisão' : 'aguardando documento'}. <a href={`/companies/${encodeURIComponent(id)}/guides?competencia=${encodeURIComponent(competencia)}`}>Conferir Guias</a></p>}
      <ol className="carteira-task-list">{tarefas.map(t => <Etapa key={t.chave} tarefa={t} detalhe={detalhe} salvar={salvar} ocupado={ocupado} />)}</ol>
      {!tarefas.length && <p>Esta tarefa não se aplica à empresa nesta competência.</p>}
      {onOpenCompany && <Button variant="secondary" onClick={() => { onFechar(); onOpenCompany(id); }}>Abrir empresa</Button>}
    </>}
  </Modal>;
}
