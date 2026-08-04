// RECUPERAÇÃO DOS DOCUMENTOS PULADOS PELO CURSOR NSU DO ADN.
//
// O cursor guardava `maxNSU + 1` e mandava isso como `ultNSU`, que o ADN trata como EXCLUSIVO
// ("devolva o que vier DEPOIS deste"). Resultado: o documento exatamente naquele NSU nunca era
// devolvido — em toda varredura, sem erro nenhum, com a resposta legítima
// `NENHUM_DOCUMENTO_LOCALIZADO`. Como cada execução recomeçava do cursor inflado, o PRIMEIRO
// documento de cada rodada se perdia; não é um por empresa, é um por rodada.
//
// ⚠ NÃO DÁ PARA SABER QUAIS NSUs FORAM PULADOS. `PortalInvoice` não guarda o NSU do documento, e o
// cursor só registra onde a varredura parou. Por isso a recuperação é ZERAR o cursor e deixar a
// próxima captura varrer tudo de novo: a ingestão é idempotente (dedup por chaveAcesso, e por
// idNfse quando não há chave), então re-varrer não duplica nota nem rebaixa cancelamento.
//
// Este script NÃO chama o ADN. Ele só recua o cursor; quem busca é a captura (aba "Consultar
// notas" ou o worker). Separar as duas coisas é de propósito: assim a mudança de dado é revisável
// sozinha, e a varredura pode ser feita na hora que o escritório escolher.
//
// Uso:
//   node scripts/recuperar-nsu-pulados.mjs                  # só mostra (não altera nada)
//   node scripts/recuperar-nsu-pulados.mjs --aplicar        # zera o cursor de todas
//   node scripts/recuperar-nsu-pulados.mjs --aplicar --cnpj=53742042000164
//   node scripts/recuperar-nsu-pulados.mjs --aplicar --recuar=1   # recua 1 em vez de zerar

import { prisma } from "../src/infrastructure/db/prisma.js";

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.split("=").slice(1).join("=") : null;
};
const aplicar = process.argv.includes("--aplicar");
const cnpjFiltro = String(arg("cnpj") || "").replace(/\D/g, "");
const recuar = arg("recuar") ? BigInt(arg("recuar")) : null;

const portals = await prisma.portalClient.findMany({
  where: { cnpj: { not: "" }, ...(cnpjFiltro ? { cnpj: cnpjFiltro } : {}) },
  select: { id: true, razao: true, cnpj: true },
  orderBy: { razao: "asc" },
});

const estados = await prisma.portalSyncState.findMany({
  where: { clientId: { in: portals.map((p) => p.id) } },
  select: { clientId: true, adnNsuCursor: true, adnLastSyncAt: true },
});
const porId = new Map(estados.map((e) => [e.clientId, e]));

const linhas = [];
for (const p of portals) {
  const st = porId.get(p.id);
  const atual = st?.adnNsuCursor ?? null;
  if (atual == null) continue; // nunca sincronizou: não há cursor para recuar
  const novo = recuar == null
    ? 0n
    : (BigInt(atual) > recuar ? BigInt(atual) - recuar : 0n);
  linhas.push({
    razao: String(p.razao).slice(0, 30),
    cnpj: p.cnpj,
    cursorAtual: String(atual),
    cursorNovo: String(novo),
    ultimaSync: st?.adnLastSyncAt ? new Date(st.adnLastSyncAt).toISOString().slice(0, 10) : "—",
    _id: p.id,
    _novo: novo,
  });
}

console.table(linhas.map(({ _id, _novo, ...v }) => v));

if (!aplicar) {
  console.log(`\n${linhas.length} empresa(s) com cursor para recuar. Nada foi alterado.`);
  console.log("Para aplicar:  node scripts/recuperar-nsu-pulados.mjs --aplicar");
  console.log("Depois de aplicar, rode a captura (aba Consultar notas ou o worker) para varrer de novo.");
} else {
  for (const l of linhas) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.portalSyncState.update({
      where: { clientId: l._id },
      data: { adnNsuCursor: l._novo },
    });
  }
  console.log(`\n${linhas.length} cursor(es) recuado(s). A captura ainda NÃO foi executada.`);
  console.log("Próximo passo: aba Consultas → Consultar notas (ou o worker) para varrer de novo.");
}

await prisma.$disconnect();
