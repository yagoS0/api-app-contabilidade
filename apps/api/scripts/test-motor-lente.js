// Teste end-to-end do motor v2 com LENTE:
//   1. Cria CadastroFiscal LENTE (SN ativo)
//   2. Roda apuração 2026-05 com folha12m=25000 (Fator R esperado < 28%)
//   3. Mostra DAS calculado, anexos, decisão Fator R

import { prisma } from "../src/infrastructure/db/prisma.js";
import { calcularApuracaoLocal } from "../src/application/notas/apuracao/v2/MotorApuracaoService.js";

const LENTE_ID = "09167265-3c96-4735-94db-a580dc9cb0c7";

(async () => {
  // 1. Garante cadastro fiscal
  const existing = await prisma.cadastroFiscal.findUnique({ where: { portalClientId: LENTE_ID } });
  if (!existing) {
    console.log("Criando CadastroFiscal LENTE...");
    await prisma.cadastroFiscal.create({
      data: {
        portalClientId: LENTE_ID,
        regime: "SIMPLES_NACIONAL",
        dataOpcaoSN: new Date("2020-01-01"),
        cnaePrincipal: "7311400", // Agências de publicidade
        cnaesSecundarios: ["6201500", "6204000"],
        usaFatorR: true,
      },
    });
    console.log("  ok");
  } else {
    console.log("CadastroFiscal LENTE já existe.");
  }

  // 2. Apura
  console.log("\n=== Apurando LENTE 2026-05 (folha12m=25000) ===");
  const result = await calcularApuracaoLocal({
    portalClientId: LENTE_ID,
    competencia: "2026-05",
    folha12mOverride: 25000,
  });
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
