import 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompaniesTable } from '../renderCompaniesTable';
import { projetarFluxoCarteira } from '@contabilidade/shared/fluxo-carteira';
const company={companyId:'a',razao:'Empresa Teste',cnpj:'12345678000190',legacyCompany:{regimeTributario:'SIMPLES_NACIONAL'},apuracao:{estado:'transmitida'},fechamentoContabil:{fechado:true},guideCompliance:{das:{required:true,state:'gerada',guideId:'guia'},parcDas:{required:true,state:'missing',quantidade:1}},fiscalSituacao:'COM_PENDENCIA',temParcelamento:true};
test('sete colunas, guia disponível e parcelamento sem ocultar a pendência',()=>{
  const onFluxo=jest.fn();
  render(<CompaniesTable companies={[{...company,fluxoCarteira:projetarFluxoCarteira(company,{lancamentos:{total:1,importados:0}})}]} competencia="2026-09" onFluxo={onFluxo}/>);
  const headers=screen.getAllByRole('columnheader');
  expect(headers).toHaveLength(7);
  for(const label of ['Empresa','Status','Apuração','Guias','Contabilização','Situação fiscal','Ações'])expect(headers.some(h=>h.textContent.includes(label))).toBe(true);
  expect(screen.getByText('Transmitido')).toBeInTheDocument();expect(screen.getByText('Fechado')).toBeInTheDocument();
  expect(screen.getByText('Pendente')).toBeInTheDocument();expect(screen.getByRole('button',{name:/Parcelamento:/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Ver tarefas de Empresa Teste: Guias'}));expect(onFluxo).toHaveBeenCalled();
});
test('nome e seleção continuam independentes',()=>{
  const onOpenCompany=jest.fn(), onAlternarSelecao=jest.fn();
  render(<CompaniesTable companies={[company]} onOpenCompany={onOpenCompany} onAlternarSelecao={onAlternarSelecao} selecionados={new Set()}/>);
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Empresa Teste'}));
  expect(onOpenCompany).not.toHaveBeenCalled();expect(onAlternarSelecao).toHaveBeenCalledWith('a');
});


test('entrega recuperada aparece apurada por fora e contabilização continua aberta', () => {
 const externa = { ...company, apuracao: { estado: 'aberta', numeroDeclaracaoRfb: '123' }, fechamentoContabil: { fechado: false } };
 render(<CompaniesTable companies={[{ ...externa, fluxoCarteira: projetarFluxoCarteira(externa) }]} competencia="2026-09" />);
 expect(screen.getByText('Apurado')).toBeInTheDocument();
 expect(screen.getByText('Aberto')).toBeInTheDocument();
 expect(screen.queryByText('A apurar')).not.toBeInTheDocument();
});

test('procuração salva aparece sem executar consulta e muda na releitura', () => {
 const consultar = jest.fn();
 const ativa = {...company, serproStatus:{procurationStatus:'ATIVA', checkedAt:new Date().toISOString(), validUntil:'2099-12-31', vinculoConfirmado:true, systems:['00146']}};
 const view = render(<CompaniesTable companies={[ativa]} acoesGuia={{onConsultarFiscal: consultar}} />);
 expect(screen.getByText('Procuração: Ativa')).toBeInTheDocument();
 fireEvent.click(screen.getByText('Procuração: Ativa'));
 expect(screen.getByText('Serviços informados: 00146')).toBeVisible();
 expect(consultar).not.toHaveBeenCalled();
 view.rerender(<CompaniesTable companies={[{...ativa, serproStatus:{...ativa.serproStatus, procurationStatus:'AUSENTE'}}]} />);
 expect(screen.getByText('Procuração: Sem procuração ativa')).toBeInTheDocument();
});
test('DAS disponível mostra conferência preservando o acesso às tarefas', () => {
 const c = {...company, apuracao:{competencia:'2026-09'}, guideCompliance:{competencia:'2026-09', das:{required:true, ok:true, state:'gerada', guideId:'das'}}};
 render(<CompaniesTable companies={[c]} competencia="2026-09" />);
 expect(screen.getByRole('button', {name:'Ver tarefas de Empresa Teste: Conferir apuração'})).toBeInTheDocument();
 expect(screen.queryByText('Transmitido')).not.toBeInTheDocument();
 const detalhe = screen.getByText(/O DAS desta competência está disponível/);
 expect(detalhe).not.toBeVisible();
 fireEvent.click(screen.getByText('Conferir apuração', {selector:'summary'}));
 expect(detalhe).toBeVisible();
});

test('falha mais recente mostra última tentativa e preserva resultado válido no detalhe', () => {
 const c = {...company, serproStatus:{procurationStatus:'ATIVA',checkedAt:new Date().toISOString(),validUntil:'2099-12-31',vinculoConfirmado:true,
   ultimaTentativa:{status:'ERRO',iniciadaEm:new Date().toISOString(),vinculoConfirmado:true}}};
 render(<CompaniesTable companies={[c]} />);
 fireEvent.click(screen.getByText('Procuração: Erro na verificação'));
 expect(screen.getByText('Último resultado válido: Procuração ativa')).toBeVisible();
 expect(screen.getByText(/Última tentativa: Não foi possível verificar; resultado anterior preservado/)).toBeVisible();
});
