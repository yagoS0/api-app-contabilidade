import { lerHistoricoIdentidade } from '../InboxWhatsappService.js';

test('mesma pessoa conserva relacionamento, mas aviso de contingência aparece somente na conversa comercial do caso', async () => {
  const pessoa = { id: 'p', estado: 'ATIVO', versao: 1, atendidaDesde: new Date() };
  const vinculo = { id: 'v', interlocutorId: 'p', interlocutor: pessoa };
  const segmento = (id, finalidade) => ({ id, chaveEscopo: `sem-empresa:${id}`, vinculoNumeroId: 'v', vinculoNumero: vinculo,
    canalId: id, canalWhatsapp: { id, finalidade, ativo: true }, telefoneE164: '5521999999999' });
  const comercial = segmento('comercial', 'COMERCIAL'), suporte = segmento('suporte', 'SUPORTE'), outro = segmento('outro', 'COMERCIAL');
  const segmentos = [comercial, suporte, outro];
  const caso = { id: 'caso', conversaId: 'comercial', interlocutorId: 'p', triagem: { origem: 'INATIVA',
    contingenciaIa: { estado: 'PENDENTE', motivo: 'OPENAI_TIMEOUT', criadaEm: new Date().toISOString() } } };
  const client = {
    conversaWhatsapp: { findUnique: jest.fn(async ({ where }) => segmentos.find(c => c.id === where.id)), findMany: jest.fn(async () => segmentos), count: jest.fn(async () => 0) },
    contatoWhatsapp: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    atendimentoLead: { findMany: jest.fn(async () => [caso]) },
    mensagemWhatsapp: { findMany: jest.fn(async () => []) },
    acaoPendenteWhatsapp: { findMany: jest.fn(async () => []) },
    vinculoNumeroInterlocutor: { findMany: jest.fn(async () => []) },
    notaInternaAtendimento: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async () => []),
  };
  const ler = (conversaId, area) => lerHistoricoIdentidade({ conversaId, area, visiveis: [], client });
  const comercialLida = (await ler('comercial', 'comercial')).conversa;
  const suporteLida = (await ler('suporte', 'suporte')).conversa;
  const outroLida = (await ler('outro', 'comercial')).conversa;
  expect(comercialLida.contingenciaIa).toMatchObject({ estado: 'PENDENTE', motivo: 'OPENAI_TIMEOUT' });
  expect(suporteLida.atendidaDesde).toBeTruthy();
  expect(suporteLida.contingenciaIa).toBeNull();
  expect(outroLida.contingenciaIa).toBeNull();
  expect(suporteLida.relacionamento).toEqual(comercialLida.relacionamento);
});
