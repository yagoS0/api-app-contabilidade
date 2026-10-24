import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyForm } from '../renderCompanyForm';
import { getInitialCompanyFormState, mapCompanyToEditForm } from '../../hooks/useManageCompanyForm';

jest.mock('../CamposEmissaoNfse', () => ({ CamposEmissaoNfse: () => null }));
jest.mock('../SeletorMunicipioIbge', () => ({ SeletorMunicipioIbge: () => null }));

test('cadastro permite desmarcar Sem número e reler correção conservando IPTU e legado', () => {
  const inicial = { ...getInitialCompanyFormState(), ...mapCompanyToEditForm({ legacyCompany: { enderecoJson: { numero: 'S/N', semNumero: true, inscricaoImobiliaria: '000AB', legado: 'Texto antigo' }, titular: { nome: 'Ana', cpf: '52998224725' } } }) };
  function Cenario() {
    const [form, set] = useState(inicial);
    return <><CompanyForm form={form} cnpjReadOnly onChange={(k, v) => set(a => ({ ...a, [k]: v }))} onSubmit={e => e.preventDefault()} submitLabel="Salvar" /><output data-testid="cadastro-editado">{JSON.stringify(form)}</output></>;
  }
  render(<Cenario />);
  expect(screen.getByLabelText('Número')).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Sem número'));
  fireEvent.change(screen.getByLabelText('Número'), { target: { value: '123' } });
  const form = JSON.parse(screen.getByTestId('cadastro-editado').textContent);
  expect(form).toMatchObject({ enderecoNumero: '123', semNumero: false, inscricaoImobiliaria: '000AB', enderecoLegado: 'Texto antigo' });
  const relido = mapCompanyToEditForm({ legacyCompany: { enderecoJson: { numero: form.enderecoNumero, semNumero: form.semNumero, inscricaoImobiliaria: form.inscricaoImobiliaria, legado: form.enderecoLegado }, titular: form.titular } });
  expect(relido).toMatchObject({ enderecoNumero: '123', semNumero: false, inscricaoImobiliaria: '000AB', enderecoLegado: 'Texto antigo' });
});

test('conflito legado revela pessoas e só remove vínculo por gesto explícito, preservando titular no envio', () => {
  const titular = { nome: 'Ana Titular', cpf: '52998224725' };
  const socios = [{ id: 'p1', name: 'Bia Sócia', documento: '11144477735', participacao: '40' }, { id: 'p2', name: 'Caio Sócio', documento: '12345678909', participacao: '60' }];
  const inicial = { ...getInitialCompanyFormState(), titular, socios, inscricaoImobiliaria: '000AB' };
  const enviar = jest.fn();
  function Cenario() {
    const [form, set] = useState(inicial);
    return <><CompanyForm form={form} cnpjReadOnly onChange={(k,v)=>set(a=>({...a,[k]:v}))} onSubmit={e=>{e.preventDefault();enviar(form);}} submitLabel="Salvar" /><output data-testid="pessoas-editadas">{JSON.stringify(form)}</output></>;
  }
  const { container } = render(<Cenario />);
  expect(screen.getByLabelText('Nome do titular')).toHaveValue(titular.nome);
  expect(screen.getByRole('alert')).toHaveTextContent('remova apenas os vínculos de sócios que estiverem incorretos');
  expect(screen.getByText("Bia Sócia · 11144477735")).toBeInTheDocument();expect(screen.getByText("Caio Sócio · 12345678909")).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Adicionar sócio/})).toBeNull();expect(enviar).not.toHaveBeenCalled();
  expect(JSON.parse(screen.getByTestId('pessoas-editadas').textContent)).toMatchObject({titular,socios});
  fireEvent.submit(container.querySelector('form'));
  expect(enviar).toHaveBeenLastCalledWith(expect.objectContaining({titular,socios}));expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Remover vínculo de Bia Sócia'}));
  expect(JSON.parse(screen.getByTestId('pessoas-editadas').textContent)).toMatchObject({titular,socios:[socios[1]],inscricaoImobiliaria:'000AB'});
  expect(screen.getByRole('button',{name:'Remover vínculo de Caio Sócio'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Remover vínculo de Caio Sócio'}));
  expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByLabelText('Nome do titular')).toHaveValue(titular.nome);
  fireEvent.submit(container.querySelector('form'));
  expect(enviar).toHaveBeenLastCalledWith(expect.objectContaining({titular,socios:[],inscricaoImobiliaria:'000AB'}));
});
test('cadastro sem titular mantém editor de sócios disponível',()=>{
 const form={...getInitialCompanyFormState(),titular:null,socios:[]};
 render(<CompanyForm form={form} onChange={jest.fn()} onSubmit={e=>e.preventDefault()} submitLabel="Salvar" />);
 expect(screen.getByRole('button',{name:/Adicionar sócio/})).toBeInTheDocument();expect(screen.queryByLabelText('Nome do titular')).toBeNull();
});
