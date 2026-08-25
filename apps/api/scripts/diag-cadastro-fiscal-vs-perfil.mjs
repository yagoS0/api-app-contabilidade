// "A EMPRESA NÃO TEM CADASTRO FISCAL" × O PERFIL FISCAL PREENCHIDO — SOMENTE LEITURA.
//
// O dono relatou, com a tela na frente (25/08/2026): a aba Apuração diz "A empresa não tem Cadastro
// Fiscal preenchido (regime + CNAE)" enquanto Empresa → Perfil fiscal, da MESMA empresa, mostra
// "Regime tributário: Simples Nacional" e duas atividades ativas.
//
// ⚠⚠ A EXPLICAÇÃO FÁCIL — "são tabelas diferentes" — NÃO SE SUSTENTA, e foi conferida no código:
// `MotorApuracaoService.js:94` e `DadosPlanejamentoService.js:87` fazem a MESMA chamada,
// `prisma.cadastroFiscal.findUnique({ where: { portalClientId } })`. Mesma tabela, mesma chave.
//
// ⚠ O que MUDA a pergunta: o relatório de faturamento é PERSISTIDO (`relatorios_faturamento`, com
// `geradoEm` e o botão "Regerar" na tela). A frase que o contador lê sai de `dados.preApurado`, ou
// seja é uma FOTO — pode estar descrevendo um bloqueio que já não existe. Um diagnóstico congelado
// se lê como diagnóstico vivo, e manda o contador consertar o que já está consertado.
//
// Este script separa as duas hipóteses medindo, por empresa:
//   (a) o estado VIVO   — a linha em `cadastros_fiscais` existe? com que regime e CNAE?
//   (b) o estado SALVO  — o que o último relatório gravado diz, e de quando ele é
//
// ⚠ ELE NÃO ESCREVE NADA. Não há `--aplicar`. Nenhuma chamada a SERPRO, SEFAZ, ADN ou Meta.
//
// Uso:
//   node apps/api/scripts/diag-cadastro-fiscal-vs-perfil.mjs [--cnpj=...] [--detalhe]
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-cadastro-fiscal-vs-perfil.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const soDigitos = (s) => String(s || "").replace(/\D+/g, "");

function dataBr(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function main() {
  const cnpjFiltro = soDigitos(arg("cnpj"));
  const detalhe = flag("detalhe");

  const portais = await prisma.portalClient.findMany({
    select: { id: true, razao: true, cnpj: true, companyId: true },
    orderBy: { razao: "asc" },
  });
  const alvos = cnpjFiltro ? portais.filter((p) => soDigitos(p.cnpj) === cnpjFiltro) : portais;

  console.log(`\nEmpresas: ${alvos.length}${cnpjFiltro ? ` (filtrado por ${cnpjFiltro})` : ""}\n`);
  console.log(
    `${pad("EMPRESA", 28)} ${pad("CADASTRO VIVO", 26)} ${pad("PERFIL", 8)} ${pad("RELATÓRIO SALVO DIZ", 24)} GERADO EM`,
  );
  console.log("-".repeat(120));

  const placar = {
    semLinha: 0,
    comLinha: 0,
    // ⚠ O caso que decide o diagnóstico: a linha EXISTE e a foto salva acusa a falta dela.
    fotoDesatualizada: 0,
    fotoCoerente: 0,
    semRelatorio: 0,
  };
  const desatualizadas = [];

  for (const p of alvos) {
    const [cadastro, relatorio] = await Promise.all([
      prisma.cadastroFiscal.findUnique({ where: { portalClientId: p.id } }).catch(() => null),
      prisma.relatorioFaturamento.findFirst({
        where: { portalClientId: p.id },
        orderBy: { geradoEm: "desc" },
        select: { competencia: true, geradoEm: true, dados: true },
      }).catch(() => null),
    ]);

    if (cadastro) placar.comLinha += 1; else placar.semLinha += 1;

    const perfil = Array.isArray(cadastro?.perfilAtividades) ? cadastro.perfilAtividades : [];
    const vivo = cadastro
      ? `${cadastro.regime || "—"} · CNAE ${cadastro.cnaePrincipal || "—"}`
      : "⚠ SEM LINHA em cadastros_fiscais";

    const code = relatorio?.dados?.preApurado?.motivo?.code || null;
    let salvo;
    if (!relatorio) {
      salvo = "— (nunca gerado)";
      placar.semRelatorio += 1;
    } else {
      salvo = code || (relatorio.dados?.preApurado?.ok ? "ok (calculou)" : "—");
      // ⚠⚠ ESTA É A LINHA QUE RESPONDE A PERGUNTA DO DONO.
      if (code === "CADASTRO_FALTANDO" && cadastro) {
        placar.fotoDesatualizada += 1;
        desatualizadas.push({ p, relatorio, cadastro });
        salvo = `⚠⚠ ${salvo}`;
      } else {
        placar.fotoCoerente += 1;
      }
    }

    console.log(
      `${pad(p.razao, 28)} ${pad(vivo, 26)} ${pad(`${perfil.length} atv`, 8)} ${pad(salvo, 24)} ${dataBr(relatorio?.geradoEm)}`,
    );

    if (detalhe && perfil.length) {
      for (const a of perfil) {
        console.log(
          `    · CNAE ${pad(a?.cnae, 10)} ativo=${a?.ativo !== false} padrao=${Boolean(a?.padrao)}`
          + ` iss=${a?.aliquotaIss ?? "—"} codMun=${a?.codigoServicoMunicipal || "—"}`,
        );
      }
    }
  }

  console.log("\n─── PLACAR ───");
  console.log(`  linha em cadastros_fiscais .......... ${placar.comLinha} de ${alvos.length}`);
  console.log(`  SEM linha ........................... ${placar.semLinha}`);
  console.log(`  relatório nunca gerado .............. ${placar.semRelatorio}`);
  console.log(`  foto COERENTE com o estado vivo ..... ${placar.fotoCoerente}`);
  console.log(`  ⚠⚠ foto acusa CADASTRO_FALTANDO com a linha EXISTINDO ... ${placar.fotoDesatualizada}`);

  if (desatualizadas.length) {
    console.log(
      "\n⚠⚠ VEREDITO: nestas empresas o relatório SALVO afirma uma falta que o banco desmente.\n"
      + "   A frase na tela é uma FOTO velha, não um diagnóstico. O conserto não é o cadastro —\n"
      + "   é a tela deixar de apresentar um bloqueio congelado como se fosse o estado de agora.\n",
    );
    for (const d of desatualizadas) {
      console.log(`   · ${d.p.razao} — foto de ${dataBr(d.relatorio.geradoEm)}, cadastro criado ${dataBr(d.cadastro.createdAt)}`);
    }
  } else if (placar.semLinha) {
    console.log(
      "\nVEREDITO: nenhuma foto desatualizada. Onde a tela acusa a falta, a linha realmente NÃO existe —\n"
      + "   e o que engana é o Perfil fiscal, que sintetiza um cadastro a partir da `Company`\n"
      + "   (`apuracaoV2.js:88-102`, devolvendo `prefill: true`, que ninguém no front lê).\n",
    );
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
