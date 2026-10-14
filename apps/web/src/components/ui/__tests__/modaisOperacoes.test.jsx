import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CompanyCertificateUploadModal } from '../../../features/companies/certificate/components/CompanyCertificateUploadModal';
import { DeleteCompanyModal } from '../../../features/companies/detail/components/DeleteCompanyModal';
import { ImportExcelModal } from '../../../features/accounting/excel-import/components/renderImportExcelModal';
const company = { cnpj: '12345678000199', razao: 'Empresa' };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const cases = [['certificado', CompanyCertificateUploadModal, {}], ['exclusão', DeleteCompanyModal, {company}], ['Excel', ImportExcelModal, {}]];
test.each(cases)('%s leva foco ao corpo e devolve ao gatilho ao fechar por Escape', (_, Component, props) => {
  function Host() { const [open,setOpen]=useState(false); return <><button onClick={() => setOpen(true)}>Abrir</button>{open && <Component {...props} onClose={() => setOpen(false)} />}</>; }
  render(<Host />);
  const trigger=screen.getByText('Abrir'); trigger.focus(); fireEvent.click(trigger);
  expect(document.querySelector('.modal-corpo').contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
test.each(cases.slice(0,2))('%s bloqueia saída e Tab em saving externo', (_, Component, props) => {
  const close=jest.fn(); render(<Component {...props} saving onClose={close} />);
  fireEvent.keyDown(document,{key:'Escape'}); fireEvent.click(screen.getByRole('dialog')); fireEvent.click(screen.getByText('Cancelar'));
  expect(close).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Fechar')).toBeNull();
  fireEvent.keyDown(document,{key:'Tab'}); expect(document.activeElement).toBe(document.querySelector('.modal-caixa'));
});
test('certificado trava também enquanto callback aguarda e libera após erro', async () => {
  const d=deferred(),close=jest.fn(),upload=jest.fn(() => d.promise);
  render(<CompanyCertificateUploadModal onUpload={upload} onClose={close} />);
  fireEvent.change(document.querySelector('input[type=file]'),{target:{files:[new File(['x'],'cert.pfx')]}});
  fireEvent.change(screen.getByLabelText('Senha do certificado'),{target:{value:'senha'}});
  fireEvent.click(screen.getByText('Enviar')); fireEvent.keyDown(document,{key:'Escape'});
  expect(close).not.toHaveBeenCalled(); expect(screen.getByText('Cancelar')).toBeDisabled();
  await act(async () => d.reject(new Error('Falhou')));
  expect(screen.getByRole('alert')).toHaveTextContent('Falhou'); expect(screen.getByText('Cancelar')).toBeEnabled();
});
test('exclusão bloqueia saída e duplicação enquanto confirma', async () => {
  const d=deferred(),close=jest.fn(),confirm=jest.fn(() => d.promise);
  render(<DeleteCompanyModal company={company} onConfirm={confirm} onClose={close} />);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:company.cnpj}});
  fireEvent.click(screen.getByText('Excluir definitivamente')); fireEvent.click(screen.getByText('Excluindo…'));
  fireEvent.keyDown(document,{key:'Escape'}); expect(close).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => d.reject(new Error('Falhou'))); expect(screen.getByRole('alert')).toHaveTextContent('Falhou');
});
test('Excel bloqueia preview e fechamento acidental no commit, preservando saída explícita', async () => {
  const preview=deferred(),commit=deferred(),close=jest.fn();
  const view=render(<ImportExcelModal onPreview={() => preview.promise} onCommit={() => commit.promise} onClose={close} />);
  fireEvent.change(screen.getByLabelText('Planilha Excel ou CSV'),{target:{files:[new File(['x'],'planilha.xlsx')]}});
  fireEvent.click(screen.getByText('Pré-visualizar')); fireEvent.keyDown(document,{key:'Escape'});
  expect(close).not.toHaveBeenCalled(); expect(screen.getByText('Cancelar')).toBeDisabled();
  await act(async () => preview.resolve({transactions:[{rowIndex:1,data:'2026-01-01',descricao:'Teste',valor:1,match:{contaDebito:'1'}}]}));
  fireEvent.click(screen.getByText('Importar 1 linha')); fireEvent.keyDown(document,{key:'Escape'});
  expect(close).not.toHaveBeenCalled(); expect(screen.getByText('Voltar')).toBeDisabled();
  expect(screen.getByLabelText('Histórico da linha 1')).toBeDisabled();
  fireEvent.click(screen.getByText('Continuar em segundo plano')); expect(close).toHaveBeenCalledTimes(1);
  view.unmount(); await act(async () => commit.resolve({ok:true})); expect(close).toHaveBeenCalledTimes(1);
});
