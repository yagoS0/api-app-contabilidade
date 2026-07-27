// Heurística de leitura da situação fiscal (SITFIS) a partir do TEXTO do relatório.
//
// Vive num módulo próprio (e não dentro da rota) porque duas coisas precisam da MESMA regra:
// a consulta ao SERPRO e o script que reclassifica relatórios já salvos. Duplicar isso
// significaria empresas com situação divergente dependendo de quem calculou.
//
// ⚠ Best-effort — o formato do relatório SITFIS não foi validado no sandbox
// (verificadoTrial:false). Serve pra sinalizar na UI; não é fonte fiscal definitiva.

// Sinais fortes de pendência (RFB + PGFN). "DEVEDOR" aparece na coluna
// "Sdo. Dev. Cons. Situação" do relatório quando há débito.
export const SITFIS_PENDENCIA_REGEX = /pend[êe]ncia|d[ée]bito|em aberto|parcelamento em atraso|irregular|div[íi]da ativa|inscri[çc][ãa]o em d[íi]vida|devedor|saldo devedor|exig[íi]vel/i;

// Frases de "nada consta" — removidas ANTES de aplicar a regex de pendência, senão "não há
// débitos" dispararia por conter "débitos". Removemos só as frases negativas: assim um relatório
// com seção limpa na RFB mas "DEVEDOR" na PGFN ainda é pego.
// Calibrada com relatório real: a linha limpa da PGFN é "Não foram DETECTADAS pendências/
// exigibilidades suspensas ..." — "detectad" precisa estar aqui (era a causa do falso-positivo).
export const SITFIS_NEGACAO_REGEX = /(?:n[ãa]o\s+(?:h[áa]|constam?|possui|exist[eê]m?|foram\s+(?:localizad[oa]s?|apurad[oa]s?|encontrad[oa]s?|identificad[oa]s?|detectad[oa]s?))\s+(?:d[ée]bitos?|pend[êe]ncias?|inscri[çc][õo]es?|ocorr[êe]ncias?|exigibilidades?)[^.;\n]*|nada\s+consta[^.;\n]*|sem\s+(?:pend[êe]ncias?|ocorr[êe]ncias?|d[ée]bitos?)[^.;\n]*|situa[çc][ãa]o\s+(?:fiscal\s+)?regular[^.;\n]*|regular\s+perante[^.;\n]*)/gi;

// Parcelamento com exigibilidade SUSPENSA = empresa regularizando (débito suspenso, não em aberto).
// ⚠ NÃO casa "parcelamento EM ATRASO" — esse voltou a ser exigível e já cai na regex de pendência,
// que é avaliada ANTES desta.
export const SITFIS_PARCELAMENTO_REGEX = /parcelamento\s+com\s+exigibilidade\s+suspensa|(?:^|[^a-zç])em\s+parcelamento|\bparcsn\b|\bparcmei\b/i;

/**
 * Classifica o texto de um relatório SITFIS.
 * Ordem importa: débito em aberto vence parcelamento suspenso.
 * @returns {"COM_PENDENCIA"|"EM_PARCELAMENTO"|"REGULAR"}
 */
export function classificarTextoSitfis(texto) {
  const semNegacoes = String(texto || "").replace(SITFIS_NEGACAO_REGEX, " ");
  if (SITFIS_PENDENCIA_REGEX.test(semNegacoes)) return "COM_PENDENCIA";
  if (SITFIS_PARCELAMENTO_REGEX.test(semNegacoes)) return "EM_PARCELAMENTO";
  return "REGULAR";
}

/**
 * Deriva a situação a partir do resultado de uma consulta ao SERPRO.
 * NÃO varre o rawPayload (nomes de campo/metadados do envelope casavam as palavras-chave e
 * geravam pendência falsa) — só o texto do relatório conta.
 */
export function deriveSituacaoFiscal(result, extraText = "") {
  if (result?.processando) return "PROCESSANDO";
  return classificarTextoSitfis([result?.relatorioTexto || "", extraText || ""].join(" "));
}
