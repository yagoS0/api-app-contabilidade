// AUDITORIA PRÉ-APURAÇÃO — SOMENTE LEITURA, nenhum write, nenhuma chamada externa.
//
// Quantas notas caem em cada uma das cinco perguntas, HOJE, na base real. Existe para que o número
// do relatório e o número da tela venham do MESMO lugar: este script chama
// `application/notas/auditoria/auditoriaNotas.js`, a mesma regra pura que a rota
// `GET /firm/companies/:id/notas/auditoria` chama. Uma segunda conta escrita aqui divergiria da
// tela na primeira correção, e o dono leria dois números para a mesma pergunta.
//
// ⚠ ELE NÃO ESCREVE NADA, e não existe `--aplicar`. A auditoria é leitura por desenho (ver
// `auditoria/__tests__/auditoriaNaoEscreve.test.js`); um script que gravasse contradiria o módulo.
// ⚠ NÃO CHAMA ADN, SEFAZ, SERPRO NEM META. Tudo o que ele lê já está em coluna desde o backfill
// dos campos fiscais.
//
// Uso:
//   node scripts/diag-auditoria-notas.mjs [--comp=AAAA-MM] [--meses=N] [--cnpj=...] [--detalhe]
//
//   --comp     competência final da varredura (padrão: o mês anterior ao de hoje)
//   --meses    quantas competências varrer, terminando em --comp (padrão: 6)
//   --cnpj     limita a uma empresa
//   --detalhe  lista os achados linha a linha, além de contá-los
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-auditoria-notas.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { auditarCompetencia } from "../src/application/notas/auditoria/AuditoriaNotasService.js";
import { PERGUNTAS, SITUACAO } from "../src/application/notas/auditoria/auditoriaNotas.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const num = (n, w = 5) => String(n ?? 0).padStart(w);

function competenciaPadrao() {
  const hoje = new Date();
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function competenciasAte(fim, quantas) {
  const [ano, mes] = fim.split("-").map(Number);
  const out = [];
  for (let i = quantas - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

try {
  const compFim = arg("comp") || competenciaPadrao();
  if (!/^\d{4}-\d{2}$/.test(compFim)) {
    console.error("uso: node scripts/diag-auditoria-notas.mjs [--comp=AAAA-MM] [--meses=N] [--cnpj=...] [--detalhe]");
    process.exit(1);
  }
  const meses = Math.max(1, Number(arg("meses") || 6));
  const cnpjFiltro = (arg("cnpj") || "").replace(/\D+/g, "");
  const detalhe = flag("detalhe");
  const competencias = competenciasAte(compFim, meses);

  const empresas = await prisma.portalClient.findMany({
    where: cnpjFiltro ? { cnpj: { contains: cnpjFiltro } } : {},
    select: { id: true, razao: true, cnpj: true, companyId: true },
    orderBy: { razao: "asc" },
  });

  console.log("═══ AUDITORIA PRÉ-APURAÇÃO — MEDIÇÃO (só leitura) ═══");
  console.log(`empresas: ${empresas.length} · competências: ${competencias[0]}..${compFim} (${meses})`);

  const idsDasPerguntas = Object.values(PERGUNTAS).map((p) => p.id);
  const totalAchados = Object.fromEntries(idsDasPerguntas.map((id) => [id, 0]));
  const totalNaoConferivel = Object.fromEntries(idsDasPerguntas.map((id) => [id, 0]));
  const totalConferida = Object.fromEntries(idsDasPerguntas.map((id) => [id, 0]));
  const motivos = new Map();          // motivo → quantas (empresa × competência)
  const empresasComAchado = new Map(); // id → { razao, achados }
  const especies = new Map();          // especie → quantos achados
  let paresAvaliados = 0;
  let paresComNota = 0;

  for (const empresa of empresas) {
    for (const competencia of competencias) {
      const r = await auditarCompetencia({ portalClientId: empresa.id, competencia });
      paresAvaliados += 1;
      if (r.totalNotas > 0) paresComNota += 1;

      for (const p of r.perguntas) {
        if (p.situacao === SITUACAO.NAO_CONFERIVEL) {
          totalNaoConferivel[p.id] += 1;
          const chave = `${p.id} · ${p.motivo}`;
          motivos.set(chave, (motivos.get(chave) || 0) + 1);
          continue;
        }
        totalConferida[p.id] += 1;
        totalAchados[p.id] += p.achados.length;
        for (const a of p.achados) {
          const especie = a.dados?.especie || p.id;
          especies.set(especie, (especies.get(especie) || 0) + 1);
        }
      }

      if (r.totalAchados > 0) {
        const atual = empresasComAchado.get(empresa.id) || { razao: empresa.razao, achados: 0 };
        atual.achados += r.totalAchados;
        empresasComAchado.set(empresa.id, atual);
      }

      if (detalhe && r.totalAchados > 0) {
        console.log(`\n── ${empresa.razao} · ${competencia} (${r.totalNotas} notas) ──`);
        for (const p of r.perguntas) {
          for (const a of p.achados) {
            const quem = a.notaId ? `nota ${a.numero || a.notaId}` : `série ${a.dados?.serie}`;
            console.log(`   ${pad(p.titulo, 34)} ${pad(quem, 22)} ${JSON.stringify(a.dados)}`);
          }
        }
      }
    }
  }

  console.log(`\npares empresa×competência avaliados: ${paresAvaliados} · com pelo menos uma nota: ${paresComNota}`);

  console.log("\n═══ POR PERGUNTA ═══");
  console.log(`${pad("pergunta", 34)} ${pad("achados", 8)} ${pad("conferida", 10)} ${pad("não conferível", 15)}`);
  for (const p of Object.values(PERGUNTAS)) {
    console.log(
      `${pad(p.titulo, 34)} ${num(totalAchados[p.id], 8)} ${num(totalConferida[p.id], 10)} ${num(totalNaoConferivel[p.id], 15)}`,
    );
  }

  console.log("\n═══ ⚠ POR QUE NÃO DEU PARA CONFERIR (isto NÃO é 'tudo certo') ═══");
  if (!motivos.size) console.log("   (nenhum caso)");
  for (const [chave, n] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${num(n, 5)} × ${chave}`);
  }

  console.log("\n═══ ESPÉCIES DE ACHADO ═══");
  if (!especies.size) console.log("   (nenhum achado)");
  for (const [especie, n] of [...especies.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${num(n, 5)} × ${especie}`);
  }

  console.log("\n═══ EMPRESAS COM ACHADO ═══");
  if (!empresasComAchado.size) console.log("   (nenhuma)");
  for (const [, v] of [...empresasComAchado.entries()].sort((a, b) => b[1].achados - a[1].achados)) {
    console.log(`   ${num(v.achados, 5)} · ${v.razao}`);
  }

  console.log("\nNada foi gravado, e nenhuma chamada externa foi feita.");
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
