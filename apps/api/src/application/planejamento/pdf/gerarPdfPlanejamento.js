// O PDF DO PLANEJAMENTO TRIBUTÁRIO — gerado no servidor, A PARTIR DA FOTO.
//
// ⚠⚠ ELE LÊ A FOTO, NUNCA A TELA. É o que impede o papel e o ecrã de divergirem: se o gerador
// lesse o estado do formulário, dois PDFs "da mesma simulação" sairiam diferentes conforme o que
// estivesse aberto na hora. Aqui a entrada é um registro imutável de `simulacoes_planejamento`.
//
// ⚠ REUSA O `pdfkit` que já existe (única lib de PDF do repositório, hoje no DANFSe e em
// `routes/adn.js`). Nenhuma dependência nova.
//
// ⚠⚠ ESTE DOCUMENTO CIRCULA SOZINHO, e é por isso que ele carrega tanto texto de ressalva: quem o
// abre daqui a seis meses não tem a tela ao lado. Vão IMPRESSAS, obrigatoriamente:
//   · a data da geração e a competência de referência;
//   · a PROCEDÊNCIA de cada número (da empresa · digitado por cima · informado · ausente);
//   · a vigência das tabelas usadas;
//   · o aviso de que é simulação de apoio, não parecer tributário;
//   · e, quando houver, que a alíquota da CBS foi INFORMADA e não está em lei.
//
// ⚠ NENHUM NÚMERO É CALCULADO AQUI. O gerador só desenha o que a foto guardou — recalcular no PDF
// seria uma segunda implementação do motor, e ela divergiria na primeira correção.

import PDFDocument from "pdfkit";

const MARGEM = 48;
const CINZA = "#555555";
const PRETO = "#111111";

/** `1234.56` → `R$ 1.234,56`. ⚠ Ausência vira travessão, NUNCA `R$ 0,00` — zero é uma afirmação. */
function brl(v) {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return "—";
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(v, casas = 2) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: casas })}%`;
}

function dataHora(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * ⚠⚠ A PROCEDÊNCIA EM UMA FRASE. Este é o bloco que distingue DOIS PDFs da mesma empresa com
 * números diferentes — sem ele, a diferença parece erro de cálculo, e quem recebeu o primeiro não
 * tem como saber qual dos dois vale.
 */
function frasesDaProcedencia(procedencias) {
  if (!procedencias || typeof procedencias !== "object") return [];
  const linhas = [];
  for (const [campo, p] of Object.entries(procedencias)) {
    if (!p || typeof p !== "object") continue;
    const rotulo = p.rotulo || campo;
    if (p.origem === "ausente") {
      // ⚠ A ausência sai NOMEADA, com o motivo. Omiti-la faria o campo parecer não existir.
      linhas.push([rotulo, "não apurado", p.motivo || "sem motivo registrado"]);
    } else if (p.origem === "digitado") {
      // ⚠ Digitado POR CIMA mostra os DOIS: é a única forma de o leitor saber que houve troca.
      linhas.push([rotulo, "digitado nesta simulação", p.valorDaEmpresa != null ? `a empresa tinha ${brl(p.valorDaEmpresa)}` : ""]);
    } else if (p.origem === "da_empresa") {
      linhas.push([rotulo, "dado da empresa", p.detalhe || ""]);
    } else {
      linhas.push([rotulo, p.origem || "—", p.detalhe || ""]);
    }
  }
  return linhas;
}

export function gerarPdfPlanejamento({ foto, empresa }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: MARGEM, info: { Title: "Planejamento tributário" } });
      const pedacos = [];
      doc.on("data", (c) => pedacos.push(c));
      doc.on("end", () => resolve(Buffer.concat(pedacos)));
      doc.on("error", reject);

      const largura = doc.page.width - MARGEM * 2;
      const linha = () => {
        doc.moveDown(0.4);
        doc.strokeColor("#DDDDDD").lineWidth(0.5)
          .moveTo(MARGEM, doc.y).lineTo(MARGEM + largura, doc.y).stroke();
        doc.moveDown(0.6);
      };
      const titulo = (t) => {
        doc.moveDown(0.6);
        doc.fillColor(PRETO).font("Helvetica-Bold").fontSize(11).text(t);
        doc.moveDown(0.2);
      };
      const par = (t, { cor = CINZA, tamanho = 8.5 } = {}) => {
        doc.fillColor(cor).font("Helvetica").fontSize(tamanho).text(t, { width: largura, align: "justify" });
      };

      // ─── CABEÇALHO ────────────────────────────────────────────────────────────────────────
      doc.fillColor(PRETO).font("Helvetica-Bold").fontSize(16).text("Planejamento tributário");
      doc.moveDown(0.2);
      doc.fillColor(CINZA).font("Helvetica").fontSize(9)
        .text(`${empresa?.razao || "—"}${empresa?.cnpj ? ` · CNPJ ${empresa.cnpj}` : ""}`);
      doc.text(`Competência de referência: ${foto.competencia} · Gerado em ${dataHora(foto.geradoEm)}`);
      linha();

      // ─── O RESULTADO, PRIMEIRO ────────────────────────────────────────────────────────────
      // ⚠ A resposta vem antes das premissas — é a hierarquia que a tela também passou a ter.
      const r = foto.resultado || {};
      const vencedor = r.vencedor || null;
      titulo("Resultado");
      if (vencedor) {
        doc.fillColor(PRETO).font("Helvetica-Bold").fontSize(13)
          .text(`${vencedor.regime} — ${brl(vencedor.total)} por ano`);
        if (r.economiaAnual > 0) {
          doc.fillColor(CINZA).font("Helvetica").fontSize(9)
            .text(`Economia de ${brl(r.economiaAnual)} por ano em relação à segunda opção.`);
        }
      } else {
        // ⚠⚠ A RECUSA TEM O MESMO PESO DO RESULTADO. Número ausente diagramado em cinza pequeno
        // vira ausência de dúvida — é a regra que o `CardRegime` já segue na tela.
        doc.fillColor(PRETO).font("Helvetica-Bold").fontSize(12)
          .text("Não foi possível eleger um regime com os dados informados.");
      }

      // ─── OS REGIMES ───────────────────────────────────────────────────────────────────────
      const regimes = Array.isArray(r.regimes) ? r.regimes : [];
      if (regimes.length) {
        titulo("Comparativo por regime");
        for (const reg of regimes) {
          doc.fillColor(PRETO).font("Helvetica-Bold").fontSize(9.5).text(reg.regime || "—", { continued: true });
          doc.font("Helvetica").fillColor(PRETO)
            .text(`   ${reg.indisponivel ? "indisponível" : brl(reg.total)}`);
          // ⚠ O MOTIVO DA INDISPONIBILIDADE É OBRIGATÓRIO. "Indisponível" sozinho não diz se falta
          // dado ou se o regime não se aplica — e são consertos diferentes.
          if (reg.indisponivel && reg.motivo) par(`   ${reg.motivo}`, { tamanho: 8 });
          // ⚠ O que ficou FORA da conta sai nomeado: um total que esconde o que não entrou é o
          // "total que não fecha com a lista", e ele é pior que total nenhum.
          for (const n of reg.naoConsiderado || []) par(`   · fora desta conta: ${n}`, { tamanho: 8 });
        }
      }

      // ─── IBS/CBS ──────────────────────────────────────────────────────────────────────────
      // ⚠⚠ SÓ SAI SE A FOTO O GUARDOU. Um bloco fixo aqui afirmaria IBS/CBS para uma simulação
      // feita antes de o módulo existir.
      const ibs = r.ibsCbs || null;
      if (ibs) {
        titulo("IBS e CBS no Simples Nacional");
        if (ibs.zeroPorLei) {
          par(`${ibs.titulo || "Em 2026 não há IBS nem CBS para o optante."} ${ibs.explicacao || ""} `
            + `Fundamento: ${ibs.fundamento || "—"}.`, { cor: PRETO });
        } else {
          if (ibs.porDentro) {
            par(`Por dentro (padrão): ${pct(ibs.porDentro.creditoPct, 3)} do valor da operação vira `
              + `crédito para o adquirente — ${pct(ibs.porDentro.aliquotaEfetivaPct)} × `
              + `${pct(ibs.porDentro.somaPercentual)} (Anexo ${ibs.porDentro.anexo}, `
              + `${ibs.porDentro.faixa}ª faixa).`, { cor: PRETO });
            if (ibs.porDentro.semIbsNoDas) {
              par("Nesta faixa o IBS não está dentro do DAS (sublimite, LC 123/2006, art. 13-A): "
                + "não há parcela de IBS a transferir, e o crédito sai só da CBS.");
            }
          }
          if (ibs.porFora) {
            par(`Por fora (opção): ${pct(ibs.porFora.totalPct, 3)} — ${pct(ibs.porFora.cbsPct)} de CBS `
              + `mais ${pct(ibs.porFora.ibsPct)} de IBS.`, { cor: PRETO });
            // ⚠⚠ ESTA FRASE É OBRIGATÓRIA NO PAPEL. Um percentual impresso sem ela é lido como se
            // fosse lei — e a CBS ainda não foi fixada por ninguém.
            par(ibs.porFora.avisoDaCbs || "A alíquota da CBS foi informada nesta simulação e não está em lei.");
          }
          if (ibs.janela?.dependeDeRegulamentacao) {
            par("A lei remete a forma de exercer a opção à regulamentação do CGSN. Este documento "
              + "informa a janela legal — ele não confirma que o procedimento já está disponível.");
          }
        }
      }

      // ─── PROCEDÊNCIA ──────────────────────────────────────────────────────────────────────
      const proc = frasesDaProcedencia(foto.procedencias);
      if (proc.length) {
        titulo("Procedência dos dados usados nesta simulação");
        for (const [rotulo, origem, detalhe] of proc) {
          doc.fillColor(PRETO).font("Helvetica-Bold").fontSize(8.5).text(rotulo, { continued: true });
          doc.font("Helvetica").fillColor(CINZA).text(` — ${origem}${detalhe ? ` (${detalhe})` : ""}`);
        }
      }

      // ─── RODAPÉ: as ressalvas que fazem o documento circular sozinho ──────────────────────
      linha();
      if (foto.vigenciaTabelas) {
        const v = foto.vigenciaTabelas;
        par(`Tabelas com vigência${v.inicio ? ` de ${v.inicio}` : ""}${v.fim ? ` a ${v.fim}` : ""}`
          + `${v.fundamento ? ` (${v.fundamento})` : ""}.`, { tamanho: 8 });
      }
      par(r.aviso || "Simulação de apoio à decisão, com base nas tabelas vigentes na data da geração. "
        + "Não substitui análise tributária.", { tamanho: 8 });
      // ⚠ A data aparece DUAS vezes de propósito (topo e rodapé): é o que separa duas versões deste
      // mesmo documento quando as duas estão na mesa.
      par(`Documento gerado em ${dataHora(foto.geradoEm)}.`, { tamanho: 8 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
