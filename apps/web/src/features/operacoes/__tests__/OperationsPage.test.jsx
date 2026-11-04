import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { CompaniesTable } from '../../companies/list/components/renderCompaniesTable';
import { OperationsPage } from '../OperationsPage';
import { resumirEtapasOperacoes, distribuicoesCadastrais, projetarOperacoesEmpresas } from '../operacoes';
import { statusApresentacao } from '@contabilidade/shared/fluxo-carteira';
jest.mock('../OperationsAlerts', () => ({ OperationsAlerts: () => null }));
jest.mock('../OperationsRoutineCompanies', () => ({ OperationsRoutineCompanies: () => null }));
const companies = [{ companyId: 'a', razao: 'Alfa', guideCompliance: { das: { required: true, state: 'gerada', paymentStatus: 'PAID' } }, fluxoCarteira: { competencia: '2026-10', status: { chave: 'obrigacoes' }, apuracao: { apurada: true, transmitida: false }, contabilizacao: {} } }];
it('paga sem envio continua pendente de envio; barras e lista usam empresas e eixos separados', async () => {
  const api = { getCompanyGuides: jest.fn(async () => [{ guideId:'das-a', companyId:'a', competencia:'2026-10', tipo:'DAS', status:'PROCESSED', paymentStatus:'PAID', paymentStatusSource:'MANUAL', envio:{ jaEnviada:false, canais:[] } }]) };
  render(<OperationsPage api={api} companies={companies} competencia="2026-10" />);
  expect(screen.getByRole('button',{name:'Pago 1/1 empresas'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Enviado 0/1 empresas'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Disponível 1/1 empresas'}));
  const coverage = within(screen.getByRole('region', { name: 'Guias disponivel' }));
  expect(await coverage.findByText('Disponível', {exact:false})).toBeInTheDocument();
  expect(coverage.getByText(/Envio: Pendente · Pagamento: Confirmado/)).toBeInTheDocument();
  fireEvent.keyDown(document,{key:'Escape'});
  fireEvent.click(screen.getByRole('button',{name:'Enviado 0/1 empresas'}));
  const modal = within(screen.getByRole('dialog'));
  expect(await modal.findByText('não enviada')).toBeInTheDocument();
  fireEvent.click(modal.getByText('Documento das-a'));
  expect(modal.getByText('Confirmada pelo contador')).toBeInTheDocument();
  expect(modal.getByRole('link', { name: 'Abrir Guias — conferir canais e reenvio' })).toHaveAttribute('href', '/companies/a/guides?competencia=2026-10');
  expect(api.getCompanyGuides).toHaveBeenCalledWith('a');
});
it('Obrigações integra Apurar sem perder destino; troca de competência fecha o filtro antigo', () => {
  const view = render(<OperationsPage companies={companies} competencia="2026-10" />);
  expect(statusApresentacao(companies[0].fluxoCarteira)).toMatchObject({chave:'apurar',etapaOriginal:'obrigacoes'});
  fireEvent.click(screen.getByRole('button', { name: 'Apuração' }));
  expect(within(screen.getByRole('dialog')).getByRole('link',{name:'Abrir obrigações'})).toHaveAttribute('href', '/companies/a/obrigacoes?competencia=2026-10');
  view.rerender(<OperationsPage companies={companies} competencia="2026-09" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('loading e erro não exibem distribuição antiga; vazio é distinto de falha', () => {
  const view = render(<OperationsPage companies={companies} competencia="2026-10" loading />);
  expect(screen.getByRole('button', { name: 'Pago — empresas' })).toBeDisabled();
  view.rerender(<OperationsPage companies={[]} competencia="2026-10" />);
  fireEvent.click(screen.getByRole('button', { name: 'Pago 0/0 empresas' }));
  expect(within(screen.getByRole('dialog')).getByText('Nenhuma empresa neste conjunto.')).toBeInTheDocument();
  view.rerender(<OperationsPage companies={companies} competencia="2026-10" error="Falha de leitura" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pago — empresas' })).toBeDisabled();
});
it('posição no fluxo não confirma barras e falta de evidência nunca é conclusão', () => {
  const c = {...companies[0], guideCompliance:undefined, fluxoCarteira:{...companies[0].fluxoCarteira,status:{chave:'importacao'},apuracao:{apurada:false,transmitida:true}}};
  const p = resumirEtapasOperacoes(projetarOperacoesEmpresas([c,c], '2026-10').rows);
  expect(p.items).toHaveLength(1);
  expect(p.metrics.calculado.done).toHaveLength(0);
  expect(p.metrics.transmitido.done).toHaveLength(1);
  expect(p.metrics.confirmado.unknown).toHaveLength(1);
  expect(p.metrics.disponivel.unknown).toHaveLength(1);
  expect(p.metrics.concluido.done).toHaveLength(0);
  for (const metric of Object.values(p.metrics)) expect(metric.done.length + metric.missing.length).toBe(metric.total);
});
it('cinco controles independentes, revisão contábil e pagamento de guia não inferem conclusão', () => {
  const c = {...companies[0], fluxoCarteira:{...companies[0].fluxoCarteira,contabilizacao:{checklist:{receitas:true,provisoes:false,folhaProlabore:true,despesas:false,pagamentos:true}}}};
  let p = resumirEtapasOperacoes([{company:c,fluxo:c.fluxoCarteira}]);
  expect(p.metrics.receitas.done).toHaveLength(1); expect(p.metrics.provisoes.missing).toHaveLength(1);
  c.fluxoCarteira.contabilizacao.conferenciaDesatualizada = true;
  p = resumirEtapasOperacoes([{company:c,fluxo:c.fluxoCarteira}]);
  expect(p.metrics.receitas.done).toHaveLength(0);
});
it('fiscal e procuração distinguem ausência de evidência, validade e revalidação operacional', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const c = {...companies[0], temParcelamento:true, serproStatus:{procurationStatus:'ATIVA',vinculoConfirmado:true,checkedAt:'2026-10-20T12:00:00Z',validUntil:'2027-10-20'}};
  const d = distribuicoesCadastrais([{company:c}],now);
  expect(d.parcelas[0].items).toHaveLength(1);
  expect(d.fiscal[0].items).toHaveLength(0); expect(d.fiscal[2].items).toHaveLength(1);
  expect(d.procuracao[1].items).toHaveLength(1); expect(d.certificado[2].items).toHaveLength(1);
});
it.each(['VIEWER','STAFF',undefined])('papel %s não oferece conferência gravável', role => {
  render(<OperationsPage companies={[{...companies[0],myRole:role}]} competencia="2026-10" />);
  fireEvent.click(screen.getByRole('button',{name:'Apuração'}));
  expect(screen.queryByRole('button',{name:'Conferir e continuar rotina'})).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Abrir apuração'})).toBeInTheDocument();
});

const parcela = (id, extra = {}) => ({ id, numeroParcela: id, tipo:'Simples', mesOperacional:'2026-11', documento:'disponivel', comunicacao:'pendente', pagamentoConfirmado:true, ...extra });
const comParcelas = parcelas => ({ ...companies[0], fluxoCarteira:{...companies[0].fluxoCarteira,status:{chave:'guias'}}, guideCompliance:{ competencia:'2026-10', das:{required:true,state:'na'}, parcDas:{required:true,state:'enviada'}, coberturaParcelamentoMes:parcelas } });
it.each([
 ['paga sem envio',[parcela('1')],true,false,true],
 ['débito automático',[parcela('1',{documento:'nao_exigido',comunicacao:'nao_exigida',pagamentoConfirmado:false})],true,true,false],
 ['documento em conferência',[parcela('1',{documento:'a_conferir',comunicacao:'aguarda_documento'})],false,false,true],
 ['múltiplas parcelas',[parcela('1',{comunicacao:'enviada'}),parcela('2',{pagamentoConfirmado:false})],true,false,false],
])('%s: cobertura mensal mantém eixos independentes e detalhe das mesmas parcelas',(_name,parcelas,disponivel,enviado,pago)=>{
 const company=comParcelas(parcelas), result=resumirEtapasOperacoes([{company,fluxo:company.fluxoCarteira}]);
 expect(result.items[0].axes).toMatchObject({disponivel,enviado,pago});
 expect(result.items[0].guideSummary.items.filter(i=>i.parcela)).toHaveLength(parcelas.length);
 render(<OperationsPage companies={[company]} competencia="2026-10"/>);
 fireEvent.click(screen.getByRole('button',{name:/^Disponível [01]\/1 empresas$/}));
 const modal=within(screen.getByRole('dialog'));
 for(const p of parcelas) expect(modal.getByText(new RegExp(`Parcela ${p.numeroParcela} · 2026-11`)).closest('tr')).toHaveTextContent(p.pagamentoConfirmado?'Pagamento: Confirmado':'Pagamento: Não confirmado');
});
it('dispensa não confirma pagamento e cobertura de outra competência não comprova eixos',()=>{
 const company=comParcelas([]);
 expect(resumirEtapasOperacoes([{company,fluxo:company.fluxoCarteira}]).items[0].axes.pago).toBe('na');
 company.guideCompliance.competencia='2026-09';company.guideCompliance.das={required:true,state:'enviada',paymentStatus:'PAID'};
 const result=resumirEtapasOperacoes([{company,fluxo:company.fluxoCarteira}]);
 expect(result.items[0].axes).toMatchObject({disponivel:null,enviado:null,pago:null});
 expect(result.items[0].guideSummary.items).toEqual([]);
});
it('pagamento não aplicável fica fora do denominador e da lista de faltantes', () => {
 const exempt = {...comParcelas([]), companyId:'dispensada', razao:'Dispensada'};
 const pending = {...companies[0], guideCompliance:{das:{required:true,state:'enviada',paymentStatus:'UNPAID'}}};
 const list = [exempt, pending];
 const result = resumirEtapasOperacoes(projetarOperacoesEmpresas(list, '2026-10').rows);
 expect(result.metrics.pago.total).toBe(1);
 expect(result.metrics.pago.notApplicable.map(r=>r.company.companyId)).toEqual(['dispensada']);
 expect(result.metrics.pago.missing.map(r=>r.company.companyId)).toEqual(['a']);
 render(<OperationsPage companies={list} competencia="2026-10"/>);
 fireEvent.click(screen.getByRole('button',{name:'Pago 0/1 empresas'}));
 fireEvent.change(screen.getByLabelText('Situação da etapa'),{target:{value:'pending'}});
 const modal=within(screen.getByRole('dialog'));
 expect(modal.getByText('Alfa')).toBeInTheDocument();
 expect(modal.queryByText('Dispensada')).not.toBeInTheDocument();
});
it('INSS em revisão concorda entre Empresas, progresso e filtros sem apagar fechamento ou envio', async () => {
 const company = {...companies[0], guideCompliance:{competencia:'2026-10',das:{required:true,state:'enviada'},inss:{required:true,state:'enviada',guideId:'inss'}},
  fluxoCarteira:{competencia:'2026-10',status:{chave:'concluido'},apuracao:{apurada:true,transmitida:true},
   contabilizacao:{chave:'importado',rotulo:'Importado',total:1,importados:1},tarefas:[{chave:'fechar',etapa:'contabilizacao',concluida:true},{chave:'importar',etapa:'importacao',concluida:true}]}};
 const manual={companyId:'a',competencia:'2026-10',status:'DOCUMENT_REVIEW'};
 const api={getOperationManualInss:jest.fn(async()=>({items:[manual]}))};
 const list=[company];
 render(<><CompaniesTable api={api} companies={list} competencia="2026-10"/><OperationsPage api={api} companies={list} competencia="2026-10"/></>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Disponível 0/1 empresas'})).toBeEnabled());expect(screen.queryByRole('button',{name:/^Concluído /})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Ver tarefas de Alfa: Guias'})).toBeInTheDocument();
 expect(screen.queryByText('Concluídas (1)',{exact:false})).not.toBeInTheDocument();
 expect(within(screen.getByRole('region',{name:'Operações'})).getByRole('button',{name:'Contabilização'})).toBeInTheDocument();
 expect(resumirEtapasOperacoes(projetarOperacoesEmpresas(list,'2026-10').rows,[],[manual]).metrics.concluido.done).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Disponível 0/1 empresas'}));
 expect(within(screen.getByRole('dialog')).getByText('Alfa')).toBeInTheDocument();
 expect(within(screen.getByRole('dialog')).getByText(/INSS manual · Documento para revisão/)).toBeInTheDocument();
 expect(company.fluxoCarteira.status.chave).toBe('concluido');
 expect(company.guideCompliance.inss.state).toBe('enviada');
});
it('barras independem da posição e explicam o filtro superior e os desconhecidos',async()=>{
 const api={getOperationEvidence:async()=>({ok:true,competencia:'2026-10',items:[],total:0})};
 const company={...companies[0],fluxoCarteira:{...companies[0].fluxoCarteira,status:{chave:'apuracao'},tarefas:[{etapa:'apuracao',concluida:false},{etapa:'contabilizacao',concluida:true},{etapa:'importacao',concluida:true}]}};
 const view=render(<OperationsPage api={api} companies={[company]} competencia="2026-10"/>);
 const progress=screen.getByRole('group',{name:/^Receitas /});
 expect(progress).toHaveAttribute('aria-description',expect.stringContaining('Indicador informativo'));
 expect(screen.queryByRole('button',{name:/^Receitas /})).not.toBeInTheDocument();
 view.unmount();
 render(<OperationsPage api={api} companies={[company]} competencia="2026-10"/>);
 const confirmed=await screen.findByRole('button',{name:'Confirmado — empresas'});
 expect(confirmed).toBeDisabled();
 expect(confirmed).toHaveAttribute('aria-description',expect.stringContaining('Informação indisponível.'));
 expect(await screen.findByText('Não foi possível conferir as evidências da competência.',{exact:false,selector:'[role="alert"]'})).toBeVisible();
 const metric=resumirEtapasOperacoes(projetarOperacoesEmpresas([company],'2026-10').rows,[]).metrics.confirmado;
 expect(metric.done).toHaveLength(0);expect(metric.total).toBe(1);expect(metric.unknown).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Contabilização'}));expect(within(screen.getByRole('dialog')).getByText('Alfa')).toBeInTheDocument();
 company.fluxoCarteira.tarefas[2].concluida=false;
 expect(resumirEtapasOperacoes([{company,fluxo:company.fluxoCarteira}]).metrics.contabilizacao.done).toHaveLength(0);
});
it('legenda acessível permite escolher A verificar diretamente e retorna o foco ao fechar', async()=>{
 render(<OperationsPage companies={companies} competencia="2026-10"/>);
 const tile=screen.getByRole('region',{name:'Situação fiscal'});
 const category=within(tile).getByRole('button',{name:/^A verificar\s*1$/});
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 category.focus(); fireEvent.click(category);
 expect(screen.getByRole('dialog',{name:'A verificar · 1 empresas'})).toBeInTheDocument();
 fireEvent.keyDown(document,{key:'Escape'});
 await waitFor(()=>expect(category).toHaveFocus());
});

it.each([
 ['2026-10-23','2026-10-24T12:00:00Z','negative'],
 ['2026-10-24','2026-10-24T23:59:59-03:00','positive'],
 ['2026-10-25','2026-10-24T12:00:00Z','positive'],
 ['2026-10-24','2026-10-25T02:59:59Z','positive'],
 ['2026-10-24','2026-10-25T03:00:00Z','negative'],
 ['2026-02-30','2026-10-24T12:00:00Z','unknown'],
 ['2026-10-24T09:00:00-03:00','2026-10-24T12:00:00Z','negative'],
 ['2026-10-24T09:00:01-03:00','2026-10-24T12:00:00Z','positive'],
])('validade %s em %s respeita data civil e instante (%s)', (expiry, now, expected) => {
 const company = {legacyCompany:{certStorageKey:'fixture',certExpiresAt:expiry},serproStatus:{procurationStatus:'ATIVA',vinculoConfirmado:true,checkedAt:'2026-10-20T12:00:00Z',validUntil:expiry}};
 const result = distribuicoesCadastrais([{company}], Date.parse(now));
 for(const axis of ['certificado','procuracao']) expect(result[axis].find(g=>g.key===expected).items).toHaveLength(1);
});

it('sem API de evidências mantém Confirmado indisponível e não oferece aprovação',async()=>{
 render(<OperationsPage companies={companies} competencia="2026-10"/>);
 await screen.findByText('Conferências indisponíveis neste ambiente.',{exact:false});
 const confirmado=screen.getByRole('button',{name:'Confirmado — empresas'});
 expect(confirmado).toBeDisabled();
 expect(confirmado).toHaveAttribute('aria-description',expect.stringContaining('Informação indisponível'));
 expect(screen.queryByRole('button',{name:'Confirmado 0/1 empresas'})).not.toBeInTheDocument();
});

it('Transmitido usa valores vinculados; cálculo atual e extrato sem vínculo permanecem fontes distintas no detalhe',async()=>{
 const api={getApuracaoSnapshot:jest.fn(async()=>({snapshot:{portalClientId:'a',competencia:'2026-10',estado:'transmitida',idempotencyKey:'calc-a',numeroDeclaracao:'123',dasSimuladoSerpro:72,dasRetornadoSerpro:74}})),getAuditoriaNotas:jest.fn(async()=>({auditoria:{competencia:'2026-10',totalAchados:0,perguntas:[]}})),getPgdasHistorico:jest.fn(async()=>({competencia:'2026-10',atualId:'v1',versoes:[{id:'v1',numeroDeclaracao:'123',atual:true,dasTotal:73}]})),getOperationsTransmissionDocuments:jest.fn(async()=>({ok:true,companyId:'a',competencia:'2026-10',items:[{companyId:'a',competencia:'2026-10',releaseId:'release-a',versionId:'v1',calculoId:'calc-historico',proofHash:'proof-a',numeroDeclaracao:'123',receitaBruta:1000,dasTotal:73,documentos:{extrato:true,recibo:true}}],unavailable:[]}))};
 const view=render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);
 fireEvent.click(screen.getByRole('button',{name:/^Transmitido /}));const dialog=within(screen.getByRole('dialog'));
 expect(dialog.getByRole('columnheader',{name:'Receita transmitida'})).toBeInTheDocument();expect(dialog.getByRole('columnheader',{name:'Tributos'})).toBeInTheDocument();
 await dialog.findByText(/73,00/);expect(dialog.getByText(/1\.000,00/)).toBeInTheDocument();expect(dialog.queryByText(/72,00|74,00/)).not.toBeInTheDocument();expect(dialog.getByText(/Cálculo: calc-historico/)).toBeInTheDocument();expect(dialog.getAllByRole('table')).toHaveLength(1);
 expect(api.getOperationsTransmissionDocuments).toHaveBeenCalledWith('a','2026-10');expect(api.getApuracaoSnapshot).not.toHaveBeenCalled();expect(api.getPgdasHistorico).not.toHaveBeenCalled();
 expect(dialog.getByRole('link',{name:'Retificar'})).toHaveAttribute('href','/companies/a/cadastro-fiscal?competencia=2026-10');expect(dialog.getByRole('link',{name:'Abrir empresa'})).toHaveAttribute('href','/companies/a/cadastro-fiscal?competencia=2026-10');
 view.unmount();render(<OperationsPage api={api} companies={companies} competencia="2026-10"/>);fireEvent.click(screen.getByRole('button',{name:/^Calculado /}));expect(screen.queryByRole('columnheader',{name:'Cálculo salvo'})).not.toBeInTheDocument();expect(screen.queryByRole('columnheader',{name:'Imposto do extrato salvo'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Ver evidências de Alfa'}));
 const detail=within(screen.getByRole('dialog',{name:'Evidências de Alfa'}));
 await detail.findByText(/72,00/);expect(detail.getByText(/74,00/)).toBeInTheDocument();expect(detail.getByRole('region',{name:'Extratos salvos, sem conciliação de revisão'})).toHaveTextContent('73,00');
 expect(detail.getByText('Correspondência do extrato com esta revisão').nextElementSibling).toHaveTextContent('A verificar');expect(detail.getByText(/Número da declaração e valores iguais não comprovam correspondência/)).toBeInTheDocument();
});

it('Transmitido sem vínculo não inventa valores, preserva documentos e navegações da competência',async()=>{
 render(<OperationsPage companies={companies} competencia="2026-10"/>);fireEvent.click(screen.getByRole('button',{name:/^Transmitido /}));
 const table=within(screen.getByRole('region',{name:'Transmissões vinculadas'}));
 for(const column of ['Empresa / declaração','Receita transmitida','Tributos','Recibo','Extrato','Ações']) expect(table.getByRole('columnheader',{name:column})).toBeInTheDocument();
 expect(table.queryByRole('columnheader',{name:'Confirmado'})).not.toBeInTheDocument();expect(table.queryByRole('columnheader',{name:'Calculado'})).not.toBeInTheDocument();
 expect(await table.findByText('Leitura vinculada indisponível nesta conexão.')).toBeInTheDocument();expect(table.getAllByText(/Não disponível/)).toHaveLength(2);expect(table.queryByText(/R\$/)).not.toBeInTheDocument();
 expect(table.getByRole('button',{name:'Baixar recibo'})).toBeDisabled();expect(table.getByRole('button',{name:'Baixar extrato'})).toBeDisabled();
 for(const action of ['Retificar','Abrir empresa']) expect(table.getByRole('link',{name:action})).toHaveAttribute('href','/companies/a/cadastro-fiscal?competencia=2026-10');
 expect(table.getByText('Retificar abre a apuração; não executa reabertura.')).toBeInTheDocument();
});

it.each([['Calculado','Calculado']])('%s mantém somente estado pertinente e ação curta na tabela',async(label,column)=>{
 render(<OperationsPage companies={companies} competencia="2026-10"/>);fireEvent.click(screen.getByRole('button',{name:new RegExp(`^${label} `)}));const table=within(screen.getByRole('region',{name:'Empresas da etapa'}));
 expect(table.getByRole('columnheader',{name:column})).toBeInTheDocument();expect(table.queryByRole('columnheader',{name:'Confirmado'})).not.toBeInTheDocument();expect(table.queryByRole('columnheader',{name:label==='Calculado'?'Transmitido':'Calculado'})).not.toBeInTheDocument();
 const action=table.getByRole('button',{name:'Ver evidências de Alfa'});expect(action).toHaveTextContent(/^Detalhes$/);expect(table.getAllByRole('button')).toHaveLength(1);expect(table.queryByRole('link')).not.toBeInTheDocument();
 fireEvent.click(action);await screen.findByText(/Leitura de cálculo salvo:/);expect(screen.getByText('Confirmado',{selector:'dt'})).toBeInTheDocument();expect(screen.getByText('Calculado',{selector:'dt'})).toBeInTheDocument();expect(screen.getByText('Transmitido',{selector:'dt'})).toBeInTheDocument();expect(screen.getByRole('link',{name:'Abrir apuração'})).toHaveAttribute('href','/companies/a/cadastro-fiscal?competencia=2026-10');expect(screen.getByRole('link',{name:'Abrir obrigações'})).toHaveAttribute('href','/companies/a/obrigacoes?competencia=2026-10');
});
