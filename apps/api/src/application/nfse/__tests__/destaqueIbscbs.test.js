import { gzipSync } from 'node:zlib';
import { destaqueIbscbs } from '../destaqueIbscbs.js';
import { lerNfse } from '../danfse/danfseDados.js';
const dps = '<DPS><infDPS><IBSCBS><valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS></infDPS></DPS>';
const xml = (ibs, cbs, extra = '') => `<NFSe><infNFSe Id="NFS${'1'.repeat(50)}"><verCalcIBSCBS>2026</verCalcIBSCBS>${dps}<IBSCBS><valores><vBC>1000.00</vBC><fed><pCBS>0.90</pCBS></fed></valores><totCIBS><gIBS>${ibs == null ? '' : `<vIBSTot>${ibs}</vIBSTot>`}</gIBS><gCBS>${cbs == null ? '' : `<vCBS>${cbs}</vCBS>`}</gCBS>${extra}</totCIBS></IBSCBS></infNFSe></NFSe>`;
test('destaque usa valores autorizados e total da origem sem recalcular nota', () => {
  expect(destaqueIbscbs(xml('1.00','9.00','<vTotNF>1000.00</vTotNF>'))).toMatchObject({ estado: 'VALORES_PRESENTES', baseCalculo: '1.000,00', ibsTotal: '1,00', cbs: '9,00', total: '10,00', valorTotalNota: '1.000,00', aliquotaCbs: '0,90 %' });
});
test.each([[null,'9.00'],['1.00',null],['inválido','9.00']])('tributo ausente ou inválido não é zero (%s,%s)', (ibs,cbs) => {
  expect(destaqueIbscbs(xml(ibs,cbs))).toMatchObject({ estado: 'VALORES_PARCIAIS', total: null });
  expect(lerNfse(xml(ibs,cbs)).valores.totalIbsCbs).toBeNull();
});
test('zero explícito é apresentado e soma decimal é exata', () => {
  expect(destaqueIbscbs(xml('0.00','0.00'))).toMatchObject({ estado: 'VALORES_PRESENTES', total: '0,00' });
  expect(destaqueIbscbs(xml('0.10','0.20')).total).toBe('0,30');
});
test('separa DPS enviada, ausência, declaração sem retorno e envelope comprimido', () => {
  expect(destaqueIbscbs('<DPS/>').estado).toBe('XML_AUTORIZADO_INDISPONIVEL');
  expect(destaqueIbscbs(`<NFSe><infNFSe>${dps}</infNFSe></NFSe>`).estado).toBe('DECLARADO_SEM_VALORES_RETORNADOS');
  expect(destaqueIbscbs('<NFSe><infNFSe/></NFSe>').estado).toBe('NAO_INFORMADO');
  expect(destaqueIbscbs(gzipSync(xml('1.00','9.00')).toString('base64')).total).toBe('10,00');
});
