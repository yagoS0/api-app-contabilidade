jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { interpretarMensagemLead } from '../InterpretarMensagemLeadService.js';
const entrada = { texto: 'Quero abrir empresa', conversaId: 'c1', mensagemId: 'm1', telefone: '5511999990000', canalId: 'comercial', client: {} };
function dependencias(extra = {}) {
  return { flag: true, piloto: ['5511999990000'], canais: ['comercial'], tetoTotalCentavos: 300, chave: 'chave-de-teste',
    autorizar: jest.fn(async () => ({ ok: true, contexto: { chamadaId: 'call' } })), concluir: jest.fn(async () => {}),
    assistente: { interpretar: jest.fn(async () => ({ interpretacao: { intencao: null, evidenciaIntencao: null, comportamento: 'DADOS', dados: [] }, usage: { input_tokens: 10, output_tokens: 5 } })) }, ...extra };
}
test.each([{ flag: false }, { piloto: [] }, { piloto: ['outro'] }, { canais: [] }, { canais: ['principal'] }])('flag/piloto impede chamadas: %p', async override => {
  const deps = dependencias(override); expect(await interpretarMensagemLead({ ...entrada, deps })).toBeNull(); expect(deps.autorizar).not.toHaveBeenCalled(); expect(deps.assistente.interpretar).not.toHaveBeenCalled();
});
test('guardas de custo recebem modelo próprio sem mudar assistente de clientes', async () => {
  const deps = dependencias(); const r = await interpretarMensagemLead({ ...entrada, deps });
  expect(r.estado).toBe('APLICADA'); expect(deps.autorizar).toHaveBeenCalledWith(expect.objectContaining({ modelo: 'gpt-5.4-mini', finalidade: 'comercial_whatsapp', chave: 'chave-de-teste', reservaCentavos: expect.any(Number), tetoAcumuladoCentavos: 300 }));
  expect(deps.concluir).toHaveBeenCalledTimes(1); expect(deps.concluir.mock.calls[0][1].usageCompleto).toBe(true);
});
test.each(['TETO_LEAD', 'TETO_PILOTO', 'SEM_CHAVE', 'CONTAGEM_FALHOU'])('%s usa fallback sem modelo', async motivo => {
  const deps = dependencias({ autorizar: jest.fn(async () => ({ ok: false, motivo })) });
  expect(await interpretarMensagemLead({ ...entrada, deps })).toEqual({ estado: 'FALLBACK', motivo }); expect(deps.assistente.interpretar).not.toHaveBeenCalled();
});

test.each([0, -1, NaN, Infinity, 1.5])('orçamento inválido %p impede consumo', async tetoTotalCentavos => {
  const deps = dependencias({ tetoTotalCentavos });
  expect(await interpretarMensagemLead({ ...entrada, deps })).toEqual({ estado: 'FALLBACK', motivo: 'TETO_PILOTO_INVALIDO' });
  expect(deps.autorizar).not.toHaveBeenCalled(); expect(deps.assistente.interpretar).not.toHaveBeenCalled();
});

test('canal não identificado impede consumo mesmo com telefone autorizado', async () => {
  const deps = dependencias();
  expect(await interpretarMensagemLead({ ...entrada, canalId: null, deps })).toBeNull();
  expect(deps.autorizar).not.toHaveBeenCalled();
});
test('falha de reserva não chama modelo', async () => {
  const deps = dependencias({ autorizar: async () => { throw Error('db'); } });
  expect((await interpretarMensagemLead({ ...entrada, deps })).motivo).toBe('GUARDA_INDISPONIVEL'); expect(deps.assistente.interpretar).not.toHaveBeenCalled();
});
test('timeout conserva reserva desconhecida e não repete chamada', async () => {
  const deps = dependencias(); deps.assistente.interpretar.mockRejectedValue(Object.assign(Error('timeout'), { codigo: 'OPENAI_TIMEOUT' }));
  expect((await interpretarMensagemLead({ ...entrada, deps })).estado).toBe('FALLBACK'); expect(deps.concluir.mock.calls[0][1]).toMatchObject({ usageCompleto: false, erroCodigo: 'OPENAI_TIMEOUT' }); expect(deps.assistente.interpretar).toHaveBeenCalledTimes(1);
});
test('recusa com uso confirmado registra custo conhecido', async () => {
  const deps = dependencias(); deps.assistente.interpretar.mockRejectedValue(Object.assign(Error('refusal'), { codigo: 'OPENAI_RECUSA', usage: { input_tokens: 10, output_tokens: 1 } }));
  await interpretarMensagemLead({ ...entrada, deps }); expect(deps.concluir.mock.calls[0][1].usageCompleto).toBe(true);
});
test('falha de registro descarta interpretação sem repetir fechamento', async () => {
  const deps = dependencias(); deps.concluir.mockRejectedValue(Error('db')); expect(await interpretarMensagemLead({ ...entrada, deps })).toEqual({ estado: 'FALLBACK', motivo: 'REGISTRO_INDISPONIVEL' }); expect(deps.concluir).toHaveBeenCalledTimes(1);
});
test('entrada longa não reserva nem chama modelo', async () => {
  const deps = dependencias(); expect((await interpretarMensagemLead({ ...entrada, texto: 'x'.repeat(4001), deps })).motivo).toBe('ENTRADA_FORA_DO_LIMITE'); expect(deps.autorizar).not.toHaveBeenCalled();
});
