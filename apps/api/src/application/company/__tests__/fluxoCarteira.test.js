import { projetarFluxoCarteira } from '../../../../../../packages/shared/src/accounting/fluxoCarteira.js';
import { validarEdicaoTarefa } from '../../../../../../packages/shared/src/accounting/validarTarefaCarteira.js';

const empresa = (patch={}) => ({ companyId:'a', legacyCompany:{regimeTributario:'SIMPLES_NACIONAL'}, guideCompliance:{das:{required:true,state:'missing'}}, ...patch });
const contexto = (patch={}) => ({competencia:'2026-09',lancamentos:{total:2,importados:0},...patch});
const tarefa=(chave,patch={})=>({chave,versao:0,hash:'atual',dados:{},...patch});
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
test('presumido requer conferência das obrigações quando não configuradas',()=>{
  const f=projetarFluxoCarteira(empresa({legacyCompany:{regimeTributario:'LUCRO_PRESUMIDO'},apuracao:{estado:'calculada'}}),contexto());
  expect(f.tarefas.find(t=>t.chave==='transmitir').titulo).toContain('declarações');expect(f.status.chave).toBe('obrigacoes');
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
  expect(f.status.chave).toBe('apuracao');expect(f.tarefas).toHaveLength(7);
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
