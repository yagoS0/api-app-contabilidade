import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  INTEGRACAO_SERPRO_PAGTOWEB,
  SERPRO_PAGTOWEB_SYSTEM,
  SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
} from "../../../config.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";

// Contrato conferido em 24/09/2026, sem acionar serviço fiscal nos testes:
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/servicos/emite_comprovante_pagamento/
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-pagamento/pagtoweb/mensagens/
// Não há código documentado de "pagamento não localizado" em COMPARRECADACAO72.
// Ausência de PDF, autorização recusada e erro nunca equivalem a pago:false.
const VERIFICADO_TRIAL = false;
const SUCESSO = "Sucesso-PAGTOWEB-00000";
const onlyDigits = (value) => String(value ?? "").replace(/\D+/g, "");

function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function mensagensDoEnvelope(payload) {
  const mensagens = payload?.mensagens ?? payload?.Mensagens ?? payload?.mensagem;
  return (Array.isArray(mensagens) ? mensagens : [mensagens]).filter(Boolean).map((item) => ({
    codigo: String(item?.codigo ?? item?.Codigo ?? "").trim().replace(/^\[|\]$/g, ""),
    texto: typeof item === "string" ? item : String(item?.texto ?? item?.mensagem ?? item?.descricao ?? ""),
  }));
}

function pdfDoEnvelope(payload) {
  // Somente a saída do serviço: nunca varrer pedidoDados, mensagens ou objetos arbitrários
  // procurando uma string que pareça PDF. O retorno observado é dados JSON com {pdf}.
  const dados = payload?.dados ?? payload?.Dados;
  const parsed = parseJson(dados);
  return parsed ? parsed.pdf ?? parsed.Pdf ?? null : (typeof dados === "string" ? dados : null);
}

function decodificarPdf(raw) {
  if (typeof raw !== "string") return null;
  const base64 = raw.replace(/[\t\n\r ]/g, "");
  if (!base64 || base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) return null;
  const buffer = Buffer.from(base64, "base64");
  if (buffer.toString("base64") !== base64) return null;
  if (!/^%PDF-\d\.\d/.test(buffer.subarray(0, 8).toString("ascii"))) return null;
  if (!/%%EOF\s*$/.test(buffer.subarray(Math.max(0, buffer.length - 1024)).toString("latin1"))) return null;
  return buffer;
}

function identidadeEnvelope(payload, contribuinte, numeroDocumento) {
  const pessoa = payload?.contribuinte;
  const pedido = payload?.pedidoDados;
  const dadosPedido = parseJson(pedido?.dados);
  const cnpj = pessoa?.numero == null ? null : onlyDigits(pessoa.numero);
  const documento = dadosPedido?.numeroDocumento == null ? null : onlyDigits(dadosPedido.numeroDocumento);
  const divergente = (cnpj != null && (cnpj !== contribuinte || Number(pessoa.tipo) !== 2))
    || (documento != null && documento !== numeroDocumento)
    || (pedido?.idSistema != null && pedido.idSistema !== SERPRO_PAGTOWEB_SYSTEM)
    || (pedido?.idServico != null && pedido.idServico !== SERPRO_PAGTOWEB_SERVICE_COMPROVANTE);
  return {
    divergente: Boolean(divergente),
    conferida: !divergente && cnpj === contribuinte && documento === numeroDocumento
      && pedido?.idSistema === SERPRO_PAGTOWEB_SYSTEM && pedido?.idServico === SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
  };
}

function identidadeTexto(texto, contribuinte, numeroDocumento) {
  // Valores do layout real podem aparecer abaixo ou junto dos rótulos. Não juntar todos
  // os dígitos do documento: isso poderia fabricar identidade entre campos diferentes.
  const candidatosCnpj = [...texto.matchAll(/(?<!\d)(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})(?!\d)/g)].map((m) => onlyDigits(m[0]));
  const candidatosDocumento = [...texto.matchAll(/(?<!\d)(?:\d{2}\.\d{2}\.\d{5}\.\d{7}-\d|\d{17})(?!\d)/g)].map((m) => onlyDigits(m[0]));
  const cnpjConferido = candidatosCnpj.includes(contribuinte);
  const documentoConferido = candidatosDocumento.includes(numeroDocumento);
  return {
    conferida: cnpjConferido && documentoConferido,
    divergente: (candidatosCnpj.length > 0 && !cnpjConferido) || candidatosDocumento.some((candidato) => candidato !== numeroDocumento),
  };
}

async function lerPagina(page) {
  // Separar falha de extração de texto de falha na estrutura do PDF. pdf-parse ainda
  // precisa carregar as páginas; uma página sem texto não inventa composição contábil.
  try {
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    let linhaY = null;
    let texto = "";
    for (const item of content.items) {
      texto += linhaY == null || linhaY === item.transform[5] ? item.str : `\n${item.str}`;
      linhaY = item.transform[5];
    }
    return texto;
  } catch { return ""; }
}

function buildPagtoWebPayload({ numeroDocumento }) {
  const doc = onlyDigits(numeroDocumento);
  if (!doc || doc.length > 17) {
    const err = new Error(doc ? "numero_documento_invalid" : "numero_documento_required");
    err.code = doc ? "SERPRO_PAGTOWEB_NUMERO_DOCUMENTO_INVALID" : "SERPRO_PAGTOWEB_NUMERO_DOCUMENTO_REQUIRED";
    throw err;
  }
  return {
    pedidoDados: {
      idSistema: SERPRO_PAGTOWEB_SYSTEM,
      idServico: SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
      versaoSistema: "1.0",
      dados: JSON.stringify({ numeroDocumento: doc }),
    },
  };
}

/**
 * Confirma somente comprovante oficial válido e vinculado ao documento/empresa.
 * pago:null significa consulta inconclusiva; nunca deve abrir pendência ou apagar baixa.
 * Composição financeira é independente: pago:true não garante composição.confiavel.
 */
export async function confirmarPagamento({ contratanteCnpj, contribuinteCnpj, numeroDocumento, logger = null }) {
  if (!INTEGRACAO_SERPRO_PAGTOWEB) {
    const err = new Error("serpro_pagtoweb_disabled");
    err.code = "SERPRO_PAGTOWEB_DISABLED";
    throw err;
  }
  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
  if (procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }
  const contribuinte = onlyDigits(contribuinteCnpj);
  if (contribuinte.length !== 14) {
    const err = new Error("serpro_contribuinte_cnpj_invalid");
    err.code = "SERPRO_CONTRIBUINTE_CNPJ_INVALID";
    throw err;
  }
  const pedido = buildPagtoWebPayload({ numeroDocumento });
  const documento = onlyDigits(numeroDocumento);
  const client = new SerproHttpClient();
  const consultadoEm = new Date().toISOString();
  // Mantém transporte, orçamento, cooldown e tratamento de rede do cliente central.
  const resp = await client.post("/Emitir", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: 2 },
    ...pedido,
  }, { raw: true, validateStatus: () => true });

  const httpStatus = Number(resp.status);
  const data = parseJson(resp.data);
  const mensagens = mensagensDoEnvelope(data);
  const codigos = mensagens.map((m) => m.codigo).filter(Boolean);
  const mensagemProvedor = mensagens.map((m) => m.texto).filter(Boolean).join(" | ");
  const evidencia = { httpStatus, statusProvedor: data?.status ?? null, codigos };
  const resultado = (estado, motivo, identidadeConferida = false, extras = {}) => ({
    pago: estado === "CONFIRMADO" ? true : null,
    comprovantePdfBuffer: null,
    mensagem: estado === "CONFIRMADO" ? null : mensagemProvedor || "Não foi possível confirmar o pagamento na Receita. Confira o resultado da consulta.",
    verificadoTrial: VERIFICADO_TRIAL,
    rawPayload: resp.data,
    resultadoConsulta: {
      estado, fonte: "PAGTOWEB", consultadoEm, numeroDocumento: documento, cnpj: contribuinte,
      motivo, cobertura: estado === "CONFIRMADO" ? "COMPLETA" : "PARCIAL", identidadeConferida, evidencia,
    },
    ...extras,
  });
  logger?.info?.({ httpStatus, codigos }, "PAGTOWEB: resposta /Emitir");

  // A autorização/status fiscal vem ANTES do PDF: um erro contendo anexo não é prova.
  if (httpStatus >= 500) {
    const err = new Error(mensagemProvedor || "serpro_pagtoweb_indisponivel");
    err.code = "SERPRO_PAGTOWEB_INDISPONIVEL";
    err.details = { httpStatus, mensagem: mensagemProvedor, resultadoConsulta: resultado("INDETERMINADO", "HTTP_INDISPONIVEL").resultadoConsulta };
    throw err;
  }
  if (httpStatus !== 200) return resultado("INDETERMINADO", `HTTP_${httpStatus}`);
  if (!data || (data.status != null && Number(data.status) !== 200)) return resultado("INDETERMINADO", "STATUS_FISCAL_INVALIDO");
  if (!codigos.includes(SUCESSO) || codigos.some((codigo) => codigo !== SUCESSO)) return resultado("INDETERMINADO", "RESPOSTA_FISCAL_SEM_SUCESSO");
  const saida = parseJson(data.dados ?? data.Dados);
  if ((saida?.status != null && Number(saida.status) !== 200)
    || mensagensDoEnvelope(saida).some((m) => m.codigo !== SUCESSO)
    || saida?.erro || saida?.error) return resultado("INDETERMINADO", "SAIDA_FISCAL_DIVERGENTE");
  const envelope = identidadeEnvelope(data, contribuinte, documento);
  if (envelope.divergente) return resultado("PARCIAL_OU_DIVERGENTE", "IDENTIDADE_ENVELOPE_DIVERGENTE");

  const pdf = pdfDoEnvelope(data);
  if (pdf == null || pdf === "") return resultado("INDETERMINADO", "SEM_COMPROVANTE");
  const pdfBuffer = decodificarPdf(pdf);
  if (!pdfBuffer) return resultado("INDETERMINADO", "PDF_INVALIDO");
  let texto;
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const out = await pdfParse(new Uint8Array(pdfBuffer), { version: "v2.0.550", pagerender: lerPagina });
    if (!Number.isInteger(out?.numpages) || out.numpages < 1) return resultado("INDETERMINADO", "PDF_SEM_PAGINAS");
    texto = String(out.text || "");
  } catch {
    return resultado("INDETERMINADO", "PDF_ILEGIVEL");
  }
  const identidade = identidadeTexto(texto, contribuinte, documento);
  if (identidade.divergente) return resultado("PARCIAL_OU_DIVERGENTE", "IDENTIDADE_COMPROVANTE_DIVERGENTE");
  if (!identidade.conferida && !envelope.conferida) return resultado("INDETERMINADO", "IDENTIDADE_NAO_DEMONSTRADA");

  let comprovante = null;
  let composicao = null;
  try {
    const { parseComprovanteArrecadacao } = await import("./parseComprovanteArrecadacao.js");
    const { parseComposicaoComprovante } = await import("./parseComposicaoComprovante.js");
    comprovante = parseComprovanteArrecadacao(texto);
    composicao = parseComposicaoComprovante(texto);
  } catch {
    logger?.warn?.("PAGTOWEB: comprovante identificado; composição financeira exige conferência.");
  }
  evidencia.identidadeFonte = identidade.conferida ? "COMPROVANTE_PDF" : "ENVELOPE_OFICIAL";
  evidencia.pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");
  return resultado("CONFIRMADO", "COMPROVANTE_OFICIAL_CONFERIDO", true, { comprovantePdfBuffer: pdfBuffer, comprovante, composicao });
}
