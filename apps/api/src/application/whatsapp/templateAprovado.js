// O TEMPLATE APROVADO NA META — a conferência ANTES de registrar a aprovação no nosso banco.
//
// Regra PURA: sem prisma, sem rede, sem relógio. Recebe o CORPO aprovado (o texto como a Meta o
// aprovou, com os `{{n}}`) e a linha de `templates_whatsapp`, e devolve a decisão nomeada. Quem
// grava é `scripts/registrar-template-whatsapp.mjs`; quem consome o resultado gravado é
// `elegibilidadeEnvioGuia.avaliarCanal`.
//
// ── POR QUE CONFERIR O CORPO, E NÃO SÓ "ESTÁ APROVADO" ──────────────────────────────────────────
// O código monta o corpo do `guia_disponivel` com CINCO variáveis posicionais, numa ORDEM que veio
// do esqueleto do dono, não da Meta (`WhatsappCloudClient.variaveisDaGuia`). A Meta não conhece o
// significado de cada `{{n}}` — ela só CONTA. Se o modelo aprovado tiver quatro variáveis, a Meta
// recusa com `132000` ("parameter count mismatch") e o contador lê "falhou". Se tiver cinco em OUTRA
// ordem, a Meta ACEITA e o cliente recebe o vencimento no lugar do valor — sem erro nenhum, em cada
// guia, para toda a carteira. É o erro caro, e ele só se pega ANTES, lendo o corpo aprovado.
//
// ⚠ O que o CÓDIGO consegue provar: quantidade, numeração contígua (`{{1}}`…`{{5}}`), ausência de
// variável nomeada e de repetição. O que ele NÃO consegue provar: que `{{1}}` é o NOME e `{{4}}` é
// o VALOR — isso é leitura humana do texto aprovado. Por isso a decisão exige as duas coisas: a
// prova mecânica e a confirmação explícita de quem leu (`conferidoPorPessoa`).
//
// ⚠ Se o corpo aprovado discordar do código, É O CÓDIGO QUE MUDA, nunca o template: mudar o modelo
// na Meta é nova submissão e nova espera de aprovação; mudar a ordem em `variaveisDaGuia` é uma
// linha, num lugar só.

/** As cinco variáveis do corpo, NA ORDEM em que `variaveisDaGuia` as envia. [E] esqueleto do dono. */
export const VARIAVEIS_GUIA = Object.freeze([
  "nomeContato",
  "tipoGuia",
  "competencia",
  "valorFormatado",
  "vencimentoFormatado",
]);

export const MOTIVOS = Object.freeze({
  CORPO_VAZIO: "CORPO_VAZIO",
  SEM_VARIAVEIS: "SEM_VARIAVEIS",
  VARIAVEL_NOMEADA: "VARIAVEL_NOMEADA",
  VARIAVEL_REPETIDA: "VARIAVEL_REPETIDA",
  QUANTIDADE_DIVERGE: "QUANTIDADE_DIVERGE",
  NUMERACAO_COM_BURACO: "NUMERACAO_COM_BURACO",
  TEMPLATE_INEXISTENTE: "TEMPLATE_INEXISTENTE",
  NOME_META_AUSENTE: "NOME_META_AUSENTE",
  NOME_META_FORA_DA_FORMA: "NOME_META_FORA_DA_FORMA",
  SEM_DOCUMENTO_NO_TEMPLATE_DE_GUIA: "SEM_DOCUMENTO_NO_TEMPLATE_DE_GUIA",
  NAO_CONFERIDO_POR_PESSOA: "NAO_CONFERIDO_POR_PESSOA",
  CORPO_NAO_CONFERE: "CORPO_NAO_CONFERE",
});

/**
 * A forma que a Meta aceita para o nome de um template: minúsculas, dígitos e `_`.
 * Fonte: Cloud API — Message Templates ("Template names can only contain lowercase alphanumeric
 * characters and underscores", consultada em 2026-09-02). Fora disso a Meta nem cria o modelo, então
 * um nome fora da forma aqui é erro de digitação de quem copiou.
 */
export const FORMA_NOME_META = /^[a-z0-9_]{1,512}$/;

/**
 * LÊ AS VARIÁVEIS DO CORPO. Devolve os índices posicionais NA ORDEM DE APARIÇÃO e as nomeadas.
 *
 * `{{1}}` é posicional; `{{nome}}` é nomeada (a Meta aceita as duas formas, e o código deste projeto
 * envia SEMPRE a posicional para o `guia_disponivel`).
 */
export function lerVariaveisDoCorpo(corpo) {
  const texto = String(corpo ?? "");
  const posicionais = [];
  const nomeadas = [];
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(texto))) {
    const bruto = m[1].trim();
    if (/^\d+$/.test(bruto)) posicionais.push(Number(bruto));
    else nomeadas.push(bruto);
  }
  return { posicionais, nomeadas };
}

/**
 * O CORPO APROVADO BATE COM O QUE O CÓDIGO ENVIA?
 *
 * @param {string} corpo  o texto aprovado, como está na Meta
 * @param {number} [esperadas]  quantas variáveis o código envia (default: as cinco da guia)
 * @returns {{ok:boolean, motivo:string|null, mensagem:string|null, posicionais:number[], nomeadas:string[], esperadas:number}}
 */
export function conferirCorpoAprovado(corpo, esperadas = VARIAVEIS_GUIA.length) {
  const texto = String(corpo ?? "").trim();
  const base = { posicionais: [], nomeadas: [], esperadas };
  if (!texto) {
    return { ...base, ok: false, motivo: MOTIVOS.CORPO_VAZIO, mensagem: "O corpo aprovado está vazio — não há o que conferir." };
  }
  const { posicionais, nomeadas } = lerVariaveisDoCorpo(texto);
  const comLeitura = { ...base, posicionais, nomeadas };

  if (nomeadas.length) {
    return {
      ...comLeitura,
      ok: false,
      motivo: MOTIVOS.VARIAVEL_NOMEADA,
      mensagem:
        `O corpo aprovado usa variável NOMEADA (${nomeadas.map((n) => `{{${n}}}`).join(", ")}), e o código envia `
        + "variáveis POSICIONAIS ({{1}}…{{5}}). Ou o template é outro, ou o código precisa mudar para o formato nomeado.",
    };
  }
  if (!posicionais.length) {
    return { ...comLeitura, ok: false, motivo: MOTIVOS.SEM_VARIAVEIS, mensagem: "O corpo aprovado não tem nenhuma variável {{n}}." };
  }
  const repetidas = posicionais.filter((n, i) => posicionais.indexOf(n) !== i);
  if (repetidas.length) {
    return {
      ...comLeitura,
      ok: false,
      motivo: MOTIVOS.VARIAVEL_REPETIDA,
      mensagem: `A variável {{${repetidas[0]}}} aparece mais de uma vez no corpo aprovado.`,
    };
  }
  if (posicionais.length !== esperadas) {
    return {
      ...comLeitura,
      ok: false,
      motivo: MOTIVOS.QUANTIDADE_DIVERGE,
      mensagem:
        `O corpo aprovado tem ${posicionais.length} variável(is) e o código envia ${esperadas} `
        + `(${VARIAVEIS_GUIA.join(" · ")}). A Meta recusaria com "parameter count mismatch" (132000). `
        + "É o CÓDIGO que muda (`variaveisDaGuia`), não o template.",
    };
  }
  const ordenadas = [...posicionais].sort((a, b) => a - b);
  const contigua = ordenadas.every((n, i) => n === i + 1);
  if (!contigua) {
    return {
      ...comLeitura,
      ok: false,
      motivo: MOTIVOS.NUMERACAO_COM_BURACO,
      mensagem:
        `As variáveis do corpo aprovado são {{${ordenadas.join("}}, {{")}}}; o código espera {{1}} a {{${esperadas}}}, sem buraco.`,
    };
  }
  return { ...comLeitura, ok: true, motivo: null, mensagem: null };
}

/**
 * A DECISÃO DE REGISTRAR A APROVAÇÃO. Pura — o script só a executa.
 *
 * @param {object} p
 * @param {object|null} p.template  a linha de `templates_whatsapp` (ou null se a chave não existe)
 * @param {string} p.nomeMeta  o nome EXATO aprovado na Meta
 * @param {string|null} [p.corpoAprovado]  o corpo aprovado; sem ele a prova mecânica não roda
 * @param {boolean} p.conferidoPorPessoa  quem leu o corpo confirma que a ORDEM bate com `VARIAVEIS_GUIA`
 * @param {string} [p.idioma]  troca o idioma registrado, quando informado
 * @param {Date} [p.agora]
 * @returns {{ok:boolean, motivo:string|null, mensagem:string|null, dados:object|null, conferencia:object|null, avisos:string[]}}
 */
export function decidirRegistroDeAprovacao({ template, nomeMeta, corpoAprovado = null, conferidoPorPessoa = false, idioma, agora = new Date() }) {
  const avisos = [];
  if (!template) {
    return { ok: false, motivo: MOTIVOS.TEMPLATE_INEXISTENTE, mensagem: "A chave informada não existe em `templates_whatsapp`. As chaves são as cinco semeadas pela migration 20260814180000.", dados: null, conferencia: null, avisos };
  }
  const nome = String(nomeMeta ?? "").trim();
  if (!nome) {
    return { ok: false, motivo: MOTIVOS.NOME_META_AUSENTE, mensagem: "Informe o nome EXATO do template aprovado na Meta (--nome-meta).", dados: null, conferencia: null, avisos };
  }
  if (!FORMA_NOME_META.test(nome)) {
    return {
      ok: false,
      motivo: MOTIVOS.NOME_META_FORA_DA_FORMA,
      mensagem: `"${nome}" não tem a forma de nome de template da Meta (minúsculas, dígitos e _). Copie o nome como está no painel.`,
      dados: null,
      conferencia: null,
      avisos,
    };
  }
  if (template.chave === "guia_disponivel" && !template.temDocumento) {
    // O envio de guia É o PDF chegando; sem header de documento o template manda só texto.
    return { ok: false, motivo: MOTIVOS.SEM_DOCUMENTO_NO_TEMPLATE_DE_GUIA, mensagem: "O `guia_disponivel` está cadastrado SEM cabeçalho de documento; ele não pode levar o PDF da guia.", dados: null, conferencia: null, avisos };
  }

  let conferencia = null;
  if (corpoAprovado != null && String(corpoAprovado).trim()) {
    conferencia = conferirCorpoAprovado(corpoAprovado);
    if (!conferencia.ok) {
      return { ok: false, motivo: MOTIVOS.CORPO_NAO_CONFERE, mensagem: conferencia.mensagem, dados: null, conferencia, avisos };
    }
  } else {
    avisos.push("o corpo aprovado não foi informado: a quantidade e a numeração das variáveis NÃO foram conferidas pelo código");
  }

  if (conferidoPorPessoa !== true) {
    return {
      ok: false,
      motivo: MOTIVOS.NAO_CONFERIDO_POR_PESSOA,
      mensagem:
        "Falta a confirmação de quem LEU o corpo aprovado: a ORDEM das variáveis "
        + `(${VARIAVEIS_GUIA.map((v, i) => `{{${i + 1}}}=${v}`).join(", ")}) só uma pessoa confere. Passe --conferido.`,
      dados: null,
      conferencia,
      avisos,
    };
  }

  const dados = { nomeMeta: nome, statusAprovacao: "APROVADO", motivoRejeicao: null, conferidoNaMetaEm: agora };
  if (idioma != null && String(idioma).trim()) dados.idioma = String(idioma).trim();
  return { ok: true, motivo: null, mensagem: null, dados, conferencia, avisos };
}
