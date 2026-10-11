import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
jest.mock('../../../api/client', () => ({ createApiClient: () => ({}) }));
import { CadastroReforma } from '../CadastroReforma';
import { PainelCarteiraReforma } from '../PainelCarteiraReforma';
import { VerificadorNfse } from '../VerificadorNfse';
import { criarReformaFiscalMock } from '../../../api/mock/reformaFiscalMock';
const empresas = [{ companyId: 'a', razao: 'Empresa de teste', cnpj: '11111111000111' }];
const abrir = (container, texto) => {
  const details = screen.getByText(texto).closest('details');
  details.open = true; fireEvent(details, new Event('toggle'));
};
test('salva revisão, mostra histórico e mantém dados no mock entre telas', async () => {
  const api = criarReformaFiscalMock(empresas);
  const salvar = jest.spyOn(api, 'salvarCadastroReforma');
  render(<CadastroReforma companyId="a" api={api} />);
  await screen.findByText('Nenhum período informado. O regime atual da ficha não comprova o histórico.');
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar período' }));
  fireEvent.change(screen.getByLabelText('Início da vigência'), { target: { value: '2027-01-01' } });
  fireEvent.change(screen.getByLabelText('Motivo da revisão'), { target: { value: 'Escolha em estudo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar revisão' }));
  await screen.findByText('Revisão registrada no histórico.');
  expect(salvar).toHaveBeenCalledTimes(1);
  const r = await api.getCadastroReforma('a');
  expect(r.versao).toBe(1); expect(r.historico).toHaveLength(1);
  expect((await api.getCarteiraReforma('2027-01')).empresas[0]).toMatchObject({ situacao: 'EM_ESTUDO', pendente: true });
});
test('erro de gravação conserva o rascunho e não anuncia sucesso', async () => {
  const api = criarReformaFiscalMock(empresas); api.salvarCadastroReforma = jest.fn().mockRejectedValue(new Error('Conflito de versão'));
  render(<CadastroReforma companyId="a" api={api} />);
  await screen.findByLabelText('Motivo da revisão');
  fireEvent.change(screen.getByLabelText('Motivo da revisão'), { target: { value: 'Revisão preservada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar revisão' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Motivo da revisão')).toHaveValue('Revisão preservada');
  expect(screen.queryByText('Revisão registrada no histórico.')).not.toBeInTheDocument();
});
test('STAFF vê cadastro sem poder editar', async () => {
  const api = criarReformaFiscalMock(empresas), ler = api.getCadastroReforma;
  api.getCadastroReforma = async id => ({ ...await ler(id), podeEditar: false });
  render(<CadastroReforma companyId="a" api={api} />);
  expect(await screen.findByLabelText('Motivo da revisão')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Registrar revisão' })).not.toBeInTheDocument();
  expect(screen.queryByText('Preparação da apuração IBS/CBS')).not.toBeInTheDocument();
});
test('carteira carrega somente ao abrir e mostra ausência de cadastro', async () => {
  const api = criarReformaFiscalMock(empresas); jest.spyOn(api, 'getCarteiraReforma');
  const { container } = render(<PainelCarteiraReforma competencia="2027-01" api={api} />);
  expect(api.getCarteiraReforma).not.toHaveBeenCalled();
  abrir(container, 'Reforma tributária · carteira');
  await screen.findByText('Sem vigência cadastrada');
  expect(screen.getByRole('link', { name: 'Conferir cadastro' })).toHaveAttribute('href', '/companies/a/perfil-fiscal');
});
test('erro de carga não vira carteira vazia ou regular', async () => {
  const api = { getCarteiraReforma: jest.fn().mockRejectedValue(new Error('Sem conexão')) };
  const { container } = render(<PainelCarteiraReforma competencia="2027-01" api={api} />);
  abrir(container, 'Reforma tributária · carteira');
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
  expect(screen.queryByText('Nenhuma empresa encontrada neste filtro.')).not.toBeInTheDocument();
});
test('verificador preserva diferença entre resultado antigo e nova execução falha', async () => {
  const v = { createdAt: '2026-10-10T12:00:00Z', cadastroVersao: 1, versaoRegras: 'teste', resumo: { total: 1, verificadas: 1, erros: 1, revisao: 0, semAchados: 0, excluidas: 0 },
    itens: [{ id: 'nota-a', numero: '10', status: 'ERRO', papel: 'EMIT', achados: [{ codigo: 'XML_AUSENTE', mensagem: 'XML ausente', providencia: 'Importar XML.' }] }] };
  const api = { getVerificacaoNfse: jest.fn().mockResolvedValue({ ok: true, verificacao: v, desatualizada: true }), verificarNfseReforma: jest.fn().mockRejectedValue(new Error('Não concluída')) };
  const abrirNota = jest.fn();
  const { container } = render(<VerificadorNfse api={api} companyId="a" competencia="2026-10" onAbrirNota={abrirNota} />);
  abrir(container, 'Verificar conformidade de NFS-e · 2026-10');
  await screen.findByText('XML ausente');
  expect(screen.getByText(/Esta conferência está desatualizada/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir nota' })); expect(abrirNota).toHaveBeenCalledWith('nota-a');
  fireEvent.click(screen.getByRole('button', { name: 'Verificar notas armazenadas' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não concluída');
  expect(screen.getByText('XML ausente')).toBeInTheDocument();
});
test('troca de empresa ignora resposta atrasada do cadastro anterior', async () => {
  let resolver;
  const api = { getCadastroReforma: jest.fn(id => id === 'a' ? new Promise(r => { resolver = r; }) : Promise.resolve({ ok: true, versao: 0, dados: { periodos: [], emissor: 'NAO_VERIFICADO', evidenciaEmissor: '' }, historico: [], podeEditar: true })) };
  const { rerender } = render(<CadastroReforma api={api} companyId="a" />);
  rerender(<CadastroReforma api={api} companyId="b" />);
  await screen.findByLabelText('Motivo da revisão');
  resolver({ ok: true, versao: 99, dados: { periodos: [], emissor: 'VALIDADO', evidenciaEmissor: 'Outra empresa' }, historico: [] });
  await waitFor(() => expect(screen.getByText('Revisão atual: 0')).toBeInTheDocument());
  expect(screen.queryByText('Outra empresa')).not.toBeInTheDocument();
});
