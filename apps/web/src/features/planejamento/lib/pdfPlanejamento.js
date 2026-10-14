import { ANEXOS } from "./tabelasFiscais";
import { ROTULO_DO_TRIBUTO, celulaDoTributo, fraseDaAusencia } from "./comparativoDeRegimes";
import { ibsCbsDoSimples } from "./ibsCbsNoSimples";
import { lerPercentual } from "./campoNumerico";
import { ATIVIDADES_PRESUMIDO } from "./lucroPresumido";

const money = v => v == null || !Number.isFinite(v) ? "Não informado" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = v => v == null || !Number.isFinite(v) ? "Não informado" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
const clean = s => String(s ?? "Não informado").replace(/[–—−]/g, "-").replace(/[\u26a0\ufe0f]/g, "");
const available = c => !c.indisponivel && c.elegivel !== false && Number.isFinite(c.total);

// Snapshot of the displayed scenario. No company reads or recalculation of taxes.
export function modeloRelatorioPlanejamento({ empresa, referencia, entradas = {}, resultado = {}, comparativo, procedencias = [], proLabore, premissaInicio, formulario = {}, emitidoEm = new Date().toLocaleDateString("pt-BR") }) {
  const simples = resultado.regimes?.find(r => /Simples/.test(r.regime) && r.faixa != null);
  const ibs = formulario.ajustes?.incluirIbsCbs && simples ? ibsCbsDoSimples({ cenario: formulario.cenarioIbsCbs, cbsEstimadaPct: lerPercentual(formulario.cbsEstimada).valor, anexo: resultado.anexoResolvido, faixa: simples.faixa, aliquotaEfetivaPct: simples.aliquotaEfetiva * 100, dasAnual: simples.das, receitaAnual: entradas.receitaAnual }) : null;
  return { empresa: empresa?.razao || empresa?.razaoSocial || "Simulação livre", cnpj: empresa?.cnpj, referencia, entradas, resultado, comparativo, procedencias, proLabore, premissaInicio, formulario, ibs, emitidoEm };
}

export async function gerarRelatorioPlanejamento(args, Construtor = null) {
  const m = modeloRelatorioPlanejamento(args);
  const PDFDocument = Construtor || (await import("pdfkit/js/pdfkit.standalone.js")).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, info: { Title: `Planejamento tributário - ${m.empresa}`, Author: "ALTAN" } });
    const chunks = [];
    doc.on("data", c => chunks.push(c)); doc.on("error", reject);
    doc.on("end", () => resolve(new Blob(chunks, { type: "application/pdf" })));
    const W = doc.page.width - 84, bottom = 776;
    const colors = { ink: "#25334A", purple: "#59438B", muted: "#5D6B7E", line: "#DBE1EA", pale: "#F2F4F8" };
    const page = () => { doc.addPage(); doc.y = 48; };
    const room = h => { if (doc.y + h > bottom) page(); };
    const text = (s, size = 9, color = colors.ink) => {
      doc.font("Helvetica").fontSize(size);
      room(doc.heightOfString(clean(s), { width: W, lineGap: 3 }) + 8);
      doc.fillColor(color).text(clean(s), 42, doc.y, { width: W, lineGap: 3 }); doc.y += 8;
    };
    const title = (s, newPage = false, reserve = 64) => {
      if (newPage) page(); else room(reserve);
      doc.font("Helvetica-Bold").fontSize(15).fillColor(colors.purple).text(clean(s), 42, doc.y, { width: W }); doc.y += 12;
    };
    const table = (headers, rows, widths, highlight = () => false) => {
      const widthsPx = widths.map(w => w * W);
      const height = values => Math.max(...values.map((v, i) => doc.heightOfString(clean(v), { width: widthsPx[i] - 14, lineGap: 2 }))) + 16;
      doc.font("Helvetica").fontSize(8);
      const totalHeight = height(headers) + rows.reduce((sum, values) => sum + height(values), 0);
      if (totalHeight < bottom - 80) room(totalHeight + 14);
      const row = (values, header, marked) => {
        doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(8);
        const h = height(values), y = doc.y; let x = 42;
        if (header || marked) doc.rect(42, y, W, h).fill(header ? colors.purple : colors.pale);
        values.forEach((v, i) => { doc.fillColor(header ? "#FFFFFF" : colors.ink).text(clean(v), x + 7, y + 8, { width: widthsPx[i] - 14, lineGap: 2 }); x += widthsPx[i]; });
        doc.moveTo(42, y + h).lineTo(42 + W, y + h).lineWidth(0.5).strokeColor(colors.line).stroke(); doc.y = y + h;
      };
      doc.font("Helvetica").fontSize(8); room(height(headers) + (rows.length ? height(rows[0]) : 0)); row(headers, true);
      rows.forEach((values, i) => { doc.font("Helvetica").fontSize(8); if (doc.y + height(values) > bottom) { page(); row(headers, true); } row(values, false, highlight(i)); });
      doc.y += 14;
    };
    doc.rect(0, 0, doc.page.width, 12).fill(colors.purple);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(colors.purple).text("ALTAN  /  CONSULTORIA TRIBUTÁRIA", 42, 38);
    doc.fontSize(27).fillColor(colors.ink).text("Planejamento tributário", 42, 72, { width: W }); doc.y += 12;
    text(m.empresa, 13); text(`${m.cnpj ? `CNPJ ${m.cnpj} | ` : ""}Ano-base ${m.resultado.anoBase || "Não informado"} | Emitido em ${m.emitidoEm}`);
    text(`Cenário: ${m.formulario.ajustes?.nomeCenario || "Cenário atual"}. Simulação de apoio à decisão; não representa guia apurada ou imposto pago.`, 9, colors.muted);
    title("01 / Premissas");
    const e = m.entradas;
    table(["Premissa", "Valor utilizado"], [
      ["Receita anual / média mensal", `${money(e.receitaAnual)} / ${money(e.receitaAnual / 12)}`],
      ["RBT12 utilizado", money(m.resultado.inicioAtividade?.rbt12 ?? e.rbt12)],
      ["Janela fiscal", m.referencia?.janelaRotulo || "Informada no cenário"],
      ["Folha de 12 meses (FS12)", money(e.folhaAnual)],
      ["Base anual da CPP / encargos adicionais", `${money(e.folhaRemuneracoesAnual)} / ${money(e.encargosAdicionaisAnuais)}`],
      ["ISS / margem do Lucro Real", `${pct(e.aliquotaIss)} / ${pct(e.margemLucro)}`],
      ["Créditos anuais PIS/COFINS", money(e.creditosPisCofins)],
      ["Anexo / fator R", `${m.resultado.anexoResolvido || e.anexoSimples || "Pendente"} / ${e.sujeitoAoFatorR ? "automático pelo fator R" : "anexo informado"}`],
      ["Atividade do Presumido / regime atual", `${e.atividadePresumido || "Não informada"} / ${e.regimeAtual || "Não informado"}`],
      ["IBS/CBS no estudo", m.formulario.ajustes?.incluirIbsCbs ? "Incluído, conforme cenário abaixo" : "Não incluído"],
    ], [.48, .52]);
    if (m.premissaInicio) text(m.premissaInicio);
    if (e.receitasMensais) text(`Receitas mensais de início de atividade: ${e.receitasMensais.map(money).join("; ")}.`);
    if (e.receitasPorAtividade) table(["Atividade", "Receita anual", "Anexo", "ISS"], e.receitasPorAtividade.map(a => [ATIVIDADES_PRESUMIDO[a.atividade]?.rotulo || "Não informada", money(a.receita === "" ? null : Number(a.receita)), a.anexo || "Não informado", a.issPct == null || a.issPct === "" ? "Não informado" : `${a.issPct}%`]), [.4, .25, .15, .2]);
    if (e.lucroRealDetalhado?.ativo) table(["Premissa do Lucro Real", "Valor anual"], Object.entries({ custos: "Custos", despesas: "Despesas antes de IRPJ/CSLL", outrasReceitas: "Outras receitas contábeis", adicoesIrpj: "Adições ao IRPJ", exclusoesIrpj: "Exclusões do IRPJ", adicoesCsll: "Adições à CSLL", exclusoesCsll: "Exclusões da CSLL" }).map(([k, label]) => [label, money(e.lucroRealDetalhado[k] == null || e.lucroRealDetalhado[k] === "" ? null : Number(e.lucroRealDetalhado[k]))]), [.6, .4]);
    if (m.procedencias.length) { title("Origem dos dados", false, 340); table(["Dado", "Procedência"], m.procedencias.map(p => [p.rotulo || p.chave, p.texto || "Não registrada"]), [.28, .72]); }
    if (m.formulario.ajustes?.incluirIbsCbs) {
      title("IBS e CBS - premissa complementar");
      if (!m.ibs) text("Estudo indisponível: faltam anexo e faixa calculados do Simples.");
      else if (m.ibs.zeroPorLei) { text(m.ibs.titulo); text(m.ibs.explicacao); text(m.ibs.fundamento); }
      else {
        text(`Cenário 2027-2028. CBS regular estimada pelo usuário: ${m.formulario.cbsEstimada || "Não informada"}%. Não altera os totais anuais do comparativo base.`);
        table(["Indicador", "Por dentro", "Por fora"], [
          ["DAS anual de referência", money(m.ibs.imposto?.porDentro?.dasAnual), "Recomposição não calculada"],
          ["CBS / IBS no DAS", `${money(m.ibs.imposto?.porDentro?.cbsDentroDoDas)} / ${money(m.ibs.imposto?.porDentro?.ibsDentroDoDas)}`, "Apuração separada"],
          ["Débito sobre receita antes de créditos", "Incluído no DAS", money(m.ibs.imposto?.porFora?.debitoSobreAReceita)],
          ["Crédito transferido ao comprador", pct(m.ibs.porDentro?.creditoPct == null ? null : m.ibs.porDentro.creditoPct / 100), pct(m.ibs.porFora?.totalPct == null ? null : m.ibs.porFora.totalPct / 100)],
        ], [.4, .3, .3]);
        text(m.ibs.imposto?.porDentro?.explicacao || "DAS futuro não calculado.");
        text("O crédito do comprador não reduz o imposto desta empresa. O líquido por fora não foi calculado: faltam créditos das compras e recomposição do DAS.");
      }
    }
    title("02 / Comparativos e quadros", true);
    text(m.resultado.motivoComparacao || m.resultado.aviso);
    const cols = m.comparativo?.colunas || [];
    table(["Regime / cenário", "Total anual", "Média mensal", "Carga efetiva"], cols.map(c => [c.titulo, available(c) ? money(c.total) : "Indisponível", available(c) ? money(c.total / 12) : "Indisponível", available(c) ? pct(c.cargaEfetiva) : "Não estimada"]), [.34, .23, .23, .2]);
    const max = Math.max(1, ...cols.filter(available).map(c => c.total || 0));
    for (const c of cols.filter(available)) {
      room(48); text(`${c.titulo}: ${money(c.total)}${c.atual === false ? " - anexo alternativo, não é o atual" : ""}`);
      const y = doc.y; doc.rect(42, y, W, 7).fill(colors.pale); doc.rect(42, y, W * ((c.total || 0) / max), 7).fill(colors.purple); doc.y = y + 20;
    }
    if (m.resultado.economiaVsAtual != null) text(`Diferença estimada em relação ao regime atual: ${money(m.resultado.economiaVsAtual)} no ano.`);
    for (const c of cols) {
      text(`${c.titulo}${c.atual === false ? " (alternativo)" : ""}: ${c.motivo || c.cobertura?.status || "confira a cobertura"}. ${[...(c.naoConsiderado || []), ...(c.cobertura?.pendencias || [])].join(" ")}`);
    }
    title("03 / Cálculo comparativo de impostos", true);
    text("Valores anuais. Parcelas dentro do DAS não são cobranças adicionais. Alíquota sobre a base de cada tributo é diferente da carga sobre a receita.");
    const widths = [.22, ...cols.map(() => .78 / cols.length)];
    table(["Tributo", ...cols.map(c => c.titulo)], (m.comparativo?.tributos || []).map(t => [ROTULO_DO_TRIBUTO[t] || t, ...cols.map(c => { if (!available(c)) return "Indisponível"; const v = celulaDoTributo(c, t); return v.valor == null ? fraseDaAusencia(v.ausencia) : money(v.valor); })]), widths);
    for (const c of cols.filter(available)) {
      const mem = Object.entries(c.memoriaPorTributo || {});
      title(c.titulo, false, Math.min(600, 90 + mem.length * 34));
      if (mem.length) table(["Tributo", "Base de cálculo", "Alíquota", "Valor anual"], mem.map(([k, v]) => [ROTULO_DO_TRIBUTO[k] || k, money(v.baseCalculo), pct(v.aliquota), money(c.porTributo?.[k])]), [.3, .27, .18, .25]);
      for (const p of c.premissas || []) text(p, 8, colors.muted);
    }
    title("Tabelas dos anexos do Simples Nacional", true);
    text("Alíquota efetiva = (RBT12 × alíquota nominal - parcela a deduzir) ÷ RBT12. A faixa destacada usa o RBT12 do cenário; a atividade determina o anexo aplicável.");
    const rbt = m.resultado.inicioAtividade?.rbt12 ?? e.rbt12;
    Object.values(ANEXOS).forEach((a, i) => {
      if (i && i % 2 === 0) page();
      title(a.nome);
      table(["Faixa", "RBT12 de", "RBT12 até", "Nominal", "Dedução"], a.faixas.map(f => [`${f.faixa}ª`, money(f.de), money(f.ate), pct(f.aliquota), money(f.pd)]), [.09, .25, .25, .16, .25], j => rbt > 0 && rbt >= a.faixas[j].de && rbt <= a.faixas[j].ate);
    });
    text("CPP do Anexo IV e tributos fora do DAS exigem cálculo próprio. Observar elegibilidade e sublimites. Fonte: LC 123/2006, anexos I a V; tabelas do sistema para o ano-base indicado.");
    title("04 / Fator R", true);
    const f = m.resultado.fatorR;
    if (!f) text(m.formulario.anexoManual && m.formulario.sujeitoFatorR ? "Anexo escolhido manualmente neste cenário. Selecione Automático pelo Fator R para simular o enquadramento pela folha." : m.formulario.sujeitoFatorR ? "Fator R indisponível. Confira a folha e o RBT12 das premissas." : "A atividade informada não está sujeita ao fator R.");
    else {
      const minimo = Math.ceil(Math.round(rbt * 100) * 28 / 100) / 100;
      table(["Indicador", "Resultado"], [["Fator R atual", pct(f.fatorR)], ["Limite", "28,00%"], ["FS12 informada", money(e.folhaAnual)], ["FS12 mínima para 28%", money(minimo)], ["Quanto falta de folha em 12 meses", money(e.folhaAnual == null ? null : Math.max(0, minimo - e.folhaAnual))]], [.6, .4]);
      text("A janela fiscal considera os 12 meses anteriores à competência. O acréscimo de folha tem custos próprios e não representa automaticamente economia líquida.");
    }
    if (m.proLabore?.motivo) text(m.proLabore.motivo);
    if (m.proLabore && !m.proLabore.recusa) {
      const p = m.proLabore;
      table(["Pró-labore e impacto", "Valor"], [["Pró-labore mensal atual / necessário", `${money(p.proLaboreHoje)} / ${money(p.proLaboreDepois)}`], ["Aumento mensal", money(p.aumentoMensal)], ["INSS + IRRF incremental no ano", money(p.custoAnualIncremental)], ["Economia anual no DAS", money(p.economiaNoDas)], ["Saldo anual estimado", money(p.saldoAnual)]], [.6, .4]);
      for (const s of p.porSocio || []) text(`${s.nome || "Sócio"}: pró-labore ${money(s.hoje?.proLabore)} para ${money(s.depois?.proLabore)}; INSS ${money(s.hoje?.inss)} para ${money(s.depois?.inss)}; IRRF ${money(s.hoje?.irrf)} para ${money(s.depois?.irrf)}.`);
      for (const premissa of p.premissas || []) text(premissa, 8, colors.muted);
    }
    text(`Tabelas verificadas em ${m.resultado.fontesVerificadasEm || "data não registrada"}. ${m.resultado.aviso || ""}`, 8, colors.muted);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i); doc.page.margins.bottom = 0;
      doc.moveTo(42, 797).lineTo(42 + W, 797).strokeColor(colors.line).stroke();
      doc.font("Helvetica").fontSize(8).fillColor(colors.muted).text(`ALTAN | Planejamento tributário | ${m.emitidoEm}`, 42, 807, { lineBreak: false });
      doc.text(`${i + 1} / ${range.count}`, 505, 807, { lineBreak: false });
    }
    doc.end();
  });
}

export async function baixarRelatorioPlanejamento(args) {
  const blob = await gerarRelatorioPlanejamento(args);
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "relatorio-planejamento-tributario.pdf";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
