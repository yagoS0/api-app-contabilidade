// Auditoria local: não carrega .env e não habilita integrações. Banco descartável preparado pelo Principal.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'Exige PostgreSQL');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Exige loopback');
assert.match(url.pathname, /^\/[a-zA-Z0-9_]+_governance_test$/, 'Exige banco descartável _governance_test');
assert.equal(url.search, '', 'Parâmetros de conexão alternativos não são permitidos');
assert.equal(url.hash, '');
url.hostname = '127.0.0.1';
process.env.DATABASE_URL = url.toString();
process.env.DIRECT_URL = url.toString();
process.env.DOTENV_CONFIG_PATH = join(tmpdir(), `altan-audit-no-env-${randomUUID()}`);
assert.equal(existsSync(process.env.DOTENV_CONFIG_PATH), false);
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'fatal' });
const configSource = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
const flags = new Set([...Object.keys(process.env).filter(k => k.startsWith('INTEGRACAO_')),
  ...Array.from(configSource.matchAll(/\bINTEGRACAO_[A-Z0-9_]+\b/g), m => m[0])]);
for (const flag of flags) process.env[flag] = '0';
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw Error('Rede JS proibida na auditoria local'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
// Prisma usa o engine nativo; somente a URL validada acima é fornecida a ele.
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { Prisma } = await import('@prisma/client');
const prefix = `audit-${randomUUID()}`;

const { atualizarGuiaComEvidencia } = await import('../src/application/guides/atualizarGuiaComEvidencia.js');
const { registrarRecalculoGuia, sinalizarRecalculosNosLancamentos } = await import('../src/application/guides/RegistroRecalculoGuia.js');
const { conferirEntregaGuiaWhatsapp } = await import('../src/application/guides/EntregaGuiaWhatsappService.js');
const { revisaoDocumentoGuia } = await import('../src/application/whatsapp/EnvioDocumentoGuiaWhatsappService.js');
try {
  const [database] = await db.$queryRaw`SELECT current_database() AS name`;
  assert.equal(database.name, url.pathname.slice(1));
  const company = await db.portalClient.create({ data: { cnpj: prefix, razao: 'AUDITORIA SINTETICA SEM VALIDADE FISCAL' } });
  const createGuide = suffix => db.guide.create({ data: {
    portalClientId: company.id, tipo: 'OUTRA', source: 'UPLOAD', competencia: '2026-09',
    valor: 100, valorOriginal: 100, status: 'PROCESSED', paymentStatus: 'PAID',
    hash: prefix + suffix, vencimento: new Date('2026-10-20T00:00:00Z'),
    extracted: { comprovante: { total: 100 } },
  } });
  const selected = await createGuide('-selected');
  const neighbor = await createGuide('-neighbor');
  const phone = prefix; // Não é número roteável.
  await db.envioGuia.create({ data: {
    guideId: selected.id, canal: 'WHATSAPP', destino: phone, status: 'entregue', entregueEm: new Date(),
    historicoTentativas: { create: {
      status: 'entregue', entregueEm: new Date(), arquivoSha256: selected.hash,
      snapshot: { revisaoDocumento: revisaoDocumentoGuia(selected), guideId: selected.id,
        portalClientId: company.id, telefone: phone, competencia: selected.competencia,
        valor: 100, vencimento: selected.vencimento.toISOString() },
    } },
  } });
  await conferirEntregaGuiaWhatsapp(db, selected, phone);
  const captured = await atualizarGuiaComEvidencia(db, selected.id, current => ({
    valor: 115, hash: prefix + '-new', extracted: { ...current.extracted, numeroDocumento: 'sintetico-novo' },
  }));
  assert.equal(captured.paymentStatus, 'PAID');
  assert.equal(Number(captured.valorOriginal), 100);
  await assert.rejects(conferirEntregaGuiaWhatsapp(db, captured, phone), { code: 'GUIA_WHATSAPP_NAO_ENTREGUE' });
  await registrarRecalculoGuia(db, { guiaAnterior: selected, guiaId: selected.id, especie: 'DARF_PRESUMIDO' });
  const projected = await sinalizarRecalculosNosLancamentos(db, company.id,
    [{ sourceGuideId: selected.id, totalD: 100 }, { sourceGuideId: neighbor.id, totalD: 100 }]);
  assert.equal(projected[0].recalculoGuia.valorAtual, 115);
  assert.equal(projected[0].totalD, 100);
  assert.equal(projected[1].recalculoGuia, null);
  assert.deepEqual(await db.guide.findUnique({ where: { id: neighbor.id } }), neighbor);
  console.log('PASS: recaptura -> recibo obsoleto recusado -> registro -> projeção seletiva; pagamento preservado.');

  // Intercalamento determinístico com escritas reais, sem temporizador ou corrida probabilística.
  const antesSegundoRecalculo = await db.guide.findUnique({ where: { id: selected.id } });
  let intercalou = false;
  let conflitos = 0;
  const interleaved = { guide: {
    findFirst: async args => {
      const stale = await db.guide.findFirst(args);
      if (intercalou) return stale;
      intercalou = true;
      await atualizarGuiaComEvidencia(db, selected.id, current => ({
        extracted: { ...current.extracted, comprovante: { total: 99, evento: 'concorrente' } },
      }));
      assert.equal((await db.guide.findUnique({ where: { id: selected.id } })).extracted.comprovante.evento, 'concorrente');
      return stale;
    },
    updateMany: async args => {
      const resultado = await db.guide.updateMany(args);
      if (!resultado.count) conflitos += 1;
      return resultado;
    },
  } };
  await registrarRecalculoGuia(interleaved, { guiaAnterior: antesSegundoRecalculo, guiaId: selected.id, especie: 'DARF_PRESUMIDO' });
  const final = await db.guide.findUnique({ where: { id: selected.id } });
  assert.equal(networkAttempts, 0);
  // Contrato R19/R20: esta asserção deve falhar enquanto A01 existir. Não transformar em aceite verde.
  assert.equal(final.extracted.comprovante.evento, 'concorrente',
    'A01: registrarRecalculoGuia apagou evidência concorrente; requer avaliação e correção incremental');
  assert.equal(conflitos, 1, 'O primeiro CAS deve recusar a leitura anterior ao comprovante.');
  console.log('PASS: comprovante concorrente preservado.');
  await assert.rejects(registrarRecalculoGuia(db, {
    guiaAnterior: selected, guiaId: selected.id, especie: 'DARF_PRESUMIDO',
  }), { code: 'GUIA_ALTERADA' });
  assert.deepEqual(await db.guide.findUnique({ where: { id: selected.id } }), final,
    'Callback antigo não pode alterar recálculo novo, comprovante ou pagamento.');
  assert.equal(networkAttempts, 0);
  console.log('PASS: callback antigo recusado e registro novo preservado integralmente.');
  for (const [tipoNulo, extracted] of [['SQL', Prisma.DbNull], ['JSON', Prisma.JsonNull]]) {
    const guiaNula = await createGuide(`-null-${tipoNulo}`);
    const anterior = await db.guide.update({ where: { id: guiaNula.id }, data: { extracted } });
    let leituras = 0;
    const contagens = [];
    const concorrente = { guide: {
      findFirst: async args => {
        const stale = await db.guide.findFirst(args);
        if (++leituras === 1) {
          const nova = await db.guide.update({ where: { id: guiaNula.id }, data: {
            extracted: { comprovante: { total: 100, evento: 'mesmo-milissegundo' } },
            updatedAt: stale.updatedAt,
          } });
          assert.equal(+nova.updatedAt, +stale.updatedAt);
        }
        return stale;
      },
      updateMany: async args => {
        const resultado = await db.guide.updateMany(args);
        contagens.push(resultado.count);
        return resultado;
      },
    } };
    await registrarRecalculoGuia(concorrente, { guiaAnterior: anterior, guiaId: anterior.id, especie: 'DARF_PRESUMIDO' });
    assert.deepEqual(contagens, [0, 1], `${tipoNulo}: CAS deve recusar JSON alterado mesmo com timestamp igual.`);
    assert.equal(leituras, 2);
    const preservada = await db.guide.findUnique({ where: { id: anterior.id } });
    assert.equal(preservada.extracted.comprovante.evento, 'mesmo-milissegundo');
    assert.equal(preservada.extracted.recalculoGuia.guiaId, anterior.id);
    assert.equal(preservada.paymentStatus, 'PAID');
    console.log(`PASS: nulo ${tipoNulo} -> comprovante concorrente, timestamp idêntico, CAS 0/releitura/1.`);
  }
  const antesValor = await createGuide('-race-valor');
  let leiturasValor = 0;
  const contagensValor = [];
  const concorrenteValor = { guide: {
    findFirst: async args => {
      const stale = await db.guide.findFirst(args);
      if (++leiturasValor === 1) {
        const nova = await db.guide.update({ where: { id: antesValor.id }, data: { valor: 125, updatedAt: stale.updatedAt } });
        assert.equal(+nova.updatedAt, +stale.updatedAt);
        assert.deepEqual(nova.extracted, stale.extracted);
      }
      return stale;
    },
    updateMany: async args => {
      const resultado = await db.guide.updateMany(args);
      contagensValor.push(resultado.count);
      return resultado;
    },
  } };
  const registroValor = await registrarRecalculoGuia(concorrenteValor, { guiaAnterior: antesValor, guiaId: antesValor.id, especie: 'DARF_PRESUMIDO' });
  assert.deepEqual(contagensValor, [0, 1]);
  assert.equal(leiturasValor, 2);
  assert.equal(registroValor.valorAtual, 125);
  const depoisValor = await db.guide.findUnique({ where: { id: antesValor.id } });
  assert.equal(depoisValor.extracted.recalculoGuia.valorAtual, 125);
  assert.deepEqual(depoisValor.extracted.comprovante, antesValor.extracted.comprovante);
  assert.equal(depoisValor.paymentStatus, 'PAID');
  console.log('PASS: mudança apenas do valor, timestamp e JSON idênticos, CAS 0/releitura/1 e valorAtual atualizado.');
  assert.equal(networkAttempts, 0);
} finally {
  await db.$disconnect();
}
// Fixtures são conservadas exclusivamente no banco descartável para inspeção.
