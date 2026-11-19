// Prévia: node scripts/backfill-provisions-from-existing-guides.mjs --company ID --competencia AAAA-MM
// Escrita supervisionada: acrescentar --execute após conferir escopo, backup e autorização.
// Competência fechada/pendência explícita nunca é contornada por este comando.
const args = process.argv.slice(2);
function argumento(nome) {
  const i = args.indexOf(nome);
  return i < 0 ? undefined : args[i + 1];
}
const portalClientId = argumento('--company');
const competencia = argumento('--competencia');
if (args.includes('--help')) {
  console.log('Uso: --company ID --competencia AAAA-MM [--execute]. Sem --execute: somente lista candidatas, sem autorização de escrita.');
} else if (!portalClientId || portalClientId.startsWith('--') || args.filter(a => a === '--company').length !== 1 || args.filter(a => a === '--competencia').length !== 1 || args.filter(a => a === '--execute').length > 1 || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(competencia || '') || args.some((a, i) => !['--company', '--competencia', '--execute'].includes(a) && !['--company', '--competencia'].includes(args[i - 1]))) {
  console.error('Informe --company ID --competencia AAAA-MM [--execute].');
  process.exitCode = 2;
} else {
  const { backfillProvisionsFromExistingGuides } = await import('../src/application/accounting/GuideToProvisionBackfill.js');
  const { prisma } = await import('../src/infrastructure/db/prisma.js');
  try {
    const resultado = await backfillProvisionsFromExistingGuides({ portalClientId, competencia, executar: args.includes('--execute') });
    console.log(JSON.stringify(resultado));
  } catch (error) {
    // Não registrar conexão, parâmetros SQL, dados fiscais ou segredos de erros do banco.
    console.error(JSON.stringify({ error: error?.code || 'BACKFILL_FALHOU', mensagem: 'Interrompido, sem repetição automática. Confira os resultados anteriores antes de nova execução.' }));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
