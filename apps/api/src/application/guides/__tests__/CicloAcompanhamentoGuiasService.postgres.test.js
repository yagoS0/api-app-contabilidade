import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { acompanharGuia, lerAcompanhamentoGuias } from '../CicloAcompanhamentoGuiasService.js';
import { conferirTentativaAutomaticaDespacho } from '../../fiscal/automacaoCicloFiscalContext.js';
import { revisaoDocumentoGuia } from '../../whatsapp/EnvioDocumentoGuiaWhatsappService.js';
import { POLITICA_ACOMPANHAMENTO_GUIAS as politica } from '../calendarioAvisosGuia.js';
const url = process.env.TEST_CICLO_PG_URL;
(url ? test : test.skip)('PG: prova documental R2C fictícia → consulta única concorrente → mês fechado preservado', async () => {
  if (url !== 'postgresql://altan_test@127.0.0.1:54661/altan_rotinas_governance_test' || process.env.NODE_ENV !== 'test') throw Error('Somente o banco descartável autorizado.');
  const pg = new PrismaClient({ datasources: { db: { url } } });
  const id = `tracking-test-${randomUUID()}`, companyId = randomUUID(), clientId = randomUUID(), guideId = randomUUID();
  const configKey = `acompanhamento_guias_config:${id}`, attemptKey = `pagamento_auto_tentativa:guia:${guideId}`;
  const scheduledAt = '2026-11-24T11:00:00.000Z';
  const contato = { id: 'contato-ficticio', telefoneE164: '+5531999991111', vinculoNumeroId: 'vinculo-ficticio' };
  // Agenda global somente injetada em leitura; todas as reservas e documentos são PostgreSQL real.
  const db = new Proxy(pg, { get(target, prop) {
    if (prop === 'appSetting') return { ...target.appSetting, findUnique: args => args.where.key === 'serpro_runtime_settings'
      ? Promise.resolve({ value: { rotinas: { avisos_guias_whatsapp: { enabled: true, frequency: 'DAILY', hour: 8 } } } })
      : args.where.key === 'automacao_ciclo_fiscal' ? Promise.resolve(null) : target.appSetting.findUnique(args) };
    const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const transporteFiscal = jest.fn();
  const consultar = jest.fn(async () => { await pg.$transaction(tx => conferirTentativaAutomaticaDespacho(tx, { portalClientId: id, requireAttempt: true })); transporteFiscal(); return { pago: false, negativaConfirmada: true }; });
  const avisar = jest.fn(async ({assertActive}) => { await assertActive(); return { status: 'PENDENTE', motivo: 'TRANSPORTE_FICTICIO' }; });
  const deps = { db, consultar, avisar, destinatarios: async () => ({ telefones: [contato] }) };
  const run = () => acompanharGuia({ guideId, scheduledAt, agora: new Date(scheduledAt) }, deps);
  try {
    const cnpj = (BigInt(`0x${randomUUID().replace(/-/g, '')}`) % 100000000000000n).toString().padStart(14, '0');
    await pg.client.create({ data: { id: clientId, name: 'R2D SINTETICO', email: `${clientId}@example.test`, login: clientId, passwordHash: 'sem-login' } });
    await pg.company.create({ data: { id: companyId, clientId, cnpj, razaoSocial: 'R2D SINTETICO', atividades: [], regimeTributario: 'SIMPLES' } });
    await pg.portalClient.create({ data: { id, companyId, cnpj, razao: 'R2D SINTETICO', municipio: 'Contagem', status: 'ATIVA' } });
    await pg.companyRotina.create({ data: { portalClientId: id, rotina: 'avisos_guias_whatsapp', enabled: true } });
    await pg.appSetting.create({ data: { key: configKey, value: { enabled: true, politica, limiteConsultas: 1, selectionToken: randomUUID() } } });
    const guia = await pg.guide.create({ data: { id: guideId, portalClientId: id, competencia: '2026-10', tipo: 'SIMPLES', status: 'PROCESSED', source: 'SERPRO', valor: 100, hash: randomUUID(), pdfBytes: Buffer.from('%PDF-only-fixture'), vencimento: new Date('2026-11-20'), liberadaCliente: true } });
    const envio = await pg.envioGuia.create({ data: { guideId, canal: 'WHATSAPP', destino: contato.telefoneE164, status: 'entregue', entregueEm: new Date(scheduledAt) } });
    await pg.envioGuiaTentativa.create({ data: { envioGuiaId: envio.id, status: 'entregue', entregueEm: new Date(scheduledAt), arquivoSha256: guia.hash,
      snapshot: { guideId, portalClientId: id, revisaoDocumento: revisaoDocumentoGuia(guia), telefone: contato.telefoneE164, vinculoNumeroId: contato.vinculoNumeroId, competencia: guia.competencia, valor: String(guia.valor), vencimento: guia.vencimento.toISOString() } } });
    await Promise.all([run(), run()]); expect(consultar).toHaveBeenCalledTimes(1); expect(transporteFiscal).toHaveBeenCalledTimes(1);
    expect((await pg.appSetting.findUnique({ where: { key: attemptKey } })).value.status).toBe('REVISAO');
    expect((await pg.appSetting.findUnique({ where: { key: attemptKey } })).value.resultado).toBe('NAO_LOCALIZADO');
    await run(); expect(consultar).toHaveBeenCalledTimes(1); expect(transporteFiscal).toHaveBeenCalledTimes(1);
    const closed = new Date('2026-11-25T12:00:00Z');
    await pg.companyMonthlyCircular.create({ data: { portalClientId: id, competencia: '2026-10', fechadoContabilEm: closed } });
    const count = await pg.accountingEntry.count({ where: { portalClientId: id } });
    const dto = await lerAcompanhamentoGuias({ portalClientId: id, competencia: '2026-10' }, { db });
    expect(dto.items[0].entrega.comprovada).toBe(true); expect(dto.items[0].pendenciaContabil).toBe(false);
    await run(); expect(consultar).toHaveBeenCalledTimes(1); expect(transporteFiscal).toHaveBeenCalledTimes(1);
    expect(await pg.accountingEntry.count({ where: { portalClientId: id } })).toBe(count);
    expect((await pg.companyMonthlyCircular.findUnique({ where: { portalClientId_competencia: { portalClientId: id, competencia: '2026-10' } } })).fechadoContabilEm).toEqual(closed);
  } finally {
    await pg.envioGuiaTentativa.deleteMany({ where: { envioGuia: { guideId } } });
    await pg.envioGuia.deleteMany({ where: { guideId } }); await pg.guide.deleteMany({ where: { id: guideId, portalClientId: id } });
    await pg.companyMonthlyCircular.deleteMany({ where: { portalClientId: id } }); await pg.companyRotina.deleteMany({ where: { portalClientId: id } });
    await pg.appSetting.deleteMany({ where: { key: { in: [configKey, attemptKey] } } });
    await pg.portalClient.deleteMany({ where: { id, razao: 'R2D SINTETICO' } }); await pg.client.deleteMany({ where: { id: clientId, name: 'R2D SINTETICO' } });
    await pg.$disconnect();
  }
}, 30000);
