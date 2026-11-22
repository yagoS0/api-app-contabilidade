import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { decidirConfirmacaoFiscalCancelamento } from '../../../modules/nfse/domain/confirmacaoFiscalCancelamento.js';
import { verificarXmlEventoOficial, verificarRespostaCancelamento, criarTransporteCancelamento } from '../../../modules/nfse/infrastructure/http/cancelamentoFiscal.js';
import { criarCancelamentoFiscal } from '../../../modules/nfse/application/cancelamentoFiscal.js';

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
  const client = { defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, post: jest.fn(async () => ({ data: corpo })), get: jest.fn(async () => ({ data: corpo })) };
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
    const client = { defaults: { baseURL: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional' }, post: jest.fn(async () => ({ data: xml() })), get: jest.fn() };
    const transporte = criarTransporteCancelamento({ client, contexto: mutavel, caminho: `/nfse/${contexto.chaveAcesso}/eventos`, requestBody: {} });
    mutavel.companyId = 'empresa-b'; client.defaults.baseURL = 'https://example.invalid';
    const recibo = await transporte.enviar();
    expect(client.post.mock.calls[0][0]).toBe(`https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${contexto.chaveAcesso}/eventos`);
    expect(verificarRespostaCancelamento(recibo, contexto)).toMatchObject({ companyId: contexto.companyId, origemVerificada: true });
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
    if (metodo === 'enviar') expect(client.post).toHaveBeenCalledWith(`https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${contexto.chaveAcesso}/eventos`, {}, { proxy: false, timeout: 15000, maxRedirects: 0 });
    else expect(client.get).toHaveBeenCalledWith(`https://adn.producaorestrita.nfse.gov.br/contribuintes/NFSe/${contexto.chaveAcesso}/Eventos`, { proxy: false, timeout: 15000, maxRedirects: 0 });
    expect(verificarRespostaCancelamento(resposta, contexto)).toMatchObject({ origemVerificada: true });
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
    expect(evidencia.origemVerificada).toBe(true);
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
