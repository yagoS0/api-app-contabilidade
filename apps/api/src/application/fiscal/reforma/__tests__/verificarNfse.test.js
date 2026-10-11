import { verificarNfse } from '../verificarNfse.js';
const cnpj = '11111111000111';
const cadastro = { periodos: [{ inicio: '2026-01-01', fim: null, regime: 'LUCRO_PRESUMIDO', forma: 'REGULAR', situacao: 'CONFIRMADA' }] };
const xml = ({ regime = '1', competencia = '2026-12-01', bloco = true, cst = '000', nbs = '115021000' } = {}) => `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe><DPS><infDPS><dCompet>${competencia}</dCompet><prest><CNPJ>${cnpj}</CNPJ><regTrib><opSimpNac>${regime}</opSimpNac></regTrib></prest><serv><cServ><cTribNac>171901</cTribNac>${nbs ? `<cNBS>${nbs}</cNBS>` : ''}</cServ></serv>${bloco ? `<IBSCBS><cIndOp>100301</cIndOp><valores><trib><gIBSCBS><CST>${cst}</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>` : ''}</infDPS></DPS></infNFSe></NFSe>`;
const nota = patch => ({ id: 'n', numero: '1', competencia: new Date('2026-12-01'), papel: 'EMIT', statusEfetivo: 'autorizada', xmlRaw: xml(), ...patch });
const run = (patch, contexto = { cadastro, cnpj }) => verificarNfse(nota(patch), contexto);
const codigos = r => r.achados.map(a => a.codigo);
test('bloco nacional válido passa somente nas regras cobertas', () => expect(run().status).toBe('SEM_ACHADOS'));
test('reutiliza incompatibilidade CST/classificação do emissor', () => expect(codigos(run({ xmlRaw: xml({ cst: '200' }) }))).toContain('NFSE_IBSCBS_CST_INCOMPATIVEL'));
test('grupo obrigatório ausente e NBS ausente não são sucesso', () => {
  expect(codigos(run({ xmlRaw: xml({ bloco: false }) }))).toContain('NFSE_IBSCBS_OBRIGATORIO_AUSENTE');
  expect(codigos(run({ xmlRaw: xml({ nbs: '' }) }))).toContain('NFSE_IBSCBS_SEM_NBS');
});
test('XML ausente, incompleto ou municipal ficam distintos', () => {
  expect(codigos(run({ xmlRaw: null }))).toEqual(['XML_AUSENTE']);
  expect(codigos(run({ xmlRaw: '<NFSe>' }))).toEqual(['XML_INVALIDO']);
  expect(codigos(run({ xmlRaw: '<CompNfse><Nfse/></CompNfse>' }))).toEqual(['LEIAUTE_NAO_COBERTO']);
});
test('não interpreta DTD ou entidade externa', () => expect(codigos(run({ xmlRaw: '<!DOCTYPE x SYSTEM "file:///segredo"><NFSe/>' }))).toContain('XML_INVALIDO'));
test('versão futura e namespace inesperado não ganham resultado sem achados', () => {
  expect(codigos(run({ xmlRaw: xml().replace('versao="1.01"', 'versao="9.99"') }))).toContain('VERSAO_NAO_COBERTA');
  expect(codigos(run({ xmlRaw: xml().replace('http://www.sped.fazenda.gov.br/nfse', 'urn:outro') }))).toContain('VERSAO_NAO_COBERTA');
});
test('não usa o regime do tomador para criticar nota recebida', () => {
  const r = run({ papel: 'DEST', xmlRaw: xml({ regime: '3', bloco: false }) });
  expect(codigos(r)).not.toContain('REGIME_DIVERGENTE');
  expect(codigos(r)).not.toContain('NFSE_IBSCBS_OBRIGATORIO_AUSENTE');
});
test('histórico em estudo não é aplicado à nota emitida', () => {
  const r = run({}, { cnpj, cadastro: { periodos: [{ ...cadastro.periodos[0], situacao: 'EM_ESTUDO' }] } });
  expect(codigos(r)).toContain('HISTORICO_PENDENTE');
});
test('divergência do regime registrado gera erro', () => expect(codigos(run({ xmlRaw: xml({ regime: '3' }) }))).toContain('REGIME_DIVERGENTE'));
test('não atribui a data de emissão a uma nota sem competência', () => {
  expect(codigos(run({ competencia: null }))).toContain('COMPETENCIA_BASE');
  expect(codigos(run({ xmlRaw: xml({ competencia: '' }) }))).toContain('COMPETENCIA_AUSENTE');
});
test('cancelada está fora da conferência sem exigir XML', () => expect(run({ statusEfetivo: 'cancelada', xmlRaw: null })).toMatchObject({ status: 'EXCLUIDA', achados: [] }));
test('indeterminação de operação não vira dispensa ou erro fiscal presumido', () => {
  const r = run({ competencia: new Date('2026-10-01'), xmlRaw: xml({ competencia: '2026-10-01', bloco: false }) });
  expect(r.status).toBe('REVISAO');
  expect(codigos(r)).toContain('OBRIGACAO_INDETERMINADA');
  expect(codigos(r)).not.toContain('NFSE_IBSCBS_OBRIGATORIO_AUSENTE');
});
test('reaproveita categoria preservada na própria emissão para o prazo de outubro', () => {
  const r = run({ competencia: new Date('2026-10-01'), xmlRaw: xml({ competencia: '2026-10-01', bloco: false }) },
    { cnpj, cadastro, configuracaoFiscal: { categoriaObrigacaoIbscbs: 'SERVICO_ISS' } });
  expect(codigos(r)).toContain('NFSE_IBSCBS_OBRIGATORIO_AUSENTE');
  expect(codigos(r)).not.toContain('OBRIGACAO_INDETERMINADA');
});
test('Simples 2027 continua pendente de regras da operação, mesmo com opção confirmada', () => {
  const r = run({ competencia: new Date('2027-01-01'), xmlRaw: xml({ competencia: '2027-01-01', regime: '3' }) }, { cnpj,
    cadastro: { periodos: [{ ...cadastro.periodos[0], inicio: '2027-01-01', regime: 'SIMPLES' }] } });
  expect(codigos(r)).toContain('OBRIGACAO_INDETERMINADA');
});
