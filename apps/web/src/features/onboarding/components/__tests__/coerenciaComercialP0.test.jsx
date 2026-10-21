import { AtendimentoComercial } from '../../../whatsapp/components/AtendimentoComercial';
import { waitFor, render, screen } from '@testing-library/react';
import { CardEtapa } from '../ChecklistEtapas';
import { etapaDaOportunidade, nomeDaOportunidade, resumoRetorno } from '../../../comercial/comercialModel';
import { montarJornada } from '../../lib/jornadaComercial';

test('a projeção do servidor prevalece integralmente sobre dados e anotações locais', () => {
  const projecao = { atual: 'fiscal', passos: [{ id: 'fiscal', concluido: false }] };
  const jornada = montarJornada({ onboarding: {}, jornada: { projecao } });
  expect(jornada).toEqual({ ...projecao, nome: 'Atendimento', abertura: false, pessoaFisica: false });
  expect(jornada.passos).toBe(projecao.passos);
  expect(etapaDaOportunidade({ status: 'EM_TRILHA', faseComercial: 'CONTRATADO', comercial: projecao })).toBe('ANALISE');
  expect(nomeDaOportunidade({ id: 'ficha-123456', razaoSocial: '  ' })).toBe('Atendimento 123456');
});
test('retorno mostra atribuição persistida ou ausência, sem inventar equipe', () => {
  expect(resumoRetorno({ dados: { acao: 'Conferir', responsavelNome: 'Ana' } })).toContain('Ana');
  expect(resumoRetorno({ dados: {} })).toBe('Ação não informada · Data não informada · Responsável não informado');
});
test('SITFIS aproveitado não pede segunda marcação e procuração não conclui acessos', () => {
  const { rerender } = render(<CardEtapa etapa={{ id: 's', titulo: 'SITFIS', chave: 'sitfis', evidencias: [{ id: 'a', chave: 'sitfis', satisfaz: true, escopo: 'Relatório conferido', origem: 'Diagnóstico' }] }} />);
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByText('Concluída pela evidência do diagnóstico.')).toBeVisible();
  rerender(<CardEtapa etapa={{ id: 'p', titulo: 'Acessos', chave: 'procuracao_ecac', evidencias: [{ id: 'a', chave: 'procuracao_ecac', satisfaz: false, escopo: 'Somente SITFIS' }] }} />);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('checkbox')).toBeEnabled();
});

import { fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingDetailPage } from '../../pages/renderOnboardingDetailPage';
import { FluxoComercial } from '../FluxoComercial';
import { OnboardingsPage } from '../../pages/renderOnboardingsPage';
import { within } from '@testing-library/react';

test('mock real mantém a mesma jornada na lista, ficha e conversa após salvar e recarregar', async () => {
  const { createMockApi } = require('../../../../api/mock/mockApi');
  const api = createMockApi();
  const { onboarding: criada } = await api.criarOnboarding('ABERTURA');
  const id = criada.id;
  async function conferirSuperficies(titulo) {
    const { itens } = await api.listarOnboardings({ incluirRascunhos: true });
    const item = itens.find(o => o.id === id);
    const { onboarding: ficha } = await api.getOnboarding(id);
    const conversa = await api.comercial(`/onboardings/${id}`);
    expect(ficha.comercial).toEqual(item.comercial);
    expect(ficha.comercial).toEqual({ atual: conversa.jornada.projecao.atual, titulo, contratacao: conversa.jornada.projecao.contratacao });
    expect(conversa.jornada.projecao.passos.find(p => p.id === ficha.comercial.atual).titulo).toBe(titulo);
    const lista = render(<OnboardingsPage api={api} />);
    try {
      const cartao = (await screen.findByRole('button', { name: nomeDaOportunidade(item) })).closest('article');
      expect(within(cartao).getByText(`Jornada: ${titulo}`)).toBeVisible();
    } finally { lista.unmount(); }
    const detalhe = render(<MemoryRouter><OnboardingDetailPage api={api} onboardingId={id} /></MemoryRouter>);
    try {
      expect(await screen.findByLabelText('Etapa comercial')).toHaveTextContent(titulo);
      expect(screen.queryByText('Jornada: Indisponível')).not.toBeInTheDocument();
    } finally { detalhe.unmount(); }
    const chat = render(<MemoryRouter><FluxoComercial api={api} onboardingId={id} /></MemoryRouter>);
    try {
      expect(await screen.findByRole('heading', { level: 4, name: titulo })).toBeVisible();
    } finally { chat.unmount(); }
    return ficha;
  }
  expect(criada.comercial.titulo).toBe('Entender a abertura');
  await conferirSuperficies('Entender a abertura');
  const { onboarding: salva } = await api.salvarOnboarding(id, {
    finalizar: true, dados: { responsavelNome: `Pessoa fictícia ${id}` },
  });
  expect(salva.comercial).toEqual(criada.comercial);
  await api.salvarOnboardingComercial(id, { faseComercial: 'CONTRATADO', proposta: { texto: 'Anotação legada sem aceite' } });
  const { onboarding: tarefaSalva } = await api.salvarEtapaOnboarding(id, salva.etapas[0].id, { concluida: true });
  expect(tarefaSalva.status).toBe('EM_TRILHA');
  expect(tarefaSalva.comercial).toEqual(criada.comercial);
  // A classificação manual e o checklist não aceitam uma proposta nem avançam a jornada.
  const atual = await conferirSuperficies('Entender a abertura');
  await api.comercial(`/onboardings/${id}/campos`, { versao: atual.versao, operacoes: [
    { acao: 'set', campo: 'atividadePretendida', valor: 'Serviço fictício' },
    { acao: 'set', campo: 'municipioPretendido', valor: 'Município fictício' },
    { acao: 'set', campo: 'enderecoPretendido', valor: 'Rua fictícia, 123' },
  ] });
  const recarregada = await conferirSuperficies('Conferir viabilidade e escopo');
  expect(recarregada.versao).toBe(atual.versao + 1);
  expect(recarregada.proposta.texto).toBe('Anotação legada sem aceite');
  expect(recarregada.etapas[0].concluidaEm).toBeTruthy();
}, 15000);

function painel(ficha) {
  return { onboarding: ficha, propostas: [], contratos: [], documentos: [], trabalhos: [], marcos: [], jornada: { projecao: {
    atual: 'cadastro', nome: 'Pessoa física', pessoaFisica: true, encerrado: false,
    passos: [{ id: 'cadastro', titulo: 'Pessoa e serviço', acessivel: true, concluido: false, pendencias: [] }], pendencias: [],
  } } };
}
const fichaPF = () => ({ id: 'pessoa-123456', origem: 'PESSOA_FISICA', status: 'RECEBIDO', versao: 1, responsavelNome: 'Nome inicial', dados: { responsavelNome: 'Nome inicial', servicoSolicitado: 'Serviço fictício' }, etapas: [] });

test('ação no filho atualiza a ficha pai sem apagar anotações legadas em edição', async () => {
  let ficha = fichaPF();
  const api = {
    getOnboarding: jest.fn(async () => ({ onboarding: JSON.parse(JSON.stringify(ficha)) })),
    getOnboardingComercial: jest.fn(async () => ({ links: [], eventos: [], analises: [], proposta: {} })),
    comercial: jest.fn(async (path, body) => {
      if (path === '/recursos') return { recursos: [] };
      if (path.endsWith('/acompanhamento')) return { versao: ficha.versao };
      if (body) { ficha = { ...ficha, versao: 2, responsavelNome: body.operacoes[0].valor, dados: { ...ficha.dados, responsavelNome: body.operacoes[0].valor } }; return { onboarding: ficha }; }
      return painel(JSON.parse(JSON.stringify(ficha)));
    }),
  };
  const { container } = render(<MemoryRouter><OnboardingDetailPage api={api} onboardingId={ficha.id} /></MemoryRouter>);
  await screen.findByRole('button', { name: 'Salvar dados deste passo' });
  expect(screen.getByRole('region', { name: 'Anotações' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Anotações' }), { target: { value: 'Rascunho preservado' } });
  fireEvent.change(container.querySelector('.lead-step-fields input[id$="-responsavelNome"]'), { target: { value: 'Nome salvo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar dados deste passo' }));
  expect(await screen.findByText('Nome salvo', { selector: '.page-shell__title' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Anotações' })).toHaveValue('Rascunho preservado');
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

test('salvar outra tarefa conserva prova SITFIS e rascunho de observação quando GET falha', async () => {
  const ficha = { ...fichaPF(), origem: 'TRANSFERENCIA', etapas: [
    { id: 's', chave: 'sitfis', titulo: 'Relatório SITFIS', evidencias: [{ id: 'analise', chave: 'sitfis', satisfaz: true }] },
    { id: 'd', chave: 'documentos', titulo: 'Documentos', evidencias: [] },
  ] };
  const api = {
    getOnboarding: jest.fn().mockResolvedValueOnce({ onboarding: ficha }).mockRejectedValue(new Error('Sem leitura')),
    salvarEtapaOnboarding: jest.fn(async () => ({ onboarding: { ...ficha, versao: 2, etapas: ficha.etapas.map(etapa => {
      const e = { ...etapa };
      delete e.evidencias;
      return e.id === 'd' ? { ...e, concluidaEm: '2026-10-17' } : e;
    }) } })),
  };
  render(<OnboardingDetailPage api={api} onboardingId={ficha.id} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Implantação' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Adicionar observação' })[0]);
  fireEvent.change(screen.getByLabelText('Observação de Relatório SITFIS'), { target: { value: 'Minha observação ainda não salva' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /Documentos/ }));
  expect(await screen.findByText(/A ação foi salva, mas as evidências/)).toBeVisible();
  expect(screen.getByRole('checkbox', { name: /Relatório SITFIS/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Documentos/ })).toBeChecked();
  expect(screen.getByLabelText('Observação de Relatório SITFIS')).toHaveValue('Minha observação ainda não salva');
});

test('falha da releitura após comando preserva campos e informa que ação foi salva', async () => {
  const ficha = fichaPF(); let salvo = false;
  const api = { comercial: jest.fn(async (path, body) => {
    if (path === '/recursos') return { recursos: [] };
    if (body) { salvo = true; return { ok: true }; }
    if (salvo) throw new Error('Leitura indisponível');
    return painel(ficha);
  }) };
  const atualizar = jest.fn();
  const { container } = render(<FluxoComercial api={api} onboardingId={ficha.id} onAtualizar={atualizar} />);
  await screen.findByRole('button', { name: 'Salvar dados deste passo' });
  fireEvent.change(container.querySelector('.lead-step-fields input[id$="-responsavelNome"]'), { target: { value: 'Nome confirmado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar dados deste passo' }));
  expect(await screen.findByText(/^A ação foi salva/)).toHaveAttribute('role', 'alert');
  expect(screen.getByText(/Não foi possível atualizar o atendimento/)).toHaveAttribute('role', 'alert');
  expect(container.querySelector('.lead-step-fields input[id$="-responsavelNome"]')).toHaveValue('Nome confirmado');
  expect(atualizar).toHaveBeenCalledTimes(1);
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

test('resposta tardia da ficha anterior não substitui a nova ficha', async () => {
  let resolver;
  const antiga = new Promise(r => { resolver = r; });
  const ficha = fichaPF();
  const api = { getOnboarding: jest.fn(id => id === 'antiga' ? antiga : Promise.resolve({ onboarding: ficha })) };
  const { rerender } = render(<OnboardingDetailPage api={api} onboardingId="antiga" />);
  rerender(<OnboardingDetailPage api={api} onboardingId={ficha.id} />);
  expect(await screen.findByText('Nome inicial', { selector: '.page-shell__title' })).toBeVisible();
  await act(async () => resolver({ onboarding: { ...ficha, id: 'antiga', responsavelNome: 'Resposta antiga' } }));
  expect(screen.queryByText('Resposta antiga', { selector: '.page-shell__title' })).not.toBeInTheDocument();
  expect(screen.getByText('Nome inicial', { selector: '.page-shell__title' })).toBeVisible();
});

test('polling de aceite externo atualiza a etapa da ficha sem ação local e preserva rascunho', async () => {
  jest.useFakeTimers();
  let view;
  try {
    let ficha = { ...fichaPF(), status: 'RASCUNHO', comercial: { atual: 'proposta', titulo: 'Valores e aceite da proposta' } };
    let atual = 'proposta';
    const api = {
      getOnboarding: jest.fn(async () => ({ onboarding: JSON.parse(JSON.stringify(ficha)) })),
      getOnboardingComercial: jest.fn(async () => ({ links: [], eventos: [], analises: [], proposta: {} })),
      comercial: jest.fn(async path => {
        if (path === '/recursos') return { recursos: [] };
        if (path.endsWith('/acompanhamento')) return { versao: ficha.versao };
        const resposta = painel(JSON.parse(JSON.stringify(ficha)));
        resposta.jornada.projecao.atual = atual;
        resposta.jornada.projecao.passos.push(
          { id: 'proposta', titulo: 'Valores e aceite da proposta', acessivel: true, concluido: atual === 'contrato', pendencias: [] },
          { id: 'contrato', titulo: 'Contrato e assinatura', acessivel: atual === 'contrato', concluido: false, pendencias: [] },
        );
        return resposta;
      }),
    };
    await act(async () => { view = render(<MemoryRouter><OnboardingDetailPage api={api} onboardingId={ficha.id} /></MemoryRouter>); });
    expect(screen.getByLabelText('Etapa comercial')).toHaveTextContent('Valores e aceite da proposta');
    expect(screen.getByRole('region', { name: 'Jornada comercial' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Anotações' })).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Anotações' }), { target: { value: 'Rascunho durante aceite externo' } });
    // O aceite altera as evidências sem necessariamente alterar a versão dos dados da ficha.
    ficha = { ...ficha, comercial: { atual: 'contrato', titulo: 'Contrato e assinatura' } };
    atual = 'contrato';
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(screen.getByLabelText('Etapa comercial')).toHaveTextContent('Contrato e assinatura');
    expect(screen.getByRole('region', { name: 'Jornada comercial' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Contrato e assinatura', level: 4 })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Anotações' })).toHaveValue('Rascunho durante aceite externo');
    expect(api.comercial.mock.calls.every(([, body]) => body === undefined)).toBe(true);
    expect(api.getOnboarding).toHaveBeenCalledTimes(2);
    api.getOnboarding.mockRejectedValueOnce(new Error('Leitura temporariamente indisponível'));
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(screen.getByLabelText('Etapa comercial')).toHaveTextContent('Contrato e assinatura');
    expect(screen.getByText(/Não foi possível atualizar as evidências/)).toBeVisible();
    expect(screen.queryByText(/A ação foi salva/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Anotações' })).toHaveValue('Rascunho durante aceite externo');
    ficha = { ...ficha, versao: 2, responsavelNome: 'Nome na versão dois' };
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(screen.getByText('Nome na versão dois', { selector: '.page-shell__title' })).toBeVisible();
    ficha = { ...ficha, versao: 1, responsavelNome: 'Nome obsoleto', comercial: { atual: 'proposta', titulo: 'Valores e aceite da proposta' } };
    atual = 'proposta';
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(screen.getByText('Nome na versão dois', { selector: '.page-shell__title' })).toBeVisible();
    expect(screen.getByLabelText('Etapa comercial')).toHaveTextContent('Contrato e assinatura');
    expect(screen.getByRole('heading', { name: 'Contrato e assinatura', level: 4 })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Anotações' })).toHaveValue('Rascunho durante aceite externo');
  } finally { view?.unmount(); jest.useRealTimers(); }
});

test('polling antigo não propaga atualização para outra ficha', async () => {
  jest.useFakeTimers();
  let view;
  try {
    const ficha = fichaPF();
    const nova = { ...ficha, id: 'nova-987654', responsavelNome: 'Nova pessoa', dados: { ...ficha.dados, responsavelNome: 'Nova pessoa' } };
    let resolver, atrasar = false;
    const atualizar = jest.fn();
    const api = { comercial: jest.fn(async path => {
      if (path === '/recursos') return { recursos: [] };
      if (path.includes(nova.id)) return painel(nova);
      if (atrasar) return new Promise(resolve => { resolver = resolve; });
      return painel(ficha);
    }) };
    await act(async () => { view = render(<FluxoComercial api={api} onboardingId={ficha.id} onAtualizar={atualizar} />); });
    atrasar = true;
    await act(async () => { jest.advanceTimersByTime(10000); });
    await act(async () => { view.rerender(<FluxoComercial api={api} onboardingId={nova.id} onAtualizar={atualizar} />); });
    await act(async () => { resolver(painel(ficha)); });
    expect(screen.getByDisplayValue('Nova pessoa')).toBeVisible();
    expect(api.comercial).toHaveBeenCalledWith('/onboardings/' + nova.id);
    expect(screen.queryByDisplayValue('Nome inicial')).not.toBeInTheDocument();
    expect(atualizar).not.toHaveBeenCalled();
  } finally { view?.unmount(); jest.useRealTimers(); }
});

test('contato confirmado invalida os consumidores mesmo sem mudar a versão da ficha', async () => {
  const ficha = fichaPF();
  let conversaId = null;
  const api = {
    getOnboarding: jest.fn(async () => ({ onboarding: ficha })),
    getOnboardingComercial: jest.fn(async () => ({ links: [], eventos: [], analises: [], proposta: {} })),
    comercial: jest.fn(async (path, body) => {
      if (path === '/recursos') return { recursos: [] };
      if (path === '/canais-comerciais') return { canais: [{ id: 'canal-qa', chave: 'Comercial QA' }] };
      if (path.endsWith('/acompanhamento')) return { versao: ficha.versao, conversaId };
      if (path.endsWith('/contato') && body) { conversaId = 'vinculo-persistido-qa'; return { conversaId, atendimentoId: 'atendimento-qa' }; }
      return painel(ficha);
    }),
  };
  render(<MemoryRouter><OnboardingDetailPage api={api} onboardingId={ficha.id} /></MemoryRouter>);
  const acompanhamento = await screen.findByRole('region', { name: 'Acompanhamento comercial' });
  const local = within(acompanhamento);
  await waitFor(() => expect(local.getByRole('button', { name: 'Iniciar contato' })).toBeEnabled());
  fireEvent.click(local.getByRole('button', { name: 'Iniciar contato' }));
  await local.findByRole('option', { name: 'Comercial QA' });
  fireEvent.change(local.getByLabelText('Nome'), { target: { value: 'Pessoa QA' } });
  fireEvent.change(local.getByLabelText('Telefone com DDI'), { target: { value: '5521999990000' } });
  fireEvent.change(local.getByLabelText('Origem da autorização'), { target: { value: 'Autorização sintética do teste' } });
  fireEvent.click(local.getByRole('checkbox'));
  fireEvent.click(local.getByRole('button', { name: 'Preparar conversa' }));
  expect(await local.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=vinculo-persistido-qa');
  expect(ficha.versao).toBe(1);
  expect(api.comercial.mock.calls.filter(([path]) => path.endsWith('/acompanhamento')).length).toBeGreaterThan(2);
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});


test('polling integrado no chat preserva prévia e envio incerto e descarta retorno do atendimento anterior', async () => {
  jest.useFakeTimers();
  let view;
  try {
    const ficha = fichaPF(), outra = { ...fichaPF(), id: 'outra-ficha', responsavelNome: 'Outro interessado', dados: { responsavelNome: 'Outro interessado' } };
    let atrasar = false, resolverAntiga;
    const onCriado = jest.fn(), onEstado = jest.fn();
    const api = {
      comercial: jest.fn(async path => {
        if (path === '/recursos') return { recursos: [] };
        if (path === '/conversas/conversa-qa') return { atendimento: { id: 'atendimento-qa', onboardingId: ficha.id } };
        if (path === '/conversas/conversa-nova') return { atendimento: { id: 'atendimento-novo', onboardingId: outra.id } };
        if (path === `/onboardings/${outra.id}`) return painel(outra);
        if (path === `/onboardings/${ficha.id}` && atrasar) return new Promise(resolve => { resolverAntiga = resolve; });
        return painel(ficha);
      }),
      criarLinkOnboarding: jest.fn(async () => ({ token: 'token-sintetico-qa' })),
      enviarOrientacaoWhatsapp: jest.fn(async () => { throw new Error('Resultado incerto sintético'); }),
    };
    const tela = id => <AtendimentoComercial api={api} conversa={{ id, podeResponder: true, janela: { situacao: 'ABERTA' } }} onCriado={onCriado} onEstado={onEstado} />;
    await act(async () => { view = render(tela('conversa-qa')); });
    fireEvent.click(screen.getByText('Enviar formulário', { selector: 'summary' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Preparar formulário/ })); });
    const previa = screen.getByText(/token-sintetico-qa/);
    expect(previa).toBeVisible();
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(api.comercial.mock.calls.filter(([p]) => p === '/conversas/conversa-qa')).toHaveLength(2);
    expect(screen.getByText(/token-sintetico-qa/)).toBe(previa);
    expect(api.criarLinkOnboarding).toHaveBeenCalledTimes(1);
    expect(api.enviarOrientacaoWhatsapp).not.toHaveBeenCalled();
    expect(onCriado).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Conferi: enviar mensagem' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Resultado incerto sintético');
    expect(screen.getByRole('button', { name: 'Conferi: enviar mensagem' })).toBeDisabled();
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(api.comercial.mock.calls.filter(([p]) => p === '/conversas/conversa-qa')).toHaveLength(3);
    expect(screen.getByText(/token-sintetico-qa/)).toBe(previa);
    expect(screen.getByRole('button', { name: 'Conferi: enviar mensagem' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar prévia' })).toBeDisabled();
    expect(screen.getByText(/Confira o histórico: não foi possível confirmar/)).toBeVisible();
    expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledTimes(1);
    atrasar = true;
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(resolverAntiga).toEqual(expect.any(Function));
    await act(async () => { view.rerender(tela('conversa-nova')); });
    expect(screen.getByRole('link', { name: 'Abrir ficha do cliente em nova aba' })).toHaveAttribute('href', '/onboardings/outra-ficha');
    const leituras = api.comercial.mock.calls.length, estados = onEstado.mock.calls.length;
    await act(async () => { resolverAntiga(painel(ficha)); });
    expect(api.comercial.mock.calls).toHaveLength(leituras);
    expect(onEstado.mock.calls).toHaveLength(estados);
    expect(screen.getByRole('link', { name: 'Abrir ficha do cliente em nova aba' })).toHaveAttribute('href', '/onboardings/outra-ficha');
    expect(screen.queryByText(/token-sintetico-qa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Resultado incerto sintético/)).not.toBeInTheDocument();
    expect(api.enviarOrientacaoWhatsapp).toHaveBeenCalledTimes(1);
    expect(onCriado).not.toHaveBeenCalled();
  } finally { view?.unmount(); jest.useRealTimers(); }
});
