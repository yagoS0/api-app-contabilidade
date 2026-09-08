import { Prisma } from '@prisma/client';
import { aplicarSaldosProjetados, validarSaldoInicial, salvarSaldoInicialFluxo, lerSaldoInicialFluxo } from '../SaldoInicialFluxoService.js';

const meses = ['2026-11','2026-12','2027-01','2027-02'].map(competencia => ({ competencia, linhas: [] }));
const saldoInicial = { dataReferencia: '2026-12-01', valor: 5000 };
const linhas = [
  { competencia:'2026-11', valor:10000, direcao:'ENTRADA', procedencia:'FATO' },
  { competencia:'2026-12', valor:1000.10, direcao:'ENTRADA', procedencia:'FATO' },
  { competencia:'2026-12', valor:200.20, direcao:'SAIDA', procedencia:'PREVISAO' },
  { competencia:'2027-02', valor:300, direcao:'SAIDA', procedencia:'COMPROMISSO' },
];
test('âncora não incorpora histórico anterior; virada de ano e mês vazio preservam saldo', () => {
  const r = aplicarSaldosProjetados({meses,linhas,saldoInicial});
  expect(r.map(m => m.saldo)).toEqual([
    {inicial:null,final:null,projetado:true},
    {inicial:5000,final:5799.90,projetado:true},
    {inicial:5799.90,final:5799.90,projetado:true},
    {inicial:5799.90,final:5499.90,projetado:true},
  ]);
});
test('mudar janela visual não perde valores acumulados antes dela', () => {
  const r = aplicarSaldosProjetados({meses:[meses[3]],linhas,saldoInicial});
  expect(r[0].saldo).toEqual({inicial:5799.90,final:5499.90,projetado:true});
});
test('ausência de âncora não assume zero; zero explicitamente informado é válido', () => {
  expect(aplicarSaldosProjetados({meses,linhas})[2].saldo.inicial).toBeNull();
  expect(aplicarSaldosProjetados({meses,linhas,saldoInicial:{...saldoInicial,valor:0}})[2].saldo.inicial).toBe(799.9);
});
test.each([null, '', [], {}, true, 'NaN', '1.234', '1,50', '1000000000000', Infinity])('recusa saldo inválido %p', valor => {
  expect(() => validarSaldoInicial({dataReferencia:'2026-09-01',valor})).toThrow();
});
test.each(['2026-13-01','2026-02-30','2026-09-02','2026-9-01'])('recusa data sem âncora mensal válida %s', dataReferencia => {
  expect(() => validarSaldoInicial({dataReferencia,valor:100})).toThrow();
});
test('saldo negativo e centavos persistem como valor decimal, com autor e escopo do servidor', async () => {
  const client = {saldoInicialFluxo:{create:jest.fn(async ({data})=>({...data,id:1,valor:new Prisma.Decimal(data.valor),criadoEm:new Date()})),findFirst:jest.fn()}};
  const r = await salvarSaldoInicialFluxo({portalClientId:'empresa-a',usuarioId:'usuario-a',dataReferencia:'2026-09-01',valor:'-10.25',client});
  expect(r.valor).toBe(-10.25);
  expect(client.saldoInicialFluxo.create.mock.calls[0][0].data).toMatchObject({portalClientId:'empresa-a',criadoPor:'usuario-a',valor:'-10.25'});
  client.saldoInicialFluxo.findFirst.mockResolvedValue({id:2,valor:null,dataReferencia:null});
  expect(await lerSaldoInicialFluxo('empresa-b',client)).toBeNull();
  expect(client.saldoInicialFluxo.findFirst).toHaveBeenCalledWith({where:{portalClientId:'empresa-b'},orderBy:{id:'desc'}});
  client.saldoInicialFluxo.create.mockImplementation(async ({data})=>({...data,id:2}));
  expect(await salvarSaldoInicialFluxo({portalClientId:'empresa-a',usuarioId:'usuario-a',remover:true,client})).toBeNull();
  expect(client.saldoInicialFluxo.create.mock.calls[1][0].data).toMatchObject({valor:null,dataReferencia:null,criadoPor:'usuario-a'});
});
