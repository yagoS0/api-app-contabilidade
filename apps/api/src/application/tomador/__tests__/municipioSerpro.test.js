import { municipioSerpro } from '../municipioSerpro.js';
import { criarSerproCnpjEmpresa } from '../serproCnpjBasica.js';
const municipios = [['3304557', 'Rio de Janeiro', 'RJ'], ['1100106', 'Guajará-Mirim', 'RO']];
const endereco = { municipio: { codigo: '6001', descricao: 'RIO DE JANEIRO' }, uf: 'RJ' };
test('relação oficial aceita zeros à esquerda e acentuação', () => {
  expect(municipioSerpro({ municipio: { codigo: '0001', descricao: 'GUAJARA-MIRIM' }, uf: 'RO' }, municipios))
    .toEqual({ codigo_municipio_ibge: '1100106', municipio: 'Guajará-Mirim', uf: 'RO' });
});
test.each(['9999', '9997', '9707', '3304557', '60x01', '', null])('código desconhecido, exterior ou malformado fica parcial: %s', codigo => {
  expect(municipioSerpro({ ...endereco, municipio: { ...endereco.municipio, codigo } }, municipios)).toBeNull();
});
test.each([
  { ...endereco, uf: 'SP' },
  { ...endereco, municipio: { codigo: '6001', descricao: 'São Paulo' } },
  { ...endereco, municipio: { descricao: 'Rio de Janeiro' } },
])('não usa nome para adivinhar ou corrigir código divergente', entrada => {
  expect(municipioSerpro(entrada, municipios)).toBeNull();
});
test.each([null, [], [['3304557', 'Outra cidade', 'RJ']], [['3304557', 'Rio de Janeiro', 'SP']]])('exige corroboração pela lista IBGE carregada', lista => {
  expect(municipioSerpro(endereco, lista)).toBeNull();
});
test('Empresa usa a mesma conversão e conserva QSA', async () => {
  const cnpj = '11222333000181';
  const fetchImpl = jest.fn().mockResolvedValueOnce({status:200,json:async()=>({access_token:'fake',expires_in:3600})})
    .mockResolvedValueOnce({status:200,json:async()=>({ni:cnpj,nomeEmpresarial:'Teste',endereco:{...endereco,logradouro:'Teste',numero:'1',bairro:'Centro',cep:'20040020'},socios:[{nome:'Teste'}]})});
  const out = await criarSerproCnpjEmpresa({habilitado:true,consumerKey:'fake',consumerSecret:'fake',fetchImpl}).consultar(cnpj,{municipios});
  expect(out.tomador.endereco.cMun).toBe('3304557');
  expect(out.bruto.qsa[0].nome_socio).toBe('Teste');
});
