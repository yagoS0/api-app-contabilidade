import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CompaniesTable } from '../renderCompaniesTable';
import { projetarFluxoCarteira } from '@contabilidade/shared/fluxo-carteira';
const company={companyId:'a',razao:'Empresa Teste',cnpj:'12345678000190',legacyCompany:{regimeTributario:'SIMPLES_NACIONAL'},apuracao:{estado:'transmitida'},fechamentoContabil:{fechado:true},guideCompliance:{das:{required:true,state:'gerada',guideId:'guia'}},fiscalSituacao:'COM_PENDENCIA',temParcelamento:true};
test('sete colunas, guia disponível e parcelamento sem ocultar a pendência',()=>{
  const onFluxo=jest.fn();
  render(<CompaniesTable companies={[{...company,fluxoCarteira:projetarFluxoCarteira(company,{lancamentos:{total:1,importados:0}})}]} competencia="2026-09" onFluxo={onFluxo}/>);
  const headers=screen.getAllByRole('columnheader');
  expect(headers).toHaveLength(7);
  for(const label of ['Empresa','Status','Apuração','Guias','Contabilização','Situação fiscal','Ações'])expect(headers.some(h=>h.textContent.includes(label))).toBe(true);
  expect(screen.getByText('Transmitido')).toBeInTheDocument();expect(screen.getByText('Fechado')).toBeInTheDocument();
  expect(screen.getByText('Pendência')).toBeInTheDocument();expect(screen.getByText('Parcelamento')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Ver tarefas de Empresa Teste: Guias'}));expect(onFluxo).toHaveBeenCalled();
});
test('nome e seleção continuam independentes',()=>{
  const onOpenCompany=jest.fn(), onAlternarSelecao=jest.fn();
  render(<CompaniesTable companies={[company]} onOpenCompany={onOpenCompany} onAlternarSelecao={onAlternarSelecao} selecionados={new Set()}/>);
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar Empresa Teste'}));
  expect(onOpenCompany).not.toHaveBeenCalled();expect(onAlternarSelecao).toHaveBeenCalledWith('a');
});
