// Ensaio explícito: somente banco descartável autorizado, sem provedores externos.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { criarServicoComercial } from '../ComercialService.js';

test('PostgreSQL: coleta pública preserva internos, concorre por versão e reverte auditoria', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('Pendente: ALTAN_GOVERNANCE_TEST_DATABASE_URL em PostgreSQL descartável.');
  const url = new URL(raw);
  if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) throw Error('Banco não autorizado.');
  const db = new PrismaClient({ datasources: { db: { url: raw } } }), ids = [];
  const pessoa = { nome: 'Pessoa Sintética', cpf: '52998224725' };
  const criar = async () => {
    const id = randomUUID(), token = randomBytes(32).toString('base64url'); ids.push(id);
    await db.onboarding.create({ data: { id, origem: 'ABERTURA', status: 'RASCUNHO', dados: {
      cartoesPessoas: 2, modalidadeServico: 'AVULSO', consultoriaMensal: true, enderecoPretendido: 'Endereço antigo não decomposto',
    } } });
    await db.onboardingLink.create({ data: { onboardingId: id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000), criadoPorId: 'contador-sintetico' } });
    return { id, token };
  };
  const service = criarServicoComercial({ db });
  try {
    const t = await criar();
    await expect(service.publico(t.token, { versao: 0, dados: {}, finalizar: true })).rejects.toMatchObject({ code: 'dados_invalidos' });
    expect(await db.onboarding.findUnique({ where: { id: t.id } })).toMatchObject({ versao: 0, status: 'RASCUNHO' });
    const patch = { versao: 0, dados: { socios: [pessoa, {}], cartoesPessoas: 1, modalidadeServico: 'RECORRENTE', consultoriaMensal: false,
      enderecoAbertura: { rua: 'Rua Sintética', numero: '7', cidade: 'Recife', uf: 'PE', inscricaoImobiliaria: '000A-12' } } };
    const resultados = await Promise.allSettled([service.publico(t.token, patch), service.publico(t.token, patch)]);
    expect(resultados.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.find(r => r.status === 'rejected').reason.code).toBe('formulario_alterado');
    const lida = await service.publico(t.token);
    expect(lida.onboarding.dados).toMatchObject({ socios: [pessoa], cartoesPessoas: 1, modalidadeServico: 'AVULSO', consultoriaMensal: true,
      enderecoPretendido: 'Endereço antigo não decomposto', enderecoAbertura: { inscricaoImobiliaria: '000A-12' } });
    await service.publico(t.token, { versao: 1, dados: {}, finalizar: true });
    expect(await service.publico(t.token, { versao: 1, dados: {}, finalizar: true })).toEqual({ enviado: true });
    expect(await db.onboardingEvento.count({ where: { onboardingId: t.id, tipo: 'FORMULARIO_ENVIADO' } })).toBe(1);
    const f = await criar();
    const falhando = new Proxy(db, { get(target, k) {
      if (k !== '$transaction') return target[k];
      return callback => db.$transaction(tx => callback(new Proxy(tx, { get(t, key) {
        if (key !== 'onboardingEvento') return t[key];
        return new Proxy(t.onboardingEvento, { get(d, metodo) { return metodo === 'create' ? async () => { throw Error('auditoria sintética indisponível'); } : d[metodo]; } });
      } })));
    } });
    await expect(criarServicoComercial({ db: falhando }).publico(f.token, { versao: 0, dados: { socios: [pessoa] }, finalizar: true })).rejects.toThrow('auditoria sintética');
    expect(await db.onboarding.findUnique({ where: { id: f.id } })).toMatchObject({ versao: 0, status: 'RASCUNHO' });
    expect(await db.onboardingLink.findFirst({ where: { onboardingId: f.id } })).toMatchObject({ submittedAt: null });
    expect(await db.onboardingEtapa.count({ where: { onboardingId: f.id } })).toBe(0);
  } finally {
    await db.onboardingEvento.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboardingEtapa.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboardingLink.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboarding.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}, 30000);

// Exercita o provisionamento real usado pela conversão, sem pós-criação/worker/rede.
// Toda a empresa sintética é revertida pela transação externa ao terminar o cenário.
jest.mock('../../accounting/globalChartStatus.js', () => ({ getGlobalChartStatus: async () => ({ isConfigured: true }) }));
import { prisma as prismaProvisionamento } from '../../../infrastructure/db/prisma.js';
import { provisionarEmpresa } from '../../companies/CompanyProvisioningService.js';
import { validateAndNormalizeCompanyProfile } from '../../company/companyProfile.js';

test('PostgreSQL: provisionamento de titular/endereço/IPTU, edição posterior e rollback da conclusão', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('Banco descartável obrigatório.');
  const url = new URL(raw);
  if (process.env.NODE_ENV !== 'test' || !['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.search || url.hash) throw Error('Banco não autorizado.');
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const tag = randomUUID(), email = `titular-${tag}@example.invalid`, actorId = randomUUID();
  const digitos = [...randomBytes(8)].map(n => n % 10).concat([0, 0, 0, 1]);
  for (const pesos of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const resto = digitos.reduce((total, n, i) => total + n * pesos[i], 0) % 11;
    digitos.push(resto < 2 ? 0 : 11 - resto);
  }
  const cnpj = digitos.join('');
  const parada = Error('ROLLBACK_SINTETICO_CONFERIDO');
  let conferido = false;
  try {
    await expect(db.$transaction(async tx => {
      await tx.user.create({ data: { id: actorId, email: `contador-${tag}@example.invalid`, passwordHash: 'hash-sintetico', role: 'contador' } });
      prismaProvisionamento.$transaction = callback => callback(tx);
      await provisionarEmpresa({ actorUserId: actorId, body: {
        ownerEmail: email, ownerName: 'Pessoa Sintética', ownerPassword: 'SenhaSintetica!2026',
        company: { razaoSocial: `Empresa Sintética ${tag}`, cnpj, regimeTributario: 'SIMPLES', cnaePrincipal: '7020400',
          titular: { nome: 'Pessoa Sintética', cpf: '52998224725' }, socios: [],
          endereco: { rua: 'Rua Sintética', semNumero: true, bairro: 'Centro', cidade: 'Recife', uf: 'PE', cep: '50000000', inscricaoImobiliaria: '000AB-012', legado: 'Texto antigo preservado' } },
      }, concluirNaTransacao: async (t, criada) => {
        const portal = await t.portalClient.findUnique({ where: { id: criada.portalId } });
        const empresa = await t.company.findUnique({ where: { id: portal.companyId }, include: { partners: true } });
        expect(empresa.titular).toEqual({ nome: 'Pessoa Sintética', cpf: '52998224725' });
        expect(empresa.partners).toEqual([]);
        expect(empresa.enderecoJson).toMatchObject({ numero: 'S/N', semNumero: true, inscricaoImobiliaria: '000AB-012', legado: 'Texto antigo preservado' });
        const perfil = validateAndNormalizeCompanyProfile({ razaoSocial: empresa.razaoSocial, cnpj: empresa.cnpj, regimeTributario: 'SIMPLES', cnaePrincipal: empresa.cnaePrincipal, titular: empresa.titular, socios: [], endereco: { ...empresa.enderecoJson, semNumero: false, numero: '123' } });
        expect(perfil.ok).toBe(true);
        await t.company.update({ where: { id: empresa.id }, data: { enderecoJson: perfil.data.endereco } });
        const relida = await t.company.findUnique({ where: { id: empresa.id } });
        expect(relida.enderecoJson).toMatchObject({ numero: '123', semNumero: false, inscricaoImobiliaria: '000AB-012', legado: 'Texto antigo preservado' });
        expect(relida.titular).toEqual(empresa.titular);
        conferido = true;
      } });
      throw parada;
    }, { timeout: 15000 })).rejects.toBe(parada);
    expect(conferido).toBe(true);
    expect(await db.company.count({ where: { razaoSocial: `Empresa Sintética ${tag}` } })).toBe(0);
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(await db.client.count({ where: { email } })).toBe(0);
  } finally {
    delete prismaProvisionamento.$transaction;
    await db.$disconnect();
  }
}, 30000);
