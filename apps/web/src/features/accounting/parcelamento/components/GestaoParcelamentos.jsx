import { useEffect, useState } from 'react';
import { Modal } from '../../../../components/ui/Modal';
import { Button } from '../../../../components/ui/Button';
import { quadroGestaoParcelamento } from '../../../../../../../packages/shared/src/accounting/gestaoParcelamento.js';
import { resumoOrigensParcelamento } from '../../../../../../../packages/shared/src/accounting/composicaoParcelamento.js';
import './gestaoParcelamentos.css';

const moeda = n => n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const civil = d => d ? String(d).slice(0,10) : '';
const hoje = () => new Date().toLocaleDateString('sv-SE');
const dataBR = d => civil(d).split('-').reverse().join('/') || '—';

export function GestaoParcelamentos({ companyId, contratos, api, onAtualizar, onComposicao, onBaixaDocumental }) {
  const [id, setId] = useState(null), [detalhe, setDetalhe] = useState(null);
  const [aba, setAba] = useState('Parcelas'), [erro, setErro] = useState(''), [versao, setVersao] = useState(0);
  const [correcao, setCorrecao] = useState(false), [baixa, setBaixa] = useState(null);
  const [conciliacao,setConciliacao]=useState(false);
  const [referencia, setReferencia] = useState(hoje().slice(0,7));
  useEffect(() => {
    let alive = true;
    setDetalhe(null); setErro('');
    if (id) api.gestaoParcelamento(companyId, id, `?referencia=${referencia}`).then(r => { if (alive) setDetalhe(r); }).catch(e => { if (alive) setErro(e.message); });
    return () => { alive = false; };
  }, [companyId, id, referencia, versao, api, contratos]);
  async function atualizar() { setVersao(v=>v+1); await onAtualizar(); }
  const q = detalhe?.quadro;
  return <section className="gestao-parcelamentos" aria-label="Gestão dos parcelamentos">
    <div className="gestao-acoes"><label>Mês <input aria-label="Mês de acompanhamento" type="month" value={referencia} onChange={e=>{if(e.target.value)setReferencia(e.target.value);}} /></label></div>
    <div className="gestao-scroll"><table><thead><tr><th>Contrato</th><th>Situação</th><th>Parcela do mês</th><th>Pagamentos confirmados</th><th>Baixas lançadas</th><th>A conferir até o mês</th></tr></thead><tbody>
      {contratos.map(c=>{const resumo=quadroGestaoParcelamento(c,referencia);return <tr key={c.id} className={c.id===id?'gestao-selecionado':''}>
        <td><button type="button" className="gestao-link" onClick={()=>{setId(c.id);setAba('Parcelas');}}>{c.label || c.tipo} {c.numeroParcelamento ? `· ${c.numeroParcelamento}` : ''}</button></td>
        <td>{c.status}</td><td>{resumo.doMes.join(', ') || '—'} / {c.numParcelas}</td><td>{resumo.confirmadas} {resumo.historicas?`(${resumo.historicas} históricas)`:''}</td><td>{resumo.baixadas}</td><td>{resumo.aConferir}</td>
      </tr>;})}
      {!contratos.length&&<tr><td colSpan={6}>Nenhum parcelamento cadastrado.</td></tr>}
    </tbody></table></div>
    {erro&&<p role="alert">{erro} <Button onClick={()=>setVersao(v=>v+1)}>Tentar novamente</Button></p>}
    {id&&!detalhe&&!erro&&<p role="status">Carregando contrato…</p>}
    {detalhe&&<>
      <div className="gestao-acoes"><strong>{detalhe.acordo.label}</strong><nav aria-label="Detalhes do parcelamento">{['Parcelas','Dívidas incluídas','Cadastro e histórico'].map(a=><Button key={a} aria-pressed={a===aba} variant={a===aba?'primary':'secondary'} onClick={()=>setAba(a)}>{a}</Button>)}</nav></div>
      {aba==='Parcelas'&&<>
        <div className="gestao-acoes"><span>{q.aLancar} pagamento(s) confirmado(s) aguardando lançamento</span><Button disabled={detalhe.acordo.status!=='ATIVO'} onClick={()=>setConciliacao(true)}>Conciliar pagamentos anteriores</Button>{!!q.inconsistencias.length&&<Button onClick={()=>setAba('Cadastro e histórico')}>Revisar cronograma ({q.inconsistencias.length})</Button>}</div>
        <div className="gestao-scroll"><table><thead><tr><th>Parcela</th><th>Competência</th><th>Vencimento</th><th>Previsto</th><th>Valor pago</th><th>Confirmação</th><th>Contabilização</th><th>Ação</th></tr></thead><tbody>{q.parcelas.map(p=><tr key={p.id} className={p.doMes?'gestao-selecionado':''}>
          <td>{p.numeroParcela} / {detalhe.acordo.numParcelas}{p.doMes?' · Neste mês':''}</td><td>{p.competencia}</td><td>{dataBR(p.vencimento)}</td><td>{moeda(p.valorPrevisto)}</td><td>{p.confirmada?moeda(p.valorPago):'—'}</td><td>{p.origemConfirmacao}</td><td>{p.contabilizacao}</td>
          <td>{!p.baixada&&!p.historica&&detalhe.acordo.status==='ATIVO'&&<Button onClick={()=>p.confirmada?onBaixaDocumental(detalhe.acordo):setBaixa(p)}>Dar baixa</Button>}</td>
        </tr>)}</tbody></table></div>
      </>}
      {aba==='Dívidas incluídas'&&<><p>{resumoOrigensParcelamento(detalhe.acordo.debitosOrigem || []) || 'Composição ainda não vinculada à Circular.'}</p><Button onClick={()=>onComposicao(detalhe.acordo)}>Conferir dívidas da Circular</Button>{detalhe.acordo.observacoes&&<p>{detalhe.acordo.observacoes}</p>}</>}
      {aba==='Cadastro e histórico'&&<>
        <div className="gestao-acoes"><span>{detalhe.acordo.numParcelas} parcelas · {detalhe.acordo.numEntradas || 0} entradas · {detalhe.acordo.formaPagamento==='DEBITO_AUTOMATICO'?'Débito automático':detalhe.acordo.formaPagamento==='GUIA_MENSAL'?'Guia mensal':'Forma de pagamento não informada'}</span><Button disabled={detalhe.acordo.status!=='ATIVO'} onClick={()=>setCorrecao(true)}>Corrigir cadastro</Button></div>
        {!!q.inconsistencias.length&&<details><summary>Inconsistências do cronograma ({q.inconsistencias.length})</summary><ul>{q.inconsistencias.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
        <div className="gestao-scroll"><table><thead><tr><th>Data</th><th>Alteração</th><th>Motivo</th></tr></thead><tbody>{detalhe.eventos.map((e,i)=><tr key={i}><td>{dataBR(e.em)}</td><td>{{BAIXA_MANUAL:'Baixa manual',CORRECAO_CADASTRO:'Correção de cadastro',HISTORICO_ANTERIOR:'Histórico anterior',VINCULO_EXISTENTE:'Vínculo de lançamento'}[e.tipo] || e.tipo}</td><td>{e.motivo}</td></tr>)}{!detalhe.eventos.length&&<tr><td colSpan={3}>Nenhuma alteração registrada por esta gestão.</td></tr>}</tbody></table></div>
      </>}
      {correcao&&<CorrecaoCadastro detalhe={detalhe} api={api} companyId={companyId} onClose={()=>setCorrecao(false)} onSaved={atualizar}/>}
      {baixa&&<BaixaEditavel parcela={baixa} acordo={detalhe.acordo} api={api} companyId={companyId} onClose={()=>setBaixa(null)} onSaved={atualizar}/>}
      {conciliacao&&<ConciliarAnteriores detalhe={detalhe} api={api} companyId={companyId} onClose={()=>setConciliacao(false)} onSaved={atualizar}/>}
    </>}
  </section>;
}

export function ConciliarAnteriores({detalhe,api,companyId,onClose,onSaved}){
  const [tipo,setTipo]=useState('VINCULO'),[ids,setIds]=useState([]),[lote,setLote]=useState(''),[corte,setCorte]=useState(''),[motivo,setMotivo]=useState('');
  const [candidatos,setCandidatos]=useState([]),[erro,setErro]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  useEffect(()=>{let alive=true;api.gestaoParcelamento(companyId,detalhe.acordo.id,'/conciliacao/candidatos').then(r=>{if(alive)setCandidatos(r);}).catch(e=>{if(alive)setErro(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[api,companyId,detalhe.acordo.id]);
  function mudar(fn,value){setPreview(null);fn(value);}
  async function enviar(){setBusy(true);setErro('');try{const body={conciliacao:{tipo,parcelaIds:ids,lote,dataCorte:corte,motivo},confirmacao:preview?.confirmacao};if(preview){await api.gestaoParcelamento(companyId,detalhe.acordo.id,'/conciliacao',body);await onSaved();onClose();}else setPreview(await api.gestaoParcelamento(companyId,detalhe.acordo.id,'/conciliacao/previa',body));}catch(e){setErro(e.message);setPreview(null);}finally{setBusy(false);}}
  const elegiveis=detalhe.quadro.parcelas.filter(p=>!p.baixada&&!p.historica&&(tipo!=='HISTORICO'||!p.guiaId&&!p.confirmada));
  return <Modal titulo="Conciliar pagamentos anteriores" tamanho="lg" ocupado={busy} aoFechar={onClose} fecharAoClicarFundo={false} rodape={<><Button disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy||loading||!ids.length} onClick={enviar}>{preview?'Confirmar conciliação':'Conferir conciliação'}</Button></>}><div className="gestao-parcelamentos"><fieldset disabled={busy}>
    <label>Como esses pagamentos foram registrados?<select value={tipo} onChange={e=>{mudar(setTipo,e.target.value);setIds([]);}}><option value="VINCULO">Já estão nos Lançamentos — vincular</option><option value="HISTORICO">Anteriores ao acompanhamento — informar histórico</option></select></label>
    {tipo==='VINCULO'?<label>Lote de pagamento existente<select value={lote} onChange={e=>mudar(setLote,e.target.value)}><option value="">{loading?'Carregando…':'Selecione um lote sem vínculo'}</option>{candidatos.map(g=><option key={g.lote} value={g.lote}>{g.competencia} · {moeda(g.principal)} · {g.historico}</option>)}</select></label>:<><label>Início do acompanhamento<input type="date" value={corte} onChange={e=>mudar(setCorte,e.target.value)}/></label><p>O saldo de abertura precisa corresponder às parcelas restantes. O histórico não gera lançamentos.</p></>}
    {!loading&&tipo==='VINCULO'&&!candidatos.length&&<p>Não há lotes de baixa sem vínculo disponíveis. Se o pagamento ainda não foi lançado, use Dar baixa na parcela.</p>}
    <div className="gestao-scroll"><table><thead><tr><th>Selecionar</th><th>Parcela</th><th>Vencimento</th><th>Principal</th></tr></thead><tbody>{elegiveis.map(p=><tr key={p.id}><td><input aria-label={`Conciliar parcela ${p.numeroParcela}`} type={tipo==='VINCULO'?'radio':'checkbox'} name="parcela-conciliar" checked={ids.includes(p.id)} onChange={e=>mudar(setIds,tipo==='VINCULO'?[p.id]:e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/></td><td>{p.numeroParcela}</td><td>{dataBR(p.vencimento)}</td><td>{moeda(p.valorPrevisto)}</td></tr>)}</tbody></table></div>
    <label>Motivo<input value={motivo} onChange={e=>mudar(setMotivo,e.target.value)}/></label>
    </fieldset>{preview&&<p role="status">{preview.pedido.parcelaIds.length} parcela(s) · {preview.lancamentosVinculados} lançamento(s) existente(s) a vincular · Nenhum lançamento novo.{preview.conferencia&&` Saldo de abertura conferido: ${moeda(preview.conferencia.saldoRestante)}.`}</p>}{erro&&<p role="alert">{erro}</p>}</div></Modal>;
}

export function CorrecaoCadastro({ detalhe, companyId, api, onClose, onSaved }) {
  const a=detalhe.acordo;
  const [form,setForm]=useState(()=>({label:a.label,numeroParcelamento:a.numeroParcelamento || '',observacoes:a.observacoes || '',formaPagamento:a.formaPagamento || '',motivo:'',parcelas:a.parcelasContratadas.map(p=>({id:p.id,numeroParcela:p.numeroParcela,competencia:p.competencia,vencimento:civil(p.vencimento),valorPrevisto:Number(p.valorPrevisto),tipo:a.cronogramaParcelas?.find(c=>c.numeroParcela===p.numeroParcela)?.tipo || (p.numeroParcela<=a.numEntradas?'ENTRADA':'PARCELA')}))}));
  const [preview,setPreview]=useState(null),[erro,setErro]=useState(''),[busy,setBusy]=useState(false);
  const [inicioNumero,setInicioNumero]=useState(1),[inicioData,setInicioData]=useState('');
  function field(key,value){setPreview(null);setForm(f=>({...f,[key]:value}));}
  function row(id,key,value){field('parcelas',form.parcelas.map(p=>p.id===id?{...p,[key]:value}:p));}
  function aplicarDatas(){
    if(!inicioData||!Number.isInteger(Number(inicioNumero))||Number(inicioNumero)<1){setErro('Informe a parcela inicial e seu vencimento.');return;}
    const [ano,mes,dia]=inicioData.split('-').map(Number);
    field('parcelas',form.parcelas.map(p=>{
      const original=a.parcelasContratadas.find(x=>x.id===p.id);
      const protegida=original.guiaId||original.origemBaixa||original.pagamentoStatus==='CONFIRMADO'||detalhe.lancamentos.some(e=>e.numeroParcela===original.numeroParcela&&e.numeroParcela!=null);
      if(protegida||Number(p.numeroParcela)<Number(inicioNumero))return p;
      const n=mes-1+Number(p.numeroParcela)-Number(inicioNumero),ultimo=new Date(Date.UTC(ano,n+1,0)).getUTCDate();
      const d=new Date(Date.UTC(ano,n,Math.min(dia,ultimo))).toISOString().slice(0,10);
      return {...p,vencimento:d,competencia:d.slice(0,7)};
    }));setErro('');
  }
  async function enviar(){setBusy(true);setErro('');try{if(preview){await api.gestaoParcelamento(companyId,a.id,'/correcao',{alteracao:form,confirmacao:preview.confirmacao});await onSaved();onClose();}else setPreview(await api.gestaoParcelamento(companyId,a.id,'/correcao/previa',{alteracao:form}));}catch(e){setErro(e.message);setPreview(null);}finally{setBusy(false);}}
  return <Modal titulo="Corrigir cadastro e cronograma" tamanho="lg" ocupado={busy} fecharAoClicarFundo={false} aoFechar={onClose} rodape={<><Button onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={enviar}>{preview?'Confirmar correção':'Conferir alterações'}</Button></>}>
    <div className="gestao-parcelamentos"><fieldset disabled={busy}>
      <div className="gestao-acoes">{[['label','Nome'],['numeroParcelamento','Número do acordo']].map(([k,l])=><label key={k}>{l}<input value={form[k]} onChange={e=>field(k,e.target.value)}/></label>)}<label>Pagamento<select value={form.formaPagamento} onChange={e=>field('formaPagamento',e.target.value)}><option value="">Não informado</option><option value="GUIA_MENSAL">Guia mensal</option><option value="DEBITO_AUTOMATICO">Débito automático</option></select></label></div>
      <label>Descrição<textarea value={form.observacoes} onChange={e=>field('observacoes',e.target.value)}/></label>
      <p>Valores e datas com pagamento ou lançamento ficam protegidos. A numeração pode ser corrigida preservando os vínculos.</p>
      <details><summary>Ajustar previsão mensal em sequência</summary><div className="gestao-acoes"><label>A partir da parcela<input type="number" min="1" max={a.numParcelas} value={inicioNumero} onChange={e=>setInicioNumero(e.target.value)}/></label><label>Vencimento dessa parcela<input type="date" value={inicioData} onChange={e=>setInicioData(e.target.value)}/></label><Button onClick={aplicarDatas}>Preencher previsão</Button></div><p>Aplica somente a parcelas sem guia, pagamento ou lançamento. Confira as datas abaixo antes de salvar.</p></details>
      <div className="gestao-scroll"><table><thead><tr><th>Número</th><th>Tipo</th><th>Competência</th><th>Vencimento</th><th>Valor previsto</th></tr></thead><tbody>{form.parcelas.map(p=>{const orig=a.parcelasContratadas.find(x=>x.id===p.id);const protectedRow=orig.origemBaixa||orig.pagamentoStatus==='CONFIRMADO'||orig.guia?.paymentStatus==='PAID'||orig.guia?.baixada||detalhe.lancamentos.some(e=>e.sourceGuideId?e.sourceGuideId===orig.guiaId:e.numeroParcela!=null&&e.numeroParcela===orig.numeroParcela);return <tr key={p.id}>
        <td><input aria-label={`Número da parcela ${orig.numeroParcela}`} type="number" min="1" max={a.numParcelas} value={p.numeroParcela ?? ''} onChange={e=>row(p.id,'numeroParcela',e.target.value)}/></td>
        <td><select aria-label={`Tipo da parcela ${orig.numeroParcela}`} disabled={Boolean(protectedRow)} value={p.tipo} onChange={e=>row(p.id,'tipo',e.target.value)}><option value="PARCELA">Parcela</option><option value="ENTRADA">Entrada</option></select></td>
        {['competencia','vencimento','valorPrevisto'].map(k=><td key={k}><input aria-label={`${k} da parcela ${orig.numeroParcela}`} disabled={Boolean(protectedRow)} type={k==='competencia'?'month':k==='vencimento'?'date':'number'} step={k==='valorPrevisto'?'0.01':undefined} value={p[k]} onChange={e=>row(p.id,k,e.target.value)}/></td>)}
      </tr>;})}</tbody></table></div>
      <label>Motivo da correção<input value={form.motivo} onChange={e=>field('motivo',e.target.value)} /></label>
    </fieldset>
    {preview&&<div role="status"><strong>Confira antes de salvar</strong><p>{preview.alteracoes.length} parcela(s) alterada(s).</p><ul>{preview.alteracoes.map(p=><li key={p.id}>Parcela {p.antes.numeroParcela} → {p.depois.numeroParcela} · {p.antes.competencia} → {p.depois.competencia} · {dataBR(p.antes.vencimento)} → {dataBR(p.depois.vencimento)} · {moeda(p.antes.valorPrevisto)} → {moeda(p.depois.valorPrevisto)}</li>)}</ul>{Object.keys(preview.cadastro).filter(k=>preview.cadastro[k]!==preview.cadastroAnterior[k]).map(k=><p key={k}>{({label:'Nome',numeroParcelamento:'Número',observacoes:'Descrição',formaPagamento:'Pagamento'})[k]}: {preview.cadastroAnterior[k] || '—'} → {preview.cadastro[k] || '—'}</p>)}</div>}
    {erro&&<p role="alert">{erro}</p>}</div>
  </Modal>;
}

export function BaixaEditavel({ parcela, acordo, companyId, api, onClose, onSaved }) {
  const description=`PAGAMENTO ${acordo.label} PARC ${parcela.numeroParcela}/${acordo.numParcelas}`;
  const cfg=Array.isArray(acordo.configPagamento)?acordo.configPagamento:[];
  const [data,setData]=useState(hoje()),[linhas,setLinhas]=useState(()=>['PARC','CAIXA'].map(tipoLinha=>({tipoLinha,tipo:tipoLinha==='CAIXA'?'C':'D',valor:Number(parcela.valorPrevisto),conta:cfg.find(c=>c.tipoLinha===tipoLinha)?.conta || '',historico:cfg.find(c=>c.tipoLinha===tipoLinha)?.historico || description})));
  const [preview,setPreview]=useState(null),[erro,setErro]=useState(''),[busy,setBusy]=useState(false);
  const base=`/parcelas/${encodeURIComponent(parcela.id)}/baixa`;
  function change(i,k,v){setPreview(null);setLinhas(ls=>ls.map((l,j)=>i===j?{...l,[k]:v}:l));}
  async function enviar(){setBusy(true);setErro('');try{const body={baixa:{dataPagamento:data,linhas},confirmacao:preview?.confirmacao};if(preview){await api.gestaoParcelamento(companyId,acordo.id,base,body);await onSaved();onClose();}else setPreview(await api.gestaoParcelamento(companyId,acordo.id,base+'/previa',body));}catch(e){setErro(e.message);setPreview(null);}finally{setBusy(false);}}
  return <Modal titulo={`Dar baixa · Parcela ${parcela.numeroParcela}`} tamanho="lg" ocupado={busy} fecharAoClicarFundo={false} aoFechar={onClose} rodape={<><Button disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy} variant="primary" onClick={enviar}>{preview?'Confirmar e gerar lançamentos':'Conferir lançamentos'}</Button></>}><div className="gestao-parcelamentos"><fieldset disabled={busy}>
    <label>Data do pagamento<input type="date" value={data} onChange={e=>{setData(e.target.value);setPreview(null);}}/></label><p>Principal integral: {moeda(parcela.valorPrevisto)} · Baixa declarada manualmente</p>
    <div className="gestao-scroll"><table><thead><tr><th>Papel</th><th>D/C</th><th>Conta</th><th>Valor</th><th>Descrição</th><th/></tr></thead><tbody>{linhas.map((l,i)=><tr key={l.tipoLinha}><td>{{PARC:'Principal',CAIXA:'Pagamento',JUROS:'Juros',MULTA:'Multa'}[l.tipoLinha]}</td><td>{l.tipo}</td><td><input aria-label={`Conta ${l.tipoLinha}`} value={l.conta} onChange={e=>change(i,'conta',e.target.value)}/></td><td><input aria-label={`Valor ${l.tipoLinha}`} type="number" step="0.01" value={l.valor} onChange={e=>change(i,'valor',e.target.value)}/></td><td><input aria-label={`Descrição ${l.tipoLinha}`} value={l.historico} onChange={e=>change(i,'historico',e.target.value)}/></td><td>{['JUROS','MULTA'].includes(l.tipoLinha)&&<Button onClick={()=>{setPreview(null);setLinhas(ls=>ls.filter(x=>x!==l));}}>Remover</Button>}</td></tr>)}</tbody></table></div>
    <div className="gestao-acoes">{['JUROS','MULTA'].filter(p=>!linhas.some(l=>l.tipoLinha===p)).map(p=><Button key={p} onClick={()=>{setPreview(null);setLinhas(ls=>[...ls,{tipoLinha:p,tipo:'D',conta:'',valor:0,historico:description}]);}}>+ {p==='JUROS'?'Juros':'Multa'}</Button>)}</div>
    </fieldset>{preview&&<p role="status">Total conferido: {moeda(preview.total)}. Serão criados {preview.linhas.length} lançamentos na competência {preview.competencia}.</p>}{erro&&<p role="alert">{erro}</p>}</div></Modal>;
}
