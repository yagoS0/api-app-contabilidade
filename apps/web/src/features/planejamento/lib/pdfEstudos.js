import { nomeCenario, dataCenario, moedaCenario as brl, percentualCenario as pct, coberturaSalva, totalDoRegime } from "./cenariosSalvos";
import { REGIMES_ESTUDO, IMPOSTOS_MENSAIS } from "./tributosMensais";
import { ROTULO_DO_TRIBUTO } from "./comparativoDeRegimes";
import { numero } from "./operacoesPlanejamento";

// Só desenha snapshots. A importação pesada ocorre apenas ao baixar o documento.
export async function gerarPdfEstudos({ cenarios = [], estudos = null, empresa = "Simulação livre", entradas = null, procedencias = [] } = {}, Construtor = null) {
  const PDFDocument = Construtor || (await import("pdfkit/js/pdfkit.standalone.js")).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true, info: { Title: "Planejamento - estudos e comparação", Author: "Altan" } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(new Blob(chunks, { type: "application/pdf" })));
    let grupoTexto = null;
    const texto = t => {
      if (grupoTexto) { grupoTexto.push(String(t ?? "Não informado")); return; }
      doc.font("Helvetica").fontSize(9).fillColor("#263247").text(String(t ?? "Não informado"), { lineGap: 3 }).moveDown(0.35);
    };
    const bloco = fn => {
      grupoTexto = []; fn(); const linhas = grupoTexto; grupoTexto = null;
      doc.font("Helvetica").fontSize(9);
      const altura = linhas.reduce((s, t) => s + doc.heightOfString(t, { lineGap: 3 }) + 5, 0);
      if (altura < doc.page.height - 88 && doc.y + altura > doc.page.height - 44) doc.addPage();
      linhas.forEach(texto);
    };
    const titulo = t => {
      if (doc.y > 690) doc.addPage();
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(12).fillColor("#463177").text(t).moveDown(0.4);
    };
    const premissas = (e, origens = []) => {
      if (!e) return;
      texto(`Receita anual: ${brl(e.receitaAnual)} | RBT12: ${brl(e.rbt12)} | Folha/Fator R: ${brl(e.folhaAnual)}.`);
      texto(`Remunerações CPP: ${brl(e.folhaRemuneracoesAnual)} | Encargos: ${brl(e.encargosAdicionaisAnuais)} | ISS: ${pct(e.aliquotaIss)} | Margem Real: ${pct(e.margemLucro)} | Créditos PIS/Cofins: ${brl(e.creditosPisCofins)}.`);
      for (const p of origens || []) texto(`Origem de ${p.rotulo || p.chave}: ${p.texto || "Não registrada"}.`);
    };
    const estudo = s => {
      if (!s) return;
      if (s.operacoes?.operacoes?.length) {
        titulo("Operações especiais e benefícios"); texto(s.operacoes.premissa);
        for (const o of s.operacoes.operacoes) {
          texto(`${o.competencia || "Sem competência"} | ${REGIMES_ESTUDO[o.regime] || "Sem regime"} | ${o.descricao || `Operação ${o.indice}`} | ${o.tributo || "Sem tributo"}`);
          texto(`Código: ${o.codigo || "Não informado"} | UF: ${o.uf || "Não informada"} | Base final: ${brl(numero(o.base))} | Redução: ${o.reducao ?? 0}% | Base efetiva: ${brl(o.baseEfetiva)} | Alíquota: ${o.aliquota ?? "Não informada"}% | Débito: ${brl(o.debito)} | Deduções: ${brl(o.deducao)} | FCP: ${brl(o.fcp)} | Total: ${brl(o.total)}.`);
          texto(`Fundamento/origem: ${o.fundamento || "Não informado"}. ${o.pendencia || "Parâmetros conferidos no cenário."}`);
        }
      }
      if (s.mensal) {
        titulo("Projeção mensal de tributos"); texto(s.mensal.premissa);
        for (const r of s.mensal.resultados) {
          titulo(`${REGIMES_ESTUDO[r.regime]} - ${r.total == null ? "Parcial" : brl(r.total)}`);
          texto(`Parcelas conhecidas: ${brl(r.subtotalConhecido)}.`);
          for (const m of r.meses) {
            bloco(() => {
            texto(`${m.competencia}: receita ${brl(m.receita)}; ${m.origem}. ${!m.ativo ? "Anterior à abertura." : `Total: ${brl(m.total)}.`}`);
            if (m.ativo) texto(Object.entries(m.tributos).map(([k, v]) => `${IMPOSTOS_MENSAIS[k]} ${brl(v)}`).join(" | "));
            if (m.ativo && m.memoria.tributos) texto(Object.entries(m.memoria.tributos).map(([k, v]) => `${IMPOSTOS_MENSAIS[k]}: base ${brl(v.base)}, alíquota ${pct(v.aliquota)}${v.credito == null ? "" : `, crédito ${brl(v.credito)}, saldo anterior ${brl(v.saldoAnterior)}`}`).join(" | "));
            if (m.memoria.baseIrpj != null) texto(`Base IRPJ ${brl(m.memoria.baseIrpj)} (15%, adicional de 10% sobre o excesso trimestral); base CSLL ${brl(m.memoria.baseCsll)} (9%).`);
            if (m.memoria.rbt12 != null) texto(`RBT12 ${brl(m.memoria.rbt12)} | Fator R ${pct(m.memoria.fatorR)}.`);
            for (const a of m.memoria.atividades || []) texto(`Atividade ${a.atividade}: receita ${brl(a.receita)}, anexo ${a.anexo || "pendente"}, faixa ${a.faixa ?? "pendente"}, tratamento ${a.tratamento}, DAS ${brl(a.total)}.`);
            if (m.pendencias.length) texto(`Revisar: ${m.pendencias.join(" ")}`);
            });
          }
        }
      }
      if (s.reforma?.operacoes?.length || s.reforma?.creditos?.length) {
        const r = s.reforma;
        titulo(`Reforma por operação - ${r.ano}`); texto(r.premissa);
        for (const o of r.operacoes) texto(`${o.descricao || `Operação ${o.indice}`}: base ${brl(numero(o.base))}, CBS ${o.cbsPct ?? "pendente"}% = ${brl(o.cbs)}, IBS ${o.ibsPct ?? "pendente"}% = ${brl(o.ibs)}, redução ${o.reducao ?? 0}%, ICMS/ISS ${brl(o.legado)}. Fundamento: ${o.fundamento || "Não informado"}. ${o.pendencia || "Conferida no cenário."}`);
        for (const c of r.creditos) texto(`Fornecedor ${c.fornecedor || "Não informado"}, documento ${c.documento || "Não informado"}: crédito CBS ${brl(c.cbs)}; crédito IBS ${brl(c.ibs)}. ${c.pendencia || "Conferido no cenário."}`);
        texto(`CBS líquida ${brl(r.cbs)} | IBS líquido ${brl(r.ibs)} | ICMS/ISS ${brl(r.legado)} | Subtotal ${brl(r.total)}. Excedentes: CBS ${brl(r.excedenteCbs)}, IBS ${brl(r.excedenteIbs)}.`);
        if (r.pendencias.length) texto(`Revisar: ${r.pendencias.join(" ")}`);
      }
    };
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#463177").text("Planejamento tributário").moveDown(0.4);
    texto(`${empresa} | Prévia em desenvolvimento | Gerado em ${new Date().toLocaleDateString("pt-BR")}`);
    texto("Simulação de apoio à decisão. Valores salvos são preservados, sem recálculo. Diferenças de premissas ou cobertura não representam economia realizada. Tabelas do estudo mensal: 2026.");
    if (cenarios.length) {
      titulo("Comparação dos cenários selecionados");
      for (const c of cenarios) {
        texto(`${nomeCenario(c)} | ${dataCenario(c)} | competência ${c.competencia || "Não informada"} | ano ${c.resultado?.anoBase || "Não informado"}`);
        texto((c.resultado?.regimes || []).map(r => `${r.regime}: ${brl(totalDoRegime(r))} (${coberturaSalva(r)})`).join(" | "));
      }
      for (const c of cenarios) {
        doc.addPage(); titulo(`${nomeCenario(c)} - memória salva`);
        texto(`Competência ${c.competencia || "Não informada"} | criado em ${dataCenario(c)} | fontes verificadas em ${c.resultado?.fontesVerificadasEm || "Não registrado"}.`);
        premissas(c.entradas, c.procedencias);
        for (const r of c.resultado?.regimes || []) {
          titulo(`${r.regime}: ${brl(totalDoRegime(r))} - ${coberturaSalva(r)}`);
          for (const [k, v] of Object.entries(r.porTributo || {})) {
            const mem = r.memoriaPorTributo?.[k];
            texto(`${ROTULO_DO_TRIBUTO[k] || k}: ${brl(v)}${mem ? ` | alíquota ${pct(mem.aliquota)} | base ${brl(mem.baseCalculo)}` : ""}`);
          }
          for (const p of [...(r.premissas || []), ...(r.naoConsiderado || []), ...(r.cobertura?.pendencias || []), ...(r.motivo ? [r.motivo] : [])]) texto(p);
        }
        estudo(c.resultado?.estudosAvancados);
        titulo("Conclusão e revisão"); texto(c.resultado?.conclusao?.texto || "Sem conclusão registrada."); texto(`Revisão: ${c.resultado?.conclusao?.revisarEm || "Não definida"}.`);
      }
    } else { premissas(entradas, procedencias); estudo(estudos); }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i); doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Altan | Planejamento em desenvolvimento | ${i + 1}/${range.count}`, 44, doc.page.height - 28, { lineBreak: false });
    }
    doc.end();
  });
}

export async function baixarPdfEstudos(args) {
  const blob = await gerarPdfEstudos(args), url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = args.cenarios?.length ? "comparacao-cenarios-planejamento.pdf" : "estudos-planejamento.pdf";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
