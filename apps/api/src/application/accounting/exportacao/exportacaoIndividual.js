// Contrato único usado na exportação individual e em lote.
import { dataCivilBR } from '../../../utils/dataCivil.js';
import { computeFechamentoBlockers, SELECT_PARA_BLOQUEIOS } from '../fechamentoBlockers.js';
function dedupePorTexto(itens) {
  const porMotivo = new Map();
  for (const i of itens) {
    const atual = porMotivo.get(i.motivo);
    if (atual) { atual.ocorrencias += 1; continue; }
    porMotivo.set(i.motivo, { ...i, ocorrencias: 1 });
  }
  return [...porMotivo.values()];
}
export function entriesToCsv(entries) {
  // Formato "lançamento partido": 5 colunas (Data | Codigo Debito | Codigo Credito | Historico | Valor).
  // SEM header — sistema contábil destino consome desde a linha 1.
  // Valor SEM separador de milhar — só vírgula decimal (ex: 17614,98).
  // - Lançamento simples (1D + 1C, mesmo valor, mesmo histórico): uma linha consolidada.
  // - Lançamento composto: uma linha por linha contábil, lado oposto vazio.
  // - line.historico (se presente) tem prioridade sobre entry.historico.
  const rows = [];
  const sanitize = (s) => String(s || "").replace(/;/g, " ").replace(/[\r\n]+/g, " ").trim();
  const fmtValor = (v) => Number(v || 0).toFixed(2).replace(".", ",");

  // ⚠ A DATA É CIVIL, NÃO É INSTANTE — e converter para o fuso do servidor tirava um dia de TODO
  // lançamento exportado.
  //
  // `AccountingEntry.data` é gravada como MEIA-NOITE UTC (`2026-05-12T00:00:00.000Z`): ela
  // representa o DIA do lançamento, não um momento. O código antigo fazia
  // `new Date(e.data).toLocaleDateString("pt-BR")`, **sem `timeZone`** — e `toLocaleDateString` usa
  // o fuso do PROCESSO. Em produção `TZ=America/Sao_Paulo`, então meia-noite UTC vira 21h do dia
  // ANTERIOR e o CSV imprimia **11/05** para o lançamento do dia **12/05**.
  //
  // Medido em 13/08/2026, relatado pelo dono ("na minha tabela não tem 26/5 nem 11/5, mas o export
  // tem"): os 621 lançamentos da base saíam com a data um dia antes, e **15 deles mudavam de MÊS**
  // (os gravados no dia 1º viravam o último dia do mês anterior). Como este CSV é consumido por
  // sistema contábil externo, isso não é cosmético: é lançamento entrando na competência errada.
  //
  // ⚠ A TABELA SEMPRE ESTEVE CERTA — ela usa `String(entry.data).slice(0, 10)`
  // (`renderAccountingEntriesParts.jsx`), que fatia a ISO sem converter fuso nenhum. Quem divergia
  // era o export. A regra vive em `utils/dataCivil.js` porque este NÃO é o único lugar: o e-mail
  // de guia ao cliente tinha o mesmo defeito com `Guide.vencimento`.
  for (const e of entries) {
    const data = dataCivilBR(e.data);
    const entryHistorico = sanitize(e.historico);
    const lines = e.lines || [];
    const debits = lines.filter((l) => String(l.tipo).toUpperCase() === "D");
    const credits = lines.filter((l) => String(l.tipo).toUpperCase() === "C");
    const lineHistoric = (l) => sanitize(l.historico) || entryHistorico;

    if (debits.length === 1 && credits.length === 1
        && Math.abs(Number(debits[0].valor) - Number(credits[0].valor)) < 0.01
        && lineHistoric(debits[0]) === lineHistoric(credits[0])) {
      rows.push(`${data};${debits[0].conta};${credits[0].conta};${lineHistoric(debits[0])};${fmtValor(debits[0].valor)}`);
    } else {
      for (const d of debits) {
        rows.push(`${data};${d.conta};;${lineHistoric(d)};${fmtValor(d.valor)}`);
      }
      for (const c of credits) {
        rows.push(`${data};;${c.conta};${lineHistoric(c)};${fmtValor(c.valor)}`);
      }
    }
  }
  return rows.join("\r\n");
}
export async function preflightExportacao(prisma, portalClientId, competencia, incluirLancamentos = false) {
      const entries = await prisma.accountingEntry.findMany({
        where: { portalClientId, competencia, tipo: { not: "PARCELA" } },
        orderBy: [{ data: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        ...(incluirLancamentos ? { include: { lines: { orderBy: { ordem: "asc" } } } } : { select: { ...SELECT_PARA_BLOQUEIOS, id: true, historico: true, competencia: true, status: true } }),
      });

      const { blockers } = computeFechamentoBlockers(entries, competencia);
      const MOTIVOS = {
        em_branco: "lançamento sem nenhuma linha",
        conta_em_branco: "linha sem conta",
        desbalanceado: "débito ≠ crédito",
        parcelamento_desbalanceado: "grupo de parcelamento com débito ≠ crédito",
        folha_desbalanceada: "lote de folha com débito ≠ crédito",
      };
      const erros = blockers.map((b) => ({
        entryId: b.entryId || null,
        historico: b.historico || "(sem histórico)",
        motivo: MOTIVOS[b.motivo] || b.motivo,
      }));

      // Contas usadas × plano de contas. Uma query para a competência inteira.
      const codigosUsados = [...new Set(
        entries.flatMap((e) => (e.lines || []).map((l) => String(l.conta || "").trim())).filter(Boolean),
      )];
      const contasDoPlano = codigosUsados.length
        ? await prisma.chartOfAccount.findMany({
          where: { codigo: { in: codigosUsados }, OR: [{ portalClientId }, { portalClientId: null }] },
          select: { codigo: true, status: true },
        })
        : [];
      const porCodigo = new Map(contasDoPlano.map((c) => [c.codigo, c]));

      const alertas = [];
      for (const e of entries) {
        for (const l of e.lines || []) {
          const cod = String(l.conta || "").trim();
          if (!cod) continue;
          const conta = porCodigo.get(cod);
          if (!conta) {
            erros.push({ entryId: e.id, historico: e.historico || "(sem histórico)", motivo: `conta ${cod} não existe no plano` });
          } else if (conta.status === "PENDENTE_ERP") {
            alertas.push({ entryId: e.id, historico: e.historico || "(sem histórico)", motivo: `conta ${cod} ainda não confirmada no ERP` });
          }
        }
      }

      const circular = await prisma.companyMonthlyCircular.findUnique({
        where: { portalClientId_competencia: { portalClientId, competencia } },
        select: { fechadoContabilEm: true },
      });
      if (!circular?.fechadoContabilEm) {
        alertas.push({ entryId: null, historico: null, motivo: "o mês ainda não foi fechado contabilmente" });
      }

      // ⚠ REEXPORTAÇÃO. Não bloqueia — reexportar é legítimo (o ERP recusou o arquivo, o contador
      // trocou de sistema). Mas mandar o mesmo mês duas vezes sem saber disso duplica lançamento
      // do outro lado, e o único jeito de descobrir é pela conciliação, semanas depois.
      const jaExportados = entries.filter((e) => e.status === "EXPORTADO").length;
      if (jaExportados > 0) {
        alertas.push({
          entryId: null,
          historico: null,
          motivo: `${jaExportados} lançamento${jaExportados > 1 ? "s" : ""} desta competência já foi exportado antes`,
        });
      }

      let totalD = 0; let totalC = 0; let linhas = 0;
      for (const e of entries) {
        for (const l of e.lines || []) {
          linhas += 1;
          const v = Number(l.valor || 0);
          if (String(l.tipo).toUpperCase() === "D") totalD += v; else totalC += v;
        }
      }

      return ({
        ok: true,
        ...(incluirLancamentos ? { entries } : {}),
        competencia,
        // ⚠ Erro repetido não vira linha repetida: a mesma conta inexistente em oito lançamentos
        // encheria a tela e escondera os outros problemas.
        erros: dedupePorTexto(erros),
        alertas: dedupePorTexto(alertas),
        totais: { entries: entries.length, linhas, totalD, totalC, diferenca: Math.abs(totalD - totalC) },
        mesFechado: Boolean(circular?.fechadoContabilEm),
        jaExportados,
      });

}
