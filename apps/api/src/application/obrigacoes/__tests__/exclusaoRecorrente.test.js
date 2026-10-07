jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { excluirOcorrencia } from '../ObrigacoesService.js';
import { restaurarOcorrencias } from '../recuperarOcorrencias.js';
const date = s => new Date(`${s}T00:00:00Z`);
function banco() {
  const serie = { id: 's', portalClientId: 'e', periodicidade: 'MENSAL', defasagemMeses: 1, agendaVersoes: [] };
  const rows = ['09', '10', '11'].map(m => ({ id: `o${m}`, obrigacaoId: 's', cicloChave: `2026-${m}`, status: m === '11' ? 'CONCLUIDA' : 'PENDENTE', dataVencimento: date(`2026-${m}-20`), obrigacao: serie }));
  const db = {
    $transaction: fn => fn(db),
    obrigacao: { findUnique: async () => serie, update: async ({ data }) => Object.assign(serie, data) },
    ocorrenciaObrigacao: {
      findFirst: async ({ where }) => where.obrigacao.portalClientId.in.includes('e') ? rows.find(o => o.id === where.id) : null,
      findUnique: async ({ where }) => rows.find(o => o.id === where.id),
      findMany: async () => rows,
      update: async ({ where, data }) => Object.assign(rows.find(o => o.id === where.id), data),
    },
  };
  return { db, serie, rows };
}
test('somente esta cancela um ciclo e conserva os próximos, inclusive concluída', async () => {
  const { db, serie, rows } = banco();
  expect(await excluirOcorrencia({ portalIds: ['e'], ocorrenciaId: 'o09' }, db)).toMatchObject({ canceladas: 1 });
  expect(rows[0].canceladaEm).toBeInstanceOf(Date); expect(rows[1].canceladaEm).toBeUndefined();
  expect(rows[2].status).toBe('CONCLUIDA'); expect(serie.encerradaAPartirDe).toBeUndefined();
});
test('esta e próximas deixa corte durável e mantém concluídas futuras', async () => {
  const { db, serie, rows } = banco();
  expect(await excluirOcorrencia({ portalIds: ['e'], ocorrenciaId: 'o10', alcance: 'ESTA_E_PROXIMAS' }, db)).toMatchObject({ canceladas: 1, concluidasPreservadas: 1 });
  expect(serie.encerradaAPartirDe).toBe('2026-10'); expect(serie.sobrescritaLocal).toBe(true);
  expect(rows[0].canceladaEm).toBeUndefined(); expect(rows[2].canceladaEm).toBeUndefined();
});
test('recusa empresa fora do escopo sem tocar série', async () => {
  const { db, serie } = banco();
  await expect(excluirOcorrencia({ portalIds: ['outra'], ocorrenciaId: 'o09' }, db)).rejects.toMatchObject({ status: 404 });
  expect(serie.agendaVersoes).toEqual([]);
});
test('agenda permite ocultar concluída conservando o registro da conclusão', async () => {
  const {db,rows}=banco();
  rows[2].concluidaEm=new Date('2026-11-10');
  await excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o11',incluirConcluidas:true},db);
  expect(rows[2].canceladaEm).toBeInstanceOf(Date);expect(rows[2].status).toBe('CONCLUIDA');expect(rows[2].concluidaEm).toEqual(new Date('2026-11-10'));
  expect(rows[0].canceladaEm).toBeUndefined();
});


test('esta e anteriores corta o passado e conserva o futuro e as conclusões', async()=>{
 const {db,serie,rows}=banco();rows[0].status='CONCLUIDA';rows[0].concluidaEm=date('2026-09-22');
 await excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o10',alcance:'ESTA_E_ANTERIORES',incluirConcluidas:true},db);
 expect(serie.excluidaAteCiclo).toBe('2026-10');expect(rows.slice(0,2).every(o=>o.canceladaEm)).toBe(true);
 expect(rows[2].canceladaEm).toBeUndefined();expect(rows[0].concluidaEm).toEqual(date('2026-09-22'));expect(rows[0].status).toBe('CONCLUIDA');
});
test('cortes anteriores e posteriores coexistem sem reabrir exclusões',async()=>{
 const {db,serie}=banco();
 await excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o10',alcance:'ESTA_E_ANTERIORES'},db);
 await excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o09',alcance:'ESTA_E_ANTERIORES'},db);
 await excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o11',alcance:'ESTA_E_PROXIMAS'},db);
 expect(serie.excluidaAteCiclo).toBe('2026-10');expect(serie.encerradaAPartirDe).toBe('2026-11');
});
test('alcance inválido não escreve',async()=>{
 const {db,serie}=banco();await expect(excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o10',alcance:'TODAS'},db)).rejects.toMatchObject({code:'alcance_invalido'});expect(serie.agendaVersoes).toEqual([]);
});

test.each(['ESTA','ESTA_E_PROXIMAS','ESTA_E_ANTERIORES'])('cartão diário preserva o restante da janela: %s',async alcance=>{
  const {db,serie,rows}=banco();serie.agendaConfig={horaInicio:'09:00'};
  Object.assign(rows[1],{dataInicio:date('2026-10-01'),dataFim:date('2026-10-10'),status:'CONCLUIDA',concluidaEm:date('2026-10-05')});
  await excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o10',dia:'2026-10-06',alcance,incluirConcluidas:true},db);
  expect(rows[1].canceladaEm).toBeUndefined();expect(rows[1].status).toBe('CONCLUIDA');expect(rows[1].concluidaEm).toEqual(date('2026-10-05'));
  expect(rows[1].agendaConfig.diasExcluidos).toEqual((alcance==='ESTA'?[6]:alcance==='ESTA_E_PROXIMAS'?[6,7,8,9,10]:[1,2,3,4,5,6]).map(d=>`2026-10-${String(d).padStart(2,'0')}`));
  expect(Boolean(rows[0].canceladaEm)).toBe(alcance==='ESTA_E_ANTERIORES');expect(Boolean(rows[2].canceladaEm)).toBe(alcance==='ESTA_E_PROXIMAS');
});

test('dia fora da janela não modifica a série',async()=>{
  const {db,serie}=banco();await expect(excluirOcorrencia({portalIds:['e'],ocorrenciaId:'o10',dia:'2026-10-06'},db)).rejects.toMatchObject({code:'dia_invalido'});expect(serie.sobrescritaLocal).toBeUndefined();
});

test('recuperação conserva identidade, conclusão e trilha da exclusão',async()=>{
  const {db,serie,rows}=banco();serie.ativa=true;rows[2].canceladaEm=date('2026-11-22');rows[2].concluidaEm=date('2026-11-20');
  db.$queryRaw=jest.fn();db.ocorrenciaObrigacao.findMany=async()=>[rows[2]];
  await restaurarOcorrencias({portalIds:['e'],ids:['o11'],userId:'u'},db);
  expect(rows[2]).toMatchObject({id:'o11',canceladaEm:null,status:'CONCLUIDA',concluidaEm:date('2026-11-20'),agendaConfig:{restauracoes:[{por:'u',canceladaEm:date('2026-11-22').toISOString()}]}});
});

test('recuperação recusa lote fora da carteira e corte de série',async()=>{
  const {db,serie,rows}=banco();db.$queryRaw=jest.fn();db.ocorrenciaObrigacao.findMany=async()=>[];
  await expect(restaurarOcorrencias({portalIds:['outra'],ids:['o10'],userId:'u'},db)).rejects.toMatchObject({status:404});
  serie.ativa=true;serie.encerradaAPartirDe='2026-10';rows[1].canceladaEm=date('2026-10-06');db.ocorrenciaObrigacao.findMany=async()=>[rows[1]];
  await expect(restaurarOcorrencias({portalIds:['e'],ids:['o10'],userId:'u'},db)).rejects.toMatchObject({status:409});expect(rows[1].canceladaEm).toEqual(date('2026-10-06'));
});
