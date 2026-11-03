import express from 'express';
import request from 'supertest';
import PDFDocument from 'pdfkit';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { companyFirmAccess: { findUnique: jest.fn() }, user:{findUnique:jest.fn()},guide:{findUnique:jest.fn(),findFirst:jest.fn()},contatoWhatsapp:{findMany:jest.fn()},envioGuia:{findFirst:jest.fn()},appSetting:{findUnique:jest.fn(),update:jest.fn()},$transaction:jest.fn() } }));
jest.mock('../../../application/operacoes/OperationsConsultas.js', () => ({ listarErrosConsultas: jest.fn(), listarEvidenciasOperacoes: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsService.js', () => ({ lerOperacao: jest.fn(), salvarOperacao: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsExecution.js', () => ({ executarOperacao: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsManualInss.js', () => ({ lerInssManual: jest.fn(), listarInssManual: jest.fn(), salvarInssManual: jest.fn() }));
jest.mock('../../../application/operacoes/OperationsBatchService.js', () => ({ createOperationsBatchService: jest.fn() }));
jest.mock('../../../application/tasks/ManualTaskService.js', () => ({ ...jest.requireActual('../../../application/tasks/ManualTaskService.js'),backgroundRoute: (_, handler) => handler,respondWithTask:(_req,res,_spec,fn)=>fn(res,async()=>{}) }));
jest.mock('../../../workers/guideEmailWorker.js',()=>({runGuideEmailWorkerOnce:jest.fn(),runGuideEmailWorkerSelected:jest.fn()}));
jest.mock('../../../application/guides/GuideStorageService.js', () => ({ GuideStorageService: class { static create = jest.fn(); } }));
import { prisma as accessDb } from '../../../infrastructure/db/prisma.js';
import { requireFirmCompanyAccess } from '../../../middlewares/requireFirmCompanyAccess.js';
import { executarOperacao } from '../../../application/operacoes/OperationsExecution.js';
import { createOperationsRouter } from '../operacoes.js';
import { createFirmPortalRouter } from '../index.js';
import { runGuideEmailWorkerSelected } from '../../../workers/guideEmailWorker.js';
import { createOperationsGuideEvidence } from '../../../application/operacoes/OperationsGuideEvidence.js';

let app, db, storage, user, records;
let fixture;
beforeAll(async () => {
  fixture = await new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ compress: false }), chunks = [];
    pdf.on('data', chunk => chunks.push(chunk)); pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.text('Documento sintetico de teste. Sem validade fiscal.'); pdf.end();
  });
});
const versionId = 'a'.repeat(64);
const selection = { companyId: 'a', competencia: '2026-10', releaseId: 'r', versionId, tipo: 'extrato' };
const base = '/companies/a/operacoes/2026-10/transmission-documents';
beforeEach(() => {
  jest.clearAllMocks(); user = { id: 'u', role: 'contador' };
  accessDb.companyFirmAccess.findUnique.mockResolvedValue({ role: 'ACCOUNTANT', status: 'ACTIVE' });
  const version = { id: versionId, companyId: 'a', competencia: '2026-10', numeroDeclaracao: '123', declaracaoFileId: 'private/extract', reciboFileId: null, receitaBruta: 12, dasTotal: 1 };
  records = [{ key: `pgdas_historico:a:2026-10:${versionId}`, value: version }, { key: 'operations_execution:a:2026-10:r', value: { companyId: 'a', competencia: '2026-10', status: 'DONE', evolucaoDocumental: { releaseId: 'r', calculoId: 'calc', proofHash: 'b'.repeat(64), documento: { portalClientId: 'a', competencia: '2026-10', numeroDeclaracao: '123', declaracaoFileId: 'private/extract', reciboFileId: null } } } }];
  db = { appSetting: { findMany: jest.fn(async ({ where }) => records.filter(r => r.key.startsWith(where.key.startsWith))), findUnique: jest.fn(async ({ where }) => records.find(r => r.key === where.key)) } };
  storage = { downloadBuffer: jest.fn(async () => fixture) };
  app = express(); app.use(express.json()); app.use((req, res, next) => { req.auth = { user }; next(); });
  app.use(createOperationsRouter({ prisma: db, requireFirmCompanyAccess, transmissionStorage: () => storage }));
});
test.each(['STAFF', 'ACCOUNTANT', 'FIRM_ADMIN'])('active %s can read linked evidence and stored attachment without fiscal execution', async role => {
  accessDb.companyFirmAccess.findUnique.mockResolvedValue({ role, status: 'ACTIVE' });
  const dto = await request(app).get(base);
  expect(dto.status).toBe(200); expect(dto.body.items).toHaveLength(1);
  expect(JSON.stringify(dto.body)).not.toContain('private/');
  const pdf = await request(app).get(`${base}/r/${versionId}/extrato`);
  expect(pdf.status).toBe(200); expect(pdf.headers['content-disposition']).toMatch(/^attachment;/);
  expect(pdf.headers['cache-control']).toContain('no-store');
  expect(executarOperacao).not.toHaveBeenCalled();
});
test.each([null, { role: 'ACCOUNTANT', status: 'INACTIVE' }])('denied company reads neither documents nor storage', async link => {
  accessDb.companyFirmAccess.findUnique.mockResolvedValue(link);
  expect((await request(app).get(base)).status).toBe(403);
  expect((await request(app).get(`${base}/r/${versionId}/extrato`)).status).toBe(403);
  expect(db.appSetting.findMany).not.toHaveBeenCalled(); expect(storage.downloadBuffer).not.toHaveBeenCalled();
});
test('anonymous ZIP and GET do not reach data', async () => {
  user = null;
  expect((await request(app).get(base)).status).toBe(401);
  expect((await request(app).post('/operacoes/transmission-documents/zip').send({ items: [selection] })).status).toBe(401);
  expect(db.appSetting.findMany).not.toHaveBeenCalled(); expect(storage.downloadBuffer).not.toHaveBeenCalled();
});
test('ZIP rechecks the same ACL for each identity and returns no denied PDF', async () => {
  accessDb.companyFirmAccess.findUnique.mockImplementation(async ({ where }) => where.companyId_userId.companyId === 'a' ? { role: 'STAFF', status: 'ACTIVE' } : null);
  const response = await request(app).post('/operacoes/transmission-documents/zip').send({ items: [selection, { ...selection, companyId: 'denied' }] });
  expect(response.status).toBe(200); expect(response.headers['content-type']).toContain('application/zip');
  expect(storage.downloadBuffer).toHaveBeenCalledTimes(1);
  expect(accessDb.companyFirmAccess.findUnique.mock.calls.map(([args]) => args.where.companyId_userId.companyId)).toEqual(['a', 'a', 'denied']);
  expect(executarOperacao).not.toHaveBeenCalled();
});
test('changed version, wrong period and corrupt storage do not return a PDF', async () => {
  expect((await request(app).get(`${base}/r/${'c'.repeat(64)}/extrato`)).status).toBe(404);
  expect((await request(app).get(base.replace('2026-10', '2026-13'))).status).toBe(422);
  expect(storage.downloadBuffer).not.toHaveBeenCalled();
  storage.downloadBuffer.mockResolvedValue(Buffer.from('corrupt'));
  expect((await request(app).get(`${base}/r/${versionId}/extrato`)).status).toBe(422);
});

test('evidence GET rechecks persisted user and does not issue a preview or send',async()=>{
 db.user={findUnique:jest.fn(async()=>({id:'u',status:'disabled',accountType:'FIRM',role:'contador'}))};
 const response=await request(app).get('/companies/a/operacoes/2026-10/guide-evidence');
 expect(response.status).toBe(403);expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
});

test('send-task binds the token to actual selection and propagates its server guard to selected email',async()=>{
 const g={id:'g',portalClientId:'a',competencia:'2026-10',tipo:'SIMPLES',status:'PROCESSED',paymentStatus:'OPEN',valor:100,hash:'fixture',pdfBytes:Buffer.from('%PDF-fixture'),vencimento:new Date('2026-11-20')};
 const values=new Map();
 accessDb.user.findUnique.mockResolvedValue({id:'u',status:'active',role:'contador',accountType:'FIRM'});
 accessDb.guide.findUnique.mockResolvedValue(g);accessDb.guide.findFirst.mockResolvedValue(g);
 accessDb.contatoWhatsapp.findMany.mockResolvedValue([{id:'contact',email:'synthetic@example.test',ativo:true}]);
 accessDb.envioGuia.findFirst.mockResolvedValue(null);
 accessDb.appSetting.findMany=jest.fn(async({where})=>[...values]
  .filter(([key,value])=>key.startsWith(where.key.startsWith)&&(where.AND||[]).every(condition=>condition.value.path.reduce((current,part)=>current?.[part],value)===condition.value.equals))
  .map(([key,value])=>({key,value:structuredClone(value)})));
 accessDb.appSetting.create=jest.fn(async({data})=>{values.set(data.key,structuredClone(data.value));return data;});
 accessDb.appSetting.findUnique.mockImplementation(async({where})=>values.has(where.key)?{value:structuredClone(values.get(where.key))}:null);
 accessDb.appSetting.update.mockImplementation(async({where,data})=>{values.set(where.key,structuredClone(data.value));return data;});
 accessDb.$transaction.mockImplementation(fn=>fn(accessDb));
 const input={userId:'u',companyId:'a',competencia:'2026-10',items:[{guideId:'g',reenviarConfirmado:true}],whatsappRequested:false};
 const preview=await createOperationsGuideEvidence({db:accessDb}).preview(input);
 expect(preview.refused).toEqual([]);expect(preview.items).toHaveLength(1);expect(preview.token).toEqual(expect.any(String));
 const router=express();router.use(express.json());const ensureAuthorized=async req=>{req.auth={user:{id:'u',role:'contador',accountType:'FIRM'}};return true;};router.locals.ensureAuthorized=ensureAuthorized;
 router.use(createFirmPortalRouter({ensureAuthorized,log:{info:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
 const body={items:input.items,whatsappRequested:false,competencia:'2026-09',operationsPreviewToken:preview.token};
 expect((await request(router).post('/companies/a/guides/send-task').send(body)).status).toBe(409);expect(runGuideEmailWorkerSelected).not.toHaveBeenCalled();
 runGuideEmailWorkerSelected.mockImplementation(async({operationsGuard})=>{expect(operationsGuard).toBeDefined();await operationsGuard.beforeDispatch({guide:g,canal:'EMAIL',destino:'synthetic@example.test',pdfBytes:g.pdfBytes});return {results:[{status:'SENT'}]};});
 const response=await request(router).post('/companies/a/guides/send-task').send({...body,competencia:'2026-10'});
 expect(response.status).toBe(200);expect(response.body.resultados[0].email.sent).toBe(true);expect(runGuideEmailWorkerSelected).toHaveBeenCalledTimes(1);
 expect((await request(router).post('/companies/a/guides/send-task').send({...body,competencia:'2026-10'})).status).toBe(409);expect(runGuideEmailWorkerSelected).toHaveBeenCalledTimes(1);
});
