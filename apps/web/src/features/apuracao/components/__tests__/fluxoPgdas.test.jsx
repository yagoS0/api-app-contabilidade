import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FluxoPgdasPanel } from '../FluxoPgdasPanel';
import { entregaPgdasDoFechamento } from '../../lib/entregaPgdas';

const fluxo = {
  transmissao: { estado: 'TRANSMITIDA', confirmada: true, origem: 'EXTERNA', numeroDeclaracao: 'oficial-1' },
  documentos: { guia: { estado: 'DISPONIVEL', guideId: 'guia-1' }, extrato: { estado: 'PENDENTE' } },
  pagamento: { estado: 'NAO_CONFIRMADO' },
};
const montar = (extra = {}) => {
  const props = { api: { registrarEntregaPgdasExterna: jest.fn(async () => ({ ok: true })) }, dados: { faturamento: { total: 1000 } }, companyId: 'empresa-A', competencia: '2026-10', razao: 'Empresa sintética', onChanged: jest.fn(), ...extra };
  return { props, ...render(<FluxoPgdasPanel {...props} />) };
};
it('mostra documentos persistidos independentemente da transmissão e pagamento na reabertura', () => {
  montar({ dados: { fluxoPgdas: fluxo } });
  expect(screen.getByText(/origem da transmissão não comprovada/)).toBeInTheDocument();
  expect(screen.getByText('DAS: disponível')).toBeInTheDocument();
  expect(screen.getByText('Extrato: obtenção pendente')).toBeInTheDocument();
  expect(screen.getByText('Pagamento: não confirmado')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'DAS (PDF)' })).toBeEnabled();
});
it('zero comprovado não aparece como PDF e ok sozinho não prova disponibilidade', () => {
  montar({ dados: { fluxoPgdas: { ...fluxo, documentos: { guia: { estado: 'NAO_DEVIDO' }, extrato: { ok: true } } } } });
  expect(screen.getByText('DAS: sem valor a recolher comprovado')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'DAS (PDF)' })).toBeNull();
  expect(screen.getByText('Extrato: obtenção pendente')).toBeInTheDocument();
});
it('registro externo está disponível com receita e só grava depois de confirmação explícita', async () => {
  const { props } = montar();
  expect(props.api.registrarEntregaPgdasExterna).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Registrar apuração realizada fora da Altan' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('2026-10');
  expect(screen.getByRole('dialog')).toHaveTextContent('não comprova a entrega');
  fireEvent.change(screen.getByRole('textbox', { name: 'Observação (opcional)' }), { target: { value: 'Registro sintético' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar registro externo' }));
  await waitFor(() => expect(props.onChanged).toHaveBeenCalledTimes(1));
  expect(props.api.registrarEntregaPgdasExterna).toHaveBeenCalledWith('empresa-A', '2026-10', { entregue: true, confirmCompetencia: '2026-10', observacao: 'Registro sintético' });
});
it('recusa não anuncia registro e mantém orientação no diálogo', async () => {
  const { props } = montar({ api: { registrarEntregaPgdasExterna: jest.fn(async () => ({ ok: false, message: 'Acesso recusado' })) } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar apuração realizada fora da Altan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar registro externo' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Acesso recusado'));
  expect(props.onChanged).not.toHaveBeenCalled();
});
it('resultado incerto não libera afirmação externa nem inventa prova histórica', () => {
  const dados = { estado: 'erro_transmissao', snapshot: { numeroDeclaracao: 'antiga' }, fluxoPgdas: { transmissao: { estado: 'RESULTADO_INCERTO', confirmada: false } } };
  montar({ dados });
  expect(screen.getByText('Resultado fiscal não confirmado')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Registrar apuração realizada fora da Altan' })).toBeDisabled();
  expect(entregaPgdasDoFechamento(dados).provada).toBe(false);
});
it('declaração externa não apaga tentativa local incerta', () => {
  montar({ dados: { fluxoPgdas: { ...fluxo, transmissao: { ...fluxo.transmissao, tentativaLocalIncerta: true } } } });
  expect(screen.getByText(/origem da transmissão não comprovada/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('não comprova o resultado dessa tentativa nem autoriza retransmissão');
});
it('resposta de outra empresa não atualiza a leitura atual', async () => {
  let resolver;
  const { props, rerender } = montar({ api: { registrarEntregaPgdasExterna: jest.fn(() => new Promise(r => { resolver = r; })) } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar apuração realizada fora da Altan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar registro externo' }));
  rerender(<FluxoPgdasPanel {...props} companyId="empresa-B" />);
  await act(async () => resolver({ ok: true }));
  expect(props.onChanged).not.toHaveBeenCalled();
});
it.each(['key', 'unmount'])('PDF atrasado não abre depois de desmontagem (%s)', async modo => {
  let resolver;
  const originalUrl = URL.createObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:sintetico');
  const abrir = jest.spyOn(window, 'open').mockImplementation(() => null);
  const api = { fetchGuidePdfBlob: jest.fn(() => new Promise(r => { resolver = r; })) };
  const props = { api, dados: { fluxoPgdas: fluxo }, companyId: 'A', competencia: '2026-10' };
  const { rerender, unmount } = render(<FluxoPgdasPanel key="A" {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'DAS (PDF)' }));
  if (modo === 'key') rerender(<FluxoPgdasPanel key="B" {...props} companyId="B" />);
  else unmount();
  await act(async () => resolver(new Blob(['PDF sintético'])));
  expect(abrir).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  abrir.mockRestore();
  URL.createObjectURL = originalUrl;
});
it('registro aceito depois da troca de key não executa callback da empresa anterior', async () => {
  let resolver;
  const api = { registrarEntregaPgdasExterna: jest.fn(() => new Promise(r => { resolver = r; })) };
  const onChanged = jest.fn();
  const props = { api, dados: {}, companyId: 'A', competencia: '2026-10', onChanged };
  const { rerender } = render(<FluxoPgdasPanel key="A" {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Registrar apuração realizada fora da Altan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar registro externo' }));
  rerender(<FluxoPgdasPanel key="B" {...props} companyId="B" />);
  await act(async () => resolver({ ok: true }));
  expect(onChanged).not.toHaveBeenCalled();
  expect(api.registrarEntregaPgdasExterna).toHaveBeenCalledTimes(1);
});

it.each([false, true])('F01: origem desconhecida preserva existência e alerta incerto=%s', tentativaLocalIncerta => {
  montar({ dados: { fluxoPgdas: { ...fluxo, transmissao: { ...fluxo.transmissao, origem: 'DESCONHECIDA', tentativaLocalIncerta } } } });
  expect(screen.getByText('Declaração localizada na Receita — origem da transmissão não comprovada')).toBeInTheDocument();
  expect(screen.queryByText('Transmitida pela Altan')).toBeNull();
  expect(screen.getByText('DAS: disponível')).toBeInTheDocument();
  if (tentativaLocalIncerta) expect(screen.getByRole('alert')).toHaveTextContent('nem autoriza retransmissão');
  else expect(screen.queryByRole('alert')).toBeNull();
});
it('F01: snapshot histórico isolado não comprova transmissão', () => {
  montar({ dados: { estado: 'transmitida', snapshot: { estado: 'transmitida', numeroDeclaracao: 'antiga' } } });
  expect(screen.queryByText('Transmitida pela Altan')).toBeNull();
  expect(screen.getByText(/Entrega desconhecida/)).toBeInTheDocument();
});
it('F01: prova causal projetada identifica Altan', () => {
  montar({ dados: { fluxoPgdas: { ...fluxo, transmissao: { ...fluxo.transmissao, origem: 'ALTAN' } } } });
  expect(screen.getByText('Transmitida pela Altan')).toBeInTheDocument();
});
