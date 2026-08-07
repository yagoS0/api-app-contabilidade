#!/usr/bin/env node
/**
 * BAIXA AS TABELAS DE CÓDIGOS DA EFD-CONTRIBUIÇÕES da fonte oficial.
 *
 * ⚠ POR QUE ISTO É UM SCRIPT, E NÃO UM ARQUIVO COPIADO UMA VEZ:
 * as tabelas 4.3.x / 4.4.x são **dados por vigência**, não constantes. Cada linha traz `Data de
 * Início` e `Data de Fim`, e só em 2026 elas mudaram quatro vezes (LC 228/2026 em 30/03, um lote
 * em 16/04, Lei 15.394/2026 em 03/05). Hardcodá-las repetiria o erro que `tabelasFiscais.js`
 * existe para não cometer. Rodar de novo é a forma de atualizar.
 *
 * ⚠ E POR QUE ELE É FEIO: a fonte oficial não publica as tabelas como arquivo com URL. Ela publica
 * um consultor ASP.NET WebForms
 * (`ConsultaTabelasExternas.aspx?CodSistema=SpedPisCofins`) com dois `<select>` encadeados por
 * postback. Não há JSON, não há CSV, não há rota de download. O que este script faz é exercer o
 * postback do jeito que o navegador exerceria — nada aqui é engenharia reversa de API privada;
 * é a mesma página pública, sem o navegador.
 *
 * ⚠ POSTBACK COMPLETO DE PROPÓSITO. Os selects vivem num UpdatePanel e o navegador faz postback
 * PARCIAL (delta pipe-delimited). Pedir a página inteira devolve HTML normal e evita ter de
 * interpretar o formato de delta — que é detalhe interno do ASP.NET e mudaria sem aviso.
 *
 * Uso:  node scripts/baixar-tabelas-efd-contribuicoes.mjs [--out <dir>]
 * Saída: <dir>/tabelas-<AAAA-MM-DD>.json + índice legível no README daquele diretório.
 */

import fs from "node:fs";
import path from "node:path";

const BASE = "http://www.sped.fazenda.gov.br/spedtabelas/AppConsulta/publico/aspx/ConsultaTabelasExternas.aspx";
const URL_CONSULTA = `${BASE}?CodSistema=SpedPisCofins`;
const CAMPO_PACOTE = "ctl00$ContentPlaceHolder1$ddlPacotes";
const CAMPO_TABELA = "ctl00$ContentPlaceHolder1$ddlTabelas";
/** O GridView que renderiza a tabela — é ele que recebe o postback de troca de página. */
const GRID = "ctl00$ContentPlaceHolder1$grdConteudo";

/** Freio contra laço infinito, folgado o bastante para caber a maior (Municípios, ~5.570 linhas). */
const LIMITE_PAGINAS = 300;

const argOut = process.argv.indexOf("--out");
const DIR_SAIDA = argOut > -1 ? process.argv[argOut + 1] : "docs/leiaute-efd-contribuicoes/tabelas";

// ── HTML sem dependência ────────────────────────────────────────────────────────────────────────
// O projeto não tem cheerio nem jsdom, e adicionar um parser inteiro para ler três estruturas de
// uma página só não paga. As três funções abaixo são deliberadamente burras: elas assumem HTML bem
// formado do WebForms, que é gerado por máquina e não muda de forma.

const semTags = (s) =>
  s.replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();

function campoOculto(html, nome) {
  const re = new RegExp(`<input[^>]*name="${nome.replace(/\$/g, "\\$")}"[^>]*>`, "i");
  const tag = html.match(re)?.[0] || "";
  return tag.match(/value="([^"]*)"/)?.[1] || "";
}

function opcoes(html, nomeSelect) {
  const re = new RegExp(`<select[^>]*name="${nomeSelect.replace(/\$/g, "\\$")}"[^>]*>([\\s\\S]*?)</select>`, "i");
  const bloco = html.match(re)?.[1];
  if (!bloco) return [];
  return [...bloco.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)]
    .filter((m) => m[1])
    .map((m) => ({ valor: m[1], nome: semTags(m[2]) }));
}

/**
 * As linhas do GridView — o grid pelo ID, não "a maior tabela da página".
 *
 * ⚠ NÃO exigir a coluna "Data de Início". A primeira versão exigia, e descartou em silêncio
 * justamente as tabelas de CÓDIGO DE RECEITA (4.4.1 e 4.4.2), que são as que o M205/M605 precisa —
 * elas não têm coluna de vigência.
 *
 * ⚠ A LINHA DO PAGINADOR É DESCARTADA PELA MARCAÇÃO (`<tr>` que contém `Page$`), NUNCA pelo
 * conteúdo. Uma versão anterior descartava "linha cujas células são todas dígitos e cuja contagem
 * bate com o número de páginas" — e apagou TODAS as linhas da `Tabela de Limite de entrega`, cujos
 * dados são justamente quatro colunas de datas em dígitos. Heurística sobre conteúdo apaga dado
 * verdadeiro sem avisar; a marcação diz o que a linha É.
 */
function linhasDoGrid(html) {
  const grid = html.match(/<table[^>]*id="ctl00_ContentPlaceHolder1_grdConteudo"[\s\S]*?<\/table>/i)?.[0];
  if (!grid) return null;
  const linhas = [...grid.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
    .filter((r) => !/Page\$/.test(r[0]))
    .map((r) => [...r[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => semTags(c[0])))
    .filter((l) => l.length);
  return linhas.length > 1 ? linhas : null;
}

// ── Sessão ──────────────────────────────────────────────────────────────────────────────────────
let cookies = "";
function guardarCookies(res) {
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const par = c.split(";")[0];
    const nome = par.split("=")[0];
    const restantes = cookies.split("; ").filter((x) => x && x.split("=")[0] !== nome);
    cookies = [...restantes, par].join("; ");
  }
}

async function pegar(url) {
  const res = await fetch(url, { headers: cookies ? { Cookie: cookies } : {}, redirect: "follow" });
  guardarCookies(res);
  return { html: await res.text(), url: res.url };
}

/**
 * ⚠ O GRID PAGINA DE 50 EM 50, e o paginador vem como uma LINHA DA PRÓPRIA TABELA — então uma
 * colheita ingênua devolve 50 linhas de dados + uma linha `["1","2","3","4"]` e parece completa.
 * Foi exatamente o que aconteceu na primeira rodada: 22 das 74 tabelas vieram truncadas na página
 * 1, incluindo a 4.3.13 (alíquota zero), e o total de 2.020 linhas passava por número redondo.
 *
 * Truncar em silêncio é o pior modo de falhar aqui: um código de produto que existe na página 3 e
 * não no nosso dump vira "código inválido" na hora de escriturar — ou, pior, vira outro código.
 */
function temPaginador(html) {
  return /__doPostBack\('ctl00\$ContentPlaceHolder1\$grdConteudo','Page\$/.test(html);
}

async function postar(htmlAtual, alvo, valores, argumento = "") {
  const corpo = new URLSearchParams({
    __EVENTTARGET: alvo,
    __EVENTARGUMENT: argumento,
    __VIEWSTATE: campoOculto(htmlAtual, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: campoOculto(htmlAtual, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: campoOculto(htmlAtual, "__EVENTVALIDATION"),
    ...valores,
  });
  const res = await fetch(URL_CONSULTA, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookies ? { Cookie: cookies } : {}) },
    body: corpo,
    redirect: "follow",
  });
  guardarCookies(res);
  return { html: await res.text(), url: res.url };
}

// ── Colheita ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const inicio = await pegar(URL_CONSULTA);
  const pacotes = opcoes(inicio.html, CAMPO_PACOTE);
  if (!pacotes.length) {
    console.error("Nenhum pacote na página — a fonte mudou de forma. Confira a URL antes de mexer no parser.");
    process.exit(1);
  }
  console.log(`${pacotes.length} pacotes.`);

  const itens = [];
  const recusadas = [];

  for (const p of pacotes) {
    const rp = await postar(inicio.html, CAMPO_PACOTE, { [CAMPO_PACOTE]: p.valor, [CAMPO_TABELA]: "" });
    if (/Erro\.aspx/i.test(rp.url)) {
      recusadas.push({ pacote: p.nome, tabela: null, motivo: motivoDoErro(rp.url) });
      continue;
    }
    const tabelas = opcoes(rp.html, CAMPO_TABELA);
    console.log(`  ${p.nome}: ${tabelas.length} tabelas`);

    for (const t of tabelas) {
      const rt = await postar(rp.html, CAMPO_TABELA, { [CAMPO_PACOTE]: p.valor, [CAMPO_TABELA]: t.valor });
      // ⚠ O PRÓPRIO SERVIDOR recusa algumas ("A versão da tabela N não possui estrutura") com um
      // REDIRECT para Erro.aspx. Isso não é falha nossa e não pode abortar a colheita — vira item
      // registrado. Foi o que derrubou a primeira tentativa no meio.
      if (/Erro\.aspx/i.test(rt.url)) {
        recusadas.push({ pacote: p.nome, tabela: t.nome, motivo: motivoDoErro(rt.url) });
        continue;
      }
      const primeira = linhasDoGrid(rt.html);
      if (!primeira) {
        recusadas.push({ pacote: p.nome, tabela: t.nome, motivo: "resposta sem grid de dados" });
        continue;
      }

      const cabecalho = primeira[0];
      const linhas = primeira.slice(1);
      const vistas = new Set(linhas.map((l) => l.join("")));
      let paginasLidas = 1;
      let truncada = null;

      // ⚠ PAGINAÇÃO POR ÍNDICE, COM O FIM DESCOBERTO POR EXAUSTÃO. As duas metades são cicatriz:
      //  · o paginador mostra uma JANELA ("… 4 5 6 …"), então o maior número visível NÃO é o total —
      //    ler dali dava 11 páginas para a Tabela de Municípios, que tem milhares de linhas;
      //  · e `Page$Next` o servidor RECUSA (redirect para Erro.aspx sem mensagem). Só `Page$N` vale.
      // Então pede 2, 3, 4… e para quando o servidor recusa ou a página não traz nada novo.
      let htmlPagina = rt.html;
      if (temPaginador(rt.html)) {
        for (let pg = 2; pg <= LIMITE_PAGINAS; pg += 1) {
          const rpg = await postar(htmlPagina, GRID, { [CAMPO_PACOTE]: p.valor, [CAMPO_TABELA]: t.valor }, `Page$${pg}`);
          if (/Erro\.aspx/i.test(rpg.url)) break; // fim natural: essa página não existe
          const grade = linhasDoGrid(rpg.html);
          if (!grade) break;
          // A última página se repete quando se pede além dela. Sem esta parada o arquivo engordaria
          // com duplicatas parecendo dado novo.
          const novas = grade.slice(1).filter((l) => !vistas.has(l.join("")));
          if (!novas.length) break;
          for (const l of novas) vistas.add(l.join(""));
          linhas.push(...novas);
          paginasLidas = pg;
          htmlPagina = rpg.html;
          if (pg === LIMITE_PAGINAS) truncada = `parou no limite de ${LIMITE_PAGINAS} páginas`;
        }
      }

      // ⚠ Truncamento vira REGISTRO, não silêncio: um código que existe na página 12 e não no nosso
      // dump vira "código inválido" na escrituração — ou, pior, vira outro código.
      if (truncada) recusadas.push({ pacote: p.nome, tabela: t.nome, motivo: `INCOMPLETA — ${truncada}` });

      itens.push({ pacote: p.nome, id: t.valor, nome: t.nome, paginas: paginasLidas, completa: !truncada, cabecalho, linhas });
      if (paginasLidas > 1) console.log(`    ${t.nome.slice(0, 56)} — ${paginasLidas} pág., ${linhas.length} linhas${truncada ? " ⚠ INCOMPLETA" : ""}`);
    }
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const saida = {
    fonte: URL_CONSULTA,
    sistema: "SpedPisCofins",
    baixadoEm: hoje,
    // ⚠ Contagem de recusadas fica NO ARQUIVO. Um dump que só lista o que veio não deixa ninguém
    // perceber que faltou coisa — e aqui faltar uma tabela de código de receita é diferença entre
    // escriturar certo e escriturar errado.
    totalTabelas: itens.length,
    totalLinhas: itens.reduce((a, i) => a + i.linhas.length, 0),
    recusadas,
    tabelas: itens,
  };

  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  const arquivo = path.join(DIR_SAIDA, `tabelas-${hoje}.json`);
  fs.writeFileSync(arquivo, JSON.stringify(saida, null, 2), "utf8");

  console.log(`\n${itens.length} tabelas, ${saida.totalLinhas} linhas → ${arquivo}`);
  if (recusadas.length) {
    console.log(`\n${recusadas.length} recusada(s):`);
    for (const r of recusadas) console.log(`  · ${r.tabela || "(pacote inteiro)"} — ${r.motivo}`);
  }
}

function motivoDoErro(url) {
  try {
    return decodeURIComponent(url.split("msg=")[1] || "").trim() || "servidor recusou sem mensagem";
  } catch {
    return "servidor recusou";
  }
}

main().catch((e) => {
  console.error("Falhou:", e.message);
  process.exit(1);
});
