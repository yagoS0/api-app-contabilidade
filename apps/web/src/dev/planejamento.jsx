import { LaboratorioEmpresa } from '../features/planejamento/components/LaboratorioEmpresa';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PlanejamentoPage } from '../features/planejamento/pages/renderPlanejamentoPage';
import { createMockApi } from '../api/mock/mockApi';
import '../index.css';
const api=createMockApi();
function Desenvolvimento(){
  const [id,setId]=useState('bi-demo'),[area,setArea]=useState('relatorios');
  return <main className="dev-planejamento" style={{maxWidth:1400,margin:'0 auto',padding:'24px clamp(12px,3vw,40px)'}}><div style={{padding:16,marginBottom:24,border:'1px solid #e3ba64',borderRadius:12}}><strong>Desenvolvimento · dados fictícios</strong><p>Esta página usa apenas a API de demonstração. Nenhuma conexão com produção.</p><label>Cenário de teste <select value={id} onChange={e=>setId(e.target.value)}><option value="bi-demo">Empresa com histórico</option><option value="bi-demo007">Empresa sem dados</option><option value="bi-demo-sem-fechamento">Sem fechamento contábil</option><option value="bi-demo-comparacao-aberta">Comparação sem fechamento</option></select></label></div><nav className="bi-atalhos bi-areas"><button aria-pressed={area==='relatorios'} onClick={()=>setArea('relatorios')}>Relatórios e tributário</button><button aria-pressed={area==='laboratorio'} onClick={()=>setArea('laboratorio')}>Laboratório da Empresa</button></nav>{area==='laboratorio'?<LaboratorioEmpresa api={api} empresas={[{id:'bi-demo',razaoSocial:'Empresa fictícia com histórico'}]} onTributario={()=>setArea('relatorios')}/>:<PlanejamentoPage api={api} empresa={{id,razaoSocial:'Empresa de demonstração'}} empresaFixa/>}</main>;
}
if(import.meta.env.DEV) createRoot(document.getElementById('root')).render(<Desenvolvimento/>);
