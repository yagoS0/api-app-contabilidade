// PROBE do PAGAMENTOS71 — a consulta de pagamentos do PAGTOWEB.
//
// PARA QUE SERVE
// Hoje o sistema confirma pagamento pelo `COMPARRECADACAO72`, que devolve **só um PDF**. O rateio
// principal/juros/multa sai de heurística sobre o texto, e — o que importa aqui — **sem quebra por
// código de receita**. Num DARF consolidado de Lucro Presumido (PIS + COFINS + IRPJ + CSLL num
// documento só) isso significa que dá para saber que a guia foi paga, mas NÃO quanto foi de cada
// tributo. Ratear os quatro por conta própria seria inferência virando lançamento contábil.
//
// O `PAGAMENTOS71` devolve os valores como CAMPOS (`valorPrincipal`, `valorMulta`, `valorJuros`)
// e uma lista de `desmembramentos`, cada um com sua `receitaPrincipal`. Se isso for verdade contra
// a API real, a baixa por tributo deixa de precisar de inferência.
//
// ⚠ ESTE SCRIPT EXISTE PARA DESCOBRIR SE É VERDADE. A documentação descreve os campos; ela não diz
// como um DARF consolidado se comporta. As três perguntas que só a resposta real responde:
//
//   1. O DARF do LP volta como UM pagamento com N desmembramentos, ou como N pagamentos?
//   2. Cada desmembramento traz `receitaPrincipal` preenchida (8109 PIS, 2172 COFINS, 2089 IRPJ,
//      2372 CSLL) — ou ela só aparece no documento inteiro?
//   3. `valorMulta`/`valorJuros` vêm POR desmembramento, ou só no total?
//
// Sem (2) e (3) não há baixa por tributo, e o `COMPARRECADACAO72` continua sendo o caminho.
// Nenhuma linha do serviço de produção deve ser escrita antes desta resposta — é exatamente o que
// foi feito ao contrário com o `CONSDECCOMPLETA33`, que está OFF até hoje por ter sido codado sem
// nunca ter sido exercido.
//
// O QUE ELE NÃO FAZ: não grava nada, não transmite nada, não emite nada. É leitura pura.
//
// ⚠ CHAMADA PAGA. Uma por execução, registrada e contada pela guarda de custo do SERPRO. Por isso
// só roda com `--confirmo`.
//
// ⚠ DUAS COISAS AQUI NÃO SAEM DA DOCUMENTAÇÃO OFICIAL, e estão marcadas no código abaixo:
//   · o ENDPOINT (`/Consultar`) — o doc do serviço não o declara. Vem do padrão do próprio
//     código, já validado em produção: consulta que devolve dados vai em `/Consultar`
//     (parcelamento, recibo da DCTFWeb, PGDAS-D) e emissão de documento vai em `/Emitir`
//     (comprovante, guia, relatório SITFIS). Override: `--endpoint=/Emitir`.
//   · `versaoSistema` — os exemplos oficiais do PAGAMENTOS71 **não trazem o campo**, então ele não
//     é enviado. Override: `--versaoSistema=1.0`.
// Se a chamada falhar com erro de entrada, é por um desses dois que se começa.
//
// ⚠ FILTRO: os únicos filtros confirmados na documentação são `intervaloDataArrecadacao` e
// `codigoReceitaLista` (+ paginação). **Não existe filtro por número de documento documentado** —
// não invente um. O casamento com a nossa guia se faz DEPOIS, pelo `numeroDocumento` que vem em
// cada pagamento da resposta.
//
// Uso:
//   node scripts/probe-pagamentos71.mjs --cnpj=00000000000191 --de=2026-05-01 --ate=2026-07-31
//   node scripts/probe-pagamentos71.mjs --cnpj=... --de=... --ate=... --confirmo
//   ... [--codigos=8109,2172,2089,2372] [--endpoint=/Consultar] [--versaoSistema=1.0] [--json]

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  SERPRO_PAGTOWEB_SYSTEM,
  SERPRO_PAGTOWEB_SERVICE_PAGAMENTOS,
} from "../src/config.js";
import { getResolvedSerproCredentials } from "../src/application/fiscal/serpro/SerproRuntimeSettings.js";
import { SerproHttpClient } from "../src/application/fiscal/serpro/SerproHttpClient.js";
import { comContextoSerpro } from "../src/application/fiscal/serpro/serproCallContext.js";
import { getGuideNumeroDocumento } from "../src/application/fiscal/serpro/SerproPaymentConfirmationService.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const cnpjArg = String(arg("cnpj") || "").replace(/\D/g, "");
const de = arg("de");
const ate = arg("ate");
const codigos = (arg("codigos") || "").split(",").map((c) => c.trim()).filter(Boolean);
const endpoint = arg("endpoint") || "/Consultar";
const versaoSistema = arg("versaoSistema") || null;
const mostrarJson = process.argv.includes("--json");
const confirmo = process.argv.includes("--confirmo");

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
if (!cnpjArg || cnpjArg.length !== 14 || !DATA_ISO.test(de || "") || !DATA_ISO.test(ate || "")) {
  console.error("Uso: node scripts/probe-pagamentos71.mjs --cnpj=<14 dígitos> --de=YYYY-MM-DD --ate=YYYY-MM-DD [--confirmo]");
  process.exit(2);
}

// Os quatro tributos do DARF do Presumido. Só entram no filtro se o operador pedir `--codigos`;
// por padrão o probe traz TUDO do período, que é o que mostra se o DARF veio inteiro ou partido.
const TRIBUTO_POR_CODIGO = { 8109: "PIS", 2172: "COFINS", 2089: "IRPJ", 2372: "CSLL", 3208: "IRRF" };

// Informativo. Best-effort de propósito: um tropeço no banco não pode impedir o aviso de custo.
const empresa = await prisma.portalClient.findFirst({
  where: { cnpj: cnpjArg },
  select: { razao: true, cnpj: true, companyId: true },
}).catch(() => null);
if (empresa) {
  const legacy = empresa.companyId
    ? await prisma.company.findUnique({ where: { id: empresa.companyId }, select: { regimeTributario: true } }).catch(() => null)
    : null;
  console.log(`EMPRESA: ${empresa.razao} (${empresa.cnpj}) · regime ${legacy?.regimeTributario || "?"}`);
  if (legacy?.regimeTributario && !["LUCRO_PRESUMIDO", "LUCRO_REAL"].includes(legacy.regimeTributario)) {
    console.log("⚠ Esta empresa não é Presumido/Real — o DARF consolidado de 4 tributos, que é o caso");
    console.log("  que este probe existe para investigar, provavelmente não vai aparecer.");
  }
} else {
  console.log(`⚠ CNPJ ${cnpjArg} não está na carteira. O SERPRO será consultado assim mesmo (quem manda é a procuração).`);
}

// As guias de DARF do LP que temos no período — é contra elas que a resposta vai ser comparada.
// `sourceFileId` com o prefixo do LP é a mesma marca em que o worker se apoia.
//
// ⚠ `numeroDocumento` NÃO é coluna: vive dentro do JSON `extracted`, e as guias antigas usam
// `numeroDoc`/`numeroDas`. Por isso a leitura é a do worker (`getGuideNumeroDocumento`), importada
// — reimplementá-la aqui faria o probe dizer "sem número" sobre guia que o worker enxerga.
const guiasLp = await prisma.guide.findMany({
  where: { sourceFileId: { startsWith: `serpro:dctfweb:lp:${cnpjArg}:` } },
  select: { competencia: true, extracted: true, valor: true, paymentStatus: true },
  orderBy: { competencia: "asc" },
}).catch((e) => {
  // Falha aqui é informativa, não fatal — mas em SILÊNCIO ela viraria "esta empresa não tem DARF",
  // que é uma afirmação falsa e justamente a que o probe usa como referência de comparação.
  console.log(`⚠ não consegui listar as guias de LP: ${e?.message?.split("\n")[0]}`);
  return [];
});
if (guiasLp.length) {
  console.log(`\nDARFs de LP que temos no banco (${guiasLp.length}) — compare o numeroDocumento com a resposta:`);
  for (const g of guiasLp) {
    console.log(`  ${g.competencia} · doc ${getGuideNumeroDocumento(g) || "(sem número)"} · R$ ${g.valor} · ${g.paymentStatus || "?"}`);
  }
} else {
  console.log("\n⚠ Nenhum DARF de LP no banco para este CNPJ — não haverá contra o que comparar a resposta.");
}

if (!confirmo) {
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log(`Isto faria UMA consulta PAGA ao SERPRO (${SERPRO_PAGTOWEB_SERVICE_PAGAMENTOS} em ${endpoint}).`);
  console.log("É leitura: não transmite, não emite guia, não grava lançamento, não salva nada.");
  console.log("Para executar de verdade, repita o comando com --confirmo");
  console.log("───────────────────────────────────────────────────────────────");
  await prisma.$disconnect();
  process.exit(0);
}

const runtime = await getResolvedSerproCredentials();
const procurador = String(runtime.certificate?.document || "").replace(/\D/g, "");
if (procurador.length !== 14) {
  console.error("✕ CNPJ do procurador (certificado do escritório) não configurado.");
  await prisma.$disconnect();
  process.exit(1);
}

// `dados` é uma string JSON dentro do JSON — quirk do Integra Contador, igual aos outros serviços.
const dados = {
  intervaloDataArrecadacao: { dataInicial: de, dataFinal: ate },
  ...(codigos.length ? { codigoReceitaLista: codigos } : {}),
  primeiroDaPagina: 0,
  tamanhoDaPagina: 100,
};

const envelope = {
  contratante: { numero: procurador, tipo: 2 },
  autorPedidoDados: { numero: procurador, tipo: 2 },
  contribuinte: { numero: cnpjArg, tipo: 2 },
  pedidoDados: {
    idSistema: SERPRO_PAGTOWEB_SYSTEM,
    idServico: SERPRO_PAGTOWEB_SERVICE_PAGAMENTOS,
    ...(versaoSistema ? { versaoSistema } : {}),
    dados: JSON.stringify(dados),
  },
};

console.log(`\nenviando ${endpoint} · dados = ${envelope.pedidoDados.dados}`);

const client = new SerproHttpClient();
// raw + validateStatus: "nenhum pagamento no período" é resposta de negócio, não erro de rede —
// e um 4xx aqui é justamente o diagnóstico que interessa (endpoint ou versaoSistema errados).
const resp = await comContextoSerpro(
  { origem: "probe:pagamentos71", userId: null, forcar: false },
  () => client.post(endpoint, envelope, { raw: true, validateStatus: () => true }),
).catch((e) => ({ erroLocal: e?.code || "FALHA", message: e?.message }));

if (resp.erroLocal) {
  console.error(`\n✕ ${resp.erroLocal}: ${resp.message}`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log("\n═══ RESPOSTA DO SERPRO ═══");
console.log(`HTTP .............. ${resp.status}`);

const body = resp.data;
const mensagens = body?.mensagens ?? body?.Mensagens ?? null;
if (mensagens) console.log(`mensagens ......... ${JSON.stringify(mensagens)}`);

// `dados` volta ora objeto, ora string JSON, ora array — a mesma variação que já mordeu o
// extrator de numeroDocumento do comprovante. Aqui a gente não adivinha: normaliza e mostra.
let pagamentos = null;
const rawDados = body?.dados ?? body?.Dados ?? null;
try {
  const parsed = typeof rawDados === "string" ? JSON.parse(rawDados) : rawDados;
  pagamentos = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
} catch {
  console.log(`⚠ o campo "dados" não é JSON parseável. Cru: ${String(rawDados).slice(0, 400)}`);
}

if (mostrarJson || !pagamentos) {
  console.log("\n─── corpo cru ───");
  console.log(JSON.stringify(body, null, 2).slice(0, 20000));
}

if (!pagamentos?.length) {
  console.log("\nNenhum pagamento no período.");
  console.log("Se você sabe que há DARF pago aí, isso é resultado — pode ser o endpoint, o filtro");
  console.log("ou a procuração. NÃO conclua que o serviço não serve com uma tentativa só.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`\n═══ ${pagamentos.length} PAGAMENTO(S) ═══`);
for (const [i, p] of pagamentos.entries()) {
  const desm = Array.isArray(p?.desmembramentos) ? p.desmembramentos : [];
  console.log(`\n[${i + 1}] doc ${p?.numeroDocumento ?? "—"} · tipo ${p?.tipo ?? "—"} · PA ${p?.periodoApuracao ?? "—"}`);
  console.log(`    arrecadado em ${p?.dataArrecadacao ?? "—"} · vence ${p?.dataVencimento ?? "—"}`);
  console.log(`    receitaPrincipal ${p?.receitaPrincipal ?? "—"}`);
  console.log(`    total ${p?.valorTotal ?? "—"} = principal ${p?.valorPrincipal ?? "—"} + multa ${p?.valorMulta ?? "—"} + juros ${p?.valorJuros ?? "—"}`);
  console.log(`    desmembramentos: ${desm.length}`);
  if (desm.length) {
    console.table(desm.map((d) => ({
      seq: d?.sequencial,
      receita: d?.receitaPrincipal ?? "⚠ AUSENTE",
      tributo: TRIBUTO_POR_CODIGO[String(d?.receitaPrincipal ?? "").replace(/\D/g, "").slice(0, 4)] || "?",
      PA: d?.periodoApuracao,
      principal: d?.valorPrincipal,
      multa: d?.valorMulta ?? "⚠ AUSENTE",
      juros: d?.valorJuros ?? "⚠ AUSENTE",
      total: d?.valorTotal,
    })));
  }
}

// ─── AS TRÊS PERGUNTAS ─────────────────────────────────────────────────────────────────────────
// O veredito é impresso em vez de deduzido de olho: é ele que autoriza (ou não) a Parte B.
const comDesm = pagamentos.filter((p) => Array.isArray(p?.desmembramentos) && p.desmembramentos.length > 1);
const todosDesm = pagamentos.flatMap((p) => (Array.isArray(p?.desmembramentos) ? p.desmembramentos : []));
const desmComReceita = todosDesm.filter((d) => d?.receitaPrincipal != null);
const desmComAcrescimo = todosDesm.filter((d) => d?.valorMulta != null || d?.valorJuros != null);

console.log("\n═══ VEREDITO ═══");
console.log(`1. DARF consolidado veio inteiro? ${comDesm.length
  ? `SIM — ${comDesm.length} pagamento(s) com mais de um desmembramento`
  : "não apareceu nenhum pagamento com 2+ desmembramentos neste período"}`);
console.log(`2. desmembramento traz receitaPrincipal? ${todosDesm.length
  ? `${desmComReceita.length}/${todosDesm.length}`
  : "sem desmembramento para avaliar"}`);
console.log(`3. multa/juros por desmembramento? ${todosDesm.length
  ? `${desmComAcrescimo.length}/${todosDesm.length}`
  : "sem desmembramento para avaliar"}`);

// ⚠ A comparação é por DÍGITOS. As nossas guias guardam o número COM máscara
// ("07.16.26192.9479948-6") e não há garantia de que o SERPRO devolva no mesmo formato — foi
// justamente a máscara que fazia o COMPARRECADACAO72 responder 500. Comparar as strings cruas
// diria "nenhum bate" sobre documentos idênticos.
const digitos = (v) => String(v ?? "").replace(/\D+/g, "");
const nossos = new Map(guiasLp.map((g) => [digitos(getGuideNumeroDocumento(g)), g.competencia]).filter(([d]) => d));
const casados = pagamentos.filter((p) => nossos.has(digitos(p?.numeroDocumento)));
console.log(`4. bate com guia nossa? ${casados.length}/${pagamentos.length}` + (casados.length
  ? ` — ${casados.map((p) => `${nossos.get(digitos(p.numeroDocumento))}`).join(", ")}`
  : " — nenhum documento da resposta corresponde a guia nossa"));

const serve = comDesm.length > 0 && desmComReceita.length === todosDesm.length && desmComAcrescimo.length > 0;
console.log("\n───────────────────────────────────────────────────────────────");
if (serve) {
  console.log("✓ A quebra por tributo EXISTE. A baixa separada de PIS/COFINS/IRPJ/CSLL pode ser");
  console.log("  escrita a partir daqui, usando ESTA resposta como fixture do teste.");
} else {
  console.log("⚠ A quebra por tributo NÃO ficou provada nesta resposta.");
  console.log("  Se faltou receitaPrincipal ou faltaram multa/juros no desmembramento, a baixa por");
  console.log("  tributo exigiria ratear — que é inferência virando lançamento contábil. NÃO escreva");
  console.log("  a Parte B assim: traga esta saída para decidirmos.");
}
console.log("Guarde a saída inteira (--json) — ela é a fixture, e fixture inventada por mim é o");
console.log("que fez o CONSDECCOMPLETA33 nascer OFF e continuar OFF.");
console.log("───────────────────────────────────────────────────────────────");

await prisma.$disconnect();
