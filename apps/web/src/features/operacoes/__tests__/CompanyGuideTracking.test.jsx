import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { CompanyGuideTracking } from '../CompanyGuideTracking';
const response = (id, competencia, patch = {}) => ({ portalClientId: id, competencia, enabled: false, paused: false, items: [], ...patch });
test('somente leitura, estado vazio e falha distinguem falta de dados de dispensa', async () => {
 const api={getCompanyGuideTracking:jest.fn(async(id,mes)=>response(id,mes))};
 render(<CompanyGuideTracking api={api} companyId="a"/>);
 expect(await screen.findByText(/Nenhuma guia encontrada/)).toHaveTextContent('não comprova dispensa');
 expect(screen.getByText('Acompanhamento em dois dias úteis desligado. Execução sujeita à seleção, agenda e autorizações.')).toBeVisible();
 api.getCompanyGuideTracking.mockRejectedValue(Error('segredo interno'));fireEvent.click(screen.getByRole('button',{name:'Atualizar acompanhamento'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');expect(screen.queryByText('segredo interno')).not.toBeInTheDocument();
 expect(api.getCompanyGuideTracking).toHaveBeenCalledTimes(2);
});
test('consulta inconclusiva continua visível durante pausa com datas nominal e de comunicação separadas', async () => {
 const api={getCompanyGuideTracking:async(id,mes)=>response(id,mes,{paused:true,items:[{guideId:'g',documento:'SIMPLES',calendario:{vencimentoNominal:'2026-10-18',vencimentoComunicacao:'2026-10-16',antes:'2026-10-15',depois:'2026-10-20'},entrega:{comprovada:false},consulta:{status:'REVISAO',resultado:'ERRO',revisaoCompativel:false},motivo:'Confira a tentativa.',historico:[{fase:'DEPOIS',status:'INDETERMINADO',revisaoCompativel:false}]}]})};
 render(<CompanyGuideTracking api={api} companyId="a"/>);
 expect(await screen.findByText(/Automações pausadas/)).toBeVisible(); expect(screen.getByText(/Falha na consulta/)).toBeVisible();
 expect(screen.getByText(/Vencimento no documento/)).toHaveTextContent('18/10/2026');expect(screen.getByText(/Vencimento no documento/)).toHaveTextContent('16/10/2026');
 expect(screen.getByText(/Entrega da revisão atual não comprovada/)).toBeVisible();expect(screen.getByText(/Trocar o PDF não autoriza/)).toBeVisible();
 expect(screen.getByText(/Envio incerto/)).toBeVisible();
});
test('resposta tardia de outra empresa é descartada e releitura devolve foco ao resultado', async () => {
 let finish;const api={getCompanyGuideTracking:jest.fn((id,mes)=>id==='a'?new Promise(resolve=>{finish=()=>resolve(response(id,mes,{items:[{guideId:'antiga',documento:'ANTIGO'}]}));}):Promise.resolve(response(id,mes)))};
 const view=render(<CompanyGuideTracking api={api} companyId="a"/>);
 view.rerender(<CompanyGuideTracking api={api} companyId="b"/>);await screen.findByText(/Nenhuma guia encontrada/);
 await act(async()=>finish());expect(screen.queryByText(/ANTIGO/)).not.toBeInTheDocument();
 const button=screen.getByRole('button',{name:'Atualizar acompanhamento'});button.focus();fireEvent.click(button);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveFocus());
});
test('resposta de escopo divergente não aparece como vazio ou sucesso', async () => {
 render(<CompanyGuideTracking api={{getCompanyGuideTracking:async(id,mes)=>response('outra',mes)}} companyId="a"/>);
 expect(await screen.findByRole('alert')).toBeVisible();expect(screen.queryByText(/Nenhuma guia encontrada/)).not.toBeInTheDocument();
});

test('histórico distingue política nova de legado/desconhecido e mantém causas de aviso separadas da consulta', async()=>{
 const api={getCompanyGuideTracking:async(id,mes)=>response(id,mes,{items:[{guideId:'g',documento:'SIMPLES',consulta:{status:'REVISAO',resultado:'ERRO'},historico:[
  {fase:'ANTES',status:'ENVIADO',politica:null,revisaoCompativel:true},
  {fase:'DEPOIS',status:'PENDENTE',politica:'OUTRA',motivo:'Confira o contato autorizado e seu vínculo com a empresa antes de avisar.'},
  {fase:'DEPOIS',status:'PENDENTE',politica:'D2_D0_D2_V1',motivo:'Confira a aprovação Utility e o contrato do modelo WhatsApp antes de avisar.'},
 ]}]})};
 render(<CompanyGuideTracking api={api} companyId="a"/>);
 const list=await screen.findByRole('list',{name:'Histórico dos avisos'}),rows=within(list).getAllByRole('listitem');
 expect(rows[0]).toHaveTextContent('Antes do vencimento: Aviso enviado');expect(rows[0]).not.toHaveTextContent('Dois dias úteis');
 expect(rows[1]).toHaveTextContent('Depois do vencimento: Aviso pendente');expect(rows[1]).not.toHaveTextContent('Dois dias úteis');
 expect(rows[2]).toHaveTextContent('Dois dias úteis depois: Aviso pendente');
 expect(rows[1]).toHaveTextContent('Confira o contato autorizado');expect(rows[2]).toHaveTextContent('Confira a aprovação Utility');
 expect(screen.getByText(/Falha na consulta/)).toBeVisible();
});
