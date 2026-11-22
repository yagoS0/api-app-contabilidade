import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { decidirConfirmacaoFiscalCancelamento } from '../../../modules/nfse/domain/confirmacaoFiscalCancelamento.js';
import { verificarXmlEventoOficial } from '../../../modules/nfse/infrastructure/http/cancelamentoFiscal.js';
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
describe('evento fiscal oficial com chaves sintéticas efêmeras', () => {
  it.each([['101101', 'CONFIRMADO'], ['101103', 'PENDENTE'], ['105104', 'CONFIRMADO'], ['105105', 'INDEFERIDO']])('%s distingue %s', (tipo, situacao) => {
    const evidencia = verificarXmlEventoOficial(xml(tipo), contexto);
    expect(evidencia).not.toBeNull();
    expect(decidirConfirmacaoFiscalCancelamento(evidencia, contexto).situacao).toBe(situacao);
  });
  it('autor municipal não é confundido com a prestadora', () => expect(decidirConfirmacaoFiscalCancelamento(verificarXmlEventoOficial(xml('105104', { autor: '12345678000199' }), contexto), contexto).cancelada).toBe(true));
  it.each([{}, { ok: true }, { status: 'accepted' }, '', '<evento>', '<!DOCTYPE evento><evento/>'])('não promove resposta %j a confirmação', body => expect(verificarXmlEventoOficial(body, contexto)).toBeNull());
  it.each([{ autorNamespace: 'urn:alheio' }, { autor: '12345678901' }, { nDFSe: '1'.repeat(14) }, { nProcAdm: '1'.repeat(31) }])('rejeita estrutura assinada incompatível %j', alteracao => expect(verificarXmlEventoOficial(xml('105104', alteracao), contexto)).toBeNull());
  it('rejeita adulteração do conteúdo assinado', () => expect(verificarXmlEventoOficial(xml().replace('Justificativa fiscal', 'Conteúdo adulterado'), contexto)).toBeNull());
  it('rejeita wrapping e IDs duplicados', () => { const signed = xml(); expect(verificarXmlEventoOficial(signed.replace('</evento>', `<infEvento Id="EVT${contexto.chaveAcesso}101101001"/></evento>`), contexto)).toBeNull(); });
  it('rejeita evento vazio ou campos obrigatórios ausentes', () => expect(verificarXmlEventoOficial(xml('101101', { semMotivo: true }), contexto)).toBeNull());
  it('rejeita sequência fora do evento único', () => expect(verificarXmlEventoOficial(xml('101101', { seq: '2' }), contexto)).toBeNull());
  it.each([{ chave: '4'.repeat(50) }, { ambiente: '1' }, { autor: '12345678000199' }])('não confirma contexto divergente %j', alteracao => expect(decidirConfirmacaoFiscalCancelamento(verificarXmlEventoOficial(xml('101101', alteracao), contexto), contexto).cancelada).toBe(false));
  it('isola empresa mesmo com chave coincidente', () => expect(decidirConfirmacaoFiscalCancelamento(verificarXmlEventoOficial(xml(), contexto), { ...contexto, companyId: 'empresa-b' }).cancelada).toBe(false));
});
describe('coordenação sem efeitos fiscais reais', () => {
  function montar({ nova = true, corpo = null } = {}) {
    const ports = { reservar: jest.fn(async () => ({ nova })), marcarDespacho: jest.fn(), registrarResultado: jest.fn(), registrarFalha: jest.fn(), verificarResposta: verificarXmlEventoOficial };
    const transporte = { enviar: jest.fn(async () => corpo), consultar: jest.fn(async () => corpo) };
    const executar = criarCancelamentoFiscal(ports);
    const args = { contexto, prepararTransporte: jest.fn(async () => transporte), revalidarAutorizacao: jest.fn() };
    return { ports, transporte, executar, args };
  }
  it('HTTP 200 sem evento preserva estado fiscal e retorna inconclusivo', async () => { const c = montar({ corpo: { ok: true } }); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); expect(c.ports.registrarResultado).toHaveBeenCalledWith(expect.anything(), contexto, null, { situacao: 'INCONCLUSIVO', cancelada: false }); });
  it('resultado incerto só consulta, não reenvia', async () => { const c = montar({ nova: false }); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.transporte.consultar).toHaveBeenCalledTimes(1); });
  it('resposta tardia válida é reconciliada sem retransmissão', async () => { const c = montar({ nova: false, corpo: xml() }); await expect(c.executar(c.args)).resolves.toMatchObject({ confirmacaoFiscal: true }); expect(c.transporte.enviar).not.toHaveBeenCalled(); });
  it('revogação após assinatura impede POST', async () => { const c = montar(); c.args.revalidarAutorizacao.mockResolvedValueOnce().mockRejectedValueOnce(new Error('revogado')); await expect(c.executar(c.args)).rejects.toThrow('revogado'); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.ports.marcarDespacho).not.toHaveBeenCalled(); });
  it('negativa inicial não reserva nem consulta transporte', async () => { const c = montar(); c.args.revalidarAutorizacao.mockRejectedValue(new Error('sem vínculo')); await expect(c.executar(c.args)).rejects.toThrow('sem vínculo'); expect(c.ports.reservar).not.toHaveBeenCalled(); expect(c.args.prepararTransporte).not.toHaveBeenCalled(); });
  it('falha de certificado antes de despacho novo preserva recusa local', async () => { const c = montar(); c.args.prepararTransporte.mockRejectedValue(Object.assign(new Error('certificado ausente'), { code: 'NO_COMPANY_CERT' })); await expect(c.executar(c.args)).rejects.toMatchObject({ code: 'NO_COMPANY_CERT', antesDoPost: true }); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.ports.registrarFalha).toHaveBeenCalledWith(expect.anything(), { incerto: false, codigo: 'NO_COMPANY_CERT' }); });
  it('falha ao preparar consulta de reserva antiga não afirma ausência de despacho anterior', async () => { const c = montar({ nova: false }); c.args.prepararTransporte.mockRejectedValue(new Error('certificado ausente')); const erro = await c.executar(c.args).catch(e => e); expect(erro.antesDoPost).not.toBe(true); expect(c.transporte.enviar).not.toHaveBeenCalled(); expect(c.ports.registrarFalha).toHaveBeenCalledWith(expect.anything(), { incerto: true, codigo: 'FALHA_LOCAL' }); });
  it('timeout persiste incerteza e não autoriza repetição', async () => { const c = montar(); c.transporte.enviar.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); expect(c.ports.registrarFalha).toHaveBeenCalledWith(expect.anything(), { incerto: true, codigo: 'ETIMEDOUT' }); });
  it('falha de persistência após resposta impede sucesso fiscal público', async () => { const c = montar({ corpo: xml() }); c.ports.registrarResultado.mockRejectedValue(new Error('banco indisponível')); await expect(c.executar(c.args)).rejects.toMatchObject({ situacao: 'INCONCLUSIVO' }); });
});
