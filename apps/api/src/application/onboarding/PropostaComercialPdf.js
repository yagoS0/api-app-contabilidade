import PDFDocument from "pdfkit";

// Projeção explícita: nunca publicar o catálogo, seus pisos ou justificativas internas.
export function propostaParaCliente(p) {
  const s = p.snapshot || {};
  return { versao: p.versao, status: p.status, expiraEm: p.expiraEm, opcaoAceita: p.opcaoAceita,
    destinatario: s.destinatario, razaoSocial: s.razaoSocial, cnpj: s.cnpj,
    perfil: s.perfil ? { atividade: s.perfil.atividade, regime: s.perfil.regime, funcionarios: s.perfil.funcionarios, notasRecebidasMes: s.perfil.notasRecebidasMes, consultoriaMensal: s.perfil.consultoriaMensal } : null,
    servicosConferidos: s.servicosConferidos, limitacaoEscopo: s.limitacaoEscopo || null,
    conferenciaCadastro: s.conferenciaCadastro?.modo === "MANUAL" ? { modo: "MANUAL" } : null,
    opcoes: (s.opcoes || []).map(o => ({ chave: o.chave, titulo: o.titulo, recorrente: o.recorrente, unicoCentavos: o.unicoCentavos, mensalCentavos: o.mensalCentavos, escopo: o.escopo })),
    regularizacaoCentavos: s.regularizacaoCentavos, taxasCentavos: s.taxasCentavos,
    taxasConfirmadas: s.taxasConfirmadas, condicoes: s.condicoes,
    ...(p.status === "RASCUNHO" ? { pendencias: s.pendencias || [] } : {}) };
}
const dinheiro = c => Number.isSafeInteger(c) && c >= 0 ? (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "A definir";
const regimes = { SIMPLES: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido" };

export async function gerarPropostaPdf(p) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, left: 48, right: 48, bottom: 56 }, bufferPages: true,
    info: { Title: "Proposta de serviços — ALTAN", Author: "ALTAN Contabilidade" } });
  const partes = [], pronto = new Promise((resolve, reject) => {
    doc.on("data", c => partes.push(c)); doc.on("end", () => resolve(Buffer.concat(partes))); doc.on("error", reject);
  });
  const espaco = h => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
  const titulo = t => { espaco(62); doc.moveDown(.7).font("Helvetica-Bold").fontSize(12).fillColor("#233f51").text(t).moveDown(.35); };
  const texto = t => doc.font("Helvetica").fontSize(10).fillColor("#263238").text(String(t || ""), { lineGap: 3, paragraphGap: 5 });
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#233f51").text("ALTAN CONTABILIDADE").moveDown(.8);
  doc.fontSize(24).text("Proposta de serviços").moveDown(.4);
  const validade = new Date(p.expiraEm);
  texto(`Versão ${p.versao} · Validade: ${Number.isNaN(validade.getTime()) ? "A confirmar" : validade.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  if (p.status === "RASCUNHO") texto("RASCUNHO PARA REVISÃO — valores e condições sujeitos à conferência do escritório.");
  titulo("Preparada para você");
  texto(p.razaoSocial || p.destinatario || "Interessado");
  if (p.razaoSocial && p.destinatario && p.destinatario !== p.razaoSocial) texto(`Aos cuidados de ${p.destinatario}`);
  if (p.cnpj) texto(`CNPJ: ${String(p.cnpj).replace(/\D/g, "")}`);
  const perfil = p.perfil;
  if (perfil) {
    if (perfil.atividade) texto(`Atividade: ${perfil.atividade}`);
    const linhas = [regimes[perfil.regime], perfil.funcionarios != null ? `${perfil.funcionarios} funcionário(s)` : null,
      perfil.notasRecebidasMes != null ? `${perfil.notasRecebidasMes} notas recebidas/despesas por mês` : null].filter(Boolean);
    if (linhas.length) texto(linhas.join(" · "));
    if (perfil.consultoriaMensal) texto("Consultoria mensal de gestão incluída no escopo recorrente.");
  }
  if (p.servicosConferidos) { titulo("O que vamos fazer"); texto(p.servicosConferidos); }
  if (p.conferenciaCadastro?.modo === "MANUAL") { titulo("Conferência cadastral"); texto("Dados cadastrais conferidos manualmente pelo escritório; consulta automática não utilizada. Esta conferência não comprova regularidade fiscal."); }
  if (p.limitacaoEscopo) { titulo("Limites do serviço contratado"); texto(p.limitacaoEscopo); }
  for (const o of p.opcoes || []) {
    titulo(o.titulo);
    if (o.recorrente) texto(`Honorários mensais: ${dinheiro(o.mensalCentavos)} / mês`);
    if (!o.recorrente || o.unicoCentavos !== 0) texto(`Serviço inicial: ${dinheiro(o.unicoCentavos)}`);
    if (o.escopo) texto(o.escopo);
  }
  titulo("Serviços adicionais e taxas");
  texto(p.regularizacaoCentavos == null ? "Regularização de períodos anteriores: orçamento separado, quando necessária. Não incluída na mensalidade." : `Regularização: ${dinheiro(p.regularizacaoCentavos)} em serviço separado da mensalidade.`);
  texto(p.taxasCentavos == null ? "Taxas públicas: a confirmar conforme os órgãos competentes; não incluídas nos honorários." : `Taxas públicas: ${dinheiro(p.taxasCentavos)}${p.taxasConfirmadas ? " (confirmadas)" : " (estimativa a confirmar)"}.`);
  titulo("Condições e próximos passos"); texto(p.condicoes);
  texto("Após sua escolha, prepararemos o contrato para assinatura. O aceite desta proposta registra a opção escolhida; a assinatura do contrato será realizada em etapa própria.");
  if (p.pendencias?.length) { titulo("Pendências de revisão"); p.pendencias.forEach(texto); }
  const paginas = doc.bufferedPageRange();
  for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
    doc.switchToPage(i); doc.font("Helvetica").fontSize(8).fillColor("#62727b").text(`ALTAN · Proposta ${p.versao} · ${i + 1} / ${paginas.count}`, 48, doc.page.height - 36, { lineBreak: false });
  }
  doc.end(); return pronto;
}
