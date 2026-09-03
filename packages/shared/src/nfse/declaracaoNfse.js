// A DECLARAÇÃO DA NOTA — as linhas que quem confirma LÊ antes de emitir. Pura, compartilhada.
//
// ⚠⚠ ESTA É A TERCEIRA CASA DA MESMA REGRA, e nasceu (02/09/2026) porque o assistente de WhatsApp
// precisa repetir ao cliente a declaração INTEIRA antes de ele confirmar — a mesma lista que o
// portal do escritório e o do cliente mostram no passo "Conferir". As outras duas moram em:
//   `apps/web/src/features/notas/lib/declaracaoNfse.js`
//   `apps/portal-cliente-web/src/features/emitir/lib/declaracaoNfse.js`
// e ficam lá (carregam a leitura do REGIME, que depende do vocabulário de cada portal). O que
// mora aqui é só o texto das linhas — e o `apps/web` amarra por teste que as duas produzem o mesmo.
//
// ⚠ O `regime` chega JÁ RESOLVIDO (`{ rotuloDeclarado, opSimpNac, resolucao, exigePTotTribSN }`);
// este módulo não decide regime nenhum.
//
// ⚠ Não resumir: "Emitir nota de R$ X para Fulano?" foi o defeito — o contador confirmava sem ver
// alíquota, retenção, regime declarado nem percentual de tributos.

const soDigitos = (v) => String(v || "").replace(/\D/g, "");

export function formatarDoc(doc) {
  const d = soDigitos(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return String(doc || "");
}

export function fmtBRL(v) {
  const n = Number(v || 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

export function textoIssRetido(issRetido) {
  return issRetido
    ? "sim — quem recolhe o ISS é o TOMADOR; o prestador recebe o valor do serviço menos o ISS"
    : "não — quem recolhe o ISS é o PRESTADOR (a empresa que está emitindo esta nota)";
}

export function textoEndereco(endereco) {
  if (!endereco) return "não informado";
  const compl = endereco.xCpl ? ` — ${endereco.xCpl}` : "";
  return `${endereco.xLgr}, ${endereco.nro}${compl} · ${endereco.xBairro} · CEP ${endereco.CEP} · município ${endereco.cMun}`;
}

export const RESOLUCAO = Object.freeze({ RESOLVIDO: "resolvido", INDEFINIDO: "indefinido" });

function textoRegime(regime) {
  if (!regime) return "não informado";
  if (regime.resolucao !== RESOLUCAO.RESOLVIDO) return regime.rotuloDeclarado;
  return `${regime.rotuloDeclarado} (opSimpNac ${regime.opSimpNac})`;
}

/**
 * A DESCRIÇÃO ÚNICA DA NOTA.
 * @param {Object} dados `{ tomador:{nome,doc,email}, endereco|null, servico:{descricao,valor,aliquota,issRetido}, competencia, referencia, pTotTribSN, regime }`
 * @returns {Array<{rotulo: string, valor: string, forte?: boolean, separadorAntes?: boolean}>}
 */
export function linhasDoEspelho(dados = {}) {
  const { tomador = {}, endereco = null, servico = {}, competencia, referencia, pTotTribSN, regime } = dados;
  const linhas = [];
  linhas.push({ rotulo: "Tomador", valor: `${String(tomador.nome || "").trim()} · ${formatarDoc(tomador.doc)}` });
  if (tomador.email) linhas.push({ rotulo: "E-mail", valor: String(tomador.email).trim() });
  linhas.push({ rotulo: "Endereço", valor: textoEndereco(endereco) });
  linhas.push({ rotulo: "Serviço", valor: String(servico.descricao || "").trim() });
  linhas.push({ rotulo: "Competência", valor: competencia || "não informada" });
  if (referencia) linhas.push({ rotulo: "Referência", valor: String(referencia).trim() });
  // ⚠ VALOR AUSENTE NÃO É "R$ 0,00": travessão/"não informado" diz que ninguém informou.
  const valorInformado = Number.isFinite(Number(servico.valor)) && Number(servico.valor) > 0;
  linhas.push({ rotulo: "Valor dos serviços", valor: valorInformado ? fmtBRL(servico.valor) : "não informado", forte: true, separadorAntes: true });
  linhas.push({ rotulo: "Alíquota de ISS", valor: servico.aliquota == null || servico.aliquota === "" ? "a da prefeitura" : fmtPercent(servico.aliquota) });
  linhas.push({ rotulo: "ISS retido", valor: textoIssRetido(Boolean(servico.issRetido)) });
  linhas.push({ rotulo: "Regime declarado", valor: textoRegime(regime) });
  if (!regime || regime.exigePTotTribSN) {
    linhas.push({ rotulo: "Total de tributos (Simples)", valor: pTotTribSN == null || pTotTribSN === "" ? "não informado" : fmtPercent(pTotTribSN) });
  }
  return linhas;
}

export const AVISO_IRREVERSIVEL =
  "A emissão é um ato fiscal: depois de autorizada, desfazer exige cancelamento com justificativa, "
  + "dentro do prazo da prefeitura.";

/** A MESMA lista do espelho, em texto — é o que o cliente lê no `confirm` e no WhatsApp. */
export function textoDeConfirmacao(dados = {}) {
  const linhas = linhasDoEspelho(dados).map((l) => `• ${l.rotulo}: ${l.valor}`);
  return `Emitir esta nota de serviço?\n\n${linhas.join("\n")}\n\n${AVISO_IRREVERSIVEL}`;
}
