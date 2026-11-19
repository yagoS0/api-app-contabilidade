import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApuracaoV2Tab } from '../renderApuracaoV2Tab';
const fluxo = {
  transmissao: { estado: 'CONFIRMADA', confirmada: true, origem: 'EXTERNA', numeroDeclaracao: 'oficial-sintetica' },
  documentos: { guia: { estado: 'PENDENTE' }, extrato: { estado: 'DISPONIVEL' } },
  pagamento: { estado: 'NAO_CONFIRMADO' },
};
function montar(extra = {}) {
  const api = {
    getFechamento: jest.fn(async () => ({ dados: { estado: 'calculada', fluxoPgdas: fluxo } })),
    getApuracaoSnapshot: jest.fn(async () => ({ snapshot: null })),
    getRelatorioFaturamento: jest.fn(async () => ({ relatorio: null })),
    recuperarDocumentosPgdas: jest.fn(async () => ({ ok: false, partial: true, documentos: fluxo.documentos, pendencias: [{ documento: 'guia', code: 'FALHA', mensagem: 'Armazenamento indisponível' }] })),
    registrarEntregaPgdasExterna: jest.fn(), syncPgdasCircular: jest.fn(), ...extra,
  };
  const props = { api, companyId: 'empresa-A', competencia: '2026-10', panel: { pendencias: [] }, feedback: { notifyError: jest.fn() } };
  return { api, props, ...render(<ApuracaoV2Tab {...props} />) };
}
it('reabertura lê prova e pendências persistidas sem atos externos', async () => {
  const { api } = montar();
  await screen.findByText('DAS: obtenção pendente');
  expect(screen.getByText('Extrato: disponível')).toBeInTheDocument();
  expect(screen.getByText(/Declaração localizada na Receita — origem da transmissão não comprovada/)).toBeInTheDocument();
  expect(api.recuperarDocumentosPgdas).not.toHaveBeenCalled();
  expect(api.syncPgdasCircular).not.toHaveBeenCalled();
});
it('recuperação é explícita, preserva confirmação fiscal e mostra falha documental parcial', async () => {
  const { api, props } = montar();
  await screen.findByText('DAS: obtenção pendente');
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar DAS e extrato' }));
  expect(api.recuperarDocumentosPgdas).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toHaveTextContent('não retransmite');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar consulta' }));
  await screen.findByText('DAS: Armazenamento indisponível');
  await waitFor(() => expect(api.getFechamento).toHaveBeenCalledTimes(2));
  expect(api.recuperarDocumentosPgdas).toHaveBeenCalledWith('empresa-A', '2026-10');
  expect(props.feedback.notifyError).not.toHaveBeenCalled();
  expect(screen.getByText(/Declaração localizada na Receita — origem da transmissão não comprovada/)).toBeInTheDocument();
});
it('recuperação tardia da empresa anterior não aparece na nova empresa', async () => {
  let resolver;
  const { api, props, rerender } = montar({ recuperarDocumentosPgdas: jest.fn(() => new Promise(r => { resolver = r; })) });
  await screen.findByText('DAS: obtenção pendente');
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar DAS e extrato' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar consulta' }));
  api.getFechamento.mockResolvedValue({ dados: {} });
  rerender(<ApuracaoV2Tab {...props} companyId="empresa-B" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Recuperar DAS e extrato' })).toBeEnabled());
  await act(async () => resolver({ ok: false, documentos: fluxo.documentos, pendencias: [{ documento: 'guia', mensagem: 'Erro da empresa A' }] }));
  expect(screen.queryByText(/Erro da empresa A/)).toBeNull();
});
it('projeção vigente pendente não reexpõe PDFs antigos da circular como atuais', async () => {
  montar({ getFechamento: jest.fn(async () => ({ dados: {
    entregaPgdas: { extratoSalvo: { dados: { dasTotal: 10 }, files: { declaracaoFileId: 'antiga', reciboFileId: 'antigo' } } },
    fluxoPgdas: { ...fluxo, documentos: { guia: { estado: 'PENDENTE' }, extrato: { estado: 'PENDENTE', declaracaoFileId: null, reciboFileId: null } } },
  } })) });
  await screen.findByText('Extrato: obtenção pendente');
  expect(screen.queryByRole('button', { name: 'Declaração (PDF)' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Recibo (PDF)' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Histórico PGDAS-D' })).toBeEnabled();
});
it('PDF da página desmontada não abre outra janela quando chega depois', async () => {
  let resolver;
  const originalUrl = URL.createObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:sintetico');
  const abrir = jest.spyOn(window, 'open').mockImplementation(() => null);
  const { unmount } = montar({
    getFechamento: jest.fn(async () => ({ dados: { fluxoPgdas: { ...fluxo, documentos: { ...fluxo.documentos, extrato: { estado: 'DISPONIVEL', declaracaoFileId: 'declaracao' } } } } })),
    fetchPgdasPdfBlob: jest.fn(() => new Promise(r => { resolver = r; })),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Declaração (PDF)' }));
  unmount();
  await act(async () => resolver(new Blob(['PDF sintético'])));
  expect(abrir).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  abrir.mockRestore();
  URL.createObjectURL = originalUrl;
});
it('trocar empresa no pai desmonta o painel e descarta seu PDF atrasado', async () => {
  let resolver;
  const originalUrl = URL.createObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:sintetico');
  const abrir = jest.spyOn(window, 'open').mockImplementation(() => null);
  const { api, props, rerender } = montar({
    getFechamento: jest.fn(async () => ({ dados: { fluxoPgdas: { ...fluxo, documentos: { ...fluxo.documentos, guia: { estado: 'DISPONIVEL', guideId: 'guia-A' } } } } })),
    fetchGuidePdfBlob: jest.fn(() => new Promise(r => { resolver = r; })),
  });
  fireEvent.click(await screen.findByRole('button', { name: 'DAS (PDF)' }));
  api.getFechamento.mockResolvedValue({ dados: {} });
  rerender(<ApuracaoV2Tab {...props} companyId="empresa-B" />);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'DAS (PDF)' })).toBeNull());
  await act(async () => resolver(new Blob(['PDF da empresa A'])));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(abrir).not.toHaveBeenCalled();
  abrir.mockRestore(); URL.createObjectURL = originalUrl;
});
