import { useEffect, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';

function EditorTarefa({ tarefa, detalhe, salvar, ocupado }) {
  const [dados, setDados] = useState({ responsavel: '', observacao: '', dataInicio: '', dataFim: '', ...tarefa.dados });
  const [evidencia, setEvidencia] = useState('');
  const [selecionados, setSelecionados] = useState([]);
  const set = (k,v) => setDados(d => ({ ...d, [k]: v }));
  const podeConcluir = !tarefa.automatica && !tarefa.aguardando?.length;
  return <div className="carteira-task-editor">
    <div className="carteira-task-fields">
      <label>Responsável<input value={dados.responsavel} maxLength={160} onChange={e => set('responsavel',e.target.value)} /></label>
    </div>
    <label>Observações<textarea value={dados.observacao} maxLength={2000} onChange={e => set('observacao',e.target.value)} /></label>
    <Button disabled={ocupado} onClick={() => salvar(tarefa, { ...dados, acao:'planejar' })}>Salvar planejamento</Button>
    {tarefa.revisar && <p role="status">Os dados mudaram desde a última confirmação. Confira novamente.</p>}
    {tarefa.aguardando?.length > 0 && <p>Aguardando: {tarefa.aguardando.map(k => detalhe.fluxo.tarefas.find(t => t.chave === k)?.titulo || k).join(', ')}.</p>}
    {tarefa.chave === 'obrigacoes' && <ul>{detalhe.fluxo.obrigacoes.map(o => <li key={o.id}>{o.concluida ? '✓' : '○'} {o.nome}</li>)}</ul>}
    {tarefa.chave === 'importar' && <>
      <p>Selecione somente os lançamentos efetivamente importados no ERP. A competência precisa estar fechada e os lançamentos exportados.</p>
      <div className="carteira-entry-list">{detalhe.lancamentos.map(e => <label key={e.id}>
        <input type="checkbox" disabled={!e.importavel || e.importado || ocupado} checked={e.importado || selecionados.includes(e.id)} onChange={event => setSelecionados(xs => event.target.checked ? [...xs,e.id] : xs.filter(x => x !== e.id))} />
        {e.historico} — {e.importado ? 'Importado' : e.importavel ? 'A confirmar' : 'Ainda não exportado / mês aberto'}
      </label>)}</div>
    </>}
    {podeConcluir && !tarefa.concluida && <div className="carteira-task-proof">
      <label>{tarefa.chave === 'importar' ? 'ERP e referência da importação' : 'Conferência externa: documento, recibo ou evidência'}
        <textarea value={evidencia} maxLength={2000} onChange={e => setEvidencia(e.target.value)} />
      </label>
      <Button disabled={ocupado || evidencia.trim().length < 8 || (tarefa.chave === 'importar' && !selecionados.length)} onClick={() => salvar(tarefa, { acao:'concluir', evidencia, entryIds: tarefa.chave === 'importar' ? selecionados : undefined })}>Confirmar conclusão</Button>
    </div>}
    {tarefa.automatica && <p>A conclusão acompanha a operação registrada no sistema.</p>}
    {tarefa.dados.conclusao && <p>Última conferência: {tarefa.dados.conclusao.evidencia}</p>}
    {tarefa.dados.conclusao && <Button disabled={ocupado} variant="secondary" onClick={() => salvar(tarefa,{acao:'reabrir'})}>Desfazer confirmação manual</Button>}
    {!!tarefa.historico?.length && <details><summary>Histórico ({tarefa.historico.length})</summary><ul>{[...tarefa.historico].reverse().map(h => <li key={h.id}>{new Date(h.em).toLocaleString('pt-BR')} · {h.acao} · usuário {h.por}{h.dados?.conclusao?.evidencia ? ` · ${h.dados.conclusao.evidencia}` : ''}</li>)}</ul></details>}
  </div>;
}

export function FluxoCarteiraDetalhe({ company, competencia, api, onFechar, onChanged, onOpenCompany, tarefaInicial = null }) {
  const [detalhe,setDetalhe] = useState(null), [erro,setErro] = useState(''), [ocupado,setOcupado] = useState(false), [revisao,setRevisao] = useState(0);
  const [editor,setEditor] = useState(tarefaInicial);
  const id = company.companyId;
  useEffect(() => {
    let ativo=true; setDetalhe(null); setErro('');
    Promise.resolve().then(() => api.getFluxoCarteira(id,competencia)).then(r => { if(r?.ok===false)throw new Error(r.message); if(ativo)setDetalhe(r); }).catch(e => {if(ativo)setErro(e.message);});
    return () => { ativo=false; };
  },[id,competencia,api,revisao]);
  async function salvar(tarefa, dados) {
    if(ocupado)return;
    setOcupado(true);setErro('');
    try {
      const r=await api.salvarFluxoTarefa(id,tarefa.chave,{...dados,competencia,versao:tarefa.versao || 0,hash:tarefa.hash});
      if(r?.ok===false)throw new Error(r.message);
      setRevisao(x=>x+1);onChanged?.();
    } catch(e){setErro(e.message);}finally{setOcupado(false);}
  }
  return <Modal titulo={`Tarefas · ${company.razao || 'Empresa'} · ${competencia}`} tamanho="lg" aoFechar={onFechar} ocupado={ocupado}>
    {erro && <p role="alert">{erro} <button type="button" onClick={()=>setRevisao(x=>x+1)}>Atualizar</button></p>}
    {!detalhe && !erro && <p role="status">Carregando tarefas…</p>}
    {detalhe && <>
      <p>{detalhe.fluxo.regime} · Próxima etapa: <strong>{detalhe.fluxo.status.rotulo}</strong></p>
      <Button variant="secondary" onClick={()=>{onFechar();onOpenCompany?.(id);}}>Abrir empresa</Button>
      <ol className="carteira-task-list">{detalhe.fluxo.tarefas.map(t => <li key={t.chave}>
        <button className="carteira-task-toggle" type="button" aria-expanded={editor===t.chave} onClick={()=>setEditor(editor===t.chave ? null : t.chave)}><span>{t.concluida ? '✓' : '○'} {t.titulo}</span><span>{t.concluida ? 'Concluída' : t.aguardando?.length ? 'Aguardando etapa' : 'Pendente'}</span></button>
        {(t.dados.responsavel || t.dados.dataFim) && <small>{t.dados.responsavel || 'Sem responsável'}{t.dados.dataFim ? ` · ${t.dados.dataInicio} a ${t.dados.dataFim}` : ' · Sem prazo'}</small>}
        {editor===t.chave && <EditorTarefa key={`${t.chave}:${t.versao}`} tarefa={t} detalhe={detalhe} salvar={salvar} ocupado={ocupado} />}
      </li>)}</ol>

    </>}
  </Modal>;
}
