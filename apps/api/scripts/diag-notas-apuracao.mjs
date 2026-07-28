// Raio-X da cadeia NOTAS → APURAÇÃO, por empresa. Só LÊ o banco — não chama SERPRO/ADN/SEFAZ,
// não grava nada.
//
// Existe porque a apuração não pode errar, e os erros aqui são SILENCIOSOS: uma nota com o
// `statusEfetivo` errado (ou vazio) não dá erro em lugar nenhum — só muda o valor apurado.
//
//   node scripts/diag-notas-apuracao.mjs                 → todas as empresas, resumo
//   node scripts/diag-notas-apuracao.mjs --cnpj=<cnpj>   → uma empresa, detalhado
//   node scripts/diag-notas-apuracao.mjs --ano=2026      → recorta o ano (default: ano corrente)
//
// O QUE CADA ACHADO SIGNIFICA
//
//  • SEM CNAE          → a Aba Fiscal não consegue oferecer CNAE nem sugerir anexo. Empresas
//                        cadastradas antes da busca BrasilAPI ficam assim.
//  • statusEfetivo VAZIO → ⚠ a nota SOME da apuração. Todas as queries de faturamento filtram
//                        `statusEfetivo: "autorizada"` (igualdade exata), então nulo é excluído —
//                        mas a LISTAGEM da tela mostra a nota. Apura a MENOS, sem avisar.
//  • CANCELADAS        → conferir se o valor cancelado é relevante. Se o cliente cancelou a nota
//                        no NFS-e Nacional e aqui ela continua "autorizada", apura a MAIS. Quem
//                        detecta isso é a conferência do ADN (ConferenciaAdnService).
//  • status × statusEfetivo divergentes → os dois campos contam histórias diferentes sobre a
//                        mesma nota; a apuração só olha `statusEfetivo`.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");
const money = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

try {
  const cnpjFiltro = arg("cnpj");
  const ano = Number(arg("ano")) || new Date().getUTCFullYear();
  const gte = new Date(Date.UTC(ano, 0, 1));
  const lt = new Date(Date.UTC(ano + 1, 0, 1));

  // O vínculo é PortalClient.companyId → Company (as notas vivem por PortalClient).
  const portais = await prisma.portalClient.findMany({
    select: { id: true, companyId: true },
  });
  const companyIds = portais.map((p) => p.companyId).filter(Boolean);
  const companies = await prisma.company.findMany({
    where: {
      id: { in: companyIds },
      ...(cnpjFiltro ? { cnpj: { in: [cnpjFiltro, onlyDigits(cnpjFiltro)] } } : {}),
    },
    select: {
      id: true, cnpj: true, razaoSocial: true,
      cnaePrincipal: true, cnaesSecundarios: true, regimeTributario: true, tipoTributario: true,
    },
  });
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const empresas = portais
    .filter((p) => p.companyId && companyById.has(p.companyId))
    .map((p) => ({ ...companyById.get(p.companyId), portalClientId: p.id }))
    .sort((a, b) => String(a.razaoSocial || "").localeCompare(String(b.razaoSocial || "")));
  if (!empresas.length) { console.error("Nenhuma empresa encontrada."); process.exit(1); }

  console.log(`Raio-X notas → apuração · ano ${ano} · ${empresas.length} empresa(s)\n`);

  const semCnae = [];
  const comNulo = [];
  const comCanceladas = [];
  const semCadastro = [];

  for (const emp of empresas) {
    const pcId = emp.portalClientId;
    const notas = pcId
      ? await prisma.portalInvoice.findMany({
          where: { clientId: pcId, papel: "EMIT", competencia: { gte, lt } },
          select: {
            id: true, type: true, numero: true, competencia: true, total: true,
            status: true, statusEfetivo: true, chaveAcesso: true,
          },
        })
      : [];

    const cadastro = pcId
      ? await prisma.cadastroFiscal.findUnique({
          where: { portalClientId: pcId },
          select: { cnaePrincipal: true },
        }).catch(() => null)
      : null;

    // Agrupa por statusEfetivo (nulo vira uma categoria própria — é o caso perigoso).
    const porStatus = new Map();
    for (const n of notas) {
      const k = n.statusEfetivo == null ? "(vazio)" : String(n.statusEfetivo);
      const cur = porStatus.get(k) || { qtd: 0, valor: 0 };
      cur.qtd += 1;
      cur.valor += Number(n.total || 0);
      porStatus.set(k, cur);
    }
    const nulos = porStatus.get("(vazio)") || { qtd: 0, valor: 0 };
    const canceladas = porStatus.get("cancelada") || { qtd: 0, valor: 0 };
    const autorizadas = porStatus.get("autorizada") || { qtd: 0, valor: 0 };

    // `status` e `statusEfetivo` podem discordar. A apuração só olha statusEfetivo.
    const divergentes = notas.filter((n) => {
      const s = String(n.status || "").toUpperCase();
      const se = String(n.statusEfetivo || "").toLowerCase();
      if (!se) return false;
      return (s === "CANCELADA") !== (se === "cancelada");
    });

    const cnaeEfetivo = emp.cnaePrincipal || cadastro?.cnaePrincipal || null;
    const problemas = [];
    if (!cnaeEfetivo) { problemas.push("SEM CNAE"); semCnae.push(emp); }
    if (!cadastro) semCadastro.push(emp);
    if (nulos.qtd) { problemas.push(`${nulos.qtd} nota(s) com statusEfetivo VAZIO`); comNulo.push(emp); }
    if (canceladas.qtd) comCanceladas.push(emp);
    if (divergentes.length) problemas.push(`${divergentes.length} com status × statusEfetivo divergentes`);

    const marca = problemas.length ? "⚠" : " ";
    console.log(`${marca} ${(emp.razaoSocial || "").slice(0, 34).padEnd(34)} ${emp.cnpj}  ${String(emp.regimeTributario || emp.tipoTributario || "?").slice(0, 8)}`);
    console.log(`     CNAE: ${cnaeEfetivo || "— NENHUM —"}${emp.cnaePrincipal ? "" : cadastro?.cnaePrincipal ? "  (só no cadastro fiscal)" : ""}`);
    console.log(`     Notas EMIT ${ano}: ${notas.length}  ·  apuráveis (autorizada): ${autorizadas.qtd} = R$ ${money(autorizadas.valor)}`);
    if (canceladas.qtd) console.log(`     canceladas: ${canceladas.qtd} = R$ ${money(canceladas.valor)}  (fora da apuração, correto)`);
    if (nulos.qtd) console.log(`     ⚠ statusEfetivo VAZIO: ${nulos.qtd} = R$ ${money(nulos.valor)}  → NÃO apuradas, mas aparecem na lista`);
    for (const [k, v] of porStatus) {
      if (["autorizada", "cancelada", "(vazio)"].includes(k)) continue;
      console.log(`     ${k}: ${v.qtd} = R$ ${money(v.valor)}  (fora da apuração)`);
    }
    if (divergentes.length && cnpjFiltro) {
      for (const n of divergentes.slice(0, 10)) {
        console.log(`       nº ${n.numero || "?"}  status=${n.status}  statusEfetivo=${n.statusEfetivo}`);
      }
    }
    console.log("");
  }

  console.log("─".repeat(72));
  console.log(`Sem CNAE ...................: ${semCnae.length}  → Aba Fiscal não sugere anexo`);
  console.log(`Sem CadastroFiscal .........: ${semCadastro.length}`);
  console.log(`Com statusEfetivo vazio ....: ${comNulo.length}  → ⚠ apuram a MENOS, silenciosamente`);
  console.log(`Com notas canceladas .......: ${comCanceladas.length}`);
  if (semCnae.length && !cnpjFiltro) {
    console.log(`\nSem CNAE: ${semCnae.map((e) => e.razaoSocial).join(", ")}`);
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
