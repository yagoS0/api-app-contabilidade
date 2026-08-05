// Preenche `envios_guia` a partir do histórico de e-mail — dry-run por padrão.
//
// ⚠ POR QUE ISTO É OBRIGATÓRIO, E NÃO UMA LIMPEZA OPCIONAL
// A partir da F2 o chip da listagem e o `guideCompliance` param de ler `Guide.emailStatus` e passam
// a ler `envios_guia`. Sem backfill, no dia do deploy TODA guia já enviada aparece como pendente:
// a carteira inteira fica vermelha e o contador reenvia coisa que o cliente já recebeu.
//
// A conversão é direta e sem invenção — o que existe em `emailStatus` vira um registro de canal
// EMAIL com o mesmo significado:
//     SENT    → enviado   (com `emailSentAt` como data)
//     ERROR   → falhou    (com `emailLastError`)
//     PENDING → pendente
//     SENDING → pendente  (rebaixado de propósito: "enviando" de um processo que já morreu é
//                          estado preso; pendente deixa a fila retomar)
//
// Guia sem `emailStatus` nenhum NÃO gera registro: ausência de envio é ausência, não um envio
// pendente inventado.
//
// Uso:
//   node scripts/backfill-envio-guia.mjs             # mostra o que faria
//   node scripts/backfill-envio-guia.mjs --aplicar

import { prisma } from "../src/infrastructure/db/prisma.js";

const aplicar = process.argv.includes("--aplicar");
const LOTE = 500;

const MAPA = {
  SENT: "enviado",
  ERROR: "falhou",
  PENDING: "pendente",
  SENDING: "pendente",
};

const totais = { lidas: 0, criadas: 0, jaExistiam: 0, semStatus: 0, porStatus: {} };
let cursor = null;

// eslint-disable-next-line no-constant-condition
while (true) {
  const guias = await prisma.guide.findMany({
    take: LOTE,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: "asc" },
    select: {
      id: true, emailStatus: true, emailSentAt: true, emailLastError: true,
      emailAttempts: true, portalClientId: true,
    },
  });
  if (!guias.length) break;
  cursor = guias[guias.length - 1].id;
  totais.lidas += guias.length;

  // Os destinos vêm da empresa; buscados em bloco para não fazer uma query por guia.
  const portalIds = [...new Set(guias.map((g) => g.portalClientId).filter(Boolean))];
  const empresas = portalIds.length
    ? await prisma.portalClient.findMany({
      where: { id: { in: portalIds } },
      select: { id: true, guideNotificationEmail: true },
    })
    : [];
  const emailPorEmpresa = new Map(empresas.map((e) => [e.id, e.guideNotificationEmail]));

  const existentes = await prisma.envioGuia.findMany({
    where: { guideId: { in: guias.map((g) => g.id) }, canal: "EMAIL" },
    select: { guideId: true },
  });
  const jaTem = new Set(existentes.map((e) => e.guideId));

  const novos = [];
  for (const g of guias) {
    const bruto = String(g.emailStatus || "").toUpperCase();
    if (!bruto || !MAPA[bruto]) { totais.semStatus += 1; continue; }
    if (jaTem.has(g.id)) { totais.jaExistiam += 1; continue; }

    const status = MAPA[bruto];
    totais.porStatus[status] = (totais.porStatus[status] || 0) + 1;
    novos.push({
      guideId: g.id,
      canal: "EMAIL",
      status,
      destino: emailPorEmpresa.get(g.portalClientId) || null,
      enviadoEm: status === "enviado" ? (g.emailSentAt || new Date()) : null,
      erroMensagemUsuario: status === "falhou" ? String(g.emailLastError || "").slice(0, 400) || null : null,
      tentativas: Number(g.emailAttempts || 0),
    });
  }

  if (aplicar && novos.length) {
    // `skipDuplicates` para o script ser seguro de rodar duas vezes — a unique (guideId, canal)
    // faz o resto.
    const r = await prisma.envioGuia.createMany({ data: novos, skipDuplicates: true });
    totais.criadas += r.count;
  } else {
    totais.criadas += novos.length;
  }
}

console.table([{
  guias_lidas: totais.lidas,
  registros: totais.criadas,
  ja_existiam: totais.jaExistiam,
  sem_status_email: totais.semStatus,
}]);
console.table(Object.entries(totais.porStatus).map(([status, n]) => ({ status, n })));

if (!aplicar) {
  console.log("\nNADA foi gravado. Para aplicar:  node scripts/backfill-envio-guia.mjs --aplicar");
  console.log("⚠ Rode ANTES de subir a F2: sem estes registros, toda guia já enviada aparece como");
  console.log("  pendente na listagem e o contador reenvia o que o cliente já recebeu.");
} else {
  console.log(`\n${totais.criadas} registro(s) de envio criados. Seguro rodar de novo (skipDuplicates).`);
}

await prisma.$disconnect();
