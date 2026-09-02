// GERADOR DAS TABELAS DE RETENÇÃO NA FONTE — lê `docs/retencao-fonte/`, escreve
// `src/application/fiscal/retencao/retencao.data.js`.
//
// ⚠ ZERO REDE. Ele não baixa nada: os artefatos são versionados por quem os baixou, com hash no
// README. Se o documento mudar, o hash aqui não confere e a execução ABORTA.
//
// ⚠⚠ A CONTAGEM NÃO É PROVA, e este projeto já pagou por isso na LC 116 (uma entrada perdida e
// outra duplicada dão o mesmo total). Aqui não há o que contar: o que existe são POUCOS números
// que decidem quanto se retém de um documento fiscal. Então o gate é de CONTEÚDO — cada valor tem
// de aparecer LITERALMENTE no documento, na frase que o institui. Um `0,65%` solto em qualquer
// lugar do texto não serve; o que se procura é a frase inteira do art. 31.
//
// ⚠ E o gate confere as DUAS metades de cada regra: a alíquota e a dispensa. Uma tabela que
// soubesse reter e não soubesse dispensar produziria retenção sobre optante do Simples — que é
// justamente o que a lei proíbe (art. 32, III).
//
// Uso: node apps/api/scripts/gerar-tabelas-retencao.mjs

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..", "..");
const DOCS = path.join(RAIZ, "docs", "retencao-fonte");
const SAIDA = path.join(AQUI, "..", "src", "application", "fiscal", "retencao", "retencao.data.js");

/** Os artefatos, com o hash que o README publica. Divergiu, aborta. */
const ARTEFATOS = {
  lei10833: {
    arquivo: "l10833compilado.htm",
    codificacao: "latin1",
    sha256: "2a22828df7d34073f49430194031e794263a70cf3dec1a7b77ada28670bfe7ec",
  },
  in459: {
    arquivo: "in-srf-459-2004-vigente.json",
    codificacao: "utf-8",
    sha256: "3935f607efa38446566765dd2c0c0eac353a2cc3999b6e6ddcb91140eff77e2f",
  },
  in765: {
    arquivo: "in-rfb-765-2007-vigente.json",
    codificacao: "utf-8",
    sha256: "c156f3086aa9b0abeb9a3b2aac5560a71035c7bccbe854706ca14a2ff4e7a0f0",
  },
};

function abortar(msg) {
  console.error(`\n✖ ABORTADO: ${msg}\n`);
  console.error("Nada foi escrito. Tabela de retenção pela metade é pior que tabela nenhuma:");
  console.error("ela retém — ou deixa de reter — sobre um documento fiscal.\n");
  process.exit(1);
}

function lerArtefato(chave) {
  const a = ARTEFATOS[chave];
  const alvo = path.join(DOCS, a.arquivo);
  if (!fs.existsSync(alvo)) abortar(`artefato ausente: ${alvo}`);
  const bytes = fs.readFileSync(alvo);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== a.sha256) {
    abortar(
      `o SHA-256 de ${a.arquivo} não confere.\n`
        + `  esperado: ${a.sha256}\n  obtido:   ${sha}\n`
        + "  O documento mudou. Releia a norma ANTES de atualizar o hash — o hash existe para\n"
        + "  forçar essa releitura, não para ser atualizado até passar."
    );
  }
  return { texto: bytes.toString(a.codificacao), bytes: bytes.length };
}

/** Texto corrido do HTML do Planalto, com as entidades que esta fonte usa de fato. */
function planaltoEmTexto(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#150;/g, "–")
    .replace(/&#186;|&ordm;/g, "º")
    .replace(/&#167;|&sect;/g, "§")
    .replace(/\s+/g, " ");
}

/**
 * Texto da norma da Receita, SÓ na redação vigente.
 *
 * ⚠⚠ `compilado && !omitir` é o filtro inteiro, e ele não é zelo: o JSON traz as DUAS redações do
 * mesmo dispositivo (ver o README, armadilha 3). Sem ele sai a revogada — ou as duas.
 */
function normaEmTexto(json) {
  const d = JSON.parse(json);
  const segs = (d.outrosSegmentos || []).filter((s) => s?.compilado === true && s?.omitir !== true);
  if (!segs.length) abortar("nenhum segmento compilado e não-omitido — a forma do JSON mudou.");
  return segs.map((s) => String(s.textoIntegra || "")).join("\n").replace(/\s+/g, " ");
}

/** Cada item do gate: a frase que INSTITUI o valor, procurada literalmente. */
function exigir(texto, trecho, onde) {
  if (!texto.includes(trecho)) {
    abortar(`não encontrei em ${onde} a frase que sustenta o valor:\n    "${trecho}"`);
  }
}

// ─── leitura e gate ──────────────────────────────────────────────────────────────────────────

const lei = lerArtefato("lei10833");
const in459 = lerArtefato("in459");
const in765 = lerArtefato("in765");

const tLei = planaltoEmTexto(lei.texto);
const t459 = normaEmTexto(in459.texto);
const t765 = normaEmTexto(in765.texto);

// Lei 10.833 — as quatro frases que decidem tudo.
exigir(tLei, "estão sujeitos a retenção na fonte da Contribuição Social sobre o Lucro Líquido", "Lei 10.833 art. 30");
exigir(tLei, "percentual de 4,65% (quatro inteiros e sessenta e cinco centésimos por cento)", "Lei 10.833 art. 31");
exigir(tLei, "soma das alíquotas de 1% (um por cento), 3% (três por cento) e 0,65%", "Lei 10.833 art. 31");
exigir(tLei, "Fica dispensada a retenção de valor igual ou inferior a R$ 10,00 (dez", "Lei 10.833 art. 31 § 3º");
exigir(tLei, "Documento de Arrecadação de Receitas Federais - DARF eletrônico efetuado por meio do Siafi", "Lei 10.833 art. 31 § 3º");
exigir(tLei, "III - pessoas jurídicas optantes pelo SIMPLES", "Lei 10.833 art. 32, III");
// ⚠ A revogação do § 4º É o fim do antigo limite de R$ 5.000 somado no mês. Sem esta linha, um
// leitor futuro poderia "restaurar" a soma mensal achando que ela ainda vale.
exigir(tLei, "(Revogado)", "Lei 10.833 art. 31 § 4º");

// IN SRF 459/2004 — a redação VIGENTE do art. 3º, II, e a declaração do art. 11.
exigir(t459, "II - pessoas jurídicas optantes pelo Regime Especial Unificado", "IN SRF 459/2004 art. 3º, II");
exigir(t459, "em relação às suas receitas próprias", "IN SRF 459/2004 art. 3º, II");
exigir(t459, "deverá apresentar à pessoa jurídica tomadora dos serviços declaração, na forma do Anexo I", "IN SRF 459/2004 art. 11");

// IN RFB 765/2007 — a dispensa do IRRF e a exceção dela.
exigir(t765, "Fica dispensada a retenção do imposto de renda na fonte sobre as importâncias pagas ou creditadas a pessoa jurídica inscrita no Regime Especial Unificado", "IN RFB 765/2007 art. 1º");
exigir(t765, "não se aplica ao imposto de renda relativo aos rendimentos ou ganhos líquidos auferidos em aplicações", "IN RFB 765/2007 art. 1º § único");

// ⚠⚠ CONTRAPROVA DO GATE: se o leitor de texto quebrar, TODOS os `exigir` acima passariam a falhar
// — mas um leitor que devolvesse o documento INTEIRO sem filtrar faria a IN 459 aceitar a redação
// REVOGADA. Esta linha prova que o filtro `compilado && !omitir` está de fato cortando: a redação
// antiga (que diz só "Simples", sem "Nacional") NÃO pode estar no texto vigente.
if (t459.includes("optantes pelo Simples, em relação às suas receitas próprias")) {
  abortar(
    "o texto da IN 459 contém a redação REVOGADA do art. 3º, II.\n"
      + "  O filtro `compilado && !omitir` parou de cortar — ver a armadilha 3 do README."
  );
}

// ─── escrita ─────────────────────────────────────────────────────────────────────────────────

const conteudo = `// GERADO por apps/api/scripts/gerar-tabelas-retencao.mjs — NÃO EDITE À MÃO.
//
// Fonte: docs/retencao-fonte/ (ver o README de lá: URL, data, codificação e hash de cada artefato).
// Toda linha abaixo foi conferida LITERALMENTE contra o documento oficial pelo gate do gerador.
//
// ⚠⚠ ESTE ARQUIVO NÃO CALCULA NADA. Ele é a tabela; a conta e a decisão de reter moram em quem o
// consome. E o que NÃO está aqui está nomeado em \`NAO_VERSIONADO\`, de propósito.

/** Serviços do caput do art. 30 — transcrição literal, para a tela do contador citar. */
export const SERVICOS_ART30 = Object.freeze([
  "limpeza",
  "conservação",
  "manutenção",
  "segurança",
  "vigilância",
  "transporte de valores",
  "locação de mão-de-obra",
  "assessoria creditícia",
  "assessoria mercadológica",
  "gestão de crédito",
  "seleção e riscos",
  "administração de contas a pagar e a receber",
  "remuneração de serviços profissionais",
]);

/**
 * As três contribuições retidas na fonte, e a soma.
 *
 * ⚠ Percentuais, nunca valores: o valor sai da multiplicação pelo montante da nota, por nota.
 * Fonte: Lei 10.833/2003, art. 31, caput.
 */
export const ALIQUOTAS_ART30 = Object.freeze({
  csll: 1,
  cofins: 3,
  pisPasep: 0.65,
  total: 4.65,
  fonte: "Lei 10.833/2003, art. 31, caput",
  verificadoNaFonte: true,
});

/**
 * ⚠⚠ O PISO É DE R$ 10,00, E O ANTIGO LIMITE DE R$ 5.000 NÃO EXISTE MAIS.
 *
 * A Lei 13.137/2015 deu nova redação ao § 3º e **revogou o § 4º** — que era exatamente a regra de
 * somar os pagamentos do mês à mesma PJ para aferir o limite antigo. Sistema que ainda a aplique
 * DEIXA DE RETER o que é devido.
 */
export const PISO_DISPENSA = Object.freeze({
  valor: 10.0,
  comparacao: "menor ou igual",
  excecao: "DARF eletrônico efetuado por meio do Siafi",
  fonte: "Lei 10.833/2003, art. 31, § 3º (redação da Lei 13.137/2015)",
  somaMensalRevogada: Object.freeze({
    revogada: true,
    fonte: "Lei 10.833/2003, art. 31, § 4º — (Revogado) pela Lei 13.137/2015",
  }),
  verificadoNaFonte: true,
});

/**
 * ⚠⚠ OPTANTE DO SIMPLES NACIONAL NÃO SOFRE RETENÇÃO FEDERAL SOBRE SERVIÇOS.
 *
 * Está na LEI, não só na Instrução Normativa — a IN regulamenta e atualiza o nome do regime.
 *
 * ⚠ NÃO CONFUNDIR COM O ART. 30, § 2º: aquele fala de quem PAGA (fonte pagadora optante não é
 * obrigada a reter). Para a NFS-e o que vale é o art. 32, III — nosso cliente é o PRESTADOR.
 */
export const DISPENSA_SIMPLES_NACIONAL = Object.freeze({
  pisCofinsCsll: Object.freeze({
    dispensada: true,
    fonte: "Lei 10.833/2003, art. 32, III; IN SRF 459/2004, art. 3º, II",
    escopo: "em relação às suas receitas próprias",
    verificadoNaFonte: true,
  }),
  irrf: Object.freeze({
    dispensada: true,
    fonte: "IN RFB 765/2007, art. 1º",
    excecao:
      "rendimentos ou ganhos líquidos de aplicações de renda fixa ou variável "
      + "(LC 123/2006, art. 13, § 1º, V)",
    verificadoNaFonte: true,
  }),
  /** ⚠ A dispensa tem uma obrigação acessória do lado do prestador. */
  declaracaoAoTomador: Object.freeze({
    exigida: true,
    forma: "declaração na forma do Anexo I, em 2 (duas) vias, assinadas pelo representante legal",
    fonte: "IN SRF 459/2004, art. 11",
    verificadoNaFonte: true,
  }),
});

/**
 * ⚠⚠ O QUE NÃO ESTÁ AQUI, E POR QUÊ — regra 1 do projeto: o que não está provado não é preenchido.
 *
 * Cada entrada é uma decisão de NÃO inventar. Quem for preencher uma delas versiona a norma em
 * \`docs/retencao-fonte/\` primeiro, e o gate do gerador passa a conferi-la.
 */
export const NAO_VERSIONADO = Object.freeze({
  irrfAliquotaServicos: Object.freeze({
    porque:
      "A alíquota do IRRF sobre serviços não está na Lei 10.833. Ela vive na legislação do imposto "
      + "de renda (Lei 7.713/1988 e RIR), não versionada aqui. A IN 765 prova a DISPENSA para o "
      + "Simples — não a alíquota aplicável ao Presumido.",
  }),
  retencaoPrevidenciaria: Object.freeze({
    porque:
      "Lei 8.212/1991, art. 31 (cessão de mão de obra e empreitada) e a interação com o Anexo IV "
      + "do Simples não foram confirmadas. O campo vRetCP existe no leiaute e fica SEM PRODUTOR.",
  }),
  listaServicosProfissionais: Object.freeze({
    porque:
      "O caput do art. 30 remete ao rol de 'serviços profissionais' da legislação do IR, não "
      + "versionado. Quem declara se o serviço está na lista é o CONTADOR, por perfil — derivar do "
      + "CNAE erraria nos dois sentidos: declarar retenção indevida, ou omitir a devida.",
  }),
  orgaosPublicosFederais: Object.freeze({
    porque:
      "IN RFB 1.234/2012 tem tabela e alíquotas próprias por natureza do serviço. É outro regime "
      + "de retenção, não um caso do art. 30.",
  }),
  issRetidoNoSimples: Object.freeze({
    porque:
      "LC 123/2006, arts. 13 § 1º, 18 § 6º e 21 § 4º — retenção MUNICIPAL, pertence à fase do "
      + "grupo tribMun. A LC 123 não está versionada neste repositório.",
  }),
});
`;

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, conteudo, "utf-8");

console.log("✔ gate passou — todas as frases foram encontradas nos documentos oficiais.");
console.log(`  Lei 10.833/2003 .......... ${lei.bytes} bytes (ISO-8859-1)`);
console.log(`  IN SRF 459/2004 .......... ${in459.bytes} bytes (UTF-8)`);
console.log(`  IN RFB 765/2007 .......... ${in765.bytes} bytes (UTF-8)`);
console.log(`\n✔ escrito: ${path.relative(RAIZ, SAIDA)}`);
