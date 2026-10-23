jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarGuruConferencia } from '../GuruConferenciaService.js';
import { documentoGuru, projetarNotaGuru, resumoGuru } from '../guruNotasVinculadas.js';

const chave = '1'.repeat(50);
const xml = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${chave}"><nNFSe>1</nNFSe><cStat>100</cStat><DPS><infDPS><tpAmb>1</tpAmb><dCompet>2026-10-01</dCompet><prest><CNPJ>11111111000191</CNPJ></prest><toma><CPF>12345678909</CPF></toma><valores><vServPrest><vServ>0.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
const nota = { id: 'nota-a', companyId: 'empresa', status: 'issued', numeroNfse: '1', chaveAcesso: chave,
  companyCnpj: '11111111000191', tomadorDoc: '12345678909', updatedAt: new Date('2026-10-22T12:00:00Z'), valorServicos: 0, xml, pdfUrl: 'https://proibido.invalid' };
function fixture() {
  let rows = new Map(), falhar = false;
  const notas = [structuredClone(nota)], user = { role: 'contador', status: 'active' };
  const db = { user: { findUnique: async () => user }, company: { findUnique: async () => ({ id: 'empresa', cnpj: nota.companyCnpj }) }, portalClient: { findUnique: async () => null },
    serviceInvoice: {
      findFirst: async ({ where }) => notas.find(n => n.id === where.id && n.companyId === where.companyId) || null,
      findMany: async ({ where }) => notas.filter(n => n.companyId === where.companyId && where.id.in.includes(n.id)),
    },
    $transaction: async fn => {
      const copy = new Map(structuredClone([...rows]));
      const tx = { ...db, $queryRaw: jest.fn(async () => []), appSetting: {
        findUnique: async ({ where }) => copy.get(where.key),
        findMany: async ({ where }) => [...copy.values()].filter(r => r.key.startsWith(where.key.startsWith)),
        create: async ({ data }) => copy.set(data.key, structuredClone(data)),
        update: async ({ where, data }) => { if (falhar) throw Error('auditoria'); copy.set(where.key, { key: where.key, ...structuredClone(data) }); },
      } };
      const result = await fn(tx); rows = copy; return result;
    } };
  const env = { NODE_ENV: 'test', GURU_CONFERENCIA_COMPANY_ID: 'empresa', GURU_CONFERENCIA_ACCOUNT_ID: 'conta' };
  return { service: criarGuruConferencia({ db, env }), notas, user, env, fail: () => { falhar = true; } };
}
const args = { companyId: 'empresa', userId: 'contador' };
const preparar = (f, transacaoId = 'venda') => f.service.preparar({ ...args, body: { transacaoId, referenciaOrigem: 'Sintética', valorCentavos: 100, moeda: 'BRL', situacaoPagamento: 'INFORMADO_PAGO' } });
const comando = (item, n = nota) => ({ ...args, id: item.id, body: { versao: item.versao, hash: item.hash, notaId: n.id, notaHash: projetarNotaGuru(n).hash, confirmada: true } });

test('vínculo explícito, replay, várias notas/venda e deduplicação entre vendas; não altera documentos', async () => {
  const f = fixture(), { item } = await preparar(f);
  const antes = structuredClone(f.notas);
  expect((await f.service.obter({ ...args, id: item.id })).notas).toBeUndefined();
  const r = await f.service.vincularNota(comando(item));
  expect(r.item.notas[0]).toMatchObject({ valor: '0', conferencia: 'CONFERIDA', origem: 'ServiceInvoice', documentos: { xml: true, danfse: true } });
  expect((await f.service.vincularNota(comando(item))).repetida).toBe(true);
  const outra = { ...nota, id: 'nota-b', chaveAcesso: '2'.repeat(50), xml: xml.replace(chave, '2'.repeat(50)) }; f.notas.push(outra);
  await f.service.vincularNota(comando(item, outra));
  const segunda = await preparar(f, 'outra-venda'); await f.service.vincularNota(comando(segunda.item));
  const lista = await f.service.listar(args);
  expect(lista.resumo).toMatchObject({ vendas: 2, notasVinculadas: 2, vendasSemVinculo: 0 });
  expect(f.notas[0]).toEqual(antes[0]);
  const arquivo = await f.service.documentoNota({ ...args, id: item.id, notaId: nota.id, formato: 'xml' });
  expect(arquivo.bytes.toString()).toBe(xml); expect(arquivo.tipo).toBe('application/xml');
  expect(JSON.stringify(lista)).not.toContain('proibido.invalid');
});

test('revisão da venda/nota invalida vínculo e download; exige nova conferência', async () => {
  const f = fixture(), { item } = await preparar(f);
  await f.service.vincularNota(comando(item));
  f.notas[0].updatedAt = new Date('2026-10-22T13:00:00Z');
  expect((await f.service.obter({ ...args, id: item.id })).notas[0].conferencia).toBe('RECONFERIR');
  await expect(f.service.vincularNota(comando(item))).rejects.toMatchObject({ code: 'guru_revisao_desatualizada' });
  await expect(f.service.documentoNota({ ...args, id: item.id, notaId: nota.id, formato: 'xml' })).rejects.toMatchObject({ status: 409 });
  await f.service.vincularNota(comando(item, f.notas[0]));
  const conferida = await f.service.conferir({ ...args, id: item.id, body: { versao: item.versao, hash: item.hash, confirmada: true } });
  expect(conferida.item.notas[0].conferencia).toBe('RECONFERIR');
});

test('isolamento, papel, produção, documento inválido e auditoria sem sucesso parcial', async () => {
  const f = fixture(), { item } = await preparar(f);
  for (const patch of [{ companyId: 'outra' }, { status: 'pending' }, { status: 'cancelled' }, { xml: '<DPS/>' }, { xml: null }, { numeroNfse: '2' }]) {
    Object.assign(f.notas[0], nota, patch);
    await expect(f.service.vincularNota(comando(item, f.notas[0]))).rejects.toThrow();
  }
  Object.assign(f.notas[0], nota);
  for (const patch of [{ confirmada: false }, { emitida: true }, { versao: 99 }]) {
    const c = comando(item); c.body = { ...c.body, ...patch };
    await expect(f.service.vincularNota(c)).rejects.toThrow();
  }
  f.user.role = 'client'; await expect(f.service.vincularNota(comando(item))).rejects.toMatchObject({ status: 403 }); f.user.role = 'contador';
  f.env.NODE_ENV = 'production'; await expect(f.service.obterNota({ ...args, notaId: nota.id })).rejects.toMatchObject({ status: 403 }); f.env.NODE_ENV = 'test';
  f.fail(); await expect(f.service.vincularNota(comando(item))).rejects.toThrow('auditoria');
  expect((await f.service.obter({ ...args, id: item.id })).historico).toHaveLength(1);
});

test.each(['<DPS/>', '<NFSe/>', '<NFSe><infNFSe>', '<!DOCTYPE NFSe [<!ENTITY x "x">]><NFSe/>'])('documento inválido não vira evidência: %s', value => {
  expect(documentoGuru({ ...nota, xml: value })).toBeNull();
});

test.each([
  ['homologação', xml.replace('<tpAmb>1', '<tpAmb>2')],
  ['prestador diferente', xml.replace('11111111000191', '22222222000191')],
  ['tomador diferente', xml.replace('12345678909', '98765432100')],
  ['valor diferente', xml.replace('0.00', '0.01')],
  ['valor ausente', xml.replace('<vServ>0.00</vServ>', '')],
  ['competência impossível', xml.replace('2026-10-01', '2026-02-30')],
  ['ambiente duplicado', xml.replace('<tpAmb>1</tpAmb>', '<tpAmb>1</tpAmb><tpAmb>2</tpAmb>')],
  ['status duplicado', xml.replace('<cStat>100</cStat>', '<cStat>100</cStat><cStat>999</cStat>')],
  ['número duplicado', xml.replace('<nNFSe>1</nNFSe>', '<nNFSe>1</nNFSe><nNFSe>2</nNFSe>')],
  ['prestador em namespace divergente', xml.replace('<prest>', '<prest xmlns="urn:invalid">')],
  ['ambiente em namespace divergente', xml.replace('<tpAmb>', '<tpAmb xmlns="urn:invalid">')],
  ['Id bruto inválido', xml.replace(`NFS${chave}`, `NFSa${chave}`)],
  ['identificação ambígua', xml.replace('</CPF>', '</CPF><CNPJ>11111111000191</CNPJ>')],
  ['valor duplicado', xml.replace('<vServ>0.00</vServ>', '<vServ>0.00</vServ><vServ>0.01</vServ>')],
  ['competência duplicada', xml.replace('</dCompet>', '</dCompet><dCompet>2026-10-02</dCompet>')],
])('%s não permite vínculo nem download', async (_motivo, documento) => {
  const f = fixture(), { item } = await preparar(f);
  f.notas[0].xml = documento;
  const info = await f.service.obterNota({ ...args, notaId: nota.id });
  expect(info.vinculavel).toBe(false);
  await expect(f.service.vincularNota({ ...comando(item), body: { ...comando(item).body, notaHash: info.hash } })).rejects.toMatchObject({ code: 'guru_documento_fiscal_invalido' });
  expect((await f.service.obter({ ...args, id: item.id })).notasVinculadas).toBeUndefined();
});

test('identidade e competência ficam explícitas; ausência cadastral não permite conferir', () => {
  expect(projetarNotaGuru(nota)).toMatchObject({ prestador: '11111111000191', tomador: '12345678909', competencia: '2026-10-01', ambiente: 'PRODUCAO', vinculavel: true });
  expect(projetarNotaGuru({ ...nota, companyCnpj: null }).vinculavel).toBe(false);
  expect(projetarNotaGuru({ ...nota, tomadorDoc: null }).vinculavel).toBe(false);
  expect(projetarNotaGuru({ ...nota, fonte: 'PortalInvoice', emitenteDoc: '22222222000191' }).vinculavel).toBe(false);
  expect(projetarNotaGuru({ ...nota, xml: xml.replace('<tpAmb>1', '<tpAmb>2') })).toMatchObject({ ambiente: 'HOMOLOGACAO', vinculavel: false });
});

test('prefixo do namespace nacional e campos opcionais legítimos continuam válidos', () => {
  const prefixado = xml.replace('xmlns=', 'xmlns:n=').replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s>])/g, '<$1n:$2');
  expect(documentoGuru({ ...nota, xml: prefixado })).toBe(prefixado);
  const opcional = xml.replace('</prest>', '<IM>123</IM><xNome>Fixture</xNome></prest>');
  expect(documentoGuru({ ...nota, xml: opcional })).toBe(opcional);
});

test('soma decimal exata por moeda; zero explícito e ausência continuam distintos', () => {
  const items = [0.1, 0.2, 0, null].map(total => ({ dados: { financeiro: { total, moeda: 'BRL' } } }));
  expect(resumoGuru(items)).toMatchObject({ valoresAusentes: 1, moedas: [{ moeda: 'BRL', total: '0.3', informados: 3, ausentes: 1 }] });
  expect(resumoGuru([{ dados: { financeiro: { total: null, moeda: 'USD' } } }]).moedas[0].total).toBeNull();
});
