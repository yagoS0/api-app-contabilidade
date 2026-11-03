import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { operationInstant } from './operationsDetails';

// Retain uncertain creation in this API session across modal remounts. Never retry a POST implicitly.
const jobsByApi = new WeakMap();
function jobsFor(api) {
  if (!api || !['object', 'function'].includes(typeof api)) return new Map();
  if (!jobsByApi.has(api)) jobsByApi.set(api, new Map());
  return jobsByApi.get(api);
}
function saveBlob(blob, type, name) {
  if (!(blob instanceof Blob) || !blob.size || !type.includes(blob.type)) throw Error('Arquivo salvo inválido');
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OperationsFiscalReports({ api, rows, title, competencia, onClose }) {
  const [data, setData] = useState({}), [selected, setSelected] = useState({}), [results, setResults] = useState({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const [query,setQuery] = useState(''), [consultSelected,setConsultSelected] = useState({}), [consultPreview,setConsultPreview] = useState(null), [consultBusy,setConsultBusy] = useState(false);
  const [batch, setBatch] = useState(null), [message, setMessage] = useState('');
  const consultationTrigger=useRef(null),previewHeading=useRef(null);
  useEffect(()=>{if(consultPreview)previewHeading.current?.focus();},[consultPreview]);
  const generation = useRef(0), lock = useRef(false), polling = useRef(0), timer = useRef(null);
  const ids = rows.map(r => r.company.companyId).sort().join('|');
  const context = `${competencia}:${ids}`;
  const currentContext = useRef(context); currentContext.current = context;
  function cancel() {
    polling.current++; timer.current?.(); timer.current = null;
    lock.current = false; setBusy(false);
  }
  useEffect(() => {
    const run = ++generation.current;
    setData({}); setConsultSelected({}); setConsultPreview(null); setSelected({}); setResults({}); setLoading(true); setBatch(null); setMessage(''); setBusy(false);
    (async () => {
      for (const id of ids.split('|').filter(Boolean)) {
        let item;
        try {
          if (!api?.getStoredSitfis) throw Error('Leitura de relatórios salvos indisponível');
          const response = await api.getStoredSitfis(id);
          if (!response || response.ok === false || !Object.hasOwn(response, 'status')) throw Error('Resposta do relatório salvo inválida');
          item = { status: response.status };
        } catch (e) { item = { error: `${e.message}. Abra a situação fiscal para conferir.` }; }
        if (generation.current !== run) return;
        setData(old => ({ ...old, [id]: item }));
      }
      if (generation.current === run) setLoading(false);
    })();
    return () => { generation.current++; polling.current++; timer.current?.(); lock.current = false; };
  }, [api, ids, competencia, version]);
  const eligible = rows.filter(r => data[r.company.companyId]?.status?.relatorioPdfFileId);
  const chosen = eligible.filter(r => selected[r.company.companyId]);
  const key = chosen.map(r => r.company.companyId).sort().join('|');
  const existing = jobsFor(api).get(key);
  const canZip = api?.createSitfisDownload && api?.getSitfisDownload && api?.fetchSitfisDownloadBlob;
  async function downloadOne(id) {
    if (lock.current) return;
    lock.current = true; setBusy(true); const run = generation.current, action = ++polling.current;
    try {
      const blob = await api.fetchSitfisPdfBlob(id);
      if (run !== generation.current || action !== polling.current) return;
      saveBlob(blob, ['application/pdf'], `situacao-fiscal-${String(id).replace(/[^a-z0-9_-]/gi, '')}.pdf`);
      setResults(old => ({ ...old, [id]: 'PDF entregue ao navegador. Confira os downloads.' }));
    } catch (e) { if (run === generation.current && action === polling.current) setResults(old => ({ ...old, [id]: `Falha no download: ${e.message}. Confira o relatório salvo na empresa.` })); }
    finally { if (run === generation.current && action === polling.current) { lock.current = false; setBusy(false); } }
  }
  async function downloadBatch() {
    if (lock.current || loading || !chosen.length || !canZip) return;
    const cache = jobsFor(api), previous = cache.get(key);
    if (previous?.uncertain) { setMessage('Criação do ZIP com resultado incerto. Confira Tarefas antes de qualquer novo pedido.'); return; }
    lock.current = true; setBusy(true); setMessage('');
    const run = generation.current, poll = ++polling.current;
    const active = () => run === generation.current && poll === polling.current && context === currentContext.current;
    let record = previous;
    try {
      if (!record) {
        record = { uncertain: true, requested: chosen.length }; cache.set(key, record);
        const created = await api.createSitfisDownload(chosen.map(r => r.company.companyId));
        if (created?.ok === false || !created?.jobId) throw Error('Criação do ZIP não confirmada. Confira Tarefas; não repita o pedido');
        record = { jobId: created.jobId, requested: chosen.length }; cache.set(key, record);
      }
      if (!active()) return;
      setBatch(record);
      for (let attempt = 0; attempt < 40; attempt++) {
        const out = await api.getSitfisDownload(record.jobId);
        if (!active()) return;
        if (out?.ok === false || !out?.job || out.job.id !== record.jobId) throw Error('Leitura do job não confirmada');
        const job = out.job; setBatch({ ...record, job });
        // A definitive result ends this request. A later explicit click requests
        // the PDFs currently saved, rather than reusing an old archive forever.
        if (['concluido', 'erro', 'expirado'].includes(job.status) && cache.get(key) === record) cache.delete(key);
        if (job.status === 'concluido') {
          const blob = await api.fetchSitfisDownloadBlob(record.jobId);
          if (!active()) return;
          saveBlob(blob, ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], 'situacoes-fiscais.zip');
          setMessage(`ZIP entregue ao navegador: ${job.comPdf ?? 'A verificar'} PDFs / ${record.requested} empresas solicitadas. O serviço não informa quais itens falharam ou ficaram sem PDF.`);
          return;
        }
        if (['erro', 'expirado'].includes(job.status)) {
          setMessage(`${job.erroMensagem || `ZIP ${job.status}`}. Confira Tarefas ou solicite um novo download dos PDFs salvos.`);
          return;
        }
        await new Promise(resolve => { const timeout = setTimeout(resolve, 1500); timer.current = () => { clearTimeout(timeout); resolve(); }; });
        timer.current = null;
        if (!active()) return;
      }
      setMessage('Acompanhamento pausado após 40 leituras. Retome o mesmo job ou confira Tarefas; nenhum novo ZIP foi solicitado.');
    } catch (e) { if (active()) { setBatch(record); setMessage(`${e.message}. Resultado não confirmado; confira Tarefas ou retome a leitura do mesmo job.`); } }
    finally { if (active()) { lock.current = false; setBusy(false); } }
  }
  const visible = rows.filter(r => `${r.company.razao || r.company.razaoSocial || ''} ${r.company.cnpj || ''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  const consultEligible = rows.filter(r => ['ACCOUNTANT','FIRM_ADMIN'].includes(r.company.myRole));
  const consultAllowed=useRef(new Set());consultAllowed.current=new Set(consultEligible.map(r=>r.company.companyId));
  const consultChosen = consultEligible.filter(r=>consultSelected[r.company.companyId]);
  async function consult() {
    if(lock.current || !consultPreview?.length) return;
    const run=generation.current, items=consultPreview;
    lock.current=true;setBusy(true);setConsultBusy(true);setConsultPreview(null);
    try { for(const {company} of items) {
      if(run!==generation.current) return;
      let result;
      try { if(!consultAllowed.current.has(company.companyId))throw Error('Acesso mudou; atualize a seleção.');const out=await api.getSitfis(company.companyId);
        result=out?.message || out?.mensagem || (out?.processando?'Consulta em processamento. Atualize somente a leitura salva.':out?.throttled?'Consulta em cache; respeite a próxima consulta permitida.':out?.ok===true?'Consulta recebida. Confira a situação e a data do relatório salvo.':'Resultado não confirmado; confira a empresa antes de repetir.');
        const saved=await api.getStoredSitfis(company.companyId);
        if(run!==generation.current)return;
        if(saved?.ok!==false && Object.hasOwn(saved||{},'status'))setData(old=>({...old,[company.companyId]:{status:saved.status}}));
      } catch(e) {result=`${e.message}. Resultado incerto; confira a empresa antes de repetir.`;}
      if(run===generation.current)setResults(old=>({...old,[company.companyId]:result}));
    }} finally {if(run===generation.current){lock.current=false;setBusy(false);setConsultBusy(false);}}
  }
  return <Modal titulo={title} tamanho="lg" className="operacoes-dialogo" ocupado={consultBusy} aoFechar={() => { cancel(); onClose(); }} rodape={<Button variant="secondary" disabled={consultBusy} onClick={() => { cancel(); onClose(); }}>Fechar</Button>}>
    <label className="operacoes-rotinas-filtros">Buscar empresa<input type="search" disabled={busy} value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="operacoes-acoes"><Button variant="secondary" disabled={busy||!api?.getSitfis} onClick={()=>setConsultSelected(old=>({...old,...Object.fromEntries(visible.filter(r=>consultEligible.includes(r)).map(r=>[r.company.companyId,true]))}))}>Selecionar exibidas para consulta</Button><Button ref={consultationTrigger} disabled={busy||!api?.getSitfis||!consultChosen.length} onClick={()=>setConsultPreview([...consultChosen])}>Consultar situação fiscal ({consultChosen.length})</Button></div>
    {consultPreview&&<div className="operacoes-previa"><h3 ref={previewHeading} tabIndex={-1}>Conferir consulta SITFIS</h3><p>Consulta explícita com custo potencial. Cache de 4 horas e próxima consulta permitida são respeitados; relatório mantém a própria data. Não consulta guias nem confirma pagamento.</p><ul>{consultPreview.map(({company})=><li key={company.companyId}>{company.razao||company.razaoSocial||company.cnpj}</li>)}</ul><Button disabled={busy} onClick={consult}>Confirmar consultas selecionadas</Button> <Button variant="secondary" disabled={busy} onClick={()=>{setConsultPreview(null);consultationTrigger.current?.focus();}}>Cancelar</Button></div>}
    <p>Relatórios salvos por empresa, com suas datas próprias. Baixar não consulta nem renova a situação no Fisco.</p>
    <div className="operacoes-acoes"><Button variant="secondary" disabled={busy || loading} onClick={() => setVersion(v => v + 1)}>Atualizar lista salva</Button><Button variant="secondary" disabled={busy || loading || !eligible.length} onClick={() => setSelected(Object.fromEntries(eligible.map(r => [r.company.companyId, true])))}>Selecionar PDFs disponíveis</Button><Button disabled={busy || loading || !chosen.length || !canZip || existing?.uncertain} onClick={downloadBatch}>{existing?.jobId ? 'Retomar download do mesmo ZIP' : `Baixar selecionados (${chosen.length})`}</Button>{busy && !consultBusy && <Button variant="secondary" onClick={cancel}>Parar acompanhamento</Button>}</div>
    {existing?.uncertain && <p role="alert">Criação do ZIP com resultado incerto. Confira Tarefas; não repita o pedido.</p>}
    {loading && <p role="status">Lendo relatórios salvos…</p>}
    {batch && <p role="status">ZIP {batch.jobId || 'a confirmar'} · {batch.job?.comPdf ?? 'A verificar'} com PDF / {batch.requested} solicitadas · {batch.job?.status || 'Acompanhamento pendente'}</p>}
    {message && <p role="status">{message}</p>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Relatórios fiscais salvos" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th className="operacoes-coluna-selecao">Selecionar</th><th>Consulta</th><th>Empresa</th><th>Situação / PDF salvo</th><th>Resultado individual</th><th>Ações</th></tr></thead><tbody>{visible.map(({ company }) => {
      const id = company.companyId, name = company.razao || company.razaoSocial || company.cnpj, item = data[id];
      return <tr key={id}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar PDF de ${name}`} disabled={busy || loading || !eligible.some(r => r.company.companyId === id)} checked={Boolean(selected[id])} onChange={e => setSelected(old => ({ ...old, [id]: e.target.checked }))} /></label></td><td><input type="checkbox" aria-label={`Consultar situação fiscal de ${name}`} disabled={busy||!consultEligible.some(r=>r.company.companyId===id)} checked={Boolean(consultSelected[id])} onChange={e=>{setConsultPreview(null);setConsultSelected(old=>({...old,[id]:e.target.checked}));}}/></td><th scope="row">{name}</th><td><p>{item?.status?.situacao || item?.status?.status || 'Situação a verificar'}</p>{item?.status?.proximaConsultaEm&&<small>Próxima consulta: {operationInstant(item.status.proximaConsultaEm)}</small>}{item?.error ? <p role="alert">{item.error}</p> : !item ? 'Lendo…' : item.status?.relatorioPdfFileId ? `Salvo · ${operationInstant(item.status.ultimoRelatorioEm || item.status.checkedAt)}` : 'PDF salvo indisponível'}</td><td>{results[id] || 'Nenhum download individual solicitado'}</td><td><div className="operacoes-acoes"><Button variant="secondary" size="sm" disabled={busy || !item?.status?.relatorioPdfFileId || !api?.fetchSitfisPdfBlob} onClick={() => downloadOne(id)}>Baixar PDF de {name}</Button><InternalLink className="btn btn-secondary btn-sm" href={`${companyTabPath(id, 'sitfis')}?competencia=${encodeURIComponent(competencia)}`}>Abrir situação fiscal da empresa</InternalLink></div></td></tr>;
    })}</tbody></table></div>
    {!rows.length && <p>Nenhuma empresa neste grupo.</p>}
    {!canZip && <p role="alert">Download ZIP autenticado indisponível neste ambiente. Confira os PDFs individualmente na empresa.</p>}
  </Modal>;
}
