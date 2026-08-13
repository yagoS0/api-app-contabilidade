// "O ADN ESTÁ PARADO?" — a pergunta certa é OLHEI, não RECEBI.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// `diag-captura-notas.mjs` imprime um veredito "ADN parado há dias" apoiado em `adnLastSyncAt`.
// ⚠ Esse campo SÓ é gravado quando chega documento (`persistCursor`) — numa empresa que não emitiu
// nota ele fica parado para sempre, MESMO com o worker consultando de hora em hora. Ou seja, o
// veredito confunde "ninguém olhou" com "olhei e não havia nada", que são diagnósticos opostos:
// o primeiro é defeito nosso, o segundo é a empresa não ter faturado.
//
// Essa distinção não é teórica — foi exatamente ela que produziu o incidente de 09/08/2026: o gate
// de 1h lia `adnLastSyncAt`, nunca fechava na empresa quieta, e o ADN levou 13.000+ consultas por
// dia até responder 429. O conserto foi passar a ler `adnLastAttemptAt`. Este script lê os DOIS,
// lado a lado, para o veredito parar de sair do campo errado.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-adn-olhou-vs-recebeu.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const agora = Date.now();
const idade = (d) => {
  if (!d) return "NUNCA";
  const min = Math.floor((agora - new Date(d).getTime()) / 60000);
  if (min < 60) return `${min}min`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
};
const minutos = (d) => (d ? Math.floor((agora - new Date(d).getTime()) / 60000) : null);

const clientes = await prisma.portalClient.findMany({
  select: { id: true, razao: true, cnpj: true },
  orderBy: { razao: "asc" },
});
// ⚠ A chave de `PortalSyncState` é `clientId` (é o `@id`), NÃO `portalClientId`. E o cursor do
// módulo Notas é `adnNsuCursor` — `lastCursor` é do AdnSyncService LEGADO, que grava em
// `AdnDocument` e não alimenta a aba. Escrevi os dois errados de memória na primeira versão e o
// script devolveu "33 empresas sem estado", que é o oposto da verdade.
const estados = await prisma.portalSyncState.findMany();
const porCliente = new Map(estados.map((e) => [e.clientId, e]));

// A janela do worker. Se `adnLastAttemptAt` for MAIS VELHO que isso, aí sim ninguém está olhando.
const INTERVALO_MIN = 60;

const linhas = [];
let olhando = 0;
let naoOlhando = 0;
let semEstado = 0;

for (const c of clientes) {
  const s = porCliente.get(c.id);
  if (!s) { semEstado += 1; continue; }

  const mTentativa = minutos(s.adnLastAttemptAt);
  const mSync = minutos(s.adnLastSyncAt);

  // ⚠ O VEREDITO SAI DA TENTATIVA, nunca do sync.
  let veredito;
  if (mTentativa == null) {
    veredito = "NUNCA OLHOU";
    naoOlhando += 1;
  } else if (mTentativa <= INTERVALO_MIN * 2) {
    veredito = mSync == null ? "olhando · nunca veio nota" : "olhando";
    olhando += 1;
  } else {
    veredito = `⚠ SEM OLHAR há ${idade(s.adnLastAttemptAt)}`;
    naoOlhando += 1;
  }

  linhas.push({
    razao: String(c.razao || "").slice(0, 30),
    olhou: idade(s.adnLastAttemptAt),
    recebeu: idade(s.adnLastSyncAt),
    cursor: s.adnNsuCursor != null ? String(s.adnNsuCursor) : "—",
    dfeOlhou: idade(s.dfeLastAttemptAt),
    backoff: s.adnBackoffUntil && new Date(s.adnBackoffUntil) > new Date() ? "ATIVO" : "—",
    erro: s.adnLastError ? String(s.adnLastError).slice(0, 30) : "—",
    veredito,
  });
}

console.log("═".repeat(100));
console.log("ADN — OLHEI (adnLastAttemptAt) × RECEBI (adnLastSyncAt)");
console.log("═".repeat(100));
console.log("\n⚠ 'recebeu' NÃO mede se o worker está rodando. Ele só se move quando CHEGA documento.");
console.log("   Empresa que não emitiu nota fica com 'recebeu' velho para sempre, e está correta.\n");
console.table(linhas);

console.log(`\nolhando normalmente: ${olhando}`);
console.log(`⚠ sem olhar / nunca olhou: ${naoOlhando}`);
console.log(`sem PortalSyncState (o worker nunca chegou nelas): ${semEstado}`);
console.log("\nNada foi alterado.");

await prisma.$disconnect();
