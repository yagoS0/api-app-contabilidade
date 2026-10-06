import { lerNfse } from '../danfseDados.js';

const envolver = dps => `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${'1'.repeat(50)}"><verCalcIBSCBS>teste-2026</verCalcIBSCBS><DPS><infDPS>${dps}</infDPS></DPS></infNFSe></NFSe>`;
it('lê os caminhos da NT 009 sem confundir CST de PIS/COFINS', () => {
  const r = lerNfse(envolver('<finNFSe>1</finNFSe><dest><CNPJ>12ABC34501DE35</CNPJ><xNome>DESTINATARIO</xNome></dest><valores><trib><tribFed><piscofins><CST>01</CST></piscofins></tribFed></trib></valores><IBSCBS><valores><trib><CST>000</CST><cClassTrib>000001</cClassTrib></trib></valores></IBSCBS>'));
  expect(r.valores.finNFSe).toBe('1');
  expect(r.valores.cstCClassTrib).toBe('000 / 000001');
  expect(r.meta.destinatarioIdentificado).toBe(true);
  expect(r.meta.versaoCalculadoraIBSCBS).toBe('teste-2026');
});
it('preserva o contrato anterior e não converte ausência em zero', () => {
  const r = lerNfse(envolver('<IBSCBS><finNFSe>0</finNFSe><valores><trib><gIBSCBS><CST>200</CST><cClassTrib>200052</cClassTrib></gIBSCBS></trib></valores></IBSCBS>'));
  expect(r.valores.finNFSe).toBe('0');
  expect(r.valores.cstCClassTrib).toBe('200 / 200052');
  expect(lerNfse(envolver('')).valores.cstCClassTrib).toBeNull();
});
