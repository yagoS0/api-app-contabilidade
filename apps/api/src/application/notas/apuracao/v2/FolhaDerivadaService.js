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
// O débito na CONTA DE DESPESA de folha/pró-labore (`role: "salary"` dos templates), nas 12
// competências ANTERIORES à de referência.
//
// ⚠ Já foi "todo débito de todo lançamento `tipo:"FOLHA"`", e isso estava errado por dois motivos
// que se somavam no mesmo número:
//
//  1. **O pagamento também é `tipo:"FOLHA"`.** Desde a Q52 a rota `/entries/folha` grava a baixa no
//     mesmo lote, com duas pernas: D "Salários a Pagar" / C caixa. Somando todo débito, o mês
//     contava o bruto E DEPOIS contava de novo a parte dele que foi paga.
//  2. **A conta importa.** Débito em conta de despesa é folha; débito em conta de passivo é
//     quitação de folha. O antigo comentário deste arquivo ("a ÚNICA linha de débito é a despesa
//     bruta") descrevia o lançamento composto de antes da Q52 e ficou falso quando cada linha
//     virou um lançamento de uma perna só.
//
// Por isso a soma é por CONTA, resolvida uma vez por empresa em `resolverContasDespesaFolha`
// (`payrollTemplate.js`), que é a mesma fonte de dicas que o modal de folha usa para lançar.
// Sem conta resolvida (plano de contas que não casa com nenhuma dica), cai numa segunda regra:
// entry com D **e** C na mesma entry é pagamento e fica de fora — pela rota, provisão tem
// exatamente uma perna e baixa tem exatamente duas.
//
// ── O QUE ISTO NÃO É ──
// NÃO é "a base do Fator R". A base é regra fiscal (LC 123/06) e pode incluir ou excluir parcelas
// que este sistema não separa. Isto é a soma do que foi LANÇADO, oferecida como conferência.
// Por isso o retorno traz o detalhamento por mês: divergindo, o contador vê ONDE divergiu, em vez
// de receber outro número solto para escolher no escuro.
//
// Quem decide continua sendo o contador. Nada aqui sobrescreve `fs12Manual`.

import { prisma } from "../../../../infrastructure/db/prisma.js";
import { resolverContasDespesaFolha } from "../../../accounting/payrollTemplate.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * As 12 competências ANTERIORES a `competencia`, da mais antiga para a mais recente.
 *
 * ⚠ Anteriores, **sem incluir** a própria competência — é a mesma janela do Fator-R e do RBT12
 * (os 12 meses anteriores ao período de apuração) e a mesma que a grade do `FechamentoModal`
 * desenha (`pasAnteriores`). Antes esta função devolvia os 12 meses terminando NA competência, um
 * mês à frente da grade, e o estrago era duplo: o mês do PA entrava no total e na contagem **sem
 * ter célula na tela** (era o "3 dos 12 meses" com só 2 rótulos visíveis), e o mês mais antigo da
 * grade nunca era conferido — ficava sem rótulo, indistinguível de "confere".
 */
export function competenciasDe12Meses(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];
  let ano = Number(m[1]);
  let mes = Number(m[2]) - 1; // começa no mês anterior
  if (mes === 0) { mes = 12; ano -= 1; }
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

  const [entries, contasDespesa] = await Promise.all([
    prisma.accountingEntry.findMany({
      where: { portalClientId, tipo: "FOLHA", competencia: { in: competencias } },
      select: { competencia: true, lines: { select: { tipo: true, valor: true, conta: true } } },
    }),
    resolverContasDespesaFolha({ portalClientId }).catch(() => new Set()),
  ]);

  const porMesMap = new Map(competencias.map((c) => [c, { competencia: c, valor: 0, lancamentos: 0 }]));
  for (const e of entries) {
    const alvo = porMesMap.get(e.competencia);
    if (!alvo) continue;
    const lines = e.lines || [];
    const debitos = lines.filter((l) => String(l.tipo).toUpperCase() === "D");
    const temCredito = lines.some((l) => String(l.tipo).toUpperCase() === "C");

    let contribuicao;
    if (contasDespesa.size) {
      // Caminho normal: só o débito que cai na conta de despesa de folha/pró-labore.
      contribuicao = debitos
        .filter((l) => contasDespesa.has(String(l.conta || "").trim()))
        .reduce((s, l) => s + (Number(l.valor) || 0), 0);
    } else if (temCredito && lines.length === 2) {
      // Sem conta resolvida: descarta o que TEM cara de pagamento (D e C na mesma entry, 2 pernas).
      // O lançamento composto antigo (pré-Q52) tem 1 D e vários C, então não cai aqui.
      contribuicao = 0;
    } else {
      contribuicao = debitos.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    }

    if (contribuicao === 0) continue;
    alvo.valor = round2(alvo.valor + contribuicao);
    // Conta lançamentos que ENTRARAM na soma. Contar os descartados faria "há folha lançada em N
    // meses" incluir mês em que só existe pagamento — o oposto do que a frase promete.
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
    // Quais contas entraram na soma. Sem isto, uma empresa cujo plano de contas não casa com as
    // dicas do template devolveria zero e ninguém saberia se é "não tem folha" ou "não achei a
    // conta" — duas coisas muito diferentes.
    contasConsideradas: [...contasDespesa],
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
