import { projetarFluxoCarteira, MODELOS_OBRIGACOES_CARTEIRA } from '../../../../../../packages/shared/src/accounting/fluxoCarteira.js';
import { validarEdicaoTarefa } from '../../../../../../packages/shared/src/accounting/validarTarefaCarteira.js';
import { complianceParcelamentos } from '../../accounting/parcelamento/pendenciasParcelamento.js';

const empresa = (patch={}) => ({ companyId:'a', legacyCompany:{regimeTributario:'SIMPLES_NACIONAL'}, guideCompliance:{das:{required:true,state:'missing'}}, ...patch });
const contexto = (patch={}) => ({competencia:'2026-09',lancamentos:{total:2,importados:0},...patch});
const tarefa=(chave,patch={})=>({chave,versao:0,hash:'atual',dados:{},...patch});

test('cinco controles não mudam status geral, fechamento ou importação', () => {
  const c = empresa({ apuracao: { estado: 'transmitida' }, guideCompliance: { das: { required: true, state: 'enviada' } } });
  const antes = projetarFluxoCarteira(c, contexto());
  const checklist = { folhaProlabore: true, despesas: true, receitas: true, provisoes: true, pagamentos: true };
  const depois = projetarFluxoCarteira(c, contexto({ conferenciaContabil: { checklist, versao: 'atual' } }));
  expect(depois.contabilizacao.checklist).toEqual(checklist);
  expect(depois.contabilizacao.chave).toBe('aberto');
  expect(depois.status).toEqual(antes.status);
  expect(depois.tarefas).toEqual(antes.tarefas);
  expect(antes.contabilizacao.checklistPendentes).toHaveLength(5);
  expect(Object.values(antes.contabilizacao.checklist)).toEqual([false, false, false, false, false]);
  expect(antes.contabilizacao.versao).toBeNull();
});

test.each([
  ['enviada aguarda pagamento', { enviada: true, estado: 'CONSULTAR_PAGAMENTO' }, true],
  ['documento faltante', { guideId: null, enviada: false, estado: 'OBTER_GUIA' }, false],
  ['disponível sem envio', { enviada: false, estado: 'ENVIAR_GUIA' }, false],
  ['débito automático', { guideId: null, formaPagamento: 'DEBITO_AUTOMATICO', estado: 'CONSULTAR_PAGAMENTO' }, true],
  ['pagamento aguarda baixa', { pagamentoConfirmado: true, estado: 'CONTABILIZAR' }, true],
])('envio separado do financeiro: %s', (_nome, patch, concluida) => {
  const parcDas = complianceParcelamentos([{ guideId: 'parcela', formaPagamento: 'GUIA', pagamentoConfirmado: false, ...patch }]);
  const c = empresa({ apuracao: { estado: 'transmitida' }, guideCompliance: { das: { required: true, state: 'enviada' }, parcDas } });
  const antes = JSON.stringify(c);
  const fluxo = projetarFluxoCarteira(c, contexto());
  expect(fluxo.tarefas.find(t => t.chave === 'enviar_guias').concluida).toBe(concluida);
  expect(fluxo.status.chave).toBe(concluida ? 'contabilizacao' : 'guias');
  expect(parcDas.pendenciaOperacional).toBe(true);
  expect(JSON.stringify(c)).toBe(antes);
});

test.each([true, false])('parcelas antiga e atual: envio atual comprovado %s', enviada => {
  const parcDas = complianceParcelamentos([
    { guideId: 'setembro', enviada: true, estado: 'CONSULTAR_PAGAMENTO', anterior: true },
    { guideId: 'outubro', enviada, estado: enviada ? 'CONSULTAR_PAGAMENTO' : 'ENVIAR_GUIA' },
  ]);
  const fluxo = projetarFluxoCarteira(empresa({ apuracao: { estado: 'transmitida' }, guideCompliance: { das: { required: true, state: 'enviada' }, parcDas } }), contexto());
  expect(fluxo.tarefas.find(t => t.chave === 'enviar_guias').concluida).toBe(enviada);
  expect(parcDas.pendencias).toBe(2);
});
test('começa em apuração sem inventar conclusão ou guia',()=>{
  const f=projetarFluxoCarteira(empresa(),contexto());
  expect(f.status.chave).toBe('apuracao');expect(f.apuracao.rotulo).toBe('A apurar');expect(f.contabilizacao.rotulo).toBe('Aberto');
});
test('apuração calculada e transmissão são etapas diferentes',()=>{
  const f=projetarFluxoCarteira(empresa({apuracao:{estado:'calculada'}}),contexto());
  expect(f.apuracao.rotulo).toBe('Apurado');expect(f.status.chave).toBe('obrigacoes');
});
test('fechamento não oculta guia por enviar',()=>{
  const f=projetarFluxoCarteira(empresa({apuracao:{estado:'transmitida'},fechamentoContabil:{fechado:true},guideCompliance:{das:{required:true,state:'gerada'}}}),contexto());
  expect(f.status.chave).toBe('guias');expect(f.contabilizacao.rotulo).toBe('Fechado');
});
test('importação parcial não conclui o mês',()=>{
  const c=empresa({apuracao:{estado:'transmitida'},fechamentoContabil:{fechado:true},guideCompliance:{das:{required:true,state:'enviada'}}});
  expect(projetarFluxoCarteira(c,contexto({lancamentos:{total:2,importados:1}})).status.chave).toBe('importacao');
  const f=projetarFluxoCarteira(c,contexto({lancamentos:{total:2,importados:2}}));expect(f.status.chave).toBe('concluido');expect(f.contabilizacao.rotulo).toBe('Importado');
});
test('reabertura mantém importado fora do estado contábil',()=>{
  expect(projetarFluxoCarteira(empresa(),contexto({lancamentos:{total:2,importados:2}})).contabilizacao.rotulo).toBe('Aberto');
});
test('sem movimento não dispensa transmitir o Simples',()=>{
  const f=projetarFluxoCarteira(empresa({empresaZerada:true,apuracao:{estado:'calculada'},guideCompliance:{das:{required:true,state:'vazio'}}}),contexto());
  expect(f.status.chave).toBe('obrigacoes');
});
test('presumido tem uma única tarefa para enviar EFD e MIT',()=>{
  const f=projetarFluxoCarteira(empresa({legacyCompany:{regimeTributario:'LUCRO_PRESUMIDO'},apuracao:{estado:'calculada'}}),contexto());
  expect(f.tarefas.find(t=>t.chave==='transmitir').titulo).toBe('Enviar EFD e MIT');expect(f.status.chave).toBe('obrigacoes');
  expect(f.tarefas.some(t=>['obrigacoes','obter_guias'].includes(t.chave))).toBe(false);
});
test('evidência antiga não conclui cálculo alterado',()=>{
  const f=projetarFluxoCarteira(empresa(),contexto({hashes:{apurar:'novo'},registros:[{chave:'apurar',dados:{conclusao:{em:'ontem',hash:'antigo'}}}]}));
  expect(f.apuracao.apurada).toBe(false);expect(f.tarefas[0].revisar).toBe(true);
});
test('obrigação pendente não some por fechamento',()=>{
  const f=projetarFluxoCarteira(empresa({apuracao:{estado:'transmitida'},fechamentoContabil:{fechado:true}}),contexto({obrigacoes:[{nome:'Obrigação mensal',concluida:false}]}));
  expect(f.status.chave).toBe('obrigacoes');
});
test('verificador contábil não cria dependência circular nas obrigações',()=>{
  const f=projetarFluxoCarteira(empresa({apuracao:{estado:'transmitida'},guideCompliance:{das:{required:true,state:'enviada'}}}),contexto({obrigacoes:[{verificador:'MES_FECHADO',concluida:false}]}));
  expect(f.status.chave).toBe('contabilizacao');
});
test('falha de leitura não é ausência de guias',()=>{
  const f=projetarFluxoCarteira(empresa({apuracao:{estado:'transmitida'},guideCompliance:null}),contexto());
  expect(f.status.chave).toBe('guias');
});
test('tarefas específicas participam da etapa e não apagam automáticas',()=>{
  const f=projetarFluxoCarteira(empresa({apuracao:{estado:'transmitida'}}),contexto({registros:[{chave:'extra:1',dados:{titulo:'Conferir notas',etapa:'apuracao'}}]}));
  expect(f.status.chave).toBe('apuracao');expect(f.tarefas).toHaveLength(6);
});

test('transmissão do presumido avança sem segunda confirmação mas ISS pendente continua bloqueando',()=>{
  const c=empresa({legacyCompany:{regimeTributario:'LUCRO_PRESUMIDO'}});
  const ctx=contexto({hashes:{transmitir:'atual'},registros:[{chave:'transmitir',dados:{conclusao:{em:'hoje',hash:'atual'}}}]});
  expect(projetarFluxoCarteira(c,ctx).status.chave).toBe('guias');
  expect(projetarFluxoCarteira(c,{...ctx,obrigacoes:[{nome:'GUIA DE ISS',concluida:false}]}).status.chave).toBe('obrigacoes');
  expect(projetarFluxoCarteira(c,{...ctx,hashes:{transmitir:'mudou'}}).apuracao.transmitida).toBe(false);
});

test('modelos não oferecem captura geral nem transmissão duplicada',()=>{
  expect(MODELOS_OBRIGACOES_CARTEIRA.some(m=>['CARTEIRA_OBTER_GUIAS','CARTEIRA_OBRIGACOES'].includes(m.verificador))).toBe(false);
  expect(MODELOS_OBRIGACOES_CARTEIRA.filter(m=>m.verificador==='CARTEIRA_TRANSMITIR').map(m=>m.titulo)).toEqual(['Transmitir apuração · Simples Nacional','Enviar EFD e MIT · Lucro Presumido']);
});

test('transmissão externa comprovada atualiza a coluna e a obrigação verificável',()=>{
  const f=projetarFluxoCarteira(empresa({legacyCompany:{regimeTributario:'LUCRO_PRESUMIDO'}}),contexto({
    hashes:{transmitir:'atual'},registros:[{chave:'transmitir',dados:{conclusao:{em:'hoje',hash:'atual'}}}],
    obrigacoes:[{verificador:'APURACAO_TRANSMITIDA',concluida:false}],
  }));
  expect(f.apuracao.rotulo).toBe('Transmitido');expect(f.obrigacoes[0].concluida).toBe(true);
});
test.each(['2026-02-30','xxx'])('recusa data impossível %s',d=>expect(()=>validarEdicaoTarefa({versao:0,dataInicio:d,dataFim:d},tarefa('apurar'),{})).toThrow('data válida'));
test('recusa versão antiga e preserva conclusões em planejamento',()=>{
  expect(()=>validarEdicaoTarefa({versao:0},tarefa('apurar',{versao:1}),{})).toThrow('mudou');
  expect(validarEdicaoTarefa({versao:0,conclusao:{em:'fraude'}},tarefa('apurar'),{}).conclusao).toBeUndefined();
});
test('não permite concluir tarefa automática manualmente',()=>expect(()=>validarEdicaoTarefa({versao:0,acao:'concluir'},tarefa('contabilizar',{automatica:true}),{})).toThrow('operação'));
test('recusa evidência contra dados alterados',()=>expect(()=>validarEdicaoTarefa({versao:0,acao:'concluir',evidencia:'recibo externo',hash:'velho'},tarefa('apurar'),{})).toThrow('mudaram'));
test('recusa importação de ID de outra empresa ou não exportado',()=>{
  const d={fluxo:{contabilizacao:{chave:'fechado'}},lancamentos:[{id:'meu',importavel:false}]};
  expect(()=>validarEdicaoTarefa({versao:0,acao:'concluir',evidencia:'ERP lote 123',hash:'atual',entryIds:['outro']},tarefa('importar'),d)).toThrow('outra competência');
});

test('confirma transmissão sem exigir formulário, conservando origem e vínculo com os dados',()=>{
  const dados=validarEdicaoTarefa({versao:0,acao:'concluir',hash:'atual'},tarefa('transmitir'),{});
  expect(dados.conclusao).toEqual({hash:'atual',origem:'CONFIRMACAO_MANUAL'});
  const f=projetarFluxoCarteira(empresa(),contexto({hashes:{transmitir:'atual'},registros:[{chave:'transmitir',dados:{...dados,conclusao:{...dados.conclusao,em:'hoje'}}}]}));
  expect(f.tarefas.find(t=>t.chave==='transmitir').concluida).toBe(true);
  expect(f.tarefas.find(t=>t.chave==='contabilizar').concluida).toBe(false);
});
test('confirmação simples continua recusando dependências e hash alterado',()=>{
  expect(()=>validarEdicaoTarefa({versao:0,acao:'concluir',hash:'atual'},tarefa('transmitir',{aguardando:['apurar']}),{})).toThrow('etapas necessárias');
  expect(()=>validarEdicaoTarefa({versao:0,acao:'concluir',hash:'antigo'},tarefa('transmitir'),{})).toThrow('mudaram');
});
test('evidência opcional conserva texto legado sem aceitar tipos inválidos',()=>{
  expect(validarEdicaoTarefa({versao:0,acao:'concluir',hash:'atual',evidencia:' Recibo 123 '},tarefa('transmitir'),{}).conclusao.evidencia).toBe('Recibo 123');
  expect(()=>validarEdicaoTarefa({versao:0,acao:'concluir',evidencia:{}},tarefa('transmitir'),{})).toThrow('Evidência inválida');
});


test('PGDAS oficial retira apuração externa das pendências sem fechar contabilização', () => {
  const c = empresa({ apuracao: { estado: 'aberta', numeroDeclaracaoRfb: '123' } });
  const f = projetarFluxoCarteira(c, contexto({ obrigacoes: [{ verificador: 'APURACAO_TRANSMITIDA', concluida: false }] }));
  expect(f.apuracao).toMatchObject({ rotulo: 'Apurado', porFora: true, apurada: true, transmitida: true });
  expect(f.tarefas.find(t => t.chave === 'apurar').concluida).toBe(true);
  expect(f.tarefas.find(t => t.chave === 'transmitir').concluida).toBe(true);
  expect(f.obrigacoes[0].concluida).toBe(true);
  expect(f.contabilizacao.chave).toBe('aberto');
  expect(f.tarefas.find(t => t.chave === 'contabilizar').concluida).toBe(false);
  expect(c.apuracao.estado).toBe('aberta');
  expect(f.status.chave).toBe('guias');
});

test('guia manual sem número oficial não prova apuração externa', () => {
  expect(projetarFluxoCarteira(empresa({ guideCompliance: { das: { required: true, state: 'gerada', source: 'UPLOAD' } } }), contexto()).apuracao.apurada).toBe(false);
});

test.each([
  { estado: 'transmitida', numeroDeclaracao: '123', numeroDeclaracaoRfb: '123' },
  { estado: 'confirmada', numeroDeclaracao: '123', numeroDeclaracaoRfb: '456' },
  { estado: 'aberta', numeroDeclaracao: '123', numeroDeclaracaoRfb: '456' },
])('não atribui transmissão interna a origem externa: %j', apuracao => {
  expect(projetarFluxoCarteira(empresa({ apuracao }), contexto()).apuracao.porFora).not.toBe(true);
});

test('comprovação PGDAS não resolve declarações de outro regime', () => {
  const c = empresa({ legacyCompany: { regimeTributario: 'LUCRO_PRESUMIDO' }, apuracao: { numeroDeclaracaoRfb: '123' } });
  expect(projetarFluxoCarteira(c, contexto()).apuracao.apurada).toBe(false);
});

test.each(['gerada', 'enviada', 'falhou'])('DAS mensal %s orienta conferência sem inventar apuração ou transmissão', state => {
  const c = empresa({ guideCompliance: { competencia: '2026-09', das: { required: true, ok: true, state, guideId: 'das' } } });
  const f = projetarFluxoCarteira(c, contexto());
  expect(f.status).toEqual({ chave: 'apuracao', rotulo: 'Conferir apuração' });
  expect(f.apuracao).toMatchObject({ apurada: false, transmitida: false, documentoDisponivel: true });
  expect(f.tarefas.find(t => t.chave === 'apurar').concluida).toBe(false);
  expect(f.tarefas.find(t => t.chave === 'transmitir').concluida).toBe(false);
  expect(c.apuracao).toBeUndefined();
});
test.each([
  { competencia: '2026-08', das: { ok: true, state: 'gerada', guideId: 'antiga' } },
  { competencia: '2026-09', parcDas: { ok: true, state: 'gerada', guideId: 'parcela' } },
  { competencia: '2026-09', das: { ok: true, state: 'vazio', guideId: 'marcador' } },
  { competencia: '2026-09', erro: true, das: { ok: true, state: 'gerada', guideId: 'das' } },
])('evidência insuficiente não muda orientação: %j', guideCompliance => {
  expect(projetarFluxoCarteira(empresa({ guideCompliance }), contexto()).apuracao.rotulo).toBe('A apurar');
});
