import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EmitirNfseWizard } from '../EmitirNfseWizard';

const cadastro = { cnpj: '39254243000191', inscricaoMunicipal: '123', codigoServicoNacional: '170601', codigoServicoMunicipal: '001', rpsSerie: '00001' };
const bruto = { cnpj: '24352609000198', razao_social: 'Tomador consultado', descricao_situacao_cadastral: 'ATIVA' };
function abrir(consultar) {
  const emitir = jest.fn();
  const api = {
    consultarTomadorNfse: consultar,
    getPerfisEmissao: jest.fn(async () => ({ integracaoLigada: false, perfis: [] })),
    previaEmissaoNfse: jest.fn(async () => ({ ok: true, pendencias: [], regimeVigente: { regime: 'SIMPLES' }, percentualSimples: { estado: 'REFERENCIA', valor: 6 } })),
  };
  render(<EmitirNfseWizard companyId="empresa" regime="SIMPLES" codigoMunicipioIbge="3304557" cadastroEmissao={cadastro} apiPerfis={api} onEmitir={emitir} onClose={() => {}} />);
  return { emitir, api };
}
const digitar = (id, valor) => fireEvent.change(document.getElementById(id), { target: { value: valor } });
function endereco() { fireEvent.click(screen.getByText('Endereço do tomador (opcional — mas só vale completo)')); }

it('consulta CNPJ pelo servidor do contador e permite tentar de novo após falha', async () => {
  const consultar = jest.fn().mockRejectedValueOnce(new Error('rede')).mockResolvedValue({ ok: true, bruto });
  const { emitir } = abrir(consultar);
  digitar('nfse-doc', bruto.cnpj);
  expect(await screen.findByText(/Consulta de CNPJ indisponível/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'consultar Receita' }));
  await waitFor(() => expect(document.getElementById('nfse-nome')).toHaveValue('Tomador consultado'));
  expect(consultar).toHaveBeenLastCalledWith('empresa', 'cnpj', bruto.cnpj);
  expect(emitir).not.toHaveBeenCalled();
});

it('resposta de CNPJ antigo não preenche outro tomador', async () => {
  let terminar;
  const consultar = jest.fn(() => new Promise(r => { terminar = r; }));
  abrir(consultar);
  digitar('nfse-doc', bruto.cnpj);
  digitar('nfse-doc', '12345678901');
  await act(async () => terminar({ ok: true, bruto }));
  expect(document.getElementById('nfse-nome')).toHaveValue('');
});

it('CEP preenche endereço parcial sem inventar número e preserva edição em andamento', async () => {
  let terminar;
  const consultar = jest.fn(() => new Promise(r => { terminar = r; }));
  const { emitir } = abrir(consultar);
  endereco();
  digitar('nfse-cep', '22770-010');
  fireEvent.click(screen.getByRole('button', { name: 'Consultar CEP' }));
  expect(screen.getByText('Consultando o CEP para completar o endereço do tomador…')).toBeInTheDocument();
  expect(screen.queryByText(/Complete o endereço do tomador/)).not.toBeInTheDocument();
  expect(screen.getByText('Continuar →').closest('button')).toBeDisabled();
  digitar('nfse-xlgr', 'Rua informada manualmente');
  await act(async () => terminar({ ok: true, endereco: { cMun: '3304557', xLgr: 'Rua do CEP', xBairro: 'Centro' } }));
  expect(document.getElementById('nfse-xlgr')).toHaveValue('Rua informada manualmente');
  expect(document.getElementById('nfse-xbairro')).toHaveValue('Centro');
  expect(document.getElementById('nfse-nro')).toHaveValue('');
  expect(consultar).toHaveBeenCalledWith('empresa', 'cep', '22770010');
  expect(emitir).not.toHaveBeenCalled();
});

it('ignora retorno de CEP que foi alterado e permite consultar o novo', async () => {
  let terminar;
  const consultar = jest.fn(() => new Promise(r => { terminar = r; }));
  abrir(consultar); endereco();
  digitar('nfse-cep', '22770010');
  fireEvent.click(screen.getByRole('button', { name: 'Consultar CEP' }));
  digitar('nfse-cep', '20040002');
  await act(async () => terminar({ ok: true, endereco: { xLgr: 'Endereço antigo' } }));
  expect(document.getElementById('nfse-xlgr')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Consultar CEP' })).toBeEnabled();
});

it('percentual manual não desaparece quando a prévia termina de carregar', async () => {
  const { api } = abrir(jest.fn(async () => ({ ok: false, mensagem: 'Manual' })));
  digitar('nfse-doc', '12345678901'); digitar('nfse-nome', 'Tomador');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar →' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Continuar →' }));
  digitar('nfse-valor', '1,00');
  digitar('nfse-ptottribsn', '6');
  await waitFor(() => expect(api.previaEmissaoNfse).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Conferindo histórico e regras da operação…')).not.toBeInTheDocument());
  expect(document.getElementById('nfse-ptottribsn')).toHaveValue('6');
});

it.each(['antes', 'durante', 'depois'])('CEP completo e número preenchido %s da consulta não acusa endereço incompleto', async momento => {
 let terminar; const consultar=jest.fn(()=>new Promise(r=>{terminar=r;})); abrir(consultar); endereco();
 digitar('nfse-cep','22770010');
 if(momento==='antes') digitar('nfse-nro','0');
 fireEvent.click(screen.getByRole('button',{name:'Consultar CEP'}));
 if(momento==='durante') digitar('nfse-nro','123');
 await act(async()=>terminar({ok:true,endereco:{cMun:'3304557',CEP:'22770010',xLgr:'Rua do CEP',xBairro:'Centro',nro:null}}));
 if(momento==='depois') digitar('nfse-nro','45');
 expect(document.getElementById('nfse-nro').value).toBe(momento==='antes'?'0':momento==='durante'?'123':'45');
 expect(screen.queryByText(/Complete o endereço do tomador/)).not.toBeInTheDocument();
 expect(screen.queryByText(/o endereço precisa estar completo/)).not.toBeInTheDocument();
 expect(document.getElementById('nfse-xlgr')).toHaveValue('Rua do CEP');expect(document.getElementById('nfse-xbairro')).toHaveValue('Centro');
});

it('troca de CEP limpa autopreenchimento antigo e preserva número e logradouro editado', async()=>{
 const consultar=jest.fn().mockResolvedValueOnce({ok:true,endereco:{cMun:'3304557',xLgr:'Rua Rio Branco',xBairro:'Centro'}}).mockResolvedValueOnce({ok:true,endereco:{cMun:'3550308',xLgr:'Rua São Paulo',xBairro:'Cambuci'}});
 abrir(consultar);endereco();digitar('nfse-cep','20040002');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Consultar CEP'})));
 digitar('nfse-nro','100');digitar('nfse-xlgr','Logradouro editado');digitar('nfse-cep','01551020');
 expect(document.getElementById('nfse-xbairro')).toHaveValue('');
 expect(document.getElementById('nfse-xlgr')).toHaveValue('Logradouro editado');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Consultar CEP'})));
 expect(consultar).toHaveBeenLastCalledWith('empresa','cep','01551020');
 expect(document.getElementById('nfse-xbairro')).toHaveValue('Cambuci');expect(document.getElementById('nfse-nro')).toHaveValue('100');
 expect(screen.queryByText(/Complete o endereço do tomador/)).not.toBeInTheDocument();
});
