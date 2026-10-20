import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { OnboardingDetailPage } from '../../pages/renderOnboardingDetailPage';
import { OnboardingsPage } from '../../pages/renderOnboardingsPage';
import { ComercialPage } from '../../../comercial/ComercialPage';
import { MemoryRouter } from 'react-router-dom';
jest.mock('../../../whatsapp/pages/renderWhatsappPage', () => ({ WhatsappPage: () => null }));
jest.mock('../PainelComercial', () => ({
  PainelComercial: ({ onAtualizar }) => <><label>Proposta em edição<input defaultValue="Rascunho local" /></label>
    <button onClick={() => onAtualizar({ origem: 'polling' })}>Simular polling</button></>,
}));
jest.mock('../../pages/renderOnboardingWizardPage', () => ({
  OnboardingWizardPage: ({ onAbrirDetalhe }) => <button onClick={onAbrirDetalhe}>Continuar atendimento</button>,
}));
jest.mock('../NovaDemanda', () => ({ NovaDemanda: () => null }));
const ficha = { id: 'ficticia', versao: 2, origem: 'ABERTURA', status: 'RASCUNHO', responsavelNome: 'Contato sintético', dados: {}, etapas: [] };
function montar(extra = {}) {
  const api = { getOnboarding: jest.fn().mockResolvedValue({ ok: true, onboarding: ficha }),
    getOnboardingComercial: jest.fn(),
    getElegibilidadeDescarteOnboarding: jest.fn().mockResolvedValue({ ok: true, elegibilidade: {
      id: ficha.id, versao: 2, podeExcluir: false, podeEncerrar: true, impedimentos: ['Histórico do atendimento'],
    } }),
    desistirOnboarding: jest.fn().mockResolvedValue({ ok: true, onboarding: { ...ficha, versao: 3, status: 'DESISTIU' } }),
    ...extra };
  render(<OnboardingDetailPage api={api} onboardingId={ficha.id} onVoltar={jest.fn()} />);
  return api;
}
async function encerrar() {
  fireEvent.click(await screen.findByLabelText('Ações de Contato sintético'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar desistência' }));
}
test('recusa é visível no detalhe fora da edição e mantém oportunidade', async () => {
  montar({ desistirOnboarding: jest.fn().mockRejectedValue(new Error('Sem permissão para encerrar')) });
  await encerrar();
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão para encerrar');
  expect(screen.getByRole('button', { name: 'Conferir novamente' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Editar ficha' })).toBeInTheDocument();
});
test('confirmação invalida atualização antiga, preserva rascunho comercial e mostra falha de releitura', async () => {
  let resolverAntiga;
  const api = montar();
  const rascunho = await screen.findByLabelText('Proposta em edição');
  fireEvent.change(rascunho, { target: { value: 'Texto não salvo' } });
  api.getOnboarding.mockImplementationOnce(() => new Promise(r => { resolverAntiga = r; }))
    .mockRejectedValueOnce(new Error('Leitura indisponível'));
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar ficha' }));
  await encerrar();
  expect(await screen.findByRole('alert')).toHaveTextContent('A ação foi salva');
  expect(screen.getByText(/Ficha: Desistiu/)).toBeVisible();
  await act(async () => { resolverAntiga({ ok: true, onboarding: ficha }); });
  expect(screen.getByText(/Ficha: Desistiu/)).toBeVisible();
  expect(screen.queryByLabelText('Ações de Contato sintético')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Atualizar ficha' })).toHaveFocus();
  expect(screen.getByLabelText('Proposta em edição')).toBe(rascunho);
  expect(rascunho).toHaveValue('Texto não salvo');
  expect(screen.getByRole('button', { name: 'Atualizar ficha' })).toBeEnabled();
});

test('cancelar no detalhe devolve foco ao gatilho preservado', async () => {
  montar();
  fireEvent.click(await screen.findByLabelText('Ações de Contato sintético'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByLabelText('Ações de Contato sintético')).toHaveFocus();
});

test.each([
  ['encerrar', 'ficha', 'sucesso'], ['encerrar', 'ficha', 'erro'],
  ['excluir', 'ficha', 'sucesso'], ['excluir', 'ficha', 'erro'],
  ['encerrar', 'rota', 'sucesso'], ['encerrar', 'rota', 'erro'],
  ['excluir', 'rota', 'sucesso'], ['excluir', 'rota', 'erro'],
])('%s pendente: troca de %s preserva foco e tela após %s antigo', async (acao, destino, resultado) => {
  let resolver, rejeitar;
  const outra = { ...ficha, id: 'outra-ficticia', responsavelNome: 'Outro contato sintético' };
  const mutacao = jest.fn(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject; }));
  const onVoltar = jest.fn();
  const api = {
    getOnboarding: jest.fn(id => Promise.resolve({ ok: true, onboarding: id === ficha.id ? ficha : outra })),
    getOnboardingComercial: jest.fn(),
    listarOnboardings: jest.fn().mockResolvedValue({ ok: true, itens: [] }),
    getElegibilidadeDescarteOnboarding: jest.fn().mockResolvedValue({ ok: true, elegibilidade: {
      id: ficha.id, versao: 2, podeExcluir: true, podeEncerrar: true, impedimentos: [],
    } }),
    desistirOnboarding: mutacao, descartarOnboarding: mutacao,
  };
  const { rerender } = render(<OnboardingDetailPage api={api} onboardingId={ficha.id} onVoltar={onVoltar} />);
  fireEvent.click(await screen.findByLabelText('Ações de Contato sintético'));
  fireEvent.click(screen.getByRole('menuitem', { name: acao === 'excluir' ? 'Excluir rascunho' : 'Encerrar oportunidade' }));
  const confirmar = screen.getByRole('button', { name: acao === 'excluir' ? 'Excluir rascunho' : 'Confirmar desistência' });
  await waitFor(() => expect(confirmar).toBeEnabled());
  fireEvent.click(confirmar);
  expect(mutacao).toHaveBeenCalledTimes(1);
  if (destino === 'ficha') {
    rerender(<OnboardingDetailPage api={api} onboardingId={outra.id} onVoltar={onVoltar} />);
    await screen.findByText(outra.responsavelNome, { exact: true, selector: 'strong.page-shell__title' });
  } else {
    rerender(<><OnboardingsPage api={api} /><label>Anotação da nova rota<input /></label></>);
    await screen.findByLabelText('Buscar atendimento');
  }
  const controleAtual = screen.getByLabelText(destino === 'ficha' ? 'Proposta em edição' : 'Anotação da nova rota');
  fireEvent.change(controleAtual, { target: { value: 'Texto do contexto atual' } });
  controleAtual.focus();
  const leituras = api.getOnboarding.mock.calls.length;
  await act(async () => {
    if (resultado === 'sucesso') resolver(acao === 'excluir' ? { ok: true }
      : { ok: true, onboarding: { ...ficha, status: 'DESISTIU', versao: 3 } });
    else rejeitar(new Error('Falha da oportunidade anterior'));
  });
  expect(controleAtual).toHaveFocus();
  expect(controleAtual).toHaveValue('Texto do contexto atual');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText(/Ficha: Desistiu/)).not.toBeInTheDocument();
  expect(onVoltar).not.toHaveBeenCalled();
  expect(api.getOnboarding).toHaveBeenCalledTimes(leituras);
  expect(mutacao).toHaveBeenCalledTimes(1);
});

test.each(['onboarding', 'comercial'])('exclusão no detalhe leva foco à lista %s mesmo durante carga', async destino => {
  const api = {
    getOnboarding: jest.fn().mockResolvedValue({ ok: true, onboarding: ficha }),
    listarOnboardings: jest.fn().mockImplementation(() => new Promise(() => {})),
    getElegibilidadeDescarteOnboarding: jest.fn().mockResolvedValue({ ok: true, elegibilidade: {
      id: ficha.id, versao: 2, podeExcluir: true, podeEncerrar: true, impedimentos: [],
    } }),
    descartarOnboarding: jest.fn().mockResolvedValue({ ok: true }),
  };
  function Fluxo() {
    const [detalhe, setDetalhe] = useState(true);
    return detalhe
      ? <OnboardingDetailPage api={api} onboardingId={ficha.id} onVoltar={() => setDetalhe(false)} />
      : destino === 'onboarding' ? <OnboardingsPage api={api} />
        : <ComercialPage api={api} />;
  }
  render(<MemoryRouter initialEntries={['/comercial/oportunidades']}><Fluxo /></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('Ações de Contato sintético'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Excluir rascunho' }));
  const confirmar = screen.getByRole('button', { name: 'Excluir rascunho' });
  await waitFor(() => expect(confirmar).toBeEnabled());
  fireEvent.click(confirmar);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(destino === 'onboarding' ? screen.getByLabelText('Buscar atendimento')
    : screen.getByRole('link', { name: 'Oportunidades' })).toHaveFocus();
  expect(api.descartarOnboarding).toHaveBeenCalledWith(ficha.id, 2);
});

test('polling durante atualização manual descarta leitura antiga e libera ocupação', async () => {
  let resolverManual;
  const api = montar();
  await screen.findByLabelText('Proposta em edição');
  api.getOnboarding.mockImplementationOnce(() => new Promise(r => { resolverManual = r; }))
    .mockResolvedValueOnce({ onboarding: { ...ficha, versao: 3, status: 'RECEBIDO' } });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar ficha' }));
  expect(screen.getByRole('button', { name: 'Atualizar ficha' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Simular polling' }));
  await screen.findByText(/Ficha: Recebido/);
  await act(async () => { resolverManual({ onboarding: ficha }); });
  expect(screen.getByText(/Ficha: Recebido/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Atualizar ficha' })).toBeEnabled();
  expect(screen.queryByText('Ficha atualizada com os dados salvos pelo cliente.')).not.toBeInTheDocument();
});

test('continuação antiga não substitui desistência confirmada', async () => {
  let resolverContinuacao;
  const api = montar();
  fireEvent.click(await screen.findByRole('button', { name: 'Editar ficha' }));
  api.getOnboarding.mockImplementationOnce(() => new Promise(r => { resolverContinuacao = r; }))
    .mockResolvedValueOnce({ onboarding: ficha });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar atendimento' }));
  // Uma continuação mais recente conclui a edição enquanto a primeira ainda aguarda.
  fireEvent.click(screen.getByRole('button', { name: 'Continuar atendimento' }));
  await screen.findByRole('button', { name: 'Editar ficha' });
  api.getOnboarding.mockResolvedValue({ onboarding: { ...ficha, versao: 3, status: 'DESISTIU' } });
  await encerrar();
  await screen.findByText(/Ficha: Desistiu/);
  await act(async () => { resolverContinuacao({ onboarding: ficha }); });
  expect(screen.getByText(/Ficha: Desistiu/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Editar ficha' })).not.toBeInTheDocument();
});

test.each(['sucesso', 'erro'])('continuação de outra ficha ignora %s tardio', async resultado => {
  let resolver, rejeitar;
  const outra = { ...ficha, id: 'outra-ficticia', responsavelNome: 'Outro contato sintético' };
  const api = { getOnboarding: jest.fn().mockResolvedValue({ onboarding: ficha }) };
  const { rerender } = render(<OnboardingDetailPage api={api} onboardingId={ficha.id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Editar ficha' }));
  api.getOnboarding.mockImplementationOnce(() => new Promise((resolve, reject) => { resolver = resolve; rejeitar = reject; }))
    .mockResolvedValue({ onboarding: outra });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar atendimento' }));
  rerender(<OnboardingDetailPage api={api} onboardingId={outra.id} />);
  await screen.findByText(outra.responsavelNome, { exact: true, selector: 'strong.page-shell__title' });
  await act(async () => {
    if (resultado === 'sucesso') resolver({ onboarding: ficha });
    else rejeitar(new Error('Falha da ficha anterior'));
  });
  expect(screen.getByText(outra.responsavelNome, { exact: true, selector: 'strong.page-shell__title' })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('continuação recusa revisão inferior sem sair da edição', async () => {
  const api = montar();
  fireEvent.click(await screen.findByRole('button', { name: 'Editar ficha' }));
  api.getOnboarding.mockResolvedValue({ onboarding: { ...ficha, versao: 1 } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continuar atendimento' })); });
  expect(screen.getByRole('button', { name: 'Continuar atendimento' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Editar ficha' })).not.toBeInTheDocument();
});

test('releitura legada preserva rascunho sem fabricar versão para confirmação', async () => {
  const legada = { ...ficha, versao: undefined };
  const api = montar({
    getOnboarding: jest.fn().mockResolvedValue({ onboarding: legada }),
    getElegibilidadeDescarteOnboarding: jest.fn().mockResolvedValue({ ok: true, elegibilidade: {
      id: ficha.id, podeExcluir: true, podeEncerrar: true, impedimentos: [],
    } }),
  });
  const rascunho = await screen.findByLabelText('Proposta em edição');
  fireEvent.change(rascunho, { target: { value: 'Proposta não salva' } });
  api.getOnboarding.mockResolvedValue({ onboarding: { ...legada, status: 'RECEBIDO' } });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar ficha' }));
  await screen.findByText('Ficha atualizada com os dados salvos pelo cliente.');
  expect(screen.getByText(/Ficha: Recebido/)).toBeVisible();
  expect(rascunho).toHaveValue('Proposta não salva');
  fireEvent.click(screen.getByLabelText('Ações de Contato sintético'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Encerrar oportunidade' }));
  await screen.findByText('Não foi possível conferir a oportunidade.');
  expect(screen.getByRole('button', { name: 'Confirmar desistência' })).toBeDisabled();
  expect(api.desistirOnboarding).not.toHaveBeenCalled();
});

test.each([
  undefined,
  { ok: false, onboarding: { ...ficha, versao: 3 } },
  { onboarding: { ...ficha, id: 'outro-id', versao: 3 } },
  { onboarding: { ...ficha, versao: undefined, status: 'DESISTIU' } },
])('releitura inválida não substitui ficha versionada nem anuncia sucesso: %p', async resposta => {
  const api = montar();
  await screen.findByLabelText('Proposta em edição');
  api.getOnboarding.mockResolvedValue(resposta);
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar ficha' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Resposta sem/);
  expect(screen.getByRole('button', { name: 'Editar ficha' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Atualizar ficha' })).toBeEnabled();
  expect(screen.queryByText('Ficha atualizada com os dados salvos pelo cliente.')).not.toBeInTheDocument();
});
