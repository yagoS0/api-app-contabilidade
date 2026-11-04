import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { InternalLink } from '../../components/ui/InternalLink';
import { companyTabPath } from '../companies/detail/lib/rotasDaEmpresa';
import { operationMoney as money, operationInstant, readCalculationDetails } from './operationsDetails';

export function CalculationEvidence({ details }) {
  if (!details) return <p role="status">Lendo cálculo e auditoria salvos…</p>;
  const snapshot = details.snapshot?.value, audit = details.auditoria?.value;
  // The history DTO has no calculation revision key. Do not join by declaration
  // number/date/current flag: reopening and recalculation preserve old identifiers.
  const history = details.history?.value;
  return <>
    {Object.entries(details).filter(([, source]) => source.error).map(([key, source]) => <p role="alert" key={key}>Leitura de {({ snapshot: 'cálculo salvo', auditoria: 'auditoria de notas', history: 'histórico PGDAS' })[key]}: {source.error}. Atualize a conferência ou abra a empresa para verificar.</p>)}
    <dl className="operacoes-checklists">
      <div><dt>Faturamento interno salvo</dt><dd>{money(snapshot?.receitaInterna)}</dd></div>
      <div><dt>Faturamento externo salvo</dt><dd>{money(snapshot?.receitaExterna)}</dd></div>
      <div><dt>Cálculo simulado salvo</dt><dd>{money(snapshot?.dasSimuladoSerpro)}</dd></div>
      <div><dt>Estado do snapshot</dt><dd>{snapshot?.estado || 'Não disponível'}</dd></div>
      <div><dt>Declaração do snapshot</dt><dd>{snapshot?.numeroDeclaracao || 'Não registrada'}</dd></div>
      <div><dt>Retorno salvo da transmissão SERPRO</dt><dd>{money(snapshot?.dasRetornadoSerpro)}</dd></div>
      <div><dt>Data salva da transmissão</dt><dd>{operationInstant(snapshot?.transmitidoEm)}</dd></div>
      <div><dt>Correspondência do extrato com esta revisão</dt><dd>A verificar</dd></div>
    </dl>
    <p>Extrato sem vínculo comprovado com a revisão do cálculo. Número da declaração e valores iguais não comprovam correspondência. O retorno salvo pode pertencer à transmissão anterior quando o cálculo foi reaberto ou recalculado.</p>
    {history && <>
      {(history.declaracaoDiferenteDaInterna || history.entregaSemTransmissaoInterna || history.mudancaDetectada) && <p role="alert">O histórico indica mudança ou divergência de declaração. Confira as versões na apuração da empresa.</p>}
      <div className="operacoes-tabela-scroll" role="region" aria-label="Extratos salvos, sem conciliação de revisão" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Declaração / versão</th><th>Imposto do extrato salvo</th><th>Origem</th><th>Consulta</th><th>Registro</th></tr></thead><tbody>{history.versoes.map((v, i) => <tr key={`${v.id || 'legado'}-${i}`}><td>{v.numeroDeclaracao || 'Não registrada'}<br />{v.id || 'Versão não identificada'}</td><td>{money(v.dasTotal)}</td><td>{v.origem || 'Não registrada'}</td><td>{operationInstant(v.consultadaEm)}</td><td>{v.atual ? 'Atual na circular' : 'Histórico'}{v.legado ? ' · Legado' : ''}</td></tr>)}</tbody></table></div>
      {!history.versoes.length && <p>Nenhum extrato salvo disponível.</p>}
      {history.limitado && <p>Histórico limitado pela fonte. Abra a apuração para conferir os documentos disponíveis.</p>}
    </>}
    <div className="operacoes-tabela-scroll" role="region" aria-label="Atividades do cálculo salvo" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Atividade salva</th><th>Anexo do formulário</th><th>Receita interna / externa</th></tr></thead><tbody>{(Array.isArray(snapshot?.atividadesEscolhidas) ? snapshot.atividadesEscolhidas : []).map((activity, i) => <tr key={i}><td>{activity.descricao || activity.idAtividade || 'Não informado'}</td><td>{activity.anexoImplicito ?? 'Não registrado no formulário'}</td><td>{money(activity.valorInterno)} / {money(activity.valorExterno)}</td></tr>)}</tbody></table></div>
    {!snapshot?.atividadesEscolhidas?.length && <p>Atividades/anexo não disponíveis no snapshot. O cadastro atual não substitui o formulário histórico.</p>}
    <p>Auditoria: {audit ? `${audit.totalAchados ?? 'A verificar'} achados · ${audit.foraDaConferencia?.total ?? 'A verificar'} notas fora da conferência` : 'Indisponível; ausência não significa aprovação.'}</p>
    {audit && <div className="operacoes-tabela-scroll" role="region" aria-label="Auditoria da competência" tabIndex={0}><table className="operacoes-tabela"><thead><tr><th>Verificação</th><th>Situação</th><th>Achados / não avaliadas</th><th>Causa</th></tr></thead><tbody>{[...(audit.perguntas || []), ...(audit.manutencao?.leitura ? [audit.manutencao.leitura] : [])].map(p => <tr key={p.id}><td>{p.titulo || p.id}</td><td>{p.situacao || 'A verificar'}</td><td>{p.achados?.length ?? 'A verificar'} / {p.naoAvaliadas?.length ?? 'A verificar'}</td><td>{p.motivo || (p.achados?.length ? 'Revisar as notas apontadas na auditoria' : 'Conferir evidências da verificação')}</td></tr>)}</tbody></table></div>}
  </>;
}

export function OperationsCalculationDetails({ api, companyId, competencia }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true; setData(null);
    readCalculationDetails(api, companyId, competencia).then(value => { if (active) setData(value); });
    return () => { active = false; };
  }, [api, companyId, competencia]);
  return <CalculationEvidence details={data} />;
}

export function OperationsTransmissionTable({ api, rows, visibleRows, competencia, footerTarget, onDetailChange, onBusyChange }) {
  const [data, setData] = useState({}), [selected, setSelected] = useState({}), [versions, setVersions] = useState({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [preview, setPreview] = useState(null);
  const generation = useRef(0), lock = useRef(false);
  const [detail,setDetail]=useState(null),[limits,setLimits]=useState(false);
  const detailTrigger=useRef(null),detailHeading=useRef(null),detailScroll=useRef(null);
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  useEffect(()=>{onDetailChange?.(Boolean(detail));if(detail)detailHeading.current?.focus({preventScroll:true});return()=>onDetailChange?.(false);},[detail,onDetailChange]);
  const back=()=>{setDetail(null);requestAnimationFrame(()=>{if(detailScroll.current)detailScroll.current.node.scrollTop=detailScroll.current.top;detailTrigger.current?.focus({preventScroll:true});});};
  const ids = rows.map(r => r.company.companyId).sort().join('|');
  useEffect(() => {
    const run = ++generation.current;
    setDetail(null);setData({}); setSelected({}); setVersions({}); setPreview(null); setMessage(''); setBusy(false); lock.current = false;
    (async () => {
      for (const companyId of ids.split('|').filter(Boolean)) {
        let value;
        try {
          if (!api?.getOperationsTransmissionDocuments) throw Error('Leitura vinculada indisponível nesta conexão.');
          value = await api.getOperationsTransmissionDocuments(companyId, competencia);
          if (value?.ok !== true || value.companyId !== companyId || value.competencia !== competencia || !Array.isArray(value.items)
            || value.items.some(i => i.companyId !== companyId || i.competencia !== competencia || !i.releaseId || !i.versionId || !i.calculoId || !i.proofHash || !i.documentos)) throw Error('Identidade ou revisão documental incompatível.');
        } catch (e) { value = { error: e.message }; }
        if (generation.current !== run) return;
        setData(old => ({ ...old, [companyId]: { api, competencia, value } }));
      }
    })();
    return () => { generation.current++; };
  }, [api, ids, competencia]);
  const sourceFor = id => data[id]?.api === api && data[id]?.competencia === competencia ? data[id].value : null;
  const versionKey = item => `${item.releaseId}:${item.versionId}`;
  const current = id => sourceFor(id)?.items?.find(i => versionKey(i) === versions[id]) || sourceFor(id)?.items?.[0];
  const selection = id => {
    const item = current(id);
    return item?.documentos.extrato ? { companyId: id, competencia, releaseId: item.releaseId, versionId: item.versionId, tipo: 'extrato' } : null;
  };
  const chosen = rows.filter(r => selected[r.company.companyId]).map(r => selection(r.company.companyId)).filter(Boolean);
  const visibleIds = new Set(visibleRows.map(r => r.company.companyId));
  const hidden = chosen.filter(i => !visibleIds.has(i.companyId)).length;
  const eligible = visibleRows.filter(r => selection(r.company.companyId));
  async function download(items, zip) {
    if (lock.current || !api?.downloadOperationsTransmissionDocuments) return;
    const run = generation.current;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const blob = await api.downloadOperationsTransmissionDocuments(items, zip);
      if (generation.current !== run) return;
      if (!(blob instanceof Blob) || !blob.size || !(zip ? ['application/zip', 'application/x-zip-compressed'] : ['application/pdf']).includes(blob.type)) throw Error('Arquivo inválido.');
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = zip ? `extratos-${competencia}.zip` : `pgdas-${items[0].tipo}-${competencia}.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(zip ? 'ZIP entregue ao navegador. Confira resultado.json: arquivos indisponíveis ou recusados tornam o lote parcial.' : 'PDF entregue ao navegador.');
    } catch (e) { if (generation.current === run) setMessage(`Download não confirmado: ${e.message}`); }
    finally { if (generation.current === run) { lock.current = false; setBusy(false); setPreview(null); } }
  }
  return <section aria-label="Declarações transmitidas e documentos vinculados">
    {!detail && <div className="operacoes-acoes operacoes-selection-summary"><span>{chosen.length} selecionadas · {hidden} fora da página ou busca atual</span><Button size="sm" variant="secondary" disabled={busy || !chosen.length} onClick={()=>{setSelected({});setPreview(null);}}>Limpar seleção</Button><Button size="sm" variant="secondary" aria-expanded={limits} onClick={()=>setLimits(!limits)}>Limites do download</Button></div>}
    {limits && !detail && <p>Limite de 30 PDFs, 8 MiB por arquivo e 32 MiB por ZIP. Valores do histórico vinculado à revisão transmitida. Reabrir a apuração não altera estes valores. Baixar não consulta o Fisco.</p>}
    {footerTarget ? createPortal(detail?<Button variant="secondary" disabled={busy} onClick={back}>Voltar</Button>:<div className="operacoes-acoes operacoes-transmission-footer"><Button aria-label={`Selecionar elegíveis desta página (${eligible.length})`} variant="secondary" disabled={busy||!eligible.length} onClick={()=>setSelected(old=>({...old,...Object.fromEntries(eligible.map(r=>[r.company.companyId,true]))}))}>Selecionar página ({eligible.length})</Button><Button disabled={busy||!chosen.length||chosen.length>30||!api?.downloadOperationsTransmissionDocuments} onClick={()=>setPreview(chosen.map(i=>({...i})))}>Baixar extratos selecionados ({chosen.length})</Button></div>,footerTarget):detail?<Button variant="secondary" disabled={busy} onClick={back}>Voltar</Button>:<div className="operacoes-acoes operacoes-transmission-footer"><Button aria-label={`Selecionar elegíveis desta página (${eligible.length})`} variant="secondary" disabled={busy||!eligible.length} onClick={()=>setSelected(old=>({...old,...Object.fromEntries(eligible.map(r=>[r.company.companyId,true]))}))}>Selecionar página ({eligible.length})</Button><Button disabled={busy||!chosen.length||chosen.length>30||!api?.downloadOperationsTransmissionDocuments} onClick={()=>setPreview(chosen.map(i=>({...i})))}>Baixar extratos selecionados ({chosen.length})</Button></div>}
    {message && <p role="status">{message}</p>}
    {preview && <div className="operacoes-previa"><h3>Conferir documentos selecionados</h3><ul>{preview.map(i => <li key={i.companyId}>{rows.find(r => r.company.companyId === i.companyId)?.company.razao || i.companyId} · {i.competencia} · versão {i.versionId}</li>)}</ul><p>Somente arquivos armazenados. Acesso e vínculo serão revalidados por item; resultado parcial será identificado no ZIP. Nenhuma consulta paga, transmissão ou envio.</p><div className="operacoes-acoes"><Button disabled={busy} onClick={() => download(preview, true)}>Confirmar download</Button><Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button></div></div>}
    <div hidden={Boolean(detail)} className="operacoes-tabela-scroll" role="region" aria-label="Transmissões vinculadas" tabIndex={0}><table className="operacoes-tabela operacoes-transmission-tabela"><thead><tr><th className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label="Selecionar extratos elegíveis desta página" disabled={busy || !eligible.length} checked={eligible.length > 0 && eligible.every(r => selected[r.company.companyId])} onChange={e => { setPreview(null); setSelected(old => ({ ...old, ...Object.fromEntries(eligible.map(r => [r.company.companyId, e.target.checked])) })); }} /></label></th><th>Empresa / declaração</th><th className="operacoes-desktop-cell">Receita transmitida</th><th>Tributos</th><th className="operacoes-desktop-cell">Recibo</th><th className="operacoes-desktop-cell">Extrato</th><th>Ações</th></tr></thead><tbody>{visibleRows.map(({ company, operation }) => {
      const id = company.companyId, source = sourceFor(id), item = current(id), name = company.razao || company.razaoSocial || company.cnpj;
      const href = `${companyTabPath(id, 'cadastroFiscal')}?competencia=${encodeURIComponent(competencia)}`;
      return <tr key={id}><td className="operacoes-coluna-selecao"><label className="operacoes-selecao-alvo"><input type="checkbox" aria-label={`Selecionar extrato de ${name}`} disabled={busy || !selection(id)} checked={Boolean(selected[id])} onChange={e => { setPreview(null); setSelected(old => ({ ...old, [id]: e.target.checked })); }} /></label></td><th scope="row">{name}{operation?.blocked && <p role="alert">{operation.blocked}</p>}{operation?.execution?.message && <p>{operation.execution.message}</p>}{source?.unavailable?.length > 0 && <p>{source.unavailable.length} execução(ões) sem vínculo documental comprovado.</p>}{source?.error ? <p role="alert">{source.error}</p> : !source ? <p role="status">Lendo documentos salvos…</p> : !item ? <p>Vínculo indisponível. Confira o histórico na apuração.</p> : <><p className="operacoes-desktop-cell">Declaração {item.numeroDeclaracao} · histórico vinculado</p><small className="operacoes-desktop-cell">Cálculo: {item.calculoId}</small>{source.items.length > 1 && <label>Versão<select aria-label={`Versão de ${name}`} disabled={busy} value={versionKey(item)} onChange={e => { setPreview(null); setSelected(old => ({ ...old, [id]: false })); setVersions(old => ({ ...old, [id]: e.target.value })); }}>{source.items.map(i => <option key={versionKey(i)} value={versionKey(i)}>{i.numeroDeclaracao} · {i.calculoId} · {i.versionId.slice(0, 12)}</option>)}</select></label>}</>}{source?.limitado && <p>Histórico limitado; não representa todas as versões.</p>}</th><td className="operacoes-desktop-cell">{money(item?.receitaBruta)}</td><td>DAS: {money(item?.dasTotal)}</td><td className="operacoes-desktop-cell"><Button size="sm" variant="secondary" disabled={busy || !item?.documentos.recibo || !api?.downloadOperationsTransmissionDocuments} onClick={() => download([{ ...selection(id), tipo: 'recibo' }], false)}>Baixar recibo</Button></td><td className="operacoes-desktop-cell"><Button size="sm" variant="secondary" disabled={busy || !selection(id) || !api?.downloadOperationsTransmissionDocuments} onClick={() => download([selection(id)], false)}>Baixar extrato</Button></td><td><Button size="sm" variant="secondary" disabled={busy} aria-label={`Detalhes da transmissão de ${name}`} onClick={e=>{detailTrigger.current=e.currentTarget;const node=e.currentTarget.closest(".modal-corpo");detailScroll.current=node?{node,top:node.scrollTop}:null;setDetail(id);}}>Detalhes</Button><div className="operacoes-acoes operacoes-desktop-cell"><InternalLink className="btn btn-secondary btn-sm" href={href}>Retificar</InternalLink><InternalLink className="btn btn-secondary btn-sm" href={href}>Abrir empresa</InternalLink></div><small className="operacoes-desktop-cell">Retificar abre a apuração; não executa reabertura.</small></td></tr>;
    })}</tbody></table></div>
    {detail && (()=>{const row=rows.find(r=>r.company.companyId===detail),item=current(detail),source=sourceFor(detail),href=`${companyTabPath(detail,'cadastroFiscal')}?competencia=${encodeURIComponent(competencia)}`;return <section aria-label="Detalhes da transmissão"><h3 ref={detailHeading} tabIndex={-1}>{row?.company.razao||row?.company.razaoSocial||detail} · {competencia}</h3>{source?.error&&<p role="alert">{source.error}</p>}{row?.operation?.blocked&&<p role="alert">{row.operation.blocked}</p>}{row?.operation?.execution?.message&&<p>{row.operation.execution.message}</p>}<table className="operacoes-tabela operacoes-detail-table"><tbody>{[['Declaração',item?.numeroDeclaracao||'A verificar'],['Receita transmitida',money(item?.receitaBruta)],['DAS',money(item?.dasTotal)],['Cálculo',item?.calculoId||'A verificar'],['Revisão',item?.versionId||'A verificar'],['Recibo',item?.documentos.recibo?'Disponível':'Indisponível'],['Extrato',item?.documentos.extrato?'Disponível':'Indisponível']].map(([key,value])=><tr key={key}><th scope="row">{key}</th><td>{value}</td></tr>)}</tbody></table><p>Valores do histórico vinculado à revisão transmitida. Reabrir a apuração não altera estes valores. Baixar não consulta o Fisco.</p>{source?.unavailable?.length>0&&<p>{source.unavailable.length} execução(ões) sem vínculo documental comprovado.</p>}{source?.limitado&&<p>Histórico limitado; não representa todas as versões.</p>}<div className="operacoes-acoes"><Button variant="secondary" disabled={busy||!item?.documentos.recibo||!api?.downloadOperationsTransmissionDocuments} onClick={()=>download([{companyId:detail,competencia,releaseId:item.releaseId,versionId:item.versionId,tipo:'recibo'}],false)}>Baixar recibo</Button><Button variant="secondary" disabled={busy||!selection(detail)||!api?.downloadOperationsTransmissionDocuments} onClick={()=>download([selection(detail)],false)}>Baixar extrato</Button><InternalLink className="btn btn-secondary btn-md" href={href}>Abrir apuração</InternalLink><InternalLink className="btn btn-secondary btn-md" href={href}>Retificar</InternalLink></div><small>Retificar abre a apuração; não executa reabertura.</small></section>;})()}
  </section>;
}

// Read-only summary: these are distinct saved sources, never proof of reconciliation.
export function OperationsTransmissionValues({ api, companyId, competencia }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    readCalculationDetails(api, companyId, competencia).then(details => {
      if (active) setResult({ api, companyId, competencia, details });
    });
    return () => { active = false; };
  }, [api, companyId, competencia]);
  const details = result && result.api === api && result.companyId === companyId && result.competencia === competencia ? result.details : null;
  if (!details) return <><td>Lendo cálculo salvo…</td><td>Lendo extrato salvo…</td></>;
  const snapshot = details.snapshot?.value, history = details.history?.value;
  const failed = Object.values(details).some(source => source.error);
  const versions = history?.versoes || [];
  const current = versions.filter(version => version.atual);
  const divergent = history?.declaracaoDiferenteDaInterna || history?.entregaSemTransmissaoInterna || history?.mudancaDetectada;
  const incompatible = versions.some(version =>
    (version.competencia != null && version.competencia !== competencia) ||
    (version.companyId != null && version.companyId !== companyId) ||
    (version.portalClientId != null && version.portalClientId !== companyId));
  const ambiguous = current.length > 1 || (history?.atualId != null && (current.length !== 1 || current[0].id !== history.atualId));
  const declarationConflict = (history?.numeroDeclaracaoInterna && snapshot?.numeroDeclaracao && String(history.numeroDeclaracaoInterna) !== String(snapshot.numeroDeclaracao)) ||
    (current.length === 1 && snapshot?.numeroDeclaracao && current[0].numeroDeclaracao && String(current[0].numeroDeclaracao) !== String(snapshot.numeroDeclaracao));
  const unknown = failed || incompatible || ambiguous || divergent || declarationConflict;
  return <>
    <td>{unknown || !snapshot ? 'A verificar' : <><span>{money(snapshot.dasSimuladoSerpro)}</span><br /><small>Simulação · {snapshot.idempotencyKey}</small></>}</td>
    <td>{unknown || !versions.length ? 'A verificar' : versions.map((version, index) => <div key={version.id || index}>
      <span>{!version.id || !version.numeroDeclaracao || money(version.dasTotal) === 'Não disponível' ? 'A verificar' : money(version.dasTotal)}</span><br />
      <small>Declaração {version.numeroDeclaracao || 'a verificar'} · versão {version.id || 'a verificar'}<br />{version.atual ? 'Atual na circular' : 'Histórico'}</small>
    </div>)}</td>
  </>;
}
