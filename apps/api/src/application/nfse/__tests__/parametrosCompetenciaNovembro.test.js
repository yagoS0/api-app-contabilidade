import { parametrosMunicipaisDaCompetencia as resolver } from '../parametrosMunicipaisCompetencia.js';
import { prepararDpsNovembro2026Offline as preparar } from '../laboratorio/dpsNovembro2026.js';
import { xmlBase } from './fixtures/dpsNovembro2026.js';
const escopo = { companyId: 'empresa', ambiente: 'homolog', municipio: '3304557', codigoServico: '170601001', competencia: '2026-11-03' };
const registro = () => ({ ...escopo, id: 'consulta', recurso: 'servico', origem: 'https://adn.producaorestrita.nfse.gov.br/parametrizacao',
  caminho: '/3304557/17.06.01.001/historicoaliquotas', status: 'RECEBIDO_PARA_CONFERENCIA', httpStatus: 200,
  resposta: { aliquotas: { '17.06.01.001': [{ Aliq: 5, Incidencia: 'SIM', DtIni: '2026-01-01T00:00:00', DtFim: null }] } } });
const linha = r => r.resposta.aliquotas['17.06.01.001'][0];
test('seleciona vigência do serviço sem inferir deduções, convênio ou Simples', () => {
  expect(resolver({ ...escopo, consultas: [registro()] })).toMatchObject({ estado: 'HISTORICO_LOCALIZADO', aliquotaIss: 5, validacaoMunicipalCompleta: false,
    pendencias: ['CONVENIO_POR_COMPETENCIA', 'ADMISSAO_AJUSTES_POR_COMPETENCIA'] });
});
test.each([['companyId','outra'],['ambiente','producao'],['municipio','3550308'],['codigoServico','170601002'],['origem','https://falso'],['httpStatus',500],['status','FALHOU'],['caminho','/outro']])('não aproveita consulta fora do escopo: %s', (campo,valor) => {
  expect(resolver({ ...escopo, consultas: [{ ...registro(), [campo]: valor }] }).estado).toBe('PENDENTE');
});
test.each(['2026-02-30', 'ontem'])('recusa vigência inválida: %s', data => {
  const r = registro(); linha(r).DtIni = data;
  expect(resolver({ ...escopo, consultas: [r] }).pendencias).toContain('PARAMETROS_VIGENCIA_INVALIDA');
});
test('consulta recente não comprova competência anterior', () => {
  const r = registro(); linha(r).DtIni = '2026-11-04';
  expect(resolver({ ...escopo, consultas: [r] }).pendencias).toContain('PARAMETROS_SEM_VIGENCIA');
});
test('sobreposição e divergências não escolhem arbitrariamente alíquota', () => {
  const a = registro(), b = registro(); linha(b).Aliq = 2;
  expect(resolver({ ...escopo, consultas: [a,b] }).pendencias).toContain('PARAMETROS_RESPOSTAS_DIVERGENTES');
  a.resposta.aliquotas['17.06.01.001'].push({ ...linha(a) });
  expect(resolver({ ...escopo, consultas: [a] }).pendencias).toContain('PARAMETROS_VIGENCIA_AMBIGUA');
});
const evidencia = { documento: '11222333000181', papel: 'toma', fonte: 'RFB', referencia: 'evidencia-sintetica', conferido: true, existe: true, vigenciaInicio: '2026-01-01', vigenciaFim: null };
const executar = evidenciasCadastrais => preparar({ xmlBase, contrato: 'NT009_V1_01_NOVEMBRO_2026', evidenciasCadastrais });
test('evidência por competência produz conferência local, sem liberação', () => {
  const r = executar([evidencia]); expect(r.cadastros.conferencias).toHaveLength(1);
  expect(r.cadastros.autenticidadeVerificada).toBe(false); expect(r.liberadoParaEmissao).toBe(false);
  expect(r.pendencias).toContain('CEP_TOMA_POR_COMPETENCIA');
});
test.each([{ vigenciaInicio: '2026-11-04' }, { fonte: 'CADASTRO_ATUAL' }, { documento: 'outro' }, { conferido: false }, { referencia: '' }])('não presume histórico cadastral: %p', alteracao => {
  expect(executar([{ ...evidencia, ...alteracao }]).cadastros.pendencias).toContain('CADASTRO_TOMA_POR_COMPETENCIA');
});
test('histórico cadastral ambíguo permanece pendente', () => expect(executar([evidencia,evidencia]).cadastros.conferencias).toHaveLength(0));
test('inexistência confirmada impede preparação', () => expect(() => executar([{ ...evidencia, existe: false }])).toThrow('Documento inexistente'));
function comDest(municipio, codigo = '170601', documento = '11222333000262') {
  const dest = `<dest><CNPJ>${documento}</CNPJ><xNome>Destinatário sintético</xNome><end><endNac><cMun>${municipio}</cMun><CEP>20040002</CEP></endNac><xLgr>Rua</xLgr><nro>1</nro><xBairro>Centro</xBairro></end></dest>`;
  return xmlBase.replace('<indDest>0</indDest>', `<indDest>1</indDest>${dest}`).replace('<cTribNac>170601</cTribNac>', `<cTribNac>${codigo}</cTribNac>`);
}
const destEvidencia = { ...evidencia, papel: 'dest', documento: '11222333000262', municipio: '3550308' };
test('divergência cadastral do destinatário tem rejeição própria', () => {
  expect(() => preparar({ xmlBase: comDest('3304557'), contrato: 'NT009_V1_01_NOVEMBRO_2026', evidenciasCadastrais: [destEvidencia] })).toThrow('Município do destinatário diverge');
});
test('170501 mesma raiz dispensa igualdade municipal, mas não existência', () => {
  const entrada = { xmlBase: comDest('3304557','170501'), contrato: 'NT009_V1_01_NOVEMBRO_2026', evidenciasCadastrais: [destEvidencia] };
  expect(preparar(entrada).cadastros.conferencias).toHaveLength(1);
  expect(() => preparar({ ...entrada, evidenciasCadastrais: [{ ...destEvidencia, existe: false }] })).toThrow('Documento inexistente');
});
