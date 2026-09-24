import { tomadorDoModelo } from '../tomadorDoModelo.js';
const endereco = '<end><endNac><cMun>3550308</cMun><CEP>01234000</CEP></endNac><xLgr>Rua A &amp; B</xLgr><nro>007</nro><xCpl>Sala 2</xCpl><xBairro>Centro</xBairro></end>';
const xml = (end = endereco) => `<NFSe><infNFSe><emit><CNPJ>999</CNPJ>${endereco}</emit><DPS><infDPS><prest><CNPJ>888</CNPJ>${endereco}</prest><toma><CNPJ>12345678000190</CNPJ><xNome>Tomador antigo</xNome><email>antigo@example.test</email>${end}</toma></infDPS></DPS></infNFSe></NFSe>`;
test('lê exclusivamente o tomador da nota, preserva zeros e decodifica XML', () => {
  expect(tomadorDoModelo(xml(), '12.345.678/0001-90')).toEqual({
    cnpjCpf:'12345678000190', nome:'Tomador antigo', email:'antigo@example.test',
    endereco:{cMun:'3550308',CEP:'01234000',xLgr:'Rua A & B',nro:'007',xCpl:'Sala 2',xBairro:'Centro'},
  });
});
test('endereço ausente não usa endereço do emitente ou prestador', () => {
  expect(tomadorDoModelo(xml(''), '12345678000190').endereco).toBeNull();
});
test('não mistura documento divergente nem endereço exterior', () => {
  expect(tomadorDoModelo(xml(), '99999999000199')).toBeNull();
  expect(tomadorDoModelo(xml('<end><endExt><cPais>US</cPais></endExt><xLgr>A</xLgr></end>'), '12345678000190').endereco).toBeNull();
});
test.each([null, '', '<NFSe>', '<!DOCTYPE a [<!ENTITY e "x">]><NFSe/>'])('ausência ou XML inválido não inventa dados (%s)', valor => {
  expect(tomadorDoModelo(valor, '12345678000190')).toBeNull();
});
test('suporta DPS da emissão local e namespaces', () => {
  const dps = '<n:DPS xmlns:n="urn:nfse"><n:infDPS><n:toma><n:CPF>01234567890</n:CPF><n:xNome>Pessoa</n:xNome></n:toma></n:infDPS></n:DPS>';
  expect(tomadorDoModelo(dps, '01234567890')).toMatchObject({cnpjCpf:'01234567890',nome:'Pessoa',endereco:null});
});
