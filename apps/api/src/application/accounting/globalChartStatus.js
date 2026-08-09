// "O plano de contas global está configurado?" — UMA definição, dois consumidores.
//
// Isto era uma função privada dentro de `routes/firm/index.js`, com dois chamadores lá dentro
// (a guarda de `POST /companies` e o `GET /chart-of-accounts/global/status`). O provisionamento de
// empresa saiu da rota para um service compartilhado, e copiar a função para lá criaria duas
// definições de "plano global configurado" — que divergiriam no dia em que alguém acrescentasse um
// sexto tipo obrigatório num dos dois lugares.

import { prisma } from "../../infrastructure/db/prisma.js";

// Lançamentos automáticos (DAS, faturamento, etc.) dependem de um plano mínimo com os 5 tipos
// básicos. Por isso o plano global é PRÉ-REQUISITO para criar qualquer empresa.
export const REQUIRED_GLOBAL_TIPOS = ["ATIVO", "PASSIVO", "RECEITA", "DESPESA", "PATRIMONIO"];

export async function getGlobalChartStatus() {
  const counts = await prisma.chartOfAccount.groupBy({
    by: ["tipo"],
    where: { portalClientId: null },
    _count: { _all: true },
  });
  const presentTipos = new Set(
    counts.map((c) => String(c.tipo || "").toUpperCase()).filter(Boolean)
  );
  const missingTipos = REQUIRED_GLOBAL_TIPOS.filter((t) => !presentTipos.has(t));
  const totalAccounts = counts.reduce((s, c) => s + Number(c._count?._all || 0), 0);
  return {
    isConfigured: missingTipos.length === 0,
    totalAccounts,
    tiposPresentes: [...presentTipos],
    tiposFaltantes: missingTipos,
  };
}
