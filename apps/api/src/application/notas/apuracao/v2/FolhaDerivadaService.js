// Deriva a folha dos ÚLTIMOS 12 MESES a partir dos lançamentos contábeis, para CONFERIR o número
// que o contador digita no fechamento.
//
// POR QUE ISTO EXISTE
// O Fator R decide se a empresa é tributada pelo Anexo III ou pelo V — diferença grande. Ele sai de
// `CompanyMonthlyCircular.fs12Manual`, que é **digitado à mão**, com o mês anterior sugerido
// (`FatorRService.resolverFolha12m`). Um dígito a menos ali muda o anexo e ninguém percebe: não há
// erro, não há alerta, só um imposto diferente.
//
// Os lançamentos de folha já existem no sistema. Somá-los dá um segundo número, independente, para
// comparar.
//
// ── O QUE É SOMADO, EXATAMENTE ──
// O total de DÉBITO dos lançamentos `tipo: "FOLHA"` (subtipo FOLHA ou PROLABORE) das 12 competências
// que terminam na competência de referência.
//
// Nos dois templates (`payrollTemplate.js`) a ÚNICA linha de débito é a despesa bruta — salário ou
// pró-labore —, e os créditos são as retenções e o líquido. Então o total de débito do lançamento é
// a remuneração BRUTA, que é o que interessa. Somar os créditos duplicaria.
//
// ── O QUE ISTO NÃO É ──
// NÃO é "a base do Fator R". A base é regra fiscal (LC 123/06) e pode incluir ou excluir parcelas
// que este sistema não separa. Isto é a soma do que foi LANÇADO, oferecida como conferência.
// Por isso o retorno traz o detalhamento por mês: divergindo, o contador vê ONDE divergiu, em vez
// de receber outro número solto para escolher no escuro.
//
// Quem decide continua sendo o contador. Nada aqui sobrescreve `fs12Manual`.

import { prisma } from "../../../../infrastructure/db/prisma.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Lista as 12 competências que terminam em `competencia`, da mais antiga para a mais recente. */
export function competenciasDe12Meses(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];
  let ano = Number(m[1]);
  let mes = Number(m[2]);
  const saida = [];
  for (let i = 0; i < 12; i += 1) {
    saida.unshift(`${ano}-${String(mes).padStart(2, "0")}`);
    mes -= 1;
    if (mes === 0) { mes = 12; ano -= 1; }
  }
  return saida;
}

/**
 * @returns {{
 *   total: number, competencias: string[], mesesComLancamento: number,
 *   porMes: Array<{ competencia: string, valor: number, lancamentos: number }>,
 *   disponivel: boolean,
 * }}
 */
export async function derivarFolha12m({ portalClientId, competencia }) {
  const competencias = competenciasDe12Meses(competencia);
  const vazio = { total: 0, competencias, mesesComLancamento: 0, porMes: [], disponivel: false };
  if (!portalClientId || !competencias.length) return vazio;

  const entries = await prisma.accountingEntry.findMany({
    where: { portalClientId, tipo: "FOLHA", competencia: { in: competencias } },
    select: { competencia: true, lines: { select: { tipo: true, valor: true } } },
  });

  const porMesMap = new Map(competencias.map((c) => [c, { competencia: c, valor: 0, lancamentos: 0 }]));
  for (const e of entries) {
    const alvo = porMesMap.get(e.competencia);
    if (!alvo) continue;
    // Total de DÉBITO do lançamento = remuneração bruta (a única linha D nos templates).
    const totalD = (e.lines || [])
      .filter((l) => String(l.tipo).toUpperCase() === "D")
      .reduce((s, l) => s + (Number(l.valor) || 0), 0);
    alvo.valor = round2(alvo.valor + totalD);
    alvo.lancamentos += 1;
  }

  const porMes = [...porMesMap.values()];
  const total = round2(porMes.reduce((s, m) => s + m.valor, 0));
  const mesesComLancamento = porMes.filter((m) => m.lancamentos > 0).length;

  return {
    total,
    competencias,
    mesesComLancamento,
    porMes,
    // Mesmo formato do `folhaMensal12` que o contador preenche ({ pa, valor }) — assim a tela
    // compara linha a linha sem precisar converter, e um "usar os lançamentos" futuro é só copiar.
    // `pa` é AAAAMM numérico, como o PGDAS-D espera.
    serie: porMes.map((m) => ({ pa: Number(m.competencia.replace("-", "")), valor: m.valor })),
    // Sem nenhum lançamento de folha no período não há conferência a oferecer — e mostrar "R$ 0,00"
    // ao lado do valor digitado sugeriria que a folha é zero, quando o que há é ausência de dado.
    disponivel: mesesComLancamento > 0,
  };
}

/**
 * Compara a folha derivada com a que o contador digitou.
 * Não escolhe: devolve os dois lados e a diferença.
 */
export function compararFolha12m({ derivada, digitada }) {
  // `Number(null)` e `Number("")` são 0, e 0 é finito — sem esta guarda, uma folha AINDA NÃO
  // DIGITADA viraria "divergência de R$ X" em vez de "ainda não preenchida". São coisas
  // diferentes: uma pede conferência, a outra pede preenchimento.
  const ausente = (v) => v === null || v === undefined || v === "";
  if (ausente(derivada) || ausente(digitada)) return { comparavel: false };
  const d = Number(derivada);
  const m = Number(digitada);
  if (!Number.isFinite(d) || !Number.isFinite(m)) return { comparavel: false };
  const diferenca = round2(m - d);
  return {
    comparavel: true,
    diferenca,
    // 1 centavo de tolerância: arredondamento por competência não é divergência.
    confere: Math.abs(diferenca) <= 0.01,
    percentual: d > 0 ? round2((diferenca / d) * 100) : null,
  };
}
