import PDFDocument from "pdfkit";

const camposApresentacao = ["incluidos", "gestao", "beneficios", "limites"];
const inteirosPublicos = ["funcionarios", "documentosEntradaMes", "blocoAdicionalQuantidade", "blocoAdicionalCentavos"];
// Projeção explícita: nunca publicar o catálogo, seus pisos ou justificativas internas.
export function propostaParaCliente(p) {
  const s = p.snapshot || {};
  return { versao: p.versao, status: p.status, expiraEm: p.expiraEm, opcaoAceita: p.opcaoAceita,
    destinatario: s.destinatario, razaoSocial: s.razaoSocial, cnpj: s.cnpj,
    perfil: s.perfil ? { atividade: s.perfil.atividade, regime: s.perfil.regime, funcionarios: s.perfil.funcionarios, notasRecebidasMes: s.perfil.notasRecebidasMes, consultoriaMensal: s.perfil.consultoriaMensal } : null,
    apresentacao: s.apresentacao ? Object.fromEntries(camposApresentacao.map(k => [k, typeof s.apresentacao[k] === "string" ? s.apresentacao[k] : ""])) : null,
    limitesPlano: s.limitesPlano ? Object.fromEntries(inteirosPublicos.filter(k => Number.isSafeInteger(s.limitesPlano[k]) && s.limitesPlano[k] >= 0).map(k => [k, s.limitesPlano[k]])) : null,
    servicosConferidos: s.servicosConferidos, limitacaoEscopo: s.limitacaoEscopo || null,
    conferenciaCadastro: s.conferenciaCadastro?.modo === "MANUAL" ? { modo: "MANUAL" } : null,
    opcoes: (s.opcoes || []).map(o => ({ chave: o.chave, titulo: o.titulo, recorrente: o.recorrente, unicoCentavos: o.unicoCentavos, mensalCentavos: o.mensalCentavos, escopo: o.escopo })),
    regularizacaoCentavos: s.regularizacaoCentavos, taxasCentavos: s.taxasCentavos,
    taxasConfirmadas: s.taxasConfirmadas, condicoes: s.condicoes,
    ...(p.status === "RASCUNHO" ? { pendencias: s.pendencias || [] } : {}) };
}
const dinheiro = c => Number.isSafeInteger(c) && c >= 0 ? (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "A definir";
const regimes = { SIMPLES: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido" };
const tinta = { titulo: "#222738", corpo: "#414958", apoio: "#65708A", ouro: "#BA8520", suave: "#F4F5F8", linha: "#E2E5EB", destaque: "#29344C" };
const limpo = v => String(v ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export async function gerarPropostaPdf(p) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 72, left: 46, right: 46, bottom: 58 }, bufferPages: true,
    info: { Title: "Proposta de serviços - ALTAN", Author: "ALTAN Contabilidade" } });
  const partes = [], pronto = new Promise((resolve, reject) => {
    doc.on("data", c => partes.push(c)); doc.on("end", () => resolve(Buffer.concat(partes))); doc.on("error", reject);
  });
  const x = 46, largura = doc.page.width - 92, fim = () => doc.page.height - 58;
  function marca(compacta = false) {
    // Mesma geometria do sol/horizonte usada por LogoAltan no portal.
    doc.save().translate(x, compacta ? 26 : 34).scale(.34);
    doc.path("M22 42 A38 38 0 0 1 98 42 Z").fill("#D9A32B");
    doc.moveTo(0,42).lineTo(120,42).lineWidth(2.5).stroke("#6272A4"); doc.restore();
    doc.font("Helvetica-Bold").fontSize(15).fillColor(tinta.titulo).text("ALTAN", x + 54, compacta ? 23 : 31, { characterSpacing: 3, lineBreak: false });
    doc.font("Helvetica").fontSize(6.5).fillColor(tinta.apoio).text("CONTABILIDADE", x + 55, compacta ? 41 : 49, { characterSpacing: 1.65, lineBreak: false });
  }
  function cabecalho() {
    marca(true);
    doc.font("Helvetica").fontSize(8).fillColor(tinta.apoio).text("PROPOSTA DE SERVIÇOS", 345, 33, { width: largura - 299, align: "right", lineBreak: false });
    doc.moveTo(x,59).lineTo(x + largura,59).lineWidth(.6).stroke(tinta.linha);
    doc.x = x; doc.y = 78;
  }
  doc.on("pageAdded", cabecalho);
  const espaco = h => { if (doc.y + h > fim()) doc.addPage(); };
  function texto(t, { pequeno = false, forte = false } = {}) {
    if (!t) return;
    doc.font(forte ? "Helvetica-Bold" : "Helvetica").fontSize(pequeno ? 9 : 10.5).fillColor(pequeno ? tinta.apoio : tinta.corpo);
    doc.text(limpo(t), x, doc.y, { width: largura, lineGap: pequeno ? 2.4 : 3.5, paragraphGap: 5 });
    doc.y += 6;
  }
  function secao(n, titulo) {
    espaco(75); doc.y += 9;
    const y = doc.y;
    doc.roundedRect(x, y, 25, 24, 6).fill(tinta.suave);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(tinta.ouro).text(String(n).padStart(2,"0"), x, y + 7, { width: 25, align: "center", lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(16).fillColor(tinta.titulo).text(titulo, x + 36, y + 3, { width: largura - 36 });
    doc.x = x; doc.y = y + 37;
  }
  function linhas(t) {
    for (const linha of limpo(t).split(/\n+/).filter(s => s.trim())) texto(linha.replace(/^[-•]\s*/, ""));
  }
  const recorrente = (p.opcoes || []).some(o => o.recorrente), comparacao = (p.opcoes || []).length > 1;
  const a = p.apresentacao || {}, perfil = p.perfil || {}, limites = p.limitesPlano || {};
  const gestao = recorrente && perfil.consultoriaMensal === true;
  marca(); doc.x = x; doc.y = 88;
  doc.font("Helvetica").fontSize(9).fillColor(tinta.ouro).text("PROPOSTA DE SERVIÇOS", x, doc.y, { characterSpacing: 1.7 });
  doc.y += 13;
  doc.font("Helvetica-Bold").fontSize(29).fillColor(tinta.titulo).text(gestao ? "Contabilidade e gestão,\nlado a lado com você." : recorrente ? "Sua contabilidade,\ncom clareza e proximidade." : "O próximo passo da sua\nempresa começa aqui.", x, doc.y, { width: largura, lineGap: 1 });
  doc.y += 13;
  const validade = p.expiraEm ? new Date(p.expiraEm) : new Date(NaN);
  texto(`Versão ${p.versao}  ·  Validade: ${Number.isNaN(validade.getTime()) ? "A confirmar" : validade.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, { pequeno: true });
  if (p.status === "RASCUNHO") texto("RASCUNHO PARA REVISÃO - valores e condições sujeitos à conferência do escritório.", { pequeno: true, forte: true });

  secao(1, "Sobre a empresa");
  texto(p.razaoSocial || p.destinatario || "Interessado", { forte: true });
  if (p.razaoSocial && p.destinatario && p.destinatario !== p.razaoSocial) texto(`Aos cuidados de ${p.destinatario}`, { pequeno: true });
  const dados = [p.cnpj ? `CNPJ ${String(p.cnpj).replace(/\D/g, "")}` : null, perfil.atividade, regimes[perfil.regime] || perfil.regime].filter(Boolean);
  if (dados.length) texto(dados.join("  ·  "));
  const volumes = [perfil.funcionarios != null ? `${perfil.funcionarios} funcionário(s)` : null, perfil.notasRecebidasMes != null ? `${perfil.notasRecebidasMes} documentos de entrada/mês` : null].filter(Boolean);
  if (volumes.length) texto(`Perfil informado: ${volumes.join("  ·  ")}.`, { pequeno: true });

  secao(2, "O que está incluído");
  if (recorrente && a.incluidos) {
    if (comparacao) texto("Na opção de contabilidade mensal:", { forte: true });
    linhas(a.incluidos);
  }
  for (const o of p.opcoes || []) {
    if (comparacao) texto(o.titulo, { forte: true });
    if (o.recorrente && a.incluidos) texto(o.escopo, { pequeno: true });
    else linhas(o.escopo || "Escopo a conferir com o escritório.");
  }
  if (p.servicosConferidos) { texto("Necessidades identificadas", { forte: true }); linhas(p.servicosConferidos); }

  secao(3, "Gestão e acompanhamento");
  if (gestao) linhas(a.gestao || "Consultoria mensal de gestão incluída no escopo recorrente. Confira as entregas nas condições desta proposta.");
  else texto(recorrente ? (perfil.consultoriaMensal === false ? "O acompanhamento segue o escopo apresentado acima. Consultoria gerencial mensal pode ser contratada separadamente." : "O acompanhamento segue as entregas e condições registradas no escopo desta proposta.") : "Acompanhamento da execução e da entrega do serviço descrito nesta proposta. Contabilidade mensal e consultoria gerencial não fazem parte da opção avulsa.");
  if (comparacao) texto("Serviços recorrentes e benefícios mensais se aplicam somente à opção de contabilidade mensal.", { pequeno: true });

  doc.addPage();
  secao(4, "Investimento");
  for (const o of p.opcoes || []) {
    const titulo = limpo(o.titulo || "Serviço");
    doc.font("Helvetica-Bold").fontSize(11);
    const alturaTitulo = doc.heightOfString(titulo, { width: largura - 32 });
    const altura = Math.max(102, alturaTitulo + 86);
    espaco(altura + 12); const y = doc.y;
    doc.roundedRect(x, y, largura, altura, 9).fill(o.recorrente ? tinta.destaque : tinta.suave);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(o.recorrente ? "#FFFFFF" : tinta.titulo).text(titulo, x + 16, y + 14, { width: largura - 32 });
    doc.font("Helvetica-Bold").fontSize(29).text(`${dinheiro(o.recorrente ? o.mensalCentavos : o.unicoCentavos)}${o.recorrente ? " / mês" : ""}`, x + 16, y + alturaTitulo + 22, { width: largura - 32 });
    doc.font("Helvetica").fontSize(9).fillColor(o.recorrente ? "#E1E6F0" : tinta.apoio).text(o.recorrente ? `Honorários mensais${o.unicoCentavos !== 0 ? ` · Serviço inicial: ${dinheiro(o.unicoCentavos)}` : " · Sem honorário inicial nesta opção"}` : "Pagamento pelo serviço avulso. Sem mensalidade nesta opção.", x + 16, y + altura - 24, { width: largura - 32 });
    doc.x = x; doc.y = y + altura + 12;
  }

  secao(5, "Benefícios incluídos");
  linhas(recorrente && a.beneficios ? a.beneficios : "Aplicam-se os benefícios expressamente descritos no escopo e nas condições desta proposta.");

  secao(6, "Limites e adicionais");
  if (recorrente && (limites.funcionarios != null || limites.documentosEntradaMes != null)) texto(`Limites do plano mensal: ${[limites.funcionarios != null ? `até ${limites.funcionarios} funcionários` : null, limites.documentosEntradaMes != null ? `até ${limites.documentosEntradaMes} documentos de entrada por mês` : null].filter(Boolean).join(" e ")}.`, { forte: true });
  if (recorrente && limites.blocoAdicionalQuantidade > 0 && limites.blocoAdicionalCentavos != null) texto(`Volume adicional: ${dinheiro(limites.blocoAdicionalCentavos)} por bloco de ${limites.blocoAdicionalQuantidade} documentos de entrada, conforme revisão do plano.`);
  if (recorrente && a.limites) linhas(a.limites);
  texto(p.regularizacaoCentavos == null ? "Regularização de períodos anteriores: orçamento separado, quando necessária. Não incluída na mensalidade." : `Regularização: ${dinheiro(p.regularizacaoCentavos)}, separada da mensalidade.`);
  texto(p.taxasCentavos == null ? "Taxas públicas: a confirmar com os órgãos competentes. Não incluídas nos honorários." : `Taxas públicas: ${dinheiro(p.taxasCentavos)}${p.taxasConfirmadas ? " (confirmadas)" : " (estimativa a confirmar)"}.`);
  if (p.limitacaoEscopo) linhas(p.limitacaoEscopo);
  if (p.conferenciaCadastro?.modo === "MANUAL") texto("Dados cadastrais conferidos manualmente pelo escritório; consulta automática não utilizada. Esta conferência não comprova regularidade fiscal.", { pequeno: true });

  secao(7, "Condições e aceite");
  linhas(p.condicoes || "Condições a confirmar com o escritório.");
  texto("O aceite registra a opção escolhida. Vigência, reajuste e rescisão serão formalizados no contrato de serviços, preparado para assinatura em etapa própria.", { pequeno: true });
  if (p.pendencias?.length) { texto("Pendências de revisão", { forte: true }); p.pendencias.forEach(t => texto(t)); }
  const paginas = doc.bufferedPageRange();
  for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
    doc.switchToPage(i); const y = doc.page.height - 39;
    // Rodapé fica fora da área do corpo; não pode disparar paginação automática.
    const margemInferior = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.moveTo(x,y - 11).lineTo(x + largura,y - 11).lineWidth(.5).stroke(tinta.linha);
    doc.font("Helvetica").fontSize(8).fillColor(tinta.apoio).text(`ALTAN CONTABILIDADE  ·  Proposta ${p.versao}${p.status === "RASCUNHO" ? "  ·  RASCUNHO" : ""}`, x, y, { width: largura - 60, lineBreak: false });
    doc.text(`${i + 1} / ${paginas.count}`, x + largura - 60, y, { width: 60, align: "right", lineBreak: false });
    doc.page.margins.bottom = margemInferior;
  }
  doc.end(); return pronto;
}
