import { extrairCnpjComercial, interpretarColetaComercial } from '../interpretacaoComercialWhatsapp.js';
const a='11222333000181', b='04252011000110';
const selecionado=cnpj=>({cnpj,invalido:false,ambiguo:false});
test.each([
 ['11222333000181',a], ['CNPJ 11.222.333/0001-81',a],
 ['Pode consultar meu CNPJ 11222333000181?',a],
 ['Meu CNPJ não é 11222333000181, o correto é 04252011000110',b],
 ['11222333000181 está errado, o correto é 04252011000110',b],
 ['11222333000181, corrigindo: 04252011000110',b],
 ['Não use o CNPJ 11222333000181; considere este CNPJ: 04252011000110',b],
 ['O correto é 04252011000110, não é 11222333000181',b],
 ['CNPJ 11222333000181, repito 11.222.333/0001-81',a],
 ['11222333000100 está errado, o correto é 04252011000110',b],
])('seleciona documento declarado sem usar negado: %s',(texto,cnpj)=>{
 expect(extrairCnpjComercial(texto)).toEqual(selecionado(cnpj));
 expect(interpretarColetaComercial({texto,origem:'INATIVA'}).operacoes).toContainEqual({campo:'cnpj',acao:'set',valor:cnpj});
});
test.each([
 'Tenho 11222333000181 e 04252011000110',
 'Pode ser 11222333000181 ou 04252011000110',
 'Não é 11222333000181',
 'Desconsidere 11222333000181',
 '11222333000181 não é meu',
 '11222333000100 ou 04252011000110',
])('documentos ambíguos ou negados pedem confirmação: %s',texto=>{
 expect(extrairCnpjComercial(texto)).toEqual({cnpj:null,invalido:false,ambiguo:true});
 const r=interpretarColetaComercial({texto,origem:'INATIVA',dadosAtuais:{cnpj:a}});
 expect(r.operacoes.some(o=>o.campo==='cnpj')).toBe(false);expect(r.resposta).toContain('CNPJ correto');
});
test.each(['11222333000100','11111111111111','11222333000181, corrigindo: 11222333000100'])('dígito incorreto apenas no documento selecionado: %s',texto=>{
 expect(extrairCnpjComercial(texto)).toEqual({cnpj:null,invalido:true,ambiguo:false});
});
test.each(['Meu CPF é 52998224725, serve?','Quero que consultem para mim','Não sei o CNPJ','Meu telefone é 21994400833'])('não inventa CNPJ nem erro de validação: %s',texto=>{
 expect(extrairCnpjComercial(texto)).toEqual({cnpj:null,invalido:false,ambiguo:false});
});

test('CNPJ antigo pode ser a empresa que o cliente quer reativar',()=>{
 expect(extrairCnpjComercial('Quero reativar meu CNPJ antigo 11222333000181')).toEqual(selecionado(a));
});
test.each(['O correto é 11222333000181 ou 04252011000110','Não quero consultar 11222333000181'])('não escolhe uma alternativa nem um documento recusado: %s',texto=>{
 expect(extrairCnpjComercial(texto)).toEqual({cnpj:null,invalido:false,ambiguo:true});
});
