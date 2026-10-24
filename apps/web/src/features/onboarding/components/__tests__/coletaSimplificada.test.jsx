import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CampoOnboarding } from '../CampoOnboarding';
import { camposDoPasso, podarInvisiveis, rascunhoVazio, combinarColetaPublica, CAMPOS_INTERNOS } from '@contabilidade/shared/onboarding';
import { validarDadosOnboarding, proximaPerguntaOnboarding } from '@contabilidade/shared/onboarding-dados';
import { useConsultaCnpjOnboarding } from '../../hooks/useConsultaCnpjOnboarding';

const pessoa = { nome: 'Ana Teste', cpf: '52998224725' };
function Pessoas({ inicial = rascunhoVazio('ABERTURA') }) {
  const [dados, setDados] = useState(inicial);
  const cnpj = useConsultaCnpjOnboarding({ contexto: 'teste', origem: 'ABERTURA', dados, habilitado: false, alterarCampo: (k, v) => setDados(a => ({ ...a, [k]: v, ...(k === 'socios' ? { cartoesPessoas: Math.max(1, v.length) } : {}) })) });
  return <>{camposDoPasso('ABERTURA', 'identificacao', dados).filter(d => ['socios', 'titular'].includes(d.campo)).map(d =>
    <CampoOnboarding key={d.campo} descritor={d} dados={dados} valor={dados[d.campo]} onAdequarPessoas={cnpj.adequarPessoas} onChange={v => setDados(a => ({ ...a, [d.campo]: v, ...(d.campo === 'socios' ? { cartoesPessoas: Math.max(1, v.length) } : {}) }))} />)}
    <button onClick={() => setDados(podarInvisiveis('ABERTURA', dados))}>Salvar e reler</button><output aria-label="Dados coletados">{JSON.stringify(dados)}</output></>;
}
test('dois cartões novos, adicionar terceiro, remover e recarregar conservando um', () => {
  render(<Pessoas />);
  expect(screen.getByText('Sócio 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '+ Adicionar sócio' }));
  expect(screen.getByText('Sócio 3')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remover sócio 3' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remover sócio 2' }));
  fireEvent.click(screen.getByText('Salvar e reler'));
  expect(screen.queryByText('Sócio 2')).toBeNull();
  expect(screen.getByRole('button', { name: 'Remover sócio 1' }).disabled).toBe(true);
});
test.each(['MEI', 'EI'])('%s tem titular e não tem quadro societário vazio', tipoEmpresa => {
  render(<Pessoas inicial={{ tipoEmpresa }} />);
  expect(screen.getAllByText('Titular').length).toBeGreaterThan(0);
  expect(screen.queryByText('Sócio 1')).toBeNull();
  expect(screen.queryByRole('button', { name: '+ Adicionar sócio' })).toBeNull();
});
test('lista existente não recebe segundo cartão', () => {
  render(<Pessoas inicial={{ socios: [pessoa] }} />);
  expect(screen.queryByText('Sócio 2')).toBeNull();
});
test('rascunho parcial permitido, conclusão exige CPF válido; vazio extra não é pessoa', () => {
  expect(validarDadosOnboarding('ABERTURA', { socios: [{ nome: 'Ana', cpf: '529' }] }).ok).toBe(true);
  expect(validarDadosOnboarding('ABERTURA', { socios: [{ nome: 'Ana', cpf: '11111111111' }] }, { finalizar: true }).ok).toBe(false);
  const r = validarDadosOnboarding('ABERTURA', { socios: [pessoa, {}] }, { finalizar: true });
  expect(r.ok).toBe(true); expect(r.dados.socios).toEqual([pessoa]);
  expect(validarDadosOnboarding('ABERTURA', { socios: [pessoa, { nome: 'Bia' }] }, { finalizar: true }).ok).toBe(false);
  expect(validarDadosOnboarding('PESSOA_FISICA', {}, { finalizar: true }).ok).toBe(true);
});
test('mudança de tipo preserva e sinaliza conflito', () => {
  const dados = podarInvisiveis('ABERTURA', { tipoEmpresa: 'MEI', socios: [pessoa] });
  expect(dados.socios).toEqual([pessoa]);
  expect(validarDadosOnboarding('ABERTURA', dados, { finalizar: true }).erros.titular).toMatch(/preservadas/);
});

test('adequação explícita transfere uma pessoa e conserva as demais até resolução', () => {
  const outra = { nome: 'Bia Teste', cpf: '11144477735' };
  render(<Pessoas inicial={{ tipoEmpresa: 'MEI', socios: [pessoa, outra] }} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Usar como titular' })[0]);
  const dados = JSON.parse(screen.getByRole('status', { name: 'Dados coletados' }).textContent);
  expect(dados.titular).toEqual([pessoa]); expect(dados.socios).toEqual([outra]);
  expect(screen.getByRole('button', { name: 'Usar como titular' })).toBeDisabled();
  expect(validarDadosOnboarding('ABERTURA', dados, { finalizar: true }).ok).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Remover sócio 1' }));
  fireEvent.click(screen.getByText('Salvar e reler'));
  expect(validarDadosOnboarding('ABERTURA', JSON.parse(screen.getByRole('status', { name: 'Dados coletados' }).textContent), { finalizar: true }).ok).toBe(true);
});

test('titular volta para sócios sem perder identidade ou participação anterior', () => {
  render(<Pessoas inicial={{ tipoEmpresa: 'LTDA', titular: [{ ...pessoa, participacao: '100' }] }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Usar como sócio' }));
  expect(JSON.parse(screen.getByRole('status', { name: 'Dados coletados' }).textContent)).toMatchObject({ titular: [], socios: [{ ...pessoa, participacao: '100' }] });
});
test.each(['ABERTURA', 'TRANSFERENCIA', 'INATIVA'])('coleta %s não expõe perguntas internas nem aceita sobrescrita forjada', origem => {
  const visiveis = ['identificacao', 'responsavel', 'situacao'].flatMap(p => camposDoPasso(origem, p, {}));
  expect(visiveis.some(d => CAMPOS_INTERNOS.includes(d.campo))).toBe(false);
  const atual = { modalidadeServico: 'AVULSO', notasRecebidasMes: 22, regimeAtual: 'SIMPLES' };
  const combinado = combinarColetaPublica(origem, atual, { modalidadeServico: 'RECORRENTE', notasRecebidasMes: 0, regimeAtual: '', responsavelNome: 'Ana' });
  expect(combinado).toMatchObject({ ...atual, responsavelNome: 'Ana' });
  expect(CAMPOS_INTERNOS).not.toContain(proximaPerguntaOnboarding({ origem, dados: {} }).campo);
});
test('endereço estruturado conserva cadastro alfanumérico do IPTU, ausência e legado', () => {
  const dados = { enderecoPretendido: 'Ao lado da praça', enderecoAbertura: { rua: 'Rua A', cidade: 'Recife', uf: 'PE', inscricaoImobiliaria: '000A-12', semNumero: true, iptuDesconhecido: false } };
  expect(validarDadosOnboarding('ABERTURA', dados).dados).toMatchObject(dados);
  const descritor = camposDoPasso('ABERTURA', 'situacao', dados).find(d => d.campo === 'enderecoAbertura');
  render(<CampoOnboarding descritor={descritor} dados={dados} valor={dados.enderecoAbertura} onChange={jest.fn()} />);
  expect(screen.getByLabelText('Inscrição imobiliária / número do cadastro do IPTU').value).toBe('000A-12');
  expect(screen.getByText(/Ao lado da praça/)).toBeTruthy();
  expect(screen.getByLabelText('Não tenho essa informação agora')).toBeTruthy();
});

test('grupos e campos anunciam o erro associado, com identificação antes das pessoas', () => {
  const dados = { tipoEmpresa: 'MEI', titular: [{ nome: 'Ana', cpf: '111' }] };
  const campos = camposDoPasso('ABERTURA', 'identificacao', dados);
  expect(campos.findIndex(c => c.campo === 'razaoSocial')).toBeLessThan(campos.findIndex(c => c.campo === 'titular'));
  expect(campos.findIndex(c => c.campo === 'tipoEmpresa')).toBeLessThan(campos.findIndex(c => c.campo === 'titular'));
  render(<CampoOnboarding descritor={campos.find(c => c.campo === 'titular')} dados={dados} valor={dados.titular} erro="Confira nome e CPF do titular." onChange={jest.fn()} />);
  expect(screen.getByRole('group', { name: 'Titular' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Titular — CPF (linha 1)')).toHaveAttribute('aria-describedby', 'onb-titular-erro');
  expect(screen.getByText('Confira nome e CPF do titular.')).toHaveAttribute('id', 'onb-titular-erro');
});
