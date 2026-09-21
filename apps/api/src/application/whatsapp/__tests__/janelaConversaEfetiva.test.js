jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  conversaWhatsapp: { findUnique: jest.fn() },
  mensagemWhatsapp: { fields: { registradaEm: { name: 'registradaEm' } }, findFirst: jest.fn() },
} }));

import { prisma } from '../../../infrastructure/db/prisma.js';
import { janelaDaConversa } from '../ConversaWhatsappService.js';
import { AVISOS } from '../janela24h.js';

const AGORA = new Date('2026-09-21T15:00:00Z');
const HORA = 3600000;
const ha = horas => new Date(AGORA.getTime() - horas * HORA);
const conversa = { id: 'cv-fiscal', telefoneE164: '5521999998888', canalId: 'principal', vinculoNumeroId: 'vigencia-a' };
const entrada = (id, horasProvedor, horasRegistro = horasProvedor, overrides = {}) => ({
  id, direcao: 'in', ocorridaEmProvedor: horasProvedor == null ? null : ha(horasProvedor), registradaEm: ha(horasRegistro), conversa, ...overrides,
});

// Interpreta as operações Prisma usadas na leitura, inclusive comparação entre colunas.
// Os dados variam independentemente da implementação: não devolve um resultado pronto.
function corresponde(row, where) {
  return Object.entries(where).every(([campo, valor]) => {
    if (campo === 'OR') return valor.some(filtro => corresponde(row, filtro));
    if (campo === 'AND') return valor.every(filtro => corresponde(row, filtro));
    if (campo === 'conversa') return corresponde(row.conversa, valor);
    if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
      return Object.entries(valor).every(([op, esperado]) => {
        const comparado = esperado?.name ? row[esperado.name] : esperado;
        if (op === 'not') return row[campo] !== comparado;
        if (row[campo] == null || comparado == null) return false;
        return op === 'lte' ? row[campo] <= comparado : op === 'gt' ? row[campo] > comparado : false;
      });
    }
    return row[campo] === valor;
  });
}
function base(mensagens, alvo = conversa) {
  prisma.conversaWhatsapp.findUnique.mockResolvedValue(alvo);
  prisma.mensagemWhatsapp.findFirst.mockImplementation(async ({ where, orderBy }) => {
    const candidatas = mensagens.filter(m => corresponde(m, where));
    const ordem = Array.isArray(orderBy) ? orderBy : [orderBy];
    candidatas.sort((a, b) => {
      for (const chave of ordem) {
        const [campo, direcao] = Object.entries(chave)[0];
        const comparacao = a[campo] > b[campo] ? 1 : a[campo] < b[campo] ? -1 : 0;
        if (comparacao) return direcao === 'desc' ? -comparacao : comparacao;
      }
      return 0;
    });
    return candidatas[0] || null;
  });
}

beforeEach(() => jest.clearAllMocks());

test('entrada antiga processada após mensagem recente não fecha novamente a janela', async () => {
  base([entrada('recente', 1, 0.9), entrada('atrasada', 48, 0.1)]);
  expect(await janelaDaConversa(conversa.id, AGORA)).toMatchObject({ situacao: 'ABERTA', instante: ha(1), fonte: 'PROVEDOR' });
});

test('um lote grande de eventos atrasados não esconde a mensagem que abriu a janela', async () => {
  base([entrada('recente', 1), ...Array.from({ length: 1001 }, (_, i) => entrada(`atrasada-${i}`, 30 + i, 0.1))]);
  expect((await janelaDaConversa(conversa.id, AGORA)).situacao).toBe('ABERTA');
});

test.each([[24, 'EXPIRADA'], [24 - 1 / HORA, 'ABERTA'], [24 + 1 / HORA, 'EXPIRADA']])('limite exato de24h: %s horas → %s', async (horas, situacao) => {
  base([entrada('limite', horas), entrada('antiga', 48, 0.1)]);
  expect((await janelaDaConversa(conversa.id, AGORA)).situacao).toBe(situacao);
});

test('sem ocorrência do provedor usa registro e conserva aviso explícito', async () => {
  base([entrada('sem-timestamp', null, 1), entrada('antiga', 48, 0.1)]);
  expect(await janelaDaConversa(conversa.id, AGORA)).toMatchObject({ situacao: 'ABERTA', instante: ha(1), fonte: 'NOSSO_REGISTRO', avisos: [AVISOS.SEM_INSTANTE_DO_PROVEDOR] });
});

test('ocorrência futura não prolonga janela além do registro mais antigo', async () => {
  base([entrada('relogio-adiantado', -2, 25)]);
  expect(await janelaDaConversa(conversa.id, AGORA)).toMatchObject({ situacao: 'EXPIRADA', instante: ha(25), fonte: 'NOSSO_REGISTRO', avisos: expect.arrayContaining([AVISOS.PROVEDOR_ADIANTADO]) });
});

test('compara instante efetivo entre ocorrência válida, nula e futura', async () => {
  base([entrada('provedor', 1, 0.9), entrada('sem', null, 3), entrada('futura', -2, 2)]);
  expect(await janelaDaConversa(conversa.id, AGORA)).toMatchObject({ instante: ha(1), fonte: 'PROVEDOR' });
});

test('se os dois relógios estiverem no futuro conserva a regra e o aviso existentes', async () => {
  base([entrada('futura', -1, -2)]);
  expect(await janelaDaConversa(conversa.id, AGORA)).toMatchObject({ situacao: 'ABERTA', instante: ha(-1), avisos: [AVISOS.INSTANTE_NO_FUTURO] });
});

test.each(['canal', 'vigencia', 'saida'])('entrada de outro %s não abre a janela deste destinatário', async tipo => {
  const externa = entrada('externa', 0, 0, tipo === 'saida' ? { direcao: 'out' } : { conversa: { ...conversa, ...(tipo === 'canal' ? { canalId: 'comercial' } : { vinculoNumeroId: 'vigencia-anterior' }) } });
  base([entrada('antiga', 48), externa]);
  expect((await janelaDaConversa(conversa.id, AGORA)).situacao).toBe('EXPIRADA');
});

test('segmentos do mesmo canal/vigência compartilham apenas a evidência temporal', async () => {
  base([entrada('nova', 1, 1, { conversa: { ...conversa, id: 'cv-outra-empresa', telefoneE164: '552199998888', portalClientId: 'outra-empresa' } })]);
  expect((await janelaDaConversa(conversa.id, AGORA)).situacao).toBe('ABERTA');
  for (const [args] of prisma.mensagemWhatsapp.findFirst.mock.calls) {
    expect(args.select).toEqual({ ocorridaEmProvedor: true, registradaEm: true });
  }
});

test('legado mantém telefone exato e não mistura segmento migrado ou outro telefone', async () => {
  const legado = { ...conversa, canalId: null, vinculoNumeroId: null };
  base([
    entrada('antiga', 48, 48, { conversa: legado }),
    entrada('novo-migrado', 1),
    entrada('outro-numero', 0, 0, { conversa: { ...legado, telefoneE164: '552188887777' } }),
  ], legado);
  expect((await janelaDaConversa(legado.id, AGORA)).situacao).toBe('EXPIRADA');
});

test('ausência de entradas e conversa inexistente continuam sem janela aberta', async () => {
  base([]);
  expect((await janelaDaConversa(conversa.id, AGORA)).situacao).toBe('NUNCA_ABERTA');
  prisma.mensagemWhatsapp.findFirst.mockClear();
  prisma.conversaWhatsapp.findUnique.mockResolvedValue(null);
  expect((await janelaDaConversa('inexistente', AGORA)).situacao).toBe('NUNCA_ABERTA');
  expect(prisma.mensagemWhatsapp.findFirst).not.toHaveBeenCalled();
});
