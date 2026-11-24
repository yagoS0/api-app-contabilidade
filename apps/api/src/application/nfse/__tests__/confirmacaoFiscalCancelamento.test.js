import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { decidirConfirmacaoFiscalCancelamento } from '../../../modules/nfse/domain/confirmacaoFiscalCancelamento.js';
import { verificarXmlEventoOficial, verificarRespostaCancelamento, criarTransporteCancelamento } from '../../../modules/nfse/infrastructure/http/cancelamentoFiscal.js';
import { criarCancelamentoFiscal } from '../../../modules/nfse/application/cancelamentoFiscal.js';
import { gzipSync } from 'node:zlib';
import { decodificarRespostaSefinCancelamento } from '../../../modules/nfse/infrastructure/http/decodificarRespostaSefinCancelamento.js';
import { decodificarRespostaAdnCancelamento } from '../../../modules/nfse/infrastructure/http/decodificarRespostaAdnCancelamento.js';

const contexto = { companyId: 'empresa-a', chaveAcesso: '3'.repeat(50), cnpj: '39254243000191', ambiente: 'homologacao' };
const descricoes = { '101101': 'Cancelamento de NFS-e', '101103': 'Solicitação de Análise Fiscal para Cancelamento de NFS-e', '105104': 'Cancelamento de NFS-e Deferido por Análise Fiscal', '105105': 'Cancelamento de NFS-e Indeferido por Análise Fiscal' };
let key, certificate;
beforeAll(() => {
  const pair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate(); cert.publicKey = pair.publicKey;
  cert.serialNumber = '01'; cert.validity.notBefore = new Date('2020-01-01'); cert.validity.notAfter = new Date('2040-01-01');
  cert.setSubject([{ name: 'commonName', value: 'synthetic-test' }]); cert.setIssuer(cert.subject.attributes);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  key = forge.pki.privateKeyToPem(pair.privateKey); certificate = forge.pki.certificateToPem(cert).replace(/-----[^-]+-----|\s/g, '');
});

describe('contratos JSON SEFIN e ADN com eventos assinados sintéticos', () => {
  const tipos = { '101101': 'CANCELAMENTO', '101103': 'SOLICITACAO_CANCELAMENTO_ANALISE_FISCAL', '105104': 'CANCELAMENTO_DEFERIDO_ANALISE_FISCAL', '105105': 'CANCELAMENTO_INDEFERIDO_ANALISE_FISCAL' };
  const compactar = valor => gzipSync(Buffer.from(valor)).toString('base64');
  const sefin = valor => ({ tipoAmbiente: 2, versaoAplicativo: 'teste', dataHoraProcessamento: '2026-11-24T12:00:00-03:00', eventoXmlGZipB64: compactar(valor) });
  const item = (tipo, valor = xml(tipo)) => ({ TipoDocumento: 'EVENTO', TipoEvento: tipos[tipo], ChaveAcesso: contexto.chaveAcesso, ArquivoXml: compactar(valor) });
  const adn = LoteDFe => ({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', TipoAmbiente: 'HOMOLOGACAO', LoteDFe, Erros: [], Alertas: [] });
  async function verificar(corpo, metodo = 'consultar', status = 200, tipo = '101101') {
    const client = { defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, post: jest.fn(async () => ({ data: corpo, status })), get: jest.fn(async () => ({ data: corpo, status })) };
    const transporte = criarTransporteCancelamento({ client, contexto, caminho: `/nfse/${contexto.chaveAcesso}/eventos`, requestBody: {} });
    const recibo = await transporte[metodo](tipo);
    return { evidencia: verificarRespostaCancelamento(recibo, contexto), recibo, client };
  }
  test.each([['enviar', 201], ['consultarIndividual', 200]])('SEFIN %s valida envelope, XML e endpoint individual', async (metodo, status) => {
    const { evidencia, client } = await verificar(sefin(xml()), metodo, status);
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto)).toEqual({ situacao: 'CONFIRMADO', cancelada: true });
    expect(evidencia.evidencias).toHaveLength(1);
    if (metodo === 'consultarIndividual') expect(client.get.mock.calls[0][0].endsWith('/eventos/101101/1')).toBe(true);
  });
  test.each(['tipoAmbiente', 'versaoAplicativo', 'dataHoraProcessamento', 'eventoXmlGZipB64'])('SEFIN exige %s', campo => {
    const corpo = sefin(xml()); delete corpo[campo];
    expect(() => decodificarRespostaSefinCancelamento(corpo, contexto)).toThrow();
  });
  test.each(['!', 'YWJj====', 'YWJj\n', 'Zh==', Buffer.from('<evento/>').toString('base64')])('SEFIN recusa Base64/GZip inválido %s', valor => {
    expect(() => decodificarRespostaSefinCancelamento({ ...sefin('x'), eventoXmlGZipB64: valor }, contexto)).toThrow();
  });
  test('GZip truncado e expansão excessiva são recusados', () => {
    const truncado = gzipSync(Buffer.from('teste')).subarray(0, 12).toString('base64');
    for (const valor of [truncado, compactar('x'.repeat(2_000_001))]) expect(() => decodificarRespostaSefinCancelamento({ ...sefin('x'), eventoXmlGZipB64: valor }, contexto)).toThrow();
  });
  test('ambiente numérico estrito SEFIN e textual estrito ADN', () => {
    expect(() => decodificarRespostaSefinCancelamento({ ...sefin('x'), tipoAmbiente: '2' }, contexto)).toThrow();
    expect(() => decodificarRespostaAdnCancelamento({ ...adn([]), TipoAmbiente: 2 }, contexto)).toThrow();
    expect(() => decodificarRespostaAdnCancelamento({ ...adn([]), TipoAmbiente: 'PRODUCAO' }, contexto)).toThrow();
  });
  test.each([200, 202, 400])('HTTP %s não comprova o POST contratado', async status => {
    expect((await verificar(sefin(xml()), 'enviar', status)).evidencia).toBeNull();
  });
  test('GET individual exige identidade do tipo consultado', async () => {
    const { evidencia } = await verificar(sefin(xml('105104')), 'consultarIndividual', 200, '101101');
    expect(evidencia.evidencias).toHaveLength(0);
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto).cancelada).toBe(false);
  });
  test('XML sem assinatura ou adulterado não entra na custódia', async () => {
    for (const valor of ['<evento/>', xml().replace('Justificativa fiscal', 'alteração inválida')]) {
      expect((await verificar(sefin(valor), 'enviar', 201)).evidencia.evidencias).toHaveLength(0);
    }
  });
  test.each([['101101', 'CONFIRMADO'], ['101103', 'PENDENTE'], ['105104', 'CONFIRMADO'], ['105105', 'INDEFERIDO']])('ADN %s gera %s', async (tipo, situacao) => {
    const { evidencia } = await verificar(adn([item(tipo)]));
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto).situacao).toBe(situacao);
  });
  test('duplicados idênticos não criam conflito; ordem não desempata eventos distintos', async () => {
    const evento = item('101101');
    expect(decidirConfirmacaoFiscalCancelamento((await verificar(adn([evento, evento]))).evidencia, contexto).cancelada).toBe(true);
    for (const tiposEventos of [['105104', '105105'], ['101101', '105105']]) {
      const lote = tiposEventos.map(t => item(t));
      const a = decidirConfirmacaoFiscalCancelamento((await verificar(adn(lote))).evidencia, contexto);
      const b = decidirConfirmacaoFiscalCancelamento((await verificar(adn([...lote].reverse()))).evidencia, contexto);
      expect(a).toEqual(b); expect(a).toMatchObject({ situacao: 'INCONCLUSIVO', cancelada: false });
    }
  });
  test('mesmo ID com conteúdo assinado diferente permanece inconclusivo', async () => {
    const { evidencia } = await verificar(adn([item('101101'), item('101101', xml('101101', { nDFSe: '2' }))]));
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto)).toHaveProperty('motivo', 'CONTEUDO_DIVERGENTE_MESMO_EVENTO');
  });
  test.each([{ TipoDocumento: 'NFSE' }, { ChaveAcesso: '4'.repeat(50) }, { TipoEvento: 'CANCELAMENTO_INDEFERIDO_ANALISE_FISCAL' }, { ArquivoXml: 'inválido' }])('metadata divergente não vira evidência válida: %j', alteracao => {
    return verificar(adn([{ ...item('101101'), ...alteracao }])).then(({ evidencia }) => {
      expect(evidencia.evidencias).toHaveLength(0); expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto).cancelada).toBe(false);
    });
  });
  test.each([{ ambiente: '1' }, { chave: '4'.repeat(50) }, { autor: '12345678000199' }])('XML alheio não entra na coleção válida %j', async alteracao => {
    expect((await verificar(adn([item('101101', xml('101101', alteracao))]))).evidencia.evidencias).toHaveLength(0);
  });
  test('resposta parcial guarda apenas evidência válida e não confirma', async () => {
    const { evidencia } = await verificar(adn([item('101101'), { TipoDocumento: 'NFSE' }]));
    expect(evidencia.evidencias).toHaveLength(1); expect(evidencia.completa).toBe(false);
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto).cancelada).toBe(false);
    const alerta = await verificar({ ...adn([item('101101')]), Alertas: [{ Codigo: 'parcial' }] });
    expect(decidirConfirmacaoFiscalCancelamento(alerta.evidencia, contexto).cancelada).toBe(false);
  });
  test('E2240 é ausência; E2241 é restrição e nenhum autoriza cancelamento', () => {
    for (const [Codigo, problema] of [['E2240', 'AUSENCIA_EVENTOS'], ['E2241', 'RESTRICAO_VINCULO_E2241']]) {
      const r = decodificarRespostaAdnCancelamento({ ...adn(null), StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', Erros: [{ Codigo }] }, contexto, 404);
      expect(r.problemas).toEqual([problema]); expect(r.documentos).toEqual([]);
    }
  });
  test.each([['E2240', 404, 'AUSENCIA_EVENTOS'], ['E2241', 404, 'RESTRICAO_VINCULO_E2241']])('rejeição HTTP preserva diagnóstico %s sem comprovante fiscal', async (Codigo, status, problema) => {
    const client = { defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, get: jest.fn().mockRejectedValue({ response: { status, data: { TipoAmbiente: 'HOMOLOGACAO', StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', Erros: [{ Codigo }] } } }) };
    const transporte = criarTransporteCancelamento({ client, contexto, caminho: `/nfse/${contexto.chaveAcesso}/eventos`, requestBody: {} });
    const evidencia = verificarRespostaCancelamento(await transporte.consultar(), contexto);
    expect(evidencia.evidencias).toEqual([]); expect(evidencia.problemas).toEqual([problema]);
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto).cancelada).toBe(false);
  });
  test('coleção e volume têm limites; XML Base64 sem gzip ADN é rejeitado', () => {
    const evento = item('101101');
    expect(() => decodificarRespostaAdnCancelamento(adn(Array(101).fill(evento)), contexto)).toThrow();
    const grande = { ...evento, ArquivoXml: compactar('x'.repeat(2_000_000)) };
    const resultado = decodificarRespostaAdnCancelamento(adn(Array(5).fill(grande)), contexto);
    expect(resultado.documentos).toHaveLength(4); expect(resultado.completa).toBe(false);
    const valor = xml();
    expect(decodificarRespostaAdnCancelamento(adn([{ ...evento, ArquivoXml: Buffer.from(valor).toString('base64') }]), contexto).documentos).toEqual([]);
  });
  test.each([['105104', 'CONFIRMADO'], ['105105', 'INDEFERIDO']])('solicitação e decisão %s não dependem da ordem', async (tipo, situacao) => {
    const lote = [item('101103'), item(tipo)];
    for (const ordem of [lote, [...lote].reverse()]) {
      expect(decidirConfirmacaoFiscalCancelamento((await verificar(adn(ordem))).evidencia, contexto).situacao).toBe(situacao);
    }
  });
  test('sucesso ADN permite Erros omitido; E2240 e E2241 não exigem LoteDFe', async () => {
    const corpo = adn([item('101101')]); delete corpo.Erros;
    expect(decidirConfirmacaoFiscalCancelamento((await verificar(corpo)).evidencia, contexto).cancelada).toBe(true);
    for (const Codigo of ['E2240', 'E2241']) {
      const negativo = { TipoAmbiente: 'HOMOLOGACAO', StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', Erros: [{ Codigo }] };
      expect((await verificar(negativo, 'consultar', 404)).evidencia.problemas[0]).toBe(Codigo === 'E2240' ? 'AUSENCIA_EVENTOS' : 'RESTRICAO_VINCULO_E2241');
      expect((await verificar(negativo, 'consultar', 200)).evidencia).toBeNull();
    }
  });
  test('rejeição 400 e ausência desconhecida não são confirmação nem indeferimento fiscal', async () => {
    for (const [status, StatusProcessamento, Codigo] of [[400, 'REJEICAO', 'E2210'], [404, 'NENHUM_DOCUMENTO_LOCALIZADO', 'desconhecido']]) {
      const { evidencia } = await verificar({ TipoAmbiente: 'HOMOLOGACAO', StatusProcessamento, Erros: [{ Codigo }] }, 'consultar', status);
      expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto)).toEqual({ situacao: 'INCONCLUSIVO', cancelada: false });
    }
  });
  test('XML cru e envelope de outro endpoint não são contratos válidos', async () => {
    expect((await verificar(xml(), 'enviar', 201)).evidencia).toBeNull();
    expect((await verificar(sefin(xml()), 'consultar', 200)).evidencia).toBeNull();
    expect((await verificar(adn([item('101101')]), 'enviar', 201)).evidencia).toBeNull();
  });
  test('UTF-8 inválido e Base64 excessivo são rejeitados antes da verificação fiscal', () => {
    for (const eventoXmlGZipB64 of [gzipSync(Buffer.from([0xc3, 0x28])).toString('base64'), 'A'.repeat(2_800_004)]) {
      expect(() => decodificarRespostaSefinCancelamento({ ...sefin('x'), eventoXmlGZipB64 }, contexto)).toThrow();
    }
  });
  test('duplicatas mantêm providerData singular e decisão não inclui solicitação pendente', async () => {
    const evento = item('105104');
    const { recibo } = await verificar(adn([item('101103'), evento, evento]));
    const executar = criarCancelamentoFiscal({ reservar: async () => ({ nova: false }), marcarDespacho: jest.fn(), registrarResultado: jest.fn(), registrarFalha: jest.fn(), verificarResposta: verificarRespostaCancelamento });
    const resultado = await executar({ contexto, revalidarAutorizacao: jest.fn(), prepararTransporte: async () => ({ consultar: async () => recibo }) });
    expect(resultado.providerData).toEqual({ eventoId: `EVT${contexto.chaveAcesso}105104001`, hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  test('mutação do envelope original não reescreve recibo confiável', async () => {
    const corpo = adn([item('101103')]); const { recibo } = await verificar(corpo);
    corpo.LoteDFe = [item('101101')];
    expect(decidirConfirmacaoFiscalCancelamento(verificarRespostaCancelamento(recibo, contexto), contexto).situacao).toBe('PENDENTE');
  });
});
function xml(tipo = '101101', { chave = contexto.chaveAcesso, ambiente = '2', autor = contexto.cnpj, seq = '1', semMotivo = false, autorNamespace = '', nDFSe = '1', nProcAdm = null } = {}) {
  const id = `EVT${chave}${tipo}${seq.padStart(3, '0')}`;
  const raw = `<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infEvento Id="${id}"><verAplic>teste</verAplic><ambGer>1</ambGer><nSeqEvento>${seq}</nSeqEvento><dhProc>2026-11-22T09:00:00-03:00</dhProc><nDFSe>${nDFSe}</nDFSe><pedRegEvento versao="1.01"><infPedReg Id="PRE${chave}${tipo}"><tpAmb>${ambiente}</tpAmb><verAplic>teste</verAplic><dhEvento>2026-11-22T09:00:00-03:00</dhEvento><CNPJAutor${autorNamespace ? ` xmlns="${autorNamespace}"` : ''}>${autor}</CNPJAutor><chNFSe>${chave}</chNFSe><e${tipo}><xDesc>${descricoes[tipo]}</xDesc>${tipo.startsWith('105') ? '<CPFAgTrib>12345678901</CPFAgTrib>' : ''}${nProcAdm === null ? '' : `<nProcAdm>${nProcAdm}</nProcAdm>`}<cMotivo>1</cMotivo>${semMotivo ? '' : '<xMotivo>Justificativa fiscal sintética para teste</xMotivo>'}</e${tipo}></infPedReg></pedRegEvento></infEvento></evento>`;
  const sig = new SignedXml(); sig.signingKey = key;
  sig.keyInfoProvider = { getKeyInfo: () => `<X509Data><X509Certificate>${certificate}</X509Certificate></X509Data>` };
  sig.addReference("//*[local-name()='infEvento']", ['http://www.w3.org/2001/10/xml-exc-c14n#'], 'http://www.w3.org/2001/04/xmlenc#sha256');
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(raw, { location: { reference: "/*[local-name()='evento']", action: 'append' } });
  return sig.getSignedXml();
}
// Dublê explícito do adaptador; simula procedência, não homologa TLS ou PKI.
async function respostaDoAdaptador(corpo, metodo = 'enviar') {
  if (typeof corpo === 'string' && corpo.startsWith('<evento')) {
    const arquivo = gzipSync(Buffer.from(corpo)).toString('base64');
    corpo = metodo === 'enviar'
      ? { tipoAmbiente: 2, versaoAplicativo: 'teste', dataHoraProcessamento: '2026-11-24T12:00:00-03:00', eventoXmlGZipB64: arquivo }
      : { TipoAmbiente: 'HOMOLOGACAO', StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{ TipoDocumento: 'EVENTO', TipoEvento: 'CANCELAMENTO', ChaveAcesso: contexto.chaveAcesso, ArquivoXml: arquivo }] };
  }
  const client = { defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, post: jest.fn(async () => ({ data: corpo, status: 201 })), get: jest.fn(async () => ({ data: corpo, status: 200 })) };
  const transporte = criarTransporteCancelamento({ client, caminho: `/nfse/${contexto.chaveAcesso}/eventos`, requestBody: {}, contexto });
  const resposta = await transporte[metodo]();
  return { resposta, client };
}

describe('evento fiscal com integridade e procedência separadas', () => {
  it.each([{ companyId: 'empresa-b' }, { cnpj: '12345678000199' }, { chaveAcesso: '4'.repeat(50) }, { ambiente: 'producao' }])('recibo da coleta A não pode ser reatribuído ao contexto %j', async alteracao => {
    const { resposta } = await respostaDoAdaptador(xml('105104'));
    expect(verificarRespostaCancelamento(resposta, { ...contexto, ...alteracao })).toBeNull();
  });
  it('snapshot de coleta não muda quando chamador modifica contexto ou baseURL', async () => {
    const mutavel = { ...contexto };
    const client = { defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, post: jest.fn(async () => ({ status: 201, data: { tipoAmbiente: 2, versaoAplicativo: 'teste', dataHoraProcessamento: '2026-11-24T12:00:00-03:00', eventoXmlGZipB64: gzipSync(Buffer.from(xml())).toString('base64') } })), get: jest.fn() };
    const transporte = criarTransporteCancelamento({ client, contexto: mutavel, caminho: `/nfse/${contexto.chaveAcesso}/eventos`, requestBody: {} });
    mutavel.companyId = 'empresa-b'; client.defaults.baseURL = 'https://example.invalid';
    const recibo = await transporte.enviar();
    expect(client.post.mock.calls[0][0]).toBe(`https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${contexto.chaveAcesso}/eventos`);
    expect(verificarRespostaCancelamento(recibo, contexto).evidencias[0]).toMatchObject({ companyId: contexto.companyId, origemVerificada: true });
    expect(verificarRespostaCancelamento(recibo, mutavel)).toBeNull();
  });
  it.each(['https://example.invalid/SefinNacional', 'https://sefin.nfse.gov.br/SefinNacional', 'http://sefin.producaorestrita.nfse.gov.br/SefinNacional', 'https://sefin.producaorestrita.nfse.gov.br/outra', 'https://sefin.producaorestrita.nfse.gov.br:8443/SefinNacional', 'https://user:password@sefin.producaorestrita.nfse.gov.br/SefinNacional'])('destino incompatível %s não despacha nem produz procedência', baseURL => {
    const client = { defaults: { baseURL }, post: jest.fn(), get: jest.fn() };
    expect(() => criarTransporteCancelamento({ client, contexto, caminho: `/nfse/${contexto.chaveAcesso}/eventos`, requestBody: {} })).toThrow('NFSE_DESTINO_CANCELAMENTO_INVALIDO');
    expect(client.post).not.toHaveBeenCalled(); expect(client.get).not.toHaveBeenCalled();
  });
  it.each(['/eventos', `/nfse/${'4'.repeat(50)}/eventos`, `/nfse/${contexto.chaveAcesso}/eventos?x=1`, 'https://example.invalid/eventos'])('caminho incompatível %s é recusado antes da rede', caminho => {
    const client = { defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, post: jest.fn(), get: jest.fn() };
    expect(() => criarTransporteCancelamento({ client, contexto, caminho, requestBody: {} })).toThrow('NFSE_DESTINO_CANCELAMENTO_INVALIDO');
    expect(client.post).not.toHaveBeenCalled(); expect(client.get).not.toHaveBeenCalled();
  });
  it('JSON forjado com corpo, contexto e destino oficiais não é recibo interno', async () => {
    const falso = { corpo: xml(), contexto, operacao: 'SOLICITAR', destino: `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${contexto.chaveAcesso}/eventos`, origemVerificada: true };
    expect(verificarRespostaCancelamento(falso, contexto)).toBeNull();
    const { resposta } = await respostaDoAdaptador(falso);
    expect(verificarRespostaCancelamento(resposta, contexto)).toBeNull();
  });
  it.each([['101101', 'CONFIRMADO'], ['101103', 'PENDENTE'], ['105104', 'CONFIRMADO'], ['105105', 'INDEFERIDO']])('%s distingue %s com procedência simulada explicitamente', async (tipo, situacao) => {
    const { resposta } = await respostaDoAdaptador(xml(tipo));
    const evidencia = verificarRespostaCancelamento(resposta, contexto);
    expect(evidencia).not.toBeNull();
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto).situacao).toBe(situacao);
  });
  it('autor municipal não é confundido com a prestadora', async () => {
    const { resposta } = await respostaDoAdaptador(xml('105104', { autor: '12345678000199' }));
    expect(decidirConfirmacaoFiscalCancelamento(verificarRespostaCancelamento(resposta, contexto), contexto).cancelada).toBe(true);
  });
  it('certificado sintético não confiável comprova integridade, nunca origem sozinho', () => {
    const evidencia = verificarXmlEventoOficial(xml(), contexto);
    expect(evidencia).toMatchObject({ integridadeVerificada: true, origemVerificada: false });
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto)).toEqual({ situacao: 'INCONCLUSIVO', cancelada: false });
    expect(verificarRespostaCancelamento(xml(), contexto)).toBeNull();
    expect(verificarRespostaCancelamento({ ...evidencia, origemVerificada: true }, contexto)).toBeNull();
  });
  it.each(['enviar', 'consultar'])('%s desabilita proxy implícito e não permite copiar procedência', async metodo => {
    const { resposta, client } = await respostaDoAdaptador(xml(), metodo);
    if (metodo === 'enviar') expect(client.post).toHaveBeenCalledWith(`https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${contexto.chaveAcesso}/eventos`, {}, { proxy: false, timeout: 15000, maxRedirects: 0, maxContentLength: 12_000_000, headers: { Accept: 'application/json' } });
    else expect(client.get).toHaveBeenCalledWith(`https://adn.producaorestrita.nfse.gov.br/contribuintes/NFSe/${contexto.chaveAcesso}/Eventos`, { proxy: false, timeout: 15000, maxRedirects: 0, maxContentLength: 12_000_000, headers: { Accept: 'application/json' } });
    expect(verificarRespostaCancelamento(resposta, contexto).evidencias[0]).toMatchObject({ origemVerificada: true });
    expect(verificarRespostaCancelamento({ ...resposta }, contexto)).toBeNull();
  });
  it('não infere campos de envelope JSON mesmo com procedência do adaptador', async () => {
    const { resposta } = await respostaDoAdaptador({ xml: xml(), origemVerificada: true });
    expect(verificarRespostaCancelamento(resposta, contexto)).toBeNull();
  });
  it.each([{}, { ok: true }, { status: 'accepted' }, '', '<evento>', '<!DOCTYPE evento><evento/>'])('não promove resposta %j a confirmação', body => expect(verificarXmlEventoOficial(body, contexto)).toBeNull());
  it.each([{ autorNamespace: 'urn:alheio' }, { autor: '12345678901' }, { nDFSe: '1'.repeat(14) }, { nProcAdm: '1'.repeat(31) }])('rejeita estrutura assinada incompatível %j', alteracao => expect(verificarXmlEventoOficial(xml('105104', alteracao), contexto)).toBeNull());
  it('rejeita adulteração do conteúdo assinado', () => expect(verificarXmlEventoOficial(xml().replace('Justificativa fiscal', 'Conteúdo adulterado'), contexto)).toBeNull());
  it('rejeita wrapping e IDs duplicados', () => { const signed = xml(); expect(verificarXmlEventoOficial(signed.replace('</evento>', `<infEvento Id="EVT${contexto.chaveAcesso}101101001"/></evento>`), contexto)).toBeNull(); });
  it('rejeita evento vazio ou campos obrigatórios ausentes', () => expect(verificarXmlEventoOficial(xml('101101', { semMotivo: true }), contexto)).toBeNull());
  it('rejeita sequência fora do evento único', () => expect(verificarXmlEventoOficial(xml('101101', { seq: '2' }), contexto)).toBeNull());
  it.each([{ chave: '4'.repeat(50) }, { ambiente: '1' }, { autor: '12345678000199' }])('não confirma contexto divergente %j', alteracao => expect(decidirConfirmacaoFiscalCancelamento(verificarXmlEventoOficial(xml('101101', alteracao), contexto), contexto).cancelada).toBe(false));
  it('isola empresa mesmo com chave coincidente', async () => {
    const { resposta } = await respostaDoAdaptador(xml());
    const evidencia = verificarRespostaCancelamento(resposta, contexto);
    expect(evidencia.evidencias[0].origemVerificada).toBe(true);
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, { ...contexto, companyId: 'empresa-b' }).cancelada).toBe(false);
  });
});
describe('coordenação sem efeitos fiscais reais', () => {
  function montar({ nova = true, corpo = null } = {}) {
    const ports = { reservar: jest.fn(async () => ({ nova })), marcarDespacho: jest.fn(), registrarResultado: jest.fn(), registrarFalha: jest.fn(), verificarResposta: verificarRespostaCancelamento };
    const transporte = { enviar: jest.fn(async () => corpo), consultar: jest.fn(async () => corpo) };
    const executar = criarCancelamentoFiscal(ports);
    const args = { contexto, prepararTransporte: jest.fn(async () => transporte), revalidarAutorizacao: jest.fn() };
    return { ports, transporte, executar, args };
  }
  it('HTTP 200 sem evento preserva estado fiscal e retorna inconclusivo', async () => { const c = montar({ corpo: { ok: true } }); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); expect(c.ports.registrarResultado).toHaveBeenCalledWith(expect.anything(), contexto, null, { situacao: 'INCONCLUSIVO', cancelada: false }); });
  it('resultado incerto só consulta, não reenvia', async () => { const c = montar({ nova: false }); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.transporte.consultar).toHaveBeenCalledTimes(1); });
  it('resposta tardia do adaptador é reconciliada sem retransmissão', async () => { const { resposta } = await respostaDoAdaptador(xml(), 'consultar'); const c = montar({ nova: false, corpo: resposta }); await expect(c.executar(c.args)).resolves.toMatchObject({ confirmacaoFiscal: true }); expect(c.transporte.enviar).not.toHaveBeenCalled(); });
  it.each([true, false])('transporte falso sem procedência não confirma XML sintético assinado (reserva nova: %s)', async nova => {
    const c = montar({ nova, corpo: xml() });
    await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' });
    expect(c.ports.registrarResultado).toHaveBeenCalledWith(expect.anything(), contexto, null, { situacao: 'INCONCLUSIVO', cancelada: false });
  });
  it('revogação após assinatura impede POST', async () => { const c = montar(); c.args.revalidarAutorizacao.mockResolvedValueOnce().mockRejectedValueOnce(new Error('revogado')); await expect(c.executar(c.args)).rejects.toThrow('revogado'); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.ports.marcarDespacho).not.toHaveBeenCalled(); });
  it('negativa inicial não reserva nem consulta transporte', async () => { const c = montar(); c.args.revalidarAutorizacao.mockRejectedValue(new Error('sem vínculo')); await expect(c.executar(c.args)).rejects.toThrow('sem vínculo'); expect(c.ports.reservar).not.toHaveBeenCalled(); expect(c.args.prepararTransporte).not.toHaveBeenCalled(); });
  it('falha de certificado antes de despacho novo preserva recusa local', async () => { const c = montar(); c.args.prepararTransporte.mockRejectedValue(Object.assign(new Error('certificado ausente'), { code: 'NO_COMPANY_CERT' })); await expect(c.executar(c.args)).rejects.toMatchObject({ code: 'NO_COMPANY_CERT', antesDoPost: true }); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.ports.registrarFalha).toHaveBeenCalledWith(expect.anything(), { incerto: false, codigo: 'NO_COMPANY_CERT' }); });
  it('falha ao preparar consulta de reserva antiga não afirma ausência de despacho anterior', async () => { const c = montar({ nova: false }); c.args.prepararTransporte.mockRejectedValue(new Error('certificado ausente')); const erro = await c.executar(c.args).catch(e => e); expect(erro.antesDoPost).not.toBe(true); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.ports.registrarFalha).toHaveBeenCalledWith(expect.anything(), { incerto: true, codigo: 'FALHA_LOCAL' }); });
  it('timeout persiste incerteza e não autoriza repetição', async () => { const c = montar(); c.transporte.enviar.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); expect(c.ports.registrarFalha).toHaveBeenCalledWith(expect.anything(), { incerto: true, codigo: 'ETIMEDOUT' }); });
  it('falha de persistência após resposta impede sucesso fiscal público', async () => { const { resposta } = await respostaDoAdaptador(xml()); const c = montar({ corpo: resposta }); c.ports.registrarResultado.mockRejectedValue(new Error('banco indisponível')); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); });
});
