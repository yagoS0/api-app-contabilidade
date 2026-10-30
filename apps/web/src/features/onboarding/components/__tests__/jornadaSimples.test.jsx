import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CadastroComercialSimples } from '../CadastroComercialSimples';
import { DestinoComercialSimples } from '../DestinoComercialSimples';
import { criarMockComercial } from '../../../../api/mock/comercialMock';
import { ProcuracaoSimples, SituacaoFiscalSimples, PagamentoComercialSimples, ApresentacaoSimples, EnviarContratoSimples, FichaDocumentosSimples } from '../EtapasComerciaisSimples';

const empresa = { razaoSocial: 'Empresa fictícia', naturezaJuridica: 'LTDA', porte: 'ME', cnaePrincipal: '6201501', endereco: { logradouro: 'Rua fictícia', municipio: 'Rio', uf: 'RJ' } };
const onboarding = { id: 'ficha-a', versao: 3, cnpj: '12345678000195', origem: 'TRANSFERENCIA', dados: { cadastroCnpj: { origem: 'CONSULTA', empresa } } };
const executar = async fn => { try { await fn(); return true; } catch { return false; } };

test('nova revisão do mesmo contrato exige preparar novamente a confirmação de pagamento', () => {
  const acao = jest.fn();
  const jornada = { contrato: { id: 'contrato', aprovadoEm: '2026-10-21T12:00:00Z' }, proposta: { versao: 1 } };
  const props = { api: {}, estado: { onboarding }, jornada, acao, executar };
  const tela = render(<PagamentoComercialSimples {...props} />);
  fireEvent.change(screen.getByLabelText('Valor recebido ou cobrado (R$)'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Referência da cobrança'), { target: { value: 'Recebimento antigo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }));
  expect(screen.getByRole('button', { name: 'Recebimento conferido por mim' })).toBeVisible();
  tela.rerender(<PagamentoComercialSimples {...props} jornada={{ ...jornada, proposta: { versao: 2 } }} />);
  expect(screen.queryByRole('button', { name: 'Recebimento conferido por mim' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirmar recebimento' })).toBeDisabled();
  expect(acao).not.toHaveBeenCalled();
});

test('cobrança da projeção da API fica identificada antes do envio', () => {
  const acao = jest.fn();
  const cobranca = { id: 'cobranca-atual', dados: { referencia: 'Mensalidade demonstrativa', valorCentavos: 12500, url: 'https://asaas.com/cobranca-exemplo' } };
  const jornada = { cobranca, contrato: { id: 'contrato', aprovadoEm: '2026-10-21T12:00:00Z' }, proposta: { versao: 1 } };
  render(<PagamentoComercialSimples api={{}} estado={{ onboarding, jornada: { projecao: jornada } }} jornada={jornada} conversaId="conversa-teste" acao={acao} executar={executar} />);
  expect(screen.getByRole('article', { name: 'Cobrança salva' })).toHaveTextContent('Mensalidade demonstrativa');
  expect(screen.getByRole('article', { name: 'Cobrança salva' })).toHaveTextContent('125,00');
  fireEvent.click(screen.getByRole('button', { name: 'Enviar cobrança ao cliente' }));
  expect(acao).toHaveBeenCalledWith('/jornada/cobranca-envio', expect.objectContaining({ cobrancaId: 'cobranca-atual', conversaId: 'conversa-teste' }));
  expect(acao).not.toHaveBeenCalledWith('/jornada/pagamento', expect.anything());
});

test('declaração manual da ficha sem conversa mostra autoria e não afirma SERPRO', () => {
  const ficha = { ...onboarding, dados: { ...onboarding.dados, cadastroRevisao: 2, procuracaoManual: { cnpj: onboarding.cnpj, cadastroRevisao: 2, atorId: 'contador-local', registradaEm: '2026-10-21T12:00:00Z' } } };
  render(<ProcuracaoSimples api={{}} recursos={[]} estado={{ onboarding: ficha }} acao={jest.fn()} />);
  expect(screen.getByText(/Validação manual registrada/)).toHaveTextContent('contador-local');
  expect(screen.getByText(/Validação manual registrada/)).toHaveTextContent('Não é verificação SERPRO');
});

test('consulta CNPJ é explícita, reaproveita o card e confirma snapshot salvo sem reenviar dados como prova', async () => {
  const api = { comercial: jest.fn().mockResolvedValue({ ok: true, versao: 3, cadastroCnpj: { empresa: { ...empresa, razaoSocial: 'Empresa consultada' } } }) };
  const acao = jest.fn().mockResolvedValue(true);
  render(<CadastroComercialSimples api={api} onboarding={onboarding} acao={acao} />);
  expect(api.comercial).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
  expect(await screen.findByText('Empresa consultada')).toBeVisible();
  expect(screen.getByText(/Dados novos da consulta/)).toBeVisible();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Prosseguir' }));
  await waitFor(() => expect(acao).toHaveBeenCalledWith('/cadastro', { versao: 3, cnpj: onboarding.cnpj, origem: 'CONSULTA' }));
});

test('edição cadastral transforma origem em manual e conserva correções após polling', async () => {
  const acao = jest.fn().mockResolvedValue(true);
  const view = render(<CadastroComercialSimples api={{}} onboarding={onboarding} acao={acao} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Nome corrigido' } });
  view.rerender(<CadastroComercialSimples api={{}} onboarding={{ ...onboarding, dados: { ...onboarding.dados } }} acao={acao} />);
  expect(screen.getByLabelText('Razão social')).toHaveValue('Nome corrigido');
  fireEvent.click(screen.getByRole('button', { name: 'Prosseguir' }));
  await waitFor(() => expect(acao).toHaveBeenCalledWith('/cadastro', expect.objectContaining({ origem: 'MANUAL', empresa: expect.objectContaining({ razaoSocial: 'Nome corrigido' }) })));
});

test('edição preserva endereço estruturado retornado e envia capital social numérico', async () => {
  const cadastro = { ...empresa, endereco: 'Rua Original, 25, sala 2, Centro', logradouro: 'Rua Original', numero: '25', complemento: 'sala 2', bairro: 'Centro', municipio: 'Rio', uf: 'RJ', cep: '20000000', capitalSocial: 15000 };
  const acao = jest.fn().mockResolvedValue(true);
  render(<CadastroComercialSimples api={{}} onboarding={{ ...onboarding, dados: { cadastroCnpj: { empresa: cadastro } } }} acao={acao} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua Original');
  expect(screen.getByLabelText('Número')).toHaveValue('25');
  expect(screen.getByLabelText('Complemento')).toHaveValue('sala 2');
  fireEvent.change(screen.getByLabelText('Capital social'), { target: { value: '20000,50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prosseguir' }));
  await waitFor(() => expect(acao).toHaveBeenCalledWith('/cadastro', expect.objectContaining({ empresa: expect.objectContaining({ capitalSocial: 20000.5, endereco: { cep: '20000000', logradouro: 'Rua Original', numero: '25', complemento: 'sala 2', bairro: 'Centro', municipio: 'Rio', uf: 'RJ' } }) })));
});

test('capital inválido não é silenciosamente apagado e zero permanece número', async () => {
  const acao = jest.fn().mockResolvedValue(true);
  render(<CadastroComercialSimples api={{}} onboarding={onboarding} acao={acao} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  fireEvent.change(screen.getByLabelText('Capital social'), { target: { value: 'vinte mil' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prosseguir' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Informe o capital social');
  expect(acao).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Capital social'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prosseguir' }));
  await waitFor(() => expect(acao).toHaveBeenCalledWith('/cadastro', expect.objectContaining({ empresa: expect.objectContaining({ capitalSocial: 0 }) })));
});

test('conflito 409 recupera versão sem descartar rascunho e preserva alteração remota não editada', async () => {
  const atual = { ...onboarding, versao: 4, dados: { cadastroCnpj: { empresa: { ...empresa, razaoSocial: 'Nome alterado remotamente', telefone: '21999990000' } } } };
  const api = { comercial: jest.fn().mockResolvedValue({ onboarding: atual }) };
  const acao = jest.fn().mockRejectedValueOnce(Object.assign(new Error('Ficha alterada'), { status: 409 })).mockResolvedValue(true);
  render(<CadastroComercialSimples api={api} onboarding={onboarding} acao={acao} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Minha correção' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prosseguir' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir versão atual' }));
  expect(await screen.findByText('Seu rascunho: Minha correção')).toBeVisible();
  expect(screen.getByText('Salvo: Nome alterado remotamente')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Prosseguir' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Manter minhas alterações e usar versão atual' }));
  fireEvent.click(screen.getByRole('button', { name: 'Prosseguir' }));
  await waitFor(() => expect(acao).toHaveBeenLastCalledWith('/cadastro', expect.objectContaining({ versao: 4, empresa: expect.objectContaining({ razaoSocial: 'Minha correção', telefone: '21999990000' }) })));
});

test('reconsulta após 409 só usa versão nova após reconciliação explícita', async () => {
  const api = { comercial: jest.fn().mockRejectedValueOnce(Object.assign(new Error('Ficha alterada'), { status: 409 })).mockResolvedValueOnce({ onboarding: { ...onboarding, versao: 4 } }).mockResolvedValue({ ok: true, versao: 5, cadastroCnpj: { empresa } }) };
  render(<CadastroComercialSimples api={api} onboarding={onboarding} acao={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Conferir versão atual' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Usar cadastro salvo e descartar rascunho' }));
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Consultar e substituir' }));
  await waitFor(() => expect(api.comercial).toHaveBeenLastCalledWith('/onboardings/ficha-a/cadastro/consulta', { versao: 4, cnpj: onboarding.cnpj }));
});

test('conflito que mudou CNPJ não aplica rascunho antigo na nova empresa', async () => {
  const api = { comercial: jest.fn().mockResolvedValue({ onboarding: { ...onboarding, cnpj: '87654321000195', versao: 4 } }) };
  const view = render(<CadastroComercialSimples api={api} onboarding={onboarding} acao={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Rascunho anterior' } });
  view.rerender(<CadastroComercialSimples api={api} onboarding={{ ...onboarding, versao: 4 }} acao={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Conferir versão atual' }));
  expect(await screen.findByRole('button', { name: 'Manter minhas alterações e usar versão atual' })).toBeDisabled();
  expect(screen.getByLabelText('Razão social')).toHaveValue('Rascunho anterior');
});

test('falha de consulta mantém cadastro visível e não conclui a etapa', async () => {
  const acao = jest.fn();
  render(<CadastroComercialSimples api={{ comercial: jest.fn().mockRejectedValue(new Error('Consulta indisponível')) }} onboarding={onboarding} acao={acao} />);
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Consulta indisponível');
  expect(screen.getByText('Empresa fictícia')).toBeVisible();
  expect(acao).not.toHaveBeenCalled();
});

test('procuração manual não pede narrativa nem declara prova SERPRO', async () => {
  const acao = jest.fn();
  render(<ProcuracaoSimples api={{}} recursos={[]} estado={{ onboarding, configuracao: { consultasFiscais: false } }} acao={acao} />);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Validado por mim' }));
  expect(acao).toHaveBeenCalledWith('/procuracao/manual', { versao: 3, confirmada: true });
  expect(screen.queryByText(/Procuração ativa/)).not.toBeInTheDocument();
});

test('falha fiscal oferece registro manual identificado e pular sem regularidade fabricada', () => {
  const acao = jest.fn();
  render(<SituacaoFiscalSimples estado={{ onboarding }} trabalho={{ status: 'ERRO', resultado: { mensagem: 'Timeout' } }} acao={acao} />);
  fireEvent.click(screen.getByRole('button', { name: 'Registrar situação manualmente' }));
  fireEvent.change(screen.getByLabelText('Situação fiscal informada'), { target: { value: 'Documento conferido pelo contador' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar e prosseguir' }));
  expect(acao).toHaveBeenCalledWith('/jornada/fiscal-alternativa', { versao: 3, modo: 'MANUAL', informacao: 'Documento conferido pelo contador' });
  fireEvent.click(screen.getByRole('button', { name: 'Pular esta etapa' }));
  expect(acao).toHaveBeenLastCalledWith('/jornada/fiscal-alternativa', { versao: 3, modo: 'PULADA' });
});

test('contador confirma recebimento da revisão aplicável sem fabricar assinatura', () => {
  const acao = jest.fn();
  const jornada = { contrato: { id: 'contrato', aprovadoEm: '2026-10-21T12:00:00.000Z', status: 'AGUARDANDO_ASSINATURA' }, proposta: { versao: 4 } };
  render(<PagamentoComercialSimples api={{}} estado={{ onboarding, documentos: [] }} jornada={jornada} acao={acao} />);
  fireEvent.change(screen.getByLabelText('Valor recebido ou cobrado (R$)'), { target: { value: '100,50' } });
  fireEvent.change(screen.getByLabelText('Referência da cobrança'), { target: { value: 'Cobrança outubro' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }));
  expect(acao).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Recebimento conferido por mim' }));
  expect(acao).toHaveBeenCalledWith('/jornada/pagamento', { versao: 3, contratoId: 'contrato', propostaVersao: 4, contratoRevisao: jornada.contrato.aprovadoEm, valorCentavos: 10050, referencia: 'Cobrança outubro', confirmado: true });
});

test('apresentação recusa metadados de outro diagnóstico e não oferece documento vazio', async () => {
  render(<ApresentacaoSimples api={{ comercial: jest.fn().mockResolvedValue({ diagnosticoId: 'antigo', conteudoHash: 'hash' }) }} estado={{ onboarding, jornada: { diagnostico: { id: 'atual' } } }} executar={executar} podeEnviar />);
  expect(await screen.findByRole('alert')).toHaveTextContent('desatualizada');
  expect(screen.getByRole('button', { name: 'Enviar ao cliente' })).toBeDisabled();
});

test('apresentação carrega prévia autenticada pelo hash e libera URL ao desmontar', async () => {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:apresentacao'); URL.revokeObjectURL = jest.fn();
  let concluir;
  const api = { comercial: jest.fn().mockResolvedValue({ diagnosticoId: 'd', conteudoHash: 'h' }), baixarApresentacaoComercial: jest.fn(() => new Promise(r => { concluir = r; })) };
  try {
    const view = render(<ApresentacaoSimples api={api} estado={{ onboarding, jornada: { diagnostico: { id: 'd' } } }} executar={executar} />);
    expect(await screen.findByText('Carregando prévia PDF…')).toBeVisible();
    expect(screen.queryByTitle('Prévia PDF da apresentação da empresa')).not.toBeInTheDocument();
    await act(async () => concluir(new Blob(['%PDF'], { type: 'application/pdf' })));
    expect(screen.getByTitle('Prévia PDF da apresentação da empresa')).toHaveAttribute('src', 'blob:apresentacao');
    expect(api.baixarApresentacaoComercial).toHaveBeenCalledWith(onboarding.id, 'd', 'h');
    view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:apresentacao');
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test('apresentação informa falha ao carregar PDF sem afirmar prévia pronta', async () => {
  const api = { comercial: jest.fn().mockResolvedValue({ diagnosticoId: 'd', conteudoHash: 'h' }), baixarApresentacaoComercial: jest.fn().mockRejectedValue(new Error('Download indisponível')) };
  render(<ApresentacaoSimples api={api} estado={{ onboarding, jornada: { diagnostico: { id: 'd' } } }} executar={executar} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Download indisponível');
  expect(screen.queryByText('Apresentação pronta · diagnóstico atual')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Prévia PDF da apresentação da empresa')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Conferi o PDF e quero preparar a proposta' })).toBeDisabled();
});

test('conferência do PDF exige clique explícito e persiste identidade e hash sem enviar', async () => {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:pdf'); URL.revokeObjectURL = jest.fn();
  const conferencia = { atorId: 'contador-teste', createdAt: '2026-10-21T12:00:00Z' };
  const api = { comercial: jest.fn().mockResolvedValueOnce({ diagnosticoId: 'd', conteudoHash: 'hash-vigente', versao: 3 }).mockResolvedValueOnce({ conferencia }), baixarApresentacaoComercial: jest.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })) };
  try {
    const view = render(<ApresentacaoSimples api={api} estado={{ onboarding, jornada: { diagnostico: { id: 'd' } } }} executar={executar} />);
    await screen.findByTitle('Prévia PDF da apresentação da empresa');
    expect(api.comercial).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Conferi o PDF e quero preparar a proposta' }));
    expect(await screen.findByText(/PDF conferido por contador-teste/)).toBeVisible();
    expect(api.comercial).toHaveBeenLastCalledWith('/onboardings/ficha-a/apresentacao/d/conferir', { versao: 3, conteudoHash: 'hash-vigente', confirmado: true });
    expect(api.comercial.mock.calls.some(([path]) => path.endsWith('/enviar'))).toBe(false);
    view.unmount();
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test('prévia ignora PDF antigo após trocar revisão e revoga a URL anterior', async () => {
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn().mockReturnValueOnce('blob:primeiro').mockReturnValueOnce('blob:atual'); URL.revokeObjectURL = jest.fn();
  let concluirAntigo;
  const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
  const api = { comercial: jest.fn().mockResolvedValueOnce({ diagnosticoId: 'a', conteudoHash: 'ha' }).mockResolvedValueOnce({ diagnosticoId: 'b', conteudoHash: 'hb' }).mockResolvedValueOnce({ diagnosticoId: 'c', conteudoHash: 'hc' }), baixarApresentacaoComercial: jest.fn().mockResolvedValueOnce(pdf).mockImplementationOnce(() => new Promise(r => { concluirAntigo = r; })).mockResolvedValueOnce(pdf) };
  const props = id => ({ api, estado: { onboarding, jornada: { diagnostico: { id } } }, executar });
  try {
    const view = render(<ApresentacaoSimples {...props('a')} />);
    await screen.findByTitle('Prévia PDF da apresentação da empresa');
    view.rerender(<ApresentacaoSimples {...props('b')} />);
    await waitFor(() => expect(api.baixarApresentacaoComercial).toHaveBeenCalledWith(onboarding.id, 'b', 'hb'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:primeiro');
    view.rerender(<ApresentacaoSimples {...props('c')} />);
    expect(await screen.findByTitle('Prévia PDF da apresentação da empresa')).toHaveAttribute('src', 'blob:atual');
    await act(async () => concluirAntigo(pdf));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(screen.getByTitle('Prévia PDF da apresentação da empresa')).toHaveAttribute('src', 'blob:atual');
    view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:atual');
  } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test('contrato prepara hash antes do envio e bloqueia repetição após resultado incerto', async () => {
  const api = { comercial: jest.fn().mockResolvedValueOnce({ conteudoHash: 'hash-vigente' }).mockRejectedValueOnce(new Error('Timeout')) };
  render(<EnviarContratoSimples api={api} onboardingId="ficha-a" contrato={{ id: 'c', aprovadoEm: 'revisao' }} conversaId="conversa" podeEnviar executar={executar} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar envio ao cliente' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar envio ao cliente' })).toBeDisabled());
  expect(api.comercial).toHaveBeenLastCalledWith('/onboardings/ficha-a/contratos/c/enviar', { conversaId: 'conversa', conteudoHash: 'hash-vigente', contratoRevisao: 'revisao' });
});

test('resposta de consulta desmontada não preenche o cadastro seguinte', async () => {
  let resolver;
  const api = { comercial: jest.fn(() => new Promise(r => { resolver = r; })) };
  const view = render(<CadastroComercialSimples key="a" api={api} onboarding={onboarding} acao={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
  view.rerender(<CadastroComercialSimples key="b" api={api} onboarding={{ ...onboarding, id: 'b', dados: { cadastroCnpj: { empresa: { ...empresa, razaoSocial: 'Outra empresa' } } } }} acao={jest.fn()} />);
  await act(async () => resolver({ ok: true, versao: 3, cadastroCnpj: { empresa: { ...empresa, razaoSocial: 'Resposta antiga' } } }));
  expect(screen.getByText('Outra empresa')).toBeVisible();
  expect(screen.queryByText('Resposta antiga')).not.toBeInTheDocument();
});

test('documento do chat é vinculado por identidade e versão, sem presumir implantação concluída', async () => {
  const api = { comercial: jest.fn().mockResolvedValue({ arquivos: [{ id: 'arquivo', nomeArquivo: 'documento-teste.pdf' }], versao: 3, temMais: false }) };
  const acao = jest.fn().mockResolvedValue(true);
  render(<FichaDocumentosSimples api={api} estado={{ onboarding, documentos: [] }} acao={acao} />);
  expect(await screen.findByText('documento-teste.pdf')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Vincular à ficha' }));
  await waitFor(() => expect(acao).toHaveBeenCalledWith('/documentos-chat', { arquivoId: 'arquivo', versao: 3 }));
  expect(screen.queryByText(/implantação concluída/i)).not.toBeInTheDocument();
});

test('trocar CNPJ limpa dados anteriores e impede prosseguir com outra identidade', () => {
  render(<CadastroComercialSimples api={{}} onboarding={onboarding} acao={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('CNPJ'), { target: { value: '87654321000195' } });
  expect(screen.queryByText('Empresa fictícia')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prosseguir' })).toBeDisabled();
});

test('destinatário vinculado exige confirmação explícita e perde autorização ao trocar contexto', async () => {
  const canal = { id: 'comercial', conversaId: 'conversa', podeResponder: true, janela: { situacao: 'ABERTA' } };
  const api = { getMensagensWhatsapp: jest.fn().mockResolvedValue({ conversa: { id: 'conversa', relacionamento: { tipo: 'LEAD' }, canais: [canal], contato: { nome: 'Pessoa fictícia' } } }) };
  const onPreparado = jest.fn();
  const view = render(<DestinoComercialSimples api={api} conversaId="conversa" contexto="a" onPreparado={onPreparado} />);
  expect(await screen.findByText('Pessoa fictícia')).toBeVisible();
  expect(onPreparado).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('button', { name: 'Usar este destinatário' }));
  expect(onPreparado).toHaveBeenLastCalledWith(expect.objectContaining({ contexto: 'a', conversaId: 'conversa' }));
  await act(async () => { view.rerender(<DestinoComercialSimples api={api} conversaId="conversa" contexto="b" onPreparado={onPreparado} />); });
  expect(onPreparado).toHaveBeenLastCalledWith(null);
});

test('mock aceita cadastro e procuração manual sem conversa, preservando ausência de prova oficial', async () => {
  const o = { ...onboarding, dados: {}, versao: 1 };
  const api = criarMockComercial({ onboardings: new Map([[o.id, o]]), persistir: jest.fn() });
  await api.comercial(`/onboardings/${o.id}/cadastro`, { versao: 1, cnpj: o.cnpj, empresa, origem: 'MANUAL' });
  const validacao = await api.comercial(`/onboardings/${o.id}/procuracao/manual`, { versao: 2, confirmada: true });
  expect(validacao.validacao.provaOficial).toBe(false);
  const estado = await api.comercial(`/onboardings/${o.id}`);
  expect(estado.jornada.projecao.atual).toBe('fiscal');
  expect(estado.atendimento.autorizacao.estado).toBe('NAO_VERIFICADA');
  expect(estado.configuracao.consultasFiscais).toBe(false);
  await expect(api.comercial(`/onboardings/${o.id}/cadastro/consulta`, { cnpj: o.cnpj })).rejects.toThrow('nenhuma consulta CNPJ');
});

test('C1: recebimento após carteira não oferece upload/envio ou recriação da empresa', () => {
  const acao = jest.fn();
  const jornada = { contrato: { id: 'c', aprovadoEm: '2026-10-25T12:00:00Z' }, proposta: { versao: 3 } };
  render(<PagamentoComercialSimples somenteRecebimento api={{}} estado={{ onboarding: { ...onboarding, status: 'CONVERTIDO' } }} jornada={jornada} acao={acao} executar={executar} />);
  expect(screen.queryByRole('button', { name: 'Enviar cobrança ao cliente' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Guia ou comprovante (PDF)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Valor recebido ou cobrado (R$)'), { target: { value: '100,10' } });
  fireEvent.change(screen.getByLabelText('Referência da cobrança'), { target: { value: 'Pagamento posterior' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }));
  expect(acao).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Recebimento conferido por mim' }));
  expect(acao).toHaveBeenCalledWith('/jornada/pagamento', expect.objectContaining({ contratoId: 'c', propostaVersao: 3, valorCentavos: 10010, confirmado: true }));
});


import { FluxoComercial } from '../FluxoComercial';

test('C1: FluxoComercial real mantém formulário pós-carteira e bloqueia campos durante gravação e erro de leitura', async () => {
  const contrato = { id: 'c', propostaId: 'p', aprovadoEm: '2026-10-25T12:00:00Z', dados: { opcao: { recorrente: true } } };
  const estado = { onboarding: { ...onboarding, status: 'CONVERTIDO' }, propostas: [], contratos: [contrato],
    jornada: { projecao: { encerrado: true, atual: 'pagamento', passos: [], contrato, proposta: { id: 'p', versao: 3 },
      comandosPermitidos: { conferirPagamento: true }, contratacao: { politica: 'COMERCIAL_2026_10_V1', ganha: false } } } };
  let resolver, falhaLeitura = false;
  const api = { comercial: jest.fn((path, body) => {
    if (body) return new Promise(resolve => { resolver = resolve; });
    if (falhaLeitura && path !== '/recursos') return Promise.reject(Error('Leitura indisponível'));
    return Promise.resolve(path === '/recursos' ? { recursos: [] } : estado);
  }) };
  render(<FluxoComercial api={api} onboardingId={onboarding.id} />);
  const valor = await screen.findByLabelText('Valor recebido ou cobrado (R$)');
  const form = screen.getByRole('group', { name: 'Recebimento após entrada na carteira' });
  expect(form).toHaveClass('lead-actions');
  expect(form).toContainElement(valor);
  expect(valor).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Enviar cobrança ao cliente' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Guia ou comprovante (PDF)')).not.toBeInTheDocument();
  fireEvent.change(valor, { target: { value: '100,10' } });
  fireEvent.change(screen.getByLabelText('Referência da cobrança'), { target: { value: 'Recebimento posterior' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar recebimento' }));
  fireEvent.click(screen.getByRole('button', { name: 'Recebimento conferido por mim' }));
  expect(form).toBeDisabled();
  expect(valor).toBeDisabled();
  expect(api.comercial).toHaveBeenCalledWith('/onboardings/ficha-a/jornada/pagamento', expect.objectContaining({ confirmado: true, contratoId: 'c', valorCentavos: 10010 }));
  falhaLeitura = true;
  await act(async () => resolver({ ok: true }));
  await waitFor(() => expect(screen.getAllByRole('alert').some(e => e.textContent.includes('Leitura indisponível'))).toBe(true));
  expect(valor).toBeDisabled();
  expect(form).toBeDisabled();
  expect(api.comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});
