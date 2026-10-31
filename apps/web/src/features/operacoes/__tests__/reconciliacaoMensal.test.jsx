import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { projetarFluxoCarteira, statusApresentacao } from '@contabilidade/shared/fluxo-carteira';
import { projetarOperacoesEmpresas, resumirEtapasOperacoes } from '../operacoes';
import { OperationsPage } from '../OperationsPage';
import { CompaniesTable } from '../../companies/list/components/renderCompaniesTable';
const comp='2026-10';
function company(guideChanges={},context={},companyChanges={}) {
 const c={companyId:'reconciliada',razao:'Empresa Reconciliada',cnpj:'12345678000190',regimeTributario:'SIMPLES',apuracao:{competencia:comp,estado:'transmitida'},fechamentoContabil:{fechado:true},guideCompliance:{competencia:comp,das:{required:true,state:'enviada',ok:true,guideId:'fake'},inss:{required:true,state:'missing',ok:false},...guideChanges},...companyChanges};
 c.fluxoCarteira=projetarFluxoCarteira(c,{competencia:comp,lancamentos:{total:1,importados:1},...context});return c;
}
const absence=(status='DOCUMENT_ABSENT')=>({companyId:'reconciliada',competencia:comp,revision:'a'.repeat(64),status,guides:[],hasProlabore:true,state:{responsible:'Equipe responsável',dueDate:null,note:'',reason:'Ausência conferida',applicable:false}});
const project=(c,manual=[absence()])=>resumirEtapasOperacoes(projetarOperacoesEmpresas([c],comp).rows,[],manual);
const apiFor=manual=>({getOperationManualInss:jest.fn(async()=>({items:[manual]})),getCompanyManualInss:jest.fn(async()=>manual),getOperationEvidence:jest.fn(async()=>({items:[],competencia:comp}))});
afterEach(cleanup);
test.each(['DOCUMENT_ABSENT','NOT_APPLICABLE'])('produtor real avança após %s sem alterar tarefas/evidências',status=>{
 const c=company(),before=JSON.stringify(c);expect(c.fluxoCarteira.status.chave).toBe('guias');const s=project(c,[absence(status)]);
 expect(s.items[0].presentation.chave).toBe('concluido');expect(s.metrics.concluido.done).toHaveLength(1);expect(s.items[0].axes.guias).toBe(true);expect(s.items[0].axes.pago).toBe(false);expect(JSON.stringify(c)).toBe(before);expect(c.fluxoCarteira.tarefas.find(t=>t.chave==='enviar_guias').concluida).toBe(false);
});
test('pendência histórica de parcelamento não bloqueia competência com cobertura mensal concluída',()=>{
 const c=company({inss:{required:false,state:'na'},parcDas:{required:true,state:'missing',ok:false},coberturaParcelamentoMes:[]});expect(c.fluxoCarteira.status.chave).toBe('guias');const s=project(c,[]);expect(s.items[0].presentation.chave).toBe('concluido');expect(s.metrics.concluido.done).toHaveLength(1);expect(c.guideCompliance.parcDas.state).toBe('missing');
});
test.each([
 ['INSS em revisão',{}, {}, {},[absence('DOCUMENT_REVIEW')],'guias'],
 ['envio corrente pendente',{das:{required:true,state:'gerada',ok:true,guideId:'fake'}},{},{},[absence()],'guias'],
 ['cobertura desconhecida',{erro:true},{},{},[absence()],'verificar'],
 ['parcelamento mensal desconhecido',{parcDas:{required:true,state:'missing'}},{},{},[absence()],'verificar'],
 ['competência divergente',{competencia:'2026-09'},{},{},[absence()],'verificar'],
 ['obrigação pendente',{}, {obrigacoes:[{verificador:'OUTRA',concluida:false}]},{},[absence()],'apurar'],
 ['contabilidade aberta',{},{},{fechamentoContabil:{fechado:false}},[absence()],'contabilizacao'],
 ['importação incompleta',{}, {lancamentos:{total:2,importados:1}},{},[absence()],'contabilizacao'],
 ['tarefa extra Guias',{}, {registros:[{chave:'extra:manual',dados:{titulo:'Conferência extra',etapa:'guias'}}]},{},[absence()],'guias'],
])('%s mantém bloqueio apropriado',(_label,g,ctx,c,manual,expected)=>{const s=project(company(g,ctx,c),manual);expect(s.items[0].presentation.chave).toBe(expected);expect(s.metrics.concluido.done).toHaveLength(0);});
test('evidência parcial não conclui fluxo sem tarefas/obrigações completas',()=>{
 for(const fluxo of [{status:{chave:'guias'}},{status:{chave:'guias'},tarefas:[],obrigacoes:[]},{status:{chave:'guias'},tarefas:[{chave:'enviar_guias',etapa:'guias',concluida:false}],obrigacoes:[]}])expect(statusApresentacao(fluxo,{guiasConhecidas:true,guiasPendentes:false}).chave).not.toBe('concluido');
});
test.each(['unknown', 'concluido'])('tarefa extra %s não vira conclusão silenciosa',(etapa)=>{
 const c=company({}, {registros:[{chave:'extra:unknown',dados:{titulo:'Etapa a revisar',etapa}}]});expect(project(c).items[0].presentation.chave).toBe('verificar');
});
test.each(['DOCUMENT_ABSENT','NOT_APPLICABLE'])('detalhe de %s abre pela empresa sem criar pendência ou executar ações',async status=>{
 const c=company(),manual=absence(status),api=apiFor(manual),onSend=jest.fn();const view=render(<OperationsPage api={api} companies={[c]} competencia={comp} acoesGuia={{onEnviar:onSend}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pago 0/1 empresas'}));fireEvent.click(screen.getByRole('button',{name:'Ver detalhes do INSS manual'}));
 expect(await screen.findByText('Equipe responsável')).toBeInTheDocument();expect(api.getCompanyManualInss).toHaveBeenCalledWith('reconciliada',comp);expect(api.getCompanyManualInss).toHaveBeenCalledTimes(1);expect(onSend).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:'Responsável'})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Configurar INSS manual'})).toHaveAttribute('href','/companies/reconciliada/automacao?competencia=2026-10');
 fireEvent.click(screen.getByText('Fechar',{selector:'button'}));expect(screen.queryByText('Equipe responsável')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Pago 0/1 empresas'}));fireEvent.click(screen.getByRole('button',{name:'Ver detalhes do INSS manual'}));await screen.findByText('Equipe responsável');view.rerender(<OperationsPage api={api} companies={[]} competencia="2026-11"/>);expect(screen.queryByText('Equipe responsável')).not.toBeInTheDocument();
});
test('Empresas e Operações exibem a mesma conclusão reconciliada do produtor',async()=>{
 const c=company(),api=apiFor(absence());const table=render(<CompaniesTable api={api} companies={[c]} competencia={comp}/>);
 fireEvent.click(await screen.findByRole('button',{name:/Concluídas \(1\)/}));await waitFor(()=>expect(screen.getByRole('button',{name:'Ver tarefas de Empresa Reconciliada: Concluído'})).toBeInTheDocument());table.unmount();render(<OperationsPage api={api} companies={[c]} competencia={comp}/>);expect(screen.queryByRole('button',{name:'Concluído 1/1 empresas'})).not.toBeInTheDocument();expect(await screen.findByRole('button',{name:'Disponível 1/1 empresas'})).toBeInTheDocument();expect(project(c).metrics.concluido.done).toHaveLength(1);expect(c.fluxoCarteira.status.chave).toBe('guias');
});


