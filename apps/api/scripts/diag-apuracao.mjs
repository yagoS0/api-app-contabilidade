// Responde "a apuração está funcionando?" com DADOS, não com opinião.
//
// Percorre a cadeia inteira por competência e mostra onde cada uma parou:
//   notas → classificação → pendências → snapshot (estado) → transmissão → DAS → conferência ADN
//
// Só LÊ o banco. Nenhuma chamada externa.
//
//   node scripts/diag-apuracao.mjs                  → ano corrente, todas as empresas
//   node scripts/diag-apuracao.mjs --ano=2026
//   node scripts/diag-apuracao.mjs --cnpj=<cnpj>    → uma empresa, competência a competência
//
// COMO LER
//  • `estado` da competência é a verdade do fluxo: `transmitida`/`confirmada` = declarado à RFB;
//    `fechada` = pronto mas não transmitido; `bloqueada_pendencias` = tem pendência humana.
//  • DAS local × SERPRO: o motor local é DOUBLE-CHECK. Quem manda é o SERPRO. Divergência grande
//    é sinal de que o cálculo local está desatualizado — não de que a declaração está errada.
//  • Conferência ADN nunca rodada aparece como `—`: significa que o faturamento daquela
//    competência NUNCA foi confrontado com a autoridade nacional.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const money = (n) => (n == null ? "—" : `R$ ${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// Estados que significam "chegou ao fim" vs "parou no meio".
const CONCLUIDOS = new Set(["transmitida", "confirmada"]);
const TRAVADOS = new Set(["bloqueada_pendencias", "erro_calculo", "erro_transmissao", "erro"]);

try {
  const cnpjFiltro = arg("cnpj");
  const ano = Number(arg("ano")) || new Date().getUTCFullYear();

  const portais = await prisma.portalClient.findMany({ select: { id: true, companyId: true, razao: true } });
  const companies = await prisma.company.findMany({
    where: {
      id: { in: portais.map((p) => p.companyId).filter(Boolean) },
      ...(cnpjFiltro ? { cnpj: { in: [cnpjFiltro, onlyDigits(cnpjFiltro)] } } : {}),
    },
    select: { id: true, cnpj: true, razaoSocial: true, regimeTributario: true, tipoTributario: true },
  });
  const byCompany = new Map(companies.map((c) => [c.id, c]));
  const empresas = portais
    .filter((p) => p.companyId && byCompany.has(p.companyId))
    .map((p) => ({ ...byCompany.get(p.companyId), portalClientId: p.id }))
    .sort((a, b) => String(a.razaoSocial || "").localeCompare(String(b.razaoSocial || "")));
  if (!empresas.length) { console.error("Nenhuma empresa encontrada."); process.exit(1); }

  const ehSimples = (e) => !/PRESUMID|REAL/i.test(String(e.regimeTributario || e.tipoTributario || ""));

  console.log(`Saúde da apuração · ano ${ano} · ${empresas.length} empresa(s)\n`);

  const totais = {
    concluidas: 0, fechadas: 0, travadas: 0, outras: 0,
    semSnapshot: 0, pendenciasAbertas: 0, conferidas: 0, divergentes: 0,
    lpSemApuracao: 0, divergenciaDas: [],
  };

  for (const emp of empresas) {
    const pcId = emp.portalClientId;
    const [snapshots, pendencias] = await Promise.all([
      prisma.apuracaoSnapshot.findMany({
        where: { portalClientId: pcId, competencia: { startsWith: `${ano}-` } },
        select: {
          competencia: true, estado: true, dasCalculadoLocal: true, dasRetornadoSerpro: true,
          transmitidoEm: true, numeroDeclaracao: true, conferenciaStatus: true, conferidaEm: true,
          receitaInterna: true, fechadaEm: true,
        },
        orderBy: { competencia: "asc" },
      }),
      prisma.filaPendencia.count({ where: { portalClientId: pcId, resolvida: false } }),
    ]);

    if (!ehSimples(emp)) {
      totais.lpSemApuracao += 1;
      console.log(`  ${(emp.razaoSocial || "").slice(0, 36).padEnd(36)} LUCRO PRESUMIDO — não apuramos (aba escondida)`);
      continue;
    }

    if (pendencias) totais.pendenciasAbertas += pendencias;

    const marca = pendencias ? "⚠" : " ";
    console.log(`${marca} ${(emp.razaoSocial || "").slice(0, 36).padEnd(36)} ${emp.cnpj}`);
    if (pendencias) console.log(`     ${pendencias} pendência(s) NÃO resolvida(s) — travam o fechamento`);

    if (!snapshots.length) {
      totais.semSnapshot += 1;
      console.log(`     nenhuma competência de ${ano} iniciada`);
      console.log("");
      continue;
    }

    for (const s of snapshots) {
      if (CONCLUIDOS.has(s.estado)) totais.concluidas += 1;
      else if (s.estado === "fechada") totais.fechadas += 1;
      else if (TRAVADOS.has(s.estado)) totais.travadas += 1;
      else totais.outras += 1;

      if (s.conferenciaStatus) totais.conferidas += 1;
      if (s.conferenciaStatus === "divergente") totais.divergentes += 1;

      // Divergência entre o motor local e o oficial do SERPRO — só faz sentido se os dois existem.
      let divTxt = "";
      if (s.dasCalculadoLocal != null && s.dasRetornadoSerpro != null) {
        const dif = Number(s.dasRetornadoSerpro) - Number(s.dasCalculadoLocal);
        if (Math.abs(dif) > 0.01) {
          divTxt = `  Δ local×SERPRO ${money(dif)}`;
          totais.divergenciaDas.push({ emp: emp.razaoSocial, comp: s.competencia, dif });
        }
      }

      const conf = s.conferenciaStatus
        ? (s.conferenciaStatus === "ok" ? "ADN ok" : s.conferenciaStatus === "divergente" ? "⚠ ADN DIVERGENTE" : "ADN n/a")
        : "ADN —";
      console.log(
        `     ${s.competencia}  ${String(s.estado).padEnd(20)} DAS ${String(money(s.dasRetornadoSerpro ?? s.dasCalculadoLocal)).padEnd(16)} ${conf}${divTxt}`,
      );
    }
    console.log("");
  }

  console.log("─".repeat(76));
  console.log(`Competências transmitidas/confirmadas : ${totais.concluidas}`);
  console.log(`Fechadas mas NÃO transmitidas ........: ${totais.fechadas}`);
  console.log(`Travadas (pendência/erro) ............: ${totais.travadas}`);
  console.log(`Em andamento (outros estados) ........: ${totais.outras}`);
  console.log(`Empresas sem NENHUMA competência .....: ${totais.semSnapshot}`);
  console.log(`Pendências humanas em aberto .........: ${totais.pendenciasAbertas}`);
  console.log(`Competências conferidas contra o ADN .: ${totais.conferidas}${totais.divergentes ? `  (${totais.divergentes} DIVERGENTES)` : ""}`);
  console.log(`Lucro Presumido (fora da apuração) ...: ${totais.lpSemApuracao}`);

  if (totais.divergenciaDas.length) {
    console.log(`\n⚠ DAS local × SERPRO divergindo em ${totais.divergenciaDas.length} competência(s):`);
    for (const d of totais.divergenciaDas.slice(0, 10)) {
      console.log(`   ${d.comp}  ${String(d.emp).slice(0, 34).padEnd(34)} ${money(d.dif)}`);
    }
    console.log("   (o SERPRO é a autoridade; divergência indica motor local desatualizado)");
  }
  if (!totais.conferidas) {
    console.log("\n⚠ NENHUMA competência foi conferida contra o ADN — o faturamento nunca foi");
    console.log("   confrontado com a autoridade nacional. O worker roda no dia 1, mas só para as");
    console.log("   empresas marcadas na rotina \"Conferência ADN\" (página Rotinas).");
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
