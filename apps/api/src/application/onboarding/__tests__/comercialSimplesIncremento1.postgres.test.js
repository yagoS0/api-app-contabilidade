// Execução explícita em PostgreSQL descartável. Ausência de banco é falha, não aprovação.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { criarJornadaLead } from '../JornadaLeadService.js';
import { projetarContratacao } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';
import { criarFiscalLead } from '../FiscalLeadService.js';
import { criarCadastroComercial } from '../CadastroComercialService.js';

test('PostgreSQL: confirmação concorrente única, revisão e rollback de auditoria', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('Pendente: configure ALTAN_GOVERNANCE_TEST_DATABASE_URL para banco descartável loopback *_governance_test.');
  const url = new URL(raw);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname)) throw Error('Banco de teste não autorizado.');
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const ids = [];
  const user = { id: 'contador-sintetico-' + randomUUID(), role: 'contador' };
  const criar = async () => {
    const id = randomUUID(); ids.push(id);
    await db.onboarding.create({ data: { id, origem: 'TRANSFERENCIA', cnpj: '11222333000181', versao: 2 } });
    const p = await db.propostaComercial.create({ data: { onboardingId: id, versao: 1, fichaVersao: 2, status: 'ACEITA', opcaoAceita: 'RECORRENTE', expiraEm: new Date('2099-01-01'), snapshot: { escopo: 'Apenas teste local' } } });
    const c = await db.contratoComercial.create({ data: { onboardingId: id, propostaId: p.id, modeloId: 'modelo-sintetico', texto: 'Documento exclusivamente sintético',
      status: 'AGUARDANDO_ASSINATURA', aprovadoPor: user.id, aprovadoEm: new Date(), dados: { politicaContratacao: 'R35', opcao: { chave: 'RECORRENTE', recorrente: true, unicoCentavos: 10000 } } } });
    return { id, p, c, body: { versao: 2, propostaVersao: p.versao, contratoId: c.id, contratoRevisao: c.aprovadoEm.toISOString(), confirmado: true, valorCentavos: 10000, referencia: 'Recebimento fictício local' } };
  };
  try {
    const cadastro = await criar();
    const manual = await criarFiscalLead({ db }).validarProcuracaoManual(cadastro.id, user, { versao: 2, confirmada: true });
    expect(manual).toMatchObject({ atorId: user.id, provaOficial: false });
    expect(await db.atendimentoLead.count({ where: { onboardingId: cadastro.id } })).toBe(0);
    const bodyCadastro = { versao: 3, origem: 'MANUAL', cnpj: '46426073000140', empresa: { razaoSocial: 'Teste sintético', endereco: 'Rua teste, 1', municipio: 'Rio de Janeiro', uf: 'RJ', cnaePrincipal: '6201501', naturezaJuridica: 'Limitada', porte: 'ME' } };
    const svcCadastro = criarCadastroComercial({ db });
    await svcCadastro.salvar(cadastro.id, user, bodyCadastro);
    const atual = await db.onboarding.findUnique({ where: { id: cadastro.id } });
    expect(atual.dados.procuracaoManual).toBeUndefined(); expect(atual.dados.cadastroRevisao).toBe(1);
    const falhaCadastro = { ...db, $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
      get(target, chave) { return chave === 'onboardingEvento' ? new Proxy(target.onboardingEvento, { get(delegate, k) { return k === 'create' ? async () => { throw Error('auditoria cadastro indisponível'); } : delegate[k]; } }) : target[chave]; },
    }))) };
    await expect(criarCadastroComercial({ db: falhaCadastro }).salvar(cadastro.id, user, { ...bodyCadastro, versao: 4, cnpj: '11222333000181' })).rejects.toThrow('auditoria cadastro');
    expect(await db.onboarding.findUnique({ where: { id: cadastro.id } })).toMatchObject({ versao: 4, cnpj: '46426073000140' });
    const t = await criar(), service = criarJornadaLead({ db });
    const [a, b] = await Promise.all([service.confirmarPagamento(t.id, user, t.body), service.confirmarPagamento(t.id, user, t.body)]);
    expect(a.id).toBe(b.id);
    const eventos = await db.onboardingEvento.findMany({ where: { onboardingId: t.id, tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO' } });
    expect(eventos).toHaveLength(1);
    const ficha = await db.onboarding.findUnique({ where: { id: t.id } });
    expect(ficha).toMatchObject({ versao: 3, faseComercial: 'CONTRATADO', portalClientId: null });
    expect(projetarContratacao({ onboarding: ficha, propostas: [t.p], contratos: [t.c], marcos: eventos })).toMatchObject({ ganha: true, carteiraPermitida: true });
    expect(await db.contratoComercial.findUnique({ where: { id: t.c.id } })).toMatchObject({ status: 'AGUARDANDO_ASSINATURA', assinaturaConferidaEm: null });
    const f = await criar();
    const falhando = { ...db, $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
      get(target, chave) { return chave === 'onboardingEvento' ? new Proxy(target.onboardingEvento, { get(delegate, k) { return k === 'create' ? async () => { throw Error('auditoria sintética indisponível'); } : delegate[k]; } }) : target[chave]; },
    }))) };
    await expect(criarJornadaLead({ db: falhando }).confirmarPagamento(f.id, user, f.body)).rejects.toThrow('auditoria sintética');
    expect(await db.onboarding.findUnique({ where: { id: f.id } })).toMatchObject({ versao: 2, faseComercial: 'LEAD', status: 'RASCUNHO' });
    expect(await db.onboardingEtapa.count({ where: { onboardingId: f.id } })).toBe(0);
    await expect(service.confirmarPagamento(f.id, user, { ...f.body, propostaVersao: 99 })).rejects.toMatchObject({ code: 'contrato_pendente' });
  } finally {
    // Somente os IDs criados pela própria execução, em banco validado acima.
    await db.onboardingEvento.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboardingEtapa.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.contratoComercial.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.propostaComercial.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboarding.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}, 30000);
