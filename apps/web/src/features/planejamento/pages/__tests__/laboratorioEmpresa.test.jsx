import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { LaboratorioEmpresa } from '../../components/LaboratorioEmpresa';
import { BaseGerencial } from '../../components/BaseGerencial';
import { ImprimirRelatorio } from '../../components/ImprimirRelatorio';
import { analisePlanejamentoMock } from '../../../../api/mock/analisePlanejamentoMock';
import { clientesAnaliseMock } from '../../../../api/mock/clientesAnaliseMock';
const campos=['Faturamento mensal','Custos fixos','Custos variáveis','Pró-labore separado','Clientes com faturamento','Tributo sobre receita (%) — premissa'];
test('cenários começam sem taxa presumida, comparam e salvam foto',async()=>{
 const api={listarCenariosLaboratorio:jest.fn(async()=>({cenarios:[]})),salvarCenarioLaboratorio:jest.fn(async d=>({cenario:{id:'a',...d,entradasJson:{a:d.a,b:d.b},createdAt:new Date().toISOString()}}))};
 render(<LaboratorioEmpresa api={api}/>);await waitFor(()=>expect(api.listarCenariosLaboratorio).toHaveBeenCalled());
 expect(screen.getByText('Salvar nova versão')).toBeDisabled();
 campos.forEach((c,i)=>fireEvent.change(screen.getAllByLabelText(c)[0],{target:{value:String([10000,2000,1000,1000,20,10][i])}}));
 fireEvent.click(screen.getByText('Copiar A para B'));expect(screen.getByText('Impacto da decisão')).toBeInTheDocument();
 fireEvent.click(screen.getByText('Testar contratação em B'));fireEvent.click(screen.getByText('Salvar nova versão'));
 await screen.findByText('Nova versão salva. Os dados da empresa não foram alterados.');
 expect(api.salvarCenarioLaboratorio.mock.calls[0][0]).toMatchObject({companyId:null,b:{fixos:5000}});
});
test('classificação incompleta bloqueia indicadores e salvar habilita contribuição',async()=>{
 const api={getClassificacaoGerencial:jest.fn(async()=>({contas:{},revisao:0})),salvarClassificacaoGerencial:jest.fn(async(_,r)=>({...r,revisao:1}))};
 const dre={linhas:[{chave:'receitaBruta',valor:10000},{chave:'pessoal',rotulo:'Pessoal',contas:[{codigo:'41101001',nome:'Pró-labore',valor:-2000}]}]};
 render(<BaseGerencial api={api} empresaId="a" dre={dre}/>);await screen.findByText('Classificar contas gerenciais');
 fireEvent.click(screen.getByText('Classificar contas gerenciais'));fireEvent.change(screen.getByLabelText('Comportamento 41101001'),{target:{value:'FIXO'}});fireEvent.click(screen.getByLabelText('Pró-labore 41101001'));fireEvent.click(screen.getByText('Salvar classificação'));
 await screen.findByText(/Pró-labore \/ receita bruta: 20.0%/);expect(api.salvarClassificacaoGerencial.mock.calls[0][0]).toBe('a');
});
test('impressão completa inclui mais de uma página da carteira',async()=>{
 const filtros={de:'2026-08',ate:'2026-08',comparar:'anterior'},dados=analisePlanejamentoMock('demo',filtros),clientes=clientesAnaliseMock('demo',filtros);
 clientes.clientes=Array.from({length:45},(_,i)=>({...clientes.clientes[0],documento:String(i),nome:`Cliente impresso ${i}`}));
 const api={getRelatorioGerencialSnapshot:jest.fn(async()=>({dados,clientes,classificacao:{}}))};
 const old=window.print;window.print=jest.fn(()=>{expect(document.querySelector('#relatorio-gerencial-impressao').textContent).toContain('Cliente impresso 44');expect(document.body.classList.contains('imprimindo-gerencial')).toBe(true);});
 try{render(<ImprimirRelatorio api={api} empresaId="demo" empresaNome="Demonstração" dados={dados} {...filtros}/>);fireEvent.click(screen.getByText('Imprimir relatório completo'));await waitFor(()=>expect(window.print).toHaveBeenCalledTimes(1));expect(document.body.classList.contains('imprimindo-gerencial')).toBe(false);}finally{window.print=old;}
});
test('trocar a empresa enquanto prepara relatório não imprime fotografia antiga',async()=>{
 let resolver;const api={getRelatorioGerencialSnapshot:jest.fn(()=>new Promise(r=>{resolver=r;}))};
 const old=window.print;window.print=jest.fn();
 try{const v=render(<ImprimirRelatorio api={api} empresaId="a" de="2026-08" ate="2026-08" comparar="anterior"/>);fireEvent.click(screen.getByText('Imprimir relatório completo'));await waitFor(()=>expect(resolver).toBeDefined());v.unmount();resolver({dados:{},clientes:{},classificacao:{}});await Promise.resolve();expect(window.print).not.toHaveBeenCalled();}finally{window.print=old;}
});

test.each([{companyId:'empresa-real',id:'legado',razao:'Empresa da carteira'},{id:'empresa-real',razao:'Empresa da carteira'}])('importa receita pela identidade da carteira: %j',async empresa=>{
 const filtros={de:'2026-08',ate:'2026-08',comparar:'anterior'},dados=analisePlanejamentoMock('demo',filtros),clientes=clientesAnaliseMock('demo',filtros);
 const api={listarCenariosLaboratorio:jest.fn(async()=>({cenarios:[]})),getRelatorioGerencialSnapshot:jest.fn(async()=>({dados,clientes,classificacao:{}}))};
 render(<LaboratorioEmpresa api={api} empresas={[empresa]}/>);
 fireEvent.change(screen.getByLabelText('Base do cenário'),{target:{value:'empresa-real'}});
 fireEvent.change(screen.getByLabelText('Mês de referência'),{target:{value:'2026-08'}});
 fireEvent.click(screen.getByText('Trazer base do mês'));
 await waitFor(()=>expect(screen.getAllByLabelText('Faturamento mensal')[0]).toHaveValue(dados.atual.dre.linhas.find(l=>l.chave==='receitaBruta').valor));
 expect(api.getRelatorioGerencialSnapshot).toHaveBeenCalledWith('empresa-real',filtros);
 expect(screen.getByText('Salvar nova versão')).toBeDisabled();
});

test('regras automáticas habilitam DAS sem gravar; sugestões médias exigem confirmação',async()=>{
 const api={getClassificacaoGerencial:jest.fn(async()=>({contas:{},revisao:0})),salvarClassificacaoGerencial:jest.fn(async(_,r)=>({...r,revisao:1}))};
 const dre={linhas:[{chave:'receitaBruta',valor:12000},{chave:'deducoes',contas:[{codigo:'311020001',nome:'DAS SIMPLES NACIONAL',valor:-720}]},{chave:'gerais',contas:[{codigo:'411020010',nome:'Aluguel de imóveis',valor:-1000}]}]};
 render(<BaseGerencial api={api} empresaId="real" dre={dre}/>);
 await screen.findByText(/1 conta\(s\) classificada\(s\) automaticamente/);
 expect(api.salvarClassificacaoGerencial).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Revisar sugestões em lote'));
 expect(screen.getByLabelText('Comportamento 311020001')).toHaveValue('VARIAVEL');
 expect(screen.getByLabelText('Comportamento 411020010')).toHaveValue('FIXO');
 expect(screen.getByText(/Sugestão para conferir/)).toBeInTheDocument();
 fireEvent.click(screen.getByText('Salvar classificação'));
 await waitFor(()=>expect(api.salvarClassificacaoGerencial).toHaveBeenCalledWith('real',{revisao:0,contas:{'311020001':{comportamento:'VARIAVEL',prolabore:false},'411020010':{comportamento:'FIXO',prolabore:false}}}));
});

test('editar receita mantém proporção dos variáveis sem arredondamento por tecla',async()=>{
 const api={listarCenariosLaboratorio:jest.fn(async()=>({cenarios:[]}))};
 render(<LaboratorioEmpresa api={api}/>);await waitFor(()=>expect(api.listarCenariosLaboratorio).toHaveBeenCalled());
 campos.forEach((c,i)=>fireEvent.change(screen.getAllByLabelText(c)[0],{target:{value:String([12612,0,756.73,0,1,0][i])}}));
 const campo=screen.getAllByLabelText('Faturamento mensal')[0];fireEvent.focus(campo);
 for(const value of ['1','13','132','1320','13200'])fireEvent.change(campo,{target:{value}});
 expect(screen.getAllByLabelText('Custos variáveis')[0]).toHaveValue(792.01);
});
