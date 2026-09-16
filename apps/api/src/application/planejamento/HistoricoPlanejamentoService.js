import { prisma } from "../../infrastructure/db/prisma.js";
import { whereFaturamentoEmit } from "../notas/apuracao/v2/FechamentoService.js";
import { carregarPlano } from "../accounting/AliquotaPorLancamentosService.js";
import { classificarConta, GRUPO } from "../accounting/lib/impostosSobreReceita.js";
import { resolverContasDespesaFolha } from "../accounting/payrollTemplate.js";
import { historicoMensalDosSnapshots } from "./lib/historicoMensal.js";

const numero = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const arredondar = v => Math.round(v * 100) / 100;
const valido = v => numero(v) != null && numero(v) >= 0;
const data = c => new Date(`${c}-01T00:00:00Z`);

// A receita é escolhida por fonte, nunca somada entre nota, lançamento e apuração.
export function consolidarHistorico({ snapshots = [], notas = [], lancamentos = [], plano = new Map(), contasFolha = new Set() }) {
  const mapa = new Map();
  const mes = competencia => {
    if (!mapa.has(competencia)) mapa.set(competencia, { competencia, receita: null, folha: null, tributoApurado: null });
    return mapa.get(competencia);
  };
  for (const n of notas) {
    const d = new Date(n.competencia);
    if (!n.competencia || !Number.isFinite(d.getTime()) || !valido(n._sum?.total) || !(n._count?._all > 0)) continue;
    const m = mes(d.toISOString().slice(0, 7));
    m.receitaNotas = arredondar((m.receitaNotas || 0) + Number(n._sum.total));
    m.quantidadeNotas = (m.quantidadeNotas || 0) + n._count._all;
  }
  for (const e of lancamentos) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(e.competencia) || !["CONFIRMADO", "EXPORTADO"].includes(e.status)) continue;
    // Baixa/provisão de passivo não é uma nova receita; o plano resolve a natureza da linha.
    const m = mes(e.competencia);
    for (const l of e.lines || []) {
      const v = numero(l.valor);
      if (v == null || !["D", "C"].includes(l.tipo)) continue;
      const conta = plano.get(String(l.conta || "").trim());
      const grupo = classificarConta(conta);
      if (grupo === GRUPO.INDETERMINADO) m.contasNaoIdentificadas = (m.contasNaoIdentificadas || 0) + 1;
      if ([GRUPO.RECEITA_BRUTA, GRUPO.DEDUCAO_NAO_TRIBUTARIA].includes(grupo)) {
        m.receitaLancamentos = arredondar((m.receitaLancamentos || 0) + v * (l.tipo === "C" ? 1 : -1));
      }
      // Provisão de salário não prova pagamento nem encargos da base fiscal do Fator R.
      if (contasFolha.has(String(l.conta || "").trim())) m.folhaContabil = arredondar((m.folhaContabil || 0) + v * (l.tipo === "D" ? 1 : -1));
    }
  }
  for (const s of historicoMensalDosSnapshots(snapshots)) Object.assign(mes(s.competencia), s);
  for (const m of mapa.values()) {
    if (m.receita == null) {
      if (valido(m.receitaNotas)) { m.receita = m.receitaNotas; m.origem = `notas autorizadas cadastradas (${m.quantidadeNotas})`; }
      else if (valido(m.receitaLancamentos)) { m.receita = m.receitaLancamentos; m.origem = "lançamentos contábeis confirmados (receita menos devoluções/descontos)"; }
    }
    const fontes = [m.receita, m.receitaNotas, m.receitaLancamentos].filter(v => v != null);
    if (fontes.length > 1 && Math.max(...fontes) - Math.min(...fontes) > 0.01) m.avisoReceita = "Receita diferente entre as fontes. Usada a apuração; na ausência, notas e depois lançamentos. Confira a competência.";
    if (m.receitaLancamentos < 0) m.avisoReceita = "Saldo contábil de receita negativo: confira estornos e encerramentos antes de usar no planejamento.";
    if (m.contasNaoIdentificadas && m.receitaNotas == null && m.origem?.startsWith("lançamentos")) m.avisoReceita = `${m.contasNaoIdentificadas} linha(s) sem conta reconhecida no plano. A receita contábil pode estar incompleta.`;
    if (m.folhaContabil < 0) m.folhaContabil = null;
    if (m.folhaContabil != null) m.origemFolhaContabil = "despesa de folha/pró-labore lançada; conferir pagamento e encargos";
  }
  return [...mapa.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

export async function carregarHistoricoPlanejamento({ portalClientId, referencia, snapshots = [], client = prisma }) {
  const inicio = `${Number(referencia.slice(0, 4)) - 1}-01`;
  const fim = data(referencia);
  fim.setUTCMonth(fim.getUTCMonth() + 1);
  const falhas = [];
  const ler = (nome, operacao, vazio) => Promise.resolve().then(operacao).catch(() => { falhas.push(nome); return vazio; });
  const [notas, lancamentos, plano, contasFolha] = await Promise.all([
    ler("notas fiscais", () => client.portalInvoice.groupBy({ by: ["competencia"], where: {
      ...whereFaturamentoEmit(), clientId: String(portalClientId), competencia: { gte: data(inicio), lt: fim },
    }, _sum: { total: true }, _count: { _all: true } }), []),
    ler("lançamentos", () => client.accountingEntry.findMany({ where: {
      portalClientId: String(portalClientId), competencia: { gte: inicio, lte: referencia }, status: { in: ["CONFIRMADO", "EXPORTADO"] },
    }, select: { competencia: true, status: true, lines: { select: { conta: true, tipo: true, valor: true } } } }), []),
    ler("plano de contas", () => carregarPlano(portalClientId, client), new Map()),
    ler("contas de folha", () => resolverContasDespesaFolha({ portalClientId, client }), new Set()),
  ]);
  return { historico: consolidarHistorico({ snapshots, notas, lancamentos, plano, contasFolha }).map(m => ({ ...m, mesParcial: m.competencia === referencia })),
    avisos: falhas.length ? [`Não foi possível ler: ${falhas.join(", ")}. O preenchimento automático pode estar incompleto.`] : [] };
}
