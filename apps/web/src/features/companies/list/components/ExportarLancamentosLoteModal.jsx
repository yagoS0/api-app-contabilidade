import { useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';

export function ExportarLancamentosLoteModal({api,companies=[],competencia,onClose}) {
  const [de,setDe]=useState(competencia||''),[ate,setAte]=useState(competencia||'');
  const [previa,setPrevia]=useState(null),[erro,setErro]=useState(null),[busy,setBusy]=useState(false),[confirmado,setConfirmado]=useState(false),[baixado,setBaixado]=useState(false);
  const pedido={companyIds:companies.map(c=>c.id),competenciaInicio:de,competenciaFim:ate};
  const aptas=previa?.empresas?.filter(e=>e.estado==='PRONTA')||[];
  const temAlertas=aptas.some(e=>e.alertas?.length);
  async function conferir(){setBusy(true);setErro(null);setPrevia(null);setConfirmado(false);setBaixado(false);try{const r=await api.preflightEntriesBatch(pedido);if(r?.ok===false)throw new Error(r.message||'Falha na conferência');setPrevia(r);}catch(e){setErro(e.message);}finally{setBusy(false);}}
  async function baixar(){setBusy(true);setErro(null);try{const blob=await api.exportEntriesBatch({...pedido,confirmarAlertas:confirmado,preflightHashes:Object.fromEntries((previa?.empresas||[]).map(e=>[e.id,e.preflightHash]))});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`lancamentos-${de}_${ate}.zip`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setBaixado(true);}catch(e){setErro(e.message||'Falha ao baixar o lote.');}finally{setBusy(false);}}
  const mudar=(set,v)=>{set(v);setPrevia(null);setConfirmado(false);setBaixado(false);};
  return <Modal titulo="Exportar lançamentos das empresas" tamanho="lg" ocupado={busy} aoFechar={onClose} rodape={<><Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button><Button disabled={busy||!de||!ate} onClick={conferir}>Conferir lote</Button><Button disabled={busy||!aptas.length||(temAlertas&&!confirmado)} onClick={baixar}>{busy?'Preparando…':'Baixar ZIP com CSVs'}</Button></>}>
    <p>{companies.length} empresa(s) selecionada(s). Um CSV por empresa, no formato do ERP: cinco colunas sem cabeçalho.</p>
    <ul>{companies.map(c=><li key={c.id}>{c.razao||c.razaoSocial||c.id} · {c.cnpj||'CNPJ não informado'}</li>)}</ul>
    <div style={{display:'flex',gap:16,flexWrap:'wrap'}}><label>Competência inicial <input type="month" value={de} disabled={busy} onChange={e=>mudar(setDe,e.target.value)}/></label><label>Competência final <input type="month" value={ate} disabled={busy} onChange={e=>mudar(setAte,e.target.value)}/></label></div>
    <p>Todos os lançamentos do período, exceto rastreio de parcelas. Os filtros de tipo e status da tela individual não se aplicam a este lote.</p>
    {erro&&<p role="alert">{erro}</p>}
    {previa&&<div role="status"><p>{aptas.length} empresa(s) apta(s); {(previa.empresas?.length||0)-aptas.length} fora do arquivo.</p>{previa.empresas.map(e=><section key={e.id}><strong>{e.razao||companies.find(c=>c.id===e.id)?.razao||e.id}: {({PRONTA:'pronta',BLOQUEADA:'bloqueada',SEM_MOVIMENTO:'sem lançamentos',SEM_ACESSO:'sem acesso',FALHA:'falha',INDISPONIVEL:'indisponível'})[e.estado]||e.estado}</strong>{e.motivo&&<p>{e.motivo}</p>}<ul>{[...(e.erros||[]),...(e.alertas||[])].map((m,i)=><li key={i}>{m.competencia} · {m.motivo}</li>)}</ul></section>)}</div>}
    {temAlertas&&<label style={{display:'block',marginTop:12}}><input type="checkbox" checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/> Conferi os alertas das empresas aptas e desejo exportar.</label>}
    {baixado&&<p role="status">Download solicitado. Confira o manifesto.json dentro do ZIP: ele registra o resultado final de cada empresa, inclusive falhas parciais. A conferência foi refeita na geração. A importação no ERP e o status dos lançamentos não foram confirmados automaticamente.</p>}
  </Modal>;
}
