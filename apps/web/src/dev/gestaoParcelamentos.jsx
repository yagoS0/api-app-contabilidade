import React from 'react';
import {createRoot} from 'react-dom/client';
import {GestaoParcelamentos} from '../features/accounting/parcelamento/components/GestaoParcelamentos';
import {quadroGestaoParcelamento} from '../../../../packages/shared/src/accounting/gestaoParcelamento.js';
import '../index.css';
import '../App.css';

const acordo={id:'demo',label:'Parcelamento Simples Nacional',numeroParcelamento:'17',tipo:'PARCSN',status:'ATIVO',numParcelas:41,numEntradas:1,formaPagamento:'GUIA_MENSAL',debitosOrigem:[],observacoes:'DAS de 01 a 04/2025',configPagamento:[{tipoLinha:'PARC',conta:'200'},{tipoLinha:'CAIXA',conta:'100'}],parcelasContratadas:Array.from({length:41},(_,i)=>{
  const date=new Date(Date.UTC(2025,11+i,20)).toISOString().slice(0,10);
  return {id:`demo-${i+1}`,numeroParcela:i+1,competencia:date.slice(0,7),vencimento:date,valorPrevisto:i===0?900:300,origemBaixa:i<2?'HISTORICO':i===2?'MANUAL':null,valorBaixa:i===2?305:null,pagamentoStatus:i===9?'CONFIRMADO':null,pagamentoEvidencia:i===9?{resultado:'CONFIRMADO'}:null};
})};
const contratos=[acordo];
const api={async gestaoParcelamento(_company,_id,action=''){
  if(action==='/conciliacao/candidatos')return [];
  if(action&&!action.startsWith('?'))throw new Error('Prévia visual: a gravação é validada separadamente no banco local de testes.');
  return {acordo,lancamentos:[],eventos:[],quadro:quadroGestaoParcelamento(acordo,new URLSearchParams(action).get('referencia')||'2026-10')};
}};
if(import.meta.env.DEV)createRoot(document.getElementById('root')).render(<main style={{width:'92%',maxWidth:1500,margin:'24px auto'}}><p>Desenvolvimento · dados fictícios · prévia visual sem gravação</p><h1 style={{fontSize:20}}>Parcelamentos</h1><GestaoParcelamentos companyId="demo" contratos={contratos} api={api} onAtualizar={async()=>{}} onComposicao={()=>alert('A composição é conferida no módulo da Circular do app.')} onBaixaDocumental={()=>alert('No app, abre a conferência do comprovante existente.')}/></main>);
