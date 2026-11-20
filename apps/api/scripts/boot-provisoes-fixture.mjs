// Exclusivo do smoke Docker: sem credenciais reais, servidor produtivo ou chamadas externas.
import assert from 'node:assert/strict';

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
assert.equal(process.env.ALTAN_BOOT_FIXTURE, '1');
assert.equal(target.hostname, 'boot-postgres');
assert.equal(target.pathname, '/boot_governance_test');
assert.equal(target.username, 'synthetic');
assert.equal(target.password, 'synthetic');
assert.ok(['prepare', 'verify'].includes(process.argv[2]));

const { prisma } = await import('../src/infrastructure/db/prisma.js');
const guideId = 'synthetic-boot-guide';
try {
  if (process.argv[2] === 'prepare') {
    assert.equal(await prisma.portalClient.count(), 0, 'Fixture exige banco novo');
    await prisma.portalClient.create({ data: { id: 'synthetic-boot-company', razao: 'SYNTHETIC BOOT', cnpj: '00000000000000' } });
    await prisma.guide.create({ data: { id: guideId, portalClientId: 'synthetic-boot-company',
      tipo: 'PIS', competencia: '2026-10', valor: '100.00', vencimento: new Date('2026-11-20T00:00:00Z'),
      status: 'PROCESSED', source: 'LOCAL' } });
    const { generateProvisionsFromGuide } = await import('../src/application/accounting/GuideToProvisionService.js');
    // Controle positivo: o gerador legado realmente provisiona esta guia. O rollback
    // deixa a órfã elegível antes do boot; o teste não passa por fixture inócua.
    const rollback = new Error('synthetic-positive-control-rollback');
    await assert.rejects(prisma.$transaction(async tx => {
      const result = await generateProvisionsFromGuide({ guideId, tx });
      assert.equal(result.ok, true);
      assert.equal(await tx.accountingEntry.count({ where: { sourceGuideId: guideId } }), 1);
      throw rollback;
    }), error => error === rollback);
  }
  assert.equal(await prisma.guide.count({ where: { id: guideId, status: 'PROCESSED' } }), 1);
  assert.equal(await prisma.accountingEntry.count(), 0, 'Boot/restart criou provisões sem comando supervisionado');
  console.log('Fixture sintética: guia elegível preservada, zero provisões.');
} finally {
  await prisma.$disconnect();
}
