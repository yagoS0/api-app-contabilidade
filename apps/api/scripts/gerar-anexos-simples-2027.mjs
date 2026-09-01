// GERA OS ANEXOS I A V DA LC 123/2006 — REDAÇÃO 2027-2028 — a partir do texto OFICIAL versionado.
//
// Mesma regra de `gerar-lista-lc116.mjs` e `gerar-lista-servico-nacional.mjs`: tabela de alíquota
// **não se transcreve de memória nem se deduz por analogia**. Ela entra como artefato oficial —
// URL, data, contagem e hash — e o código é GERADO, com provas que ABORTAM na divergência.
//
// Fonte: `docs/reforma-consumo/lcp214.htm` (Planalto, texto compilado, com as marcas de alteração
// da LC 227/2026). Ver o README de lá — inclusive as QUATRO afirmações de plano que a leitura da
// lei derrubou.
//
// ⚠⚠ POR QUE ESTE GERADOR EXISTE, e não uma transcrição: a primeira tentativa de extrair estas
// tabelas por regex solta JÁ ERROU. No Anexo III saíram `16,42` e `16,41` para a MESMA faixa (duas
// vigências diferentes se misturando no texto corrido) e um bloco somou **100,01%**. Quem pegou
// isso foi a prova da soma, não a leitura humana — e é por isso que ela é o coração deste arquivo.
//
// ⚠⚠ SÓ O PERÍODO 2027-2028. Decisão do dono, 01/09/2026. Cada anexo traz SETE vigências
// (2027-2028 · 2029 · 2030 · 2031 · 2032 · 2033+) e as de 2029 em diante dependem das frações de
// redução de ICMS/ISS dos arts. 501 e 508, que NÃO foram transcritas. Gerar 2029+ sem elas seria
// entregar tabela que o motor não sabe aplicar.
//
// ⚠ SÓ LEITURA E ZERO REDE.
//
// Uso:
//   node apps/api/scripts/gerar-anexos-simples-2027.mjs             # confere e reescreve
//   node apps/api/scripts/gerar-anexos-simples-2027.mjs --conferir  # só confere

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const FONTE = path.join(RAIZ, "docs/reforma-consumo/lcp214.htm");
const SAIDA = path.join(RAIZ, "apps/web/src/features/planejamento/lib/anexosSimples2027.data.js");

const SO_CONFERE = process.argv.includes("--conferir");

/** ⚠ O hash da fonte. Trocou o arquivo, a geração para até alguém conferir o que mudou. */
const SHA_ESPERADO = "6f3e19fefd0b4e11839c6ea4a9d18dfaec57b6c1025352b8a83c367a9267ad40";

/**
 * ⚠⚠ AS COLUNAS SÃO DIFERENTES EM CADA ANEXO, e isso não é detalhe: o Anexo II tem IPI, o IV NÃO
 * TEM CPP (a contribuição patronal é recolhida por fora, art. 13 § 5º-C) e o I não tem ISS. Uma
 * lista única de colunas produziria zeros onde a coluna não existe — e zero, aqui, é afirmação.
 */
const ESPERADO = Object.freeze({
  anexos: 5,
  faixasPorAnexo: 6,
  colunas: {
    I: ["IRPJ", "CSLL", "CBS", "CPP", "ICMS", "IBS"],
    II: ["IRPJ", "CSLL", "CBS", "CPP", "IPI", "ICMS", "IBS"],
    III: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
    IV: ["IRPJ", "CSLL", "CBS", "ISS", "IBS"],
    V: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
  },
  /** Medido na fonte: as nominais NÃO mudaram em relação à redação vigente em 2026. */
  nominaisAnexoI: ["4,00", "7,30", "9,50", "10,70", "14,30", "18,90"],
});

function morrer(msg) {
  console.error(`\n⚠⚠ GERAÇÃO ABORTADA — ${msg}\n`);
  console.error("Os anexos NÃO foram reescritos. Alíquota que muda sem alguém conferir é");
  console.error("exatamente o que este gate existe para impedir — e o número sai num PDF que vai");
  console.error("ao cliente.\n");
  process.exit(1);
}

// ─── LEITURA ─────────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(FONTE)) morrer(`fonte não encontrada: ${FONTE}`);
const bytes = fs.readFileSync(FONTE);
const sha = crypto.createHash("sha256").update(bytes).digest("hex");
if (sha !== SHA_ESPERADO) {
  morrer(`o hash da fonte mudou.\n  esperado: ${SHA_ESPERADO}\n  lido:     ${sha}`);
}

// ⚠ latin-1, NÃO utf-8: o Planalto serve em ISO-8859-1. Lido como utf-8, "Alíquota" e "Repartição"
// viram lixo e NENHUMA âncora casa — o extrator acha zero e o gate aborta, que é o certo.
const html = new TextDecoder("latin1").decode(bytes);
const texto = html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, "\n")
  .replace(/&nbsp;/g, " ")
  .replace(/&#186;/g, "º")
  .replace(/&aacute;/g, "á").replace(/&iacute;/g, "í").replace(/&ccedil;/g, "ç")
  .replace(/&eacute;/g, "é").replace(/&oacute;/g, "ó").replace(/&atilde;/g, "ã")
  .replace(/[ \t ]+/g, " ")
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .join(" | ")
  // ⚠⚠ O INDICADOR ORDINAL VEM PARTIDO EM ALGUNS ANEXOS. No Anexo V a 3ª faixa está no HTML como
  // `3 | a | Faixa` — o "ª" é sobrescrito e sai em elemento próprio. Sem esta normalização o
  // extrator lia CINCO faixas nominais e o gate abortava sem dizer que a causa era tipográfica.
  // ⚠ Mesma classe da armadilha do `&#150;` já registrada em `gerar-lista-lc116.mjs`: a fonte
  // oficial é HTML de editor de texto, não dado estruturado.
  .replace(/(\d) \| a \| Faixa/g, "$1ª Faixa");

// ─── EXTRAÇÃO ────────────────────────────────────────────────────────────────────────────────
//
// ⚠⚠ A ÂNCORA É O PAR (anexo da LC 214 → anexo da LC 123), e o RECORTE É A PRIMEIRA VIGÊNCIA.
// Foi ignorar o recorte que produziu o `16,42`/`16,41` na primeira tentativa: sem parar no
// `(Vigência: 1º/1/2029)` seguinte, o regex atravessava para a tabela do ano seguinte.
const ORDEM = [
  ["XVIII", "I"], ["XIX", "II"], ["XX", "III"], ["XXI", "IV"], ["XXII", "V"],
];

function blocoDoAnexo(romanoLc214) {
  const ini = texto.indexOf(`ANEXO ${romanoLc214} `);
  if (ini === -1) morrer(`não achei o "ANEXO ${romanoLc214}" na fonte`);
  const daqui = texto.slice(ini);
  // ⚠ O corte é no PRÓXIMO marcador de vigência, que é onde a tabela de 2027-2028 termina.
  const fim = daqui.indexOf("(Vigência: 1º/1/2029");
  if (fim === -1) morrer(`o "ANEXO ${romanoLc214}" não traz o corte de 2029 — a fonte mudou de forma`);
  const bloco = daqui.slice(0, fim);
  if (!bloco.includes("(Vigência: 1º/1/2027 a 31/12/2028)")) {
    morrer(`o "ANEXO ${romanoLc214}" não declara a vigência 2027-2028 no começo`);
  }
  return bloco;
}

/** `"15,33"` → `0.1533`. Percentual da PARTILHA, sempre com duas casas na fonte. */
function fracao(txt) {
  const n = Number(txt.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) morrer(`percentual ilegível: ${JSON.stringify(txt)}`);
  return n;
}

function extrair(romanoLc214, romanoLc123) {
  const bloco = blocoDoAnexo(romanoLc214);
  const colunasEsperadas = ESPERADO.colunas[romanoLc123];

  // As colunas, LIDAS da fonte — nunca as esperadas. A lista esperada só serve de prova.
  const cab = /Percentual de Repartição \| dos Tributos \|(.*?)\| 1ª Faixa/.exec(bloco);
  if (!cab) morrer(`Anexo ${romanoLc123}: não achei o cabeçalho da partilha`);
  const colunas = cab[1].split("|").map((c) => c.trim()).filter(Boolean)
    // ⚠ O Anexo III e o IV escrevem `ISS (*)` — a nota de rodapé é da LEI, não coluna nova.
    .map((c) => c.replace(/\s*\(\*\)\s*$/, ""));
  if (colunas.join(",") !== colunasEsperadas.join(",")) {
    morrer(`Anexo ${romanoLc123}: colunas divergem.\n  esperado: ${colunasEsperadas}\n  lido:     ${colunas}`);
  }

  // A tabela de cima: alíquota nominal e parcela a deduzir, faixa a faixa.
  //
  // ⚠⚠ FATIADA POR MARCADOR, NÃO CASADA POR UM PADRÃO ÚNICO — e a razão é medida. A célula "Valor
  // a Deduzir" da 1ª faixa aparece em TRÊS formas nesta fonte:
  //
  //     Anexo I     `1ª Faixa | Até 180.000,00 | 4,00% | - | 2ª Faixa`     ← traço
  //     Anexo III   `1ª Faixa | Até 180.000,00 | 6,00% | 2ª Faixa`         ← CÉLULA AUSENTE
  //     (e há a variante com a célula presente e vazia, que o `filter(Boolean)` come)
  //
  // As três dizem a mesma coisa: a 1ª faixa não tem parcela a deduzir. Um padrão único que
  // aceitasse a ausência passaria a engolir o `2` de "2ª Faixa" como dedução — e ninguém veria,
  // porque o resultado continuaria sendo um número plausível. Fatiar entre marcadores torna isso
  // impossível: o que está DEPOIS do próximo `Nª Faixa` não é desta faixa, por construção.
  const nominais = [];
  // ⚠ Só a região ANTES do cabeçalho da partilha: depois dele vêm outros seis `Nª Faixa`, com
  // percentuais, e eles não têm alíquota nem dedução.
  const regiaoNominal = bloco.slice(0, cab.index);
  const marcadores = [...regiaoNominal.matchAll(/(\d)ª Faixa/g)];
  for (let k = 0; k < marcadores.length; k += 1) {
    const desta = marcadores[k];
    const proxima = marcadores[k + 1];
    const trecho = regiaoNominal.slice(desta.index, proxima ? proxima.index : undefined);
    const celulas = trecho.split("|").map((c) => c.trim()).filter(Boolean);
    // A alíquota é a única célula com `%`. Sem ela, a fatia não é uma linha de faixa.
    const iAliquota = celulas.findIndex((c) => /^[\d,]+%$/.test(c));
    if (iAliquota === -1) continue;
    const seguinte = celulas[iAliquota + 1];
    // ⚠ Dedução ausente, `-`, ou vazia ⇒ 0. Qualquer outra coisa tem de ser número, ou `fracao`
    // aborta — nunca se adivinha o que uma célula estranha quis dizer.
    const temDeducao = seguinte != null && seguinte !== "-" && /^[\d.,]+$/.test(seguinte);
    nominais.push({
      faixa: Number(desta[1]),
      aliquota: fracao(celulas[iAliquota].replace("%", "")),
      deduzir: temDeducao ? fracao(seguinte) : 0,
    });
  }

  // ⚠⚠⚠ A 6ª FAIXA TEM COLUNAS PRÓPRIAS, e descobrir isso foi o que o portão da soma entregou.
  // A primeira versão exigia 6 faixas com `colunas.length` valores cada e abortou com "li 5 faixas
  // de partilha". A 6ª não estava malformada: ela tem, em TODOS os cinco anexos, **exatamente duas
  // colunas a menos** — cai o imposto do ente subnacional (ICMS ou ISS) **e cai o IBS**.
  //
  //     Anexo I    6 → 4    13,58 · 10,06 · 34,02 · 42,34            (sem ICMS, sem IBS)
  //     Anexo II   7 → 5    8,53 · 7,53 · 25,22 · 23,59 · 35,13      (mantém IPI)
  //     Anexo III  6 → 4    35,09 · 15,04 · 19,29 · 30,58            (sem ISS, sem IBS)
  //     Anexo IV   5 → 3    53,71 · 21,59 · 24,70
  //     Anexo V    6 → 4    35,10 · 15,54 · 19,78 · 29,58
  //
  // Todas somam exatamente 100%.
  //
  // ⚠⚠ ISSO É O SUBLIMITE (LC 123, art. 13-A): na 6ª faixa o ICMS/ISS sai do DAS e é recolhido por
  // fora — e o IBS, que ocupa o lugar deles, sai junto. **Não é lacuna de dado: é a lei.**
  //
  // ⚠⚠ E TEM CONSEQUÊNCIA DIRETA NO CRÉDITO "POR DENTRO": quem está na 6ª faixa transfere crédito
  // calculado **só sobre a CBS**, porque não há parcela de IBS dentro do regime único para
  // transferir. Ler a 6ª faixa com as colunas das outras cinco produziria um crédito de IBS que a
  // empresa não paga — num número que vai impresso ao cliente.
  // ⚠⚠ O CORTE NA NOTA `(*)` — sem ele o Anexo III lia DOZE faixas de partilha.
  // Os anexos de SERVIÇO (III, IV e V) trazem, depois da tabela, uma SEGUNDA tabela para a 5ª
  // faixa com alíquota efetiva acima de ~14,93%, por causa do teto de 5% do ISS. E as células dela
  // não são percentuais: são FÓRMULAS —
  //
  //     "(Alíquota efetiva - 5%) x 6,02%"
  //
  // O padrão de partilha casava o `6,02%` de dentro da fórmula e o contava como se fosse a
  // repartição de mais uma faixa. ⚠⚠ Números tirados de uma fórmula, gravados como se fossem a
  // partilha, seriam alíquota inventada num arquivo que se apresenta como transcrição da lei.
  //
  // ⚠ ELA NÃO ESTÁ SENDO IGNORADA POR DESCUIDO: o teto de 5% do ISS é regra de verdade (e a LC
  // 227/2026 acrescentou o `§ 1º-B` ao art. 23 estendendo a lógica ao IBS). Encodá-la é decisão
  // à parte, e ela não muda o crédito de CBS/IBS que esta entrega calcula — só a repartição do
  // ISS dentro do DAS na 5ª faixa de quem tem alíquota alta.
  const noteIndex = bloco.indexOf("(*) O percentual efetivo");
  const ateAsFaixas = noteIndex === -1 ? bloco : bloco.slice(0, noteIndex);
  const depois = ateAsFaixas.slice(cab.index + cab[0].length - "1ª Faixa".length);
  const partilha = [];
  // ⚠ Sem quantidade fixa no padrão: ela varia por faixa. O tamanho é CONFERIDO abaixo, faixa a
  // faixa, contra as colunas que aquela faixa deve ter.
  // ⚠ `(?: \(\*\))?` — o Anexo III cola a marca de rodapé na célula do ISS na 5ª faixa
  // (`33,50% (*)`), e sem tolerá-la a sequência quebrava ali e o `0,17%` do IBS era perdido: a
  // faixa saía com 5 valores e somando 99,83%. O `(*)` é a nota do teto de 5% do ISS, não um dado.
  const rePartilha = /(\d)ª Faixa \| ((?:[\d,]+%(?: \(\*\))?(?: \| )?)+)/g;
  for (let m = rePartilha.exec(depois); m; m = rePartilha.exec(depois)) {
    const vals = m[2].split("|")
      .map((v) => v.replace("(*)", "").replace("%", "").trim())
      .filter(Boolean)
      .map(fracao);
    partilha.push({ faixa: Number(m[1]), valores: vals });
  }

  return { colunas, nominais, partilha };
}

// ─── AS PROVAS ───────────────────────────────────────────────────────────────────────────────
const anexos = {};
/** As faixas cuja partilha não fecha exatamente 100% NA FONTE — ver a tolerância, abaixo. */
const arredondamentos = [];
for (const [lc214, lc123] of ORDEM) {
  const { colunas, nominais, partilha } = extrair(lc214, lc123);

  if (nominais.length !== ESPERADO.faixasPorAnexo) {
    morrer(`Anexo ${lc123}: li ${nominais.length} faixas nominais, esperava ${ESPERADO.faixasPorAnexo}`);
  }
  if (partilha.length !== ESPERADO.faixasPorAnexo) {
    morrer(`Anexo ${lc123}: li ${partilha.length} faixas de partilha, esperava ${ESPERADO.faixasPorAnexo}`);
  }

  const faixas = [];
  for (let i = 0; i < ESPERADO.faixasPorAnexo; i += 1) {
    const n = nominais[i];
    const p = partilha[i];
    if (n.faixa !== i + 1 || p.faixa !== i + 1) {
      morrer(`Anexo ${lc123}: as faixas saíram fora de ordem (${n.faixa}/${p.faixa} na posição ${i + 1})`);
    }

    // ⚠⚠⚠ A PROVA QUE PEGOU O DEFEITO DA PRIMEIRA TENTATIVA. A partilha de uma faixa reparte 100%
    // do DAS daquela faixa — não 99,9 e não 100,01. Somar diferente significa que o extrator
    // atravessou para a tabela de outra vigência, ou perdeu uma coluna. Nos dois casos o número
    // que sairia no PDF estaria errado, e ninguém conferiria.
    const soma = p.valores.reduce((a, b) => a + b, 0);
    // ⚠⚠ A TOLERÂNCIA É DE 0,01 PONTO, E ELA EXISTE PORQUE A LEI ARREDONDA — não por conveniência.
    // Medido no texto oficial: o Anexo III (Anexo XX da LC 214), 3ª e 4ª faixas, soma **100,01%**:
    //     4,00 + 3,50 + 16,42 + 43,40 + 32,50 + 0,19 = 100,01
    // Não é o extrator: está assim no HTML do Planalto, conferido caractere a caractere.
    // ⚠ MAS O DESVIO NÃO PODE FICAR CALADO — arredondamento silencioso é como uma coluna a mais ou
    // a menos passa despercebida. Toda faixa que precisar da tolerância é REGISTRADA e sai impressa
    // no cabeçalho do arquivo gerado, com o valor. Quem ler o dado vê a divergência da fonte.
    if (Math.abs(soma - 100) > 0.0001) {
      arredondamentos.push({ anexo: lc123, faixa: i + 1, soma: Number(soma.toFixed(2)) });
    }
    if (Math.abs(soma - 100) > 0.011) {
      morrer(`Anexo ${lc123}, ${i + 1}ª faixa: a partilha soma ${soma.toFixed(2)}%, não 100%.\n`
        + `  valores: ${p.valores.join(" | ")}\n`
        + "  É EXATAMENTE este o erro que a extração por regex solta cometeu antes: o corte de\n"
        + "  vigência falhou e duas tabelas se misturaram.");
    }

    // ⚠⚠ O MAPEAMENTO É POR NOME, e as colunas que faltam na 6ª faixa são NOMEADAS — nunca "as
    // duas últimas, por posição". A ordem do cabeçalho é `… ICMS | IBS` no I/II e `… ISS | IBS` no
    // III/IV/V; ler por índice acertaria hoje e erraria calado no dia em que a ordem mudasse.
    const foraDoDasNaSexta = ["ICMS", "ISS", "IBS"];
    const esperadas = i + 1 === 6 ? colunas.filter((c) => !foraDoDasNaSexta.includes(c)) : colunas;
    if (p.valores.length !== esperadas.length) {
      const naSexta = i + 1 === 6
        ? " Na 6a faixa o ICMS/ISS e o IBS saem do DAS (sublimite, art. 13-A) — ela tem DUAS colunas"
          + " a menos. Se a fonte mudou isso, a conta do credito muda junto."
        : " A fonte mudou de forma, ou o corte de vigencia falhou e duas tabelas se misturaram.";
      morrer(`Anexo ${lc123}, ${i + 1}a faixa: li ${p.valores.length} percentuais, esperava `
        + `${esperadas.length} (${esperadas.join("/")}).${naSexta}`);
    }

    const porTributo = {};
    esperadas.forEach((c, j) => { porTributo[c] = p.valores[j]; });
    // ⚠ `null`, nunca `0`: "este tributo não está no DAS" não é "a partilha dele é zero por cento".
    // Colapsar as duas é como o consumidor passa a somar uma parcela que a empresa não paga.
    for (const c of colunas) if (!(c in porTributo)) porTributo[c] = null;
    faixas.push({ faixa: i + 1, aliquota: n.aliquota, deduzir: n.deduzir, partilha: porTributo });
  }

  // ⚠ CBS e IBS têm de existir em TODOS — é a razão de este arquivo existir.
  for (const t of ["CBS", "IBS"]) {
    if (!colunas.includes(t)) morrer(`Anexo ${lc123}: não tem coluna de ${t}. A fonte não é a de 2027.`);
  }
  anexos[lc123] = { colunas, faixas };
}

// ⚠ As nominais do Anexo I são a prova de que a fonte é a certa: elas NÃO mudaram em relação à
// redação de 2026, e é isso que separa "o anexo novo" de "um anexo qualquer".
const lidasI = anexos.I.faixas.map((f) => f.aliquota.toFixed(2).replace(".", ","));
if (lidasI.join(",") !== ESPERADO.nominaisAnexoI.join(",")) {
  morrer(`as alíquotas nominais do Anexo I divergem.\n  esperado: ${ESPERADO.nominaisAnexoI}\n  lido:     ${lidasI}`);
}

// ─── ESCRITA ─────────────────────────────────────────────────────────────────────────────────
const cabecalho = `// ⚠⚠ ARQUIVO GERADO — NÃO EDITAR À MÃO.
//
// Fonte: docs/reforma-consumo/lcp214.htm (Planalto, texto compilado, ISO-8859-1)
//        SHA-256 ${sha}
// Gerador: apps/api/scripts/gerar-anexos-simples-2027.mjs
//
// ANEXOS I A V DA LC 123/2006 na redação dada pelo art. 519 da LC 214/2025 (Anexos XVIII a XXII
// daquela lei). ⚠⚠ VIGÊNCIA: 1º/01/2027 a 31/12/2028 — e SÓ ela está aqui.
//
// ⚠⚠ EM 2026 ESTES ANEXOS NÃO VALEM. O art. 544, III da LC 214 (redação da LC 227/2026) só põe o
// art. 519 em vigor em 1º/01/2027; até lá valem os anexos antigos, sem CBS e sem IBS na partilha.
// ⚠⚠ E PARA O OPTANTE DO SIMPLES, EM 2026, IBS E CBS SÃO ZERO: art. 348, III, "c" — as alíquotas
// de teste "não serão aplicadas em relação às operações dos contribuintes optantes pelo Simples
// Nacional".
//
// ⚠ As alíquotas NOMINAIS e as parcelas a deduzir NÃO mudaram. O que mudou foi a REPARTIÇÃO:
// COFINS + PIS deram lugar a CBS, e uma fatia pequena virou IBS (Anexo I, 1ª faixa:
// CBS 15,33% + IBS 0,17% = os 15,50% que eram COFINS 12,74% + PIS 2,76%).
//
// ⚠ As COLUNAS diferem por anexo: o II tem IPI, o IV NÃO tem CPP (patronal por fora, art. 13
// § 5º-C) e o I não tem ISS. Ler por índice em vez de por nome é como se erra isso.
//
// Cada faixa foi provada: a partilha soma 100%, com tolerância de 0,01 ponto.
${arredondamentos.length === 0
  ? "// ⚠ Nenhuma faixa precisou da tolerância nesta geração."
  : `// ⚠⚠ AS FAIXAS ABAIXO NÃO FECHAM 100% NA FONTE — é arredondamento da própria lei, conferido no
// HTML do Planalto, e fica registrado aqui para ninguém achar que é erro de leitura:
${arredondamentos.map((a) => `//   Anexo ${a.anexo}, ${a.faixa}a faixa: soma ${String(a.soma).replace(".", ",")}%`).join(String.fromCharCode(10))}`}

`;

const corpo = `export const ANEXOS_SIMPLES_2027 = ${JSON.stringify(anexos, null, 2)};

/** A vigência, para a tela poder IMPRIMI-LA. Número sem vigência não se confere depois. */
export const VIGENCIA_ANEXOS_2027 = Object.freeze({
  inicio: "2027-01-01",
  fim: "2028-12-31",
  fundamento: "LC 214/2025, art. 519 (Anexos XVIII a XXII); vigência pelo art. 544, III, na redação da LC 227/2026",
});
`;

if (SO_CONFERE) {
  console.log("✓ fonte conferida (hash bate), 5 anexos, 6 faixas cada, partilha somando 100%.");
  for (const a of arredondamentos) {
    console.log(`  ⚠ Anexo ${a.anexo}, ${a.faixa}ª faixa soma ${a.soma}% NA FONTE (arredondamento da lei)`);
  }
  for (const [k, v] of Object.entries(anexos)) {
    const f = v.faixas[0];
    console.log(`  Anexo ${k.padEnd(3)} colunas=${v.colunas.join("/")}  1ª faixa CBS=${f.partilha.CBS}% IBS=${f.partilha.IBS}%`);
  }
  process.exit(0);
}

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, cabecalho + corpo, "utf8");
console.log(`✓ escrito: ${path.relative(RAIZ, SAIDA)}`);
for (const [k, v] of Object.entries(anexos)) {
  console.log(`  Anexo ${k.padEnd(3)} ${v.colunas.join("/")}`);
}
