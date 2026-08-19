#!/usr/bin/env node
// GERADOR DA LISTA OFICIAL DE CÓDIGOS DE TRIBUTAÇÃO NACIONAL (cTribNac) — só leitura, zero rede.
//
// Lê o XLSX oficial versionado em `docs/lista-servico-nacional/` e regrava
// `apps/web/src/lib/servicosNacionais/servicosNacionais.data.js` e o gêmeo em
// `apps/portal-cliente-web/src/lib/servicosNacionais/servicosNacionais.data.js`.
//
// ⚠ POR QUE UM GERADOR, se a lista de municípios do IBGE só tem instruções no cabeçalho.
// Porque esta planilha tem UMA ARMADILHA MEDIDA: a coluna "CÓDIGO DE TRIBUTAÇÃO NACIONAL" é
// NUMÉRICA, e `010101` sai do arquivo como o número `10101` — o zero à esquerda some. Transcrever
// à mão (ou "olhar e copiar") produz 335 códigos dos quais dezenas ficam com 5 dígitos, e o
// `cTribNac` da DPS tem 6. Um gerador com autoverificação não erra isso duas vezes.
//
// ⚠ A AUTOVERIFICAÇÃO É O PONTO. O código nacional é `item(2) + subitem(2) + desdobro nacional(2)`,
// e a planilha traz as três partes em colunas próprias. O gerador **exige** que o código lido com
// padding para 6 seja idêntico ao concatenado a partir das três colunas, linha a linha. Se um dia
// a planilha mudar de forma, ele para em vez de gravar dado torto.
//
// Uso:
//   node apps/api/scripts/gerar-lista-servico-nacional.mjs
//
// (Rodar da raiz do monorepo — o `xlsx` está hoisted em `node_modules/`.)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../../..");

const XLSX_PATH = resolve(
  RAIZ,
  "docs/lista-servico-nacional/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx",
);
// ⚠ DOIS DESTINOS, E ELES SÃO O MESMO ARQUIVO. Os dois portais consomem a lista e não compartilham
// código (mesmo arranjo de `municipiosIbge.data.js`, `consultaTomador.js` e `reaproveitarNota.js`).
// Gerar nos dois AQUI é o que impede a divergência: uma atualização do Anexo B que só chegasse a um
// deles apareceria como "a tela ofereceu e o servidor recusou" — no portal que ninguém testou.
const SAIDAS = [
  resolve(
  RAIZ,
  "apps/web/src/lib/servicosNacionais/servicosNacionais.data.js",
  ),
  resolve(
  RAIZ,
  "apps/portal-cliente-web/src/lib/servicosNacionais/servicosNacionais.data.js",
  ),
];

const ABA = "LISTA.SERV.NAC.";
const URL_OFICIAL =
  "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx";
const PAGINA_OFICIAL =
  "https://www.gov.br/nfse/pt-br/mei-e-demais-empresas/codigos-de-tributacao-nacional-nbs";

// A data da extração do arquivo que está em `docs/`. Trocar SÓ quando o XLSX for rebaixado.
const EXTRAIDO_EM = "2026-08-16";

function pad2(v) {
  return String(v ?? "").trim().padStart(2, "0");
}

function morrer(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const bytes = readFileSync(XLSX_PATH);
const sha256 = createHash("sha256").update(bytes).digest("hex");

const wb = XLSX.read(bytes, { type: "buffer" });
if (!wb.SheetNames.includes(ABA)) {
  morrer(`aba "${ABA}" não encontrada. Abas: ${wb.SheetNames.join(", ")}`);
}

const linhas = XLSX.utils.sheet_to_json(wb.Sheets[ABA], {
  header: 1,
  raw: true,
  defval: null,
});

const cabecalho = (linhas[0] || []).map((c) => String(c ?? "").trim());
const ESPERADO = [
  "CÓDIGO DE TRIBUTAÇÃO NACIONAL",
  "ITEM",
  "SUBITEM",
  "DESDOBRO NACIONAL",
  "DESCRIÇÃO",
];
if (ESPERADO.some((nome, i) => cabecalho[i] !== nome)) {
  morrer(
    `cabeçalho mudou.\n  esperado: ${JSON.stringify(ESPERADO)}\n  lido:     ${JSON.stringify(cabecalho)}`,
  );
}

const servicos = [];
const grupos = [];
const vistos = new Set();

linhas.slice(1).forEach((linha, i) => {
  const numeroDaLinha = i + 2; // 1-based, com o cabeçalho
  const [codigoBruto, item, subitem, desdobro, descricao] = linha;
  const texto = String(descricao ?? "").trim();
  if (!texto) morrer(`linha ${numeroDaLinha}: descrição vazia`);

  // ⚠ LINHA SEM CÓDIGO É CABEÇALHO DE AGRUPAMENTO, não serviço selecionável. Ela dá o nome do
  // ITEM (subitem 0) ou do SUBITEM (subitem > 0, desdobro 0) — que é o que permite achar o código
  // na tela pelo texto do grupo. Jogá-las fora perderia o rótulo do grupo.
  const cru = String(codigoBruto ?? "").replace(/\D+/g, "");
  if (!cru) {
    if (Number(desdobro) !== 0) {
      morrer(`linha ${numeroDaLinha}: linha sem código com desdobro ${desdobro} (esperado 0)`);
    }
    const chave = Number(subitem) === 0 ? pad2(item) : `${pad2(item)}${pad2(subitem)}`;
    grupos.push([chave, texto]);
    return;
  }

  // ⚠ AQUI MORA A ARMADILHA: `010101` chega como o número 10101.
  const codigo = cru.padStart(6, "0");
  const montado = `${pad2(item)}${pad2(subitem)}${pad2(desdobro)}`;
  if (codigo !== montado) {
    morrer(
      `linha ${numeroDaLinha}: código "${codigo}" não bate com item/subitem/desdobro "${montado}". ` +
        "A planilha mudou de forma — conferir antes de gravar.",
    );
  }
  if (codigo.length !== 6) morrer(`linha ${numeroDaLinha}: código "${codigo}" não tem 6 dígitos`);
  if (vistos.has(codigo)) morrer(`linha ${numeroDaLinha}: código duplicado "${codigo}"`);
  vistos.add(codigo);
  servicos.push([codigo, texto]);
});

if (!servicos.length) morrer("nenhum código lido");

const js = (v) => JSON.stringify(v);

const conteudo = `// LISTA OFICIAL DE CÓDIGOS DE TRIBUTAÇÃO NACIONAL (cTribNac) — DADO, não regra. Gerado, não escrito.
//
// ⚠ ARQUIVO GERADO. Não editar à mão.
//   node apps/api/scripts/gerar-lista-servico-nacional.mjs
//
// FONTE: ${URL_OFICIAL}
//        (página: ${PAGINA_OFICIAL})
// ARQUIVO: docs/lista-servico-nacional/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx
//          SHA-256 ${sha256}
// ABA: ${ABA}
// EXTRAÍDO EM: ${EXTRAIDO_EM}
// REGISTROS: ${servicos.length} códigos selecionáveis + ${grupos.length} linhas de agrupamento
//            (${linhas.length - 1} linhas de dados na planilha).
//
// ⚠ O cTribNac NÃO É O ITEM DA LC 116. Ele é \`item(2) + subitem(2) + desdobro nacional(2)\` = 6
// dígitos. O item LC 116 \`31.01\` é "serviços técnicos em … telecomunicações e congêneres"; o
// código nacional \`310104\` é o desdobramento "Serviços técnicos em telecomunicações" — e é esse
// que aparece no DANFSe. Carregar só o anexo da LC 116 daria a granularidade ERRADA, e o erro
// sairia como nota emitida com o serviço errado.
//
// ⚠ A ARMADILHA DA PLANILHA, MEDIDA: a coluna do código é NUMÉRICA, e \`010101\` sai do arquivo
// como o número \`10101\` — o zero à esquerda some. Os códigos abaixo estão com padding para 6, e
// o gerador PROVA o padding conferindo cada um contra as colunas ITEM/SUBITEM/DESDOBRO da própria
// planilha (${servicos.length}/${servicos.length} conferem; qualquer divergência aborta a geração).
//
// ⚠ LINHAS SEM CÓDIGO NA PLANILHA SÃO AGRUPAMENTO, não serviço. Elas dão o nome do ITEM e do
// SUBITEM, e é por isso que estão aqui em \`GRUPOS_SERVICO_NACIONAL\` em vez de descartadas: é o
// texto do grupo que faz alguém achar o código certo. Elas NÃO são selecionáveis.
//
// ⚠ ESTA LISTA VAI ENVELHECER (a Receita publica novas versões do Anexo B). PARA ATUALIZAR:
//   1. baixe o XLSX da URL acima para \`docs/lista-servico-nacional/\`;
//   2. atualize o hash e a data em \`docs/lista-servico-nacional/README.md\`;
//   3. ajuste \`EXTRAIDO_EM\` no gerador e rode-o;
//   4. rode \`npm test -w @contabilidade/web\` — há teste travando contagem, padding e o primeiro
//      código da lista (\`010101\`, nunca \`10101\`).
//
// Formato: \`[código (6 dígitos), descrição]\`. Tupla em vez de objeto porque são ${servicos.length} linhas;
// o arquivo é carregado por import() dinâmico e não entra no bundle inicial.

export const SERVICOS_NACIONAIS = [
${servicos.map(([c, d]) => `  [${js(c)},${js(d)}],`).join("\n")}
];

// Agrupamento: \`[chave, descrição]\`. Chave de 2 dígitos = ITEM (ex.: "01"); de 4 = SUBITEM
// (ex.: "0101"). São os PREFIXOS do próprio código — nada aqui é derivado por semelhança de texto.
export const GRUPOS_SERVICO_NACIONAL = [
${grupos.map(([c, d]) => `  [${js(c)},${js(d)}],`).join("\n")}
];
`;

for (const saida of SAIDAS) writeFileSync(saida, conteudo, "utf8");

for (const saida of SAIDAS) console.log(`✓ ${saida}`);
console.log(`  ${servicos.length} códigos · ${grupos.length} grupos`);
console.log(`  primeiro: ${servicos[0][0]} — ${servicos[0][1]}`);
console.log(`  sha256 do XLSX: ${sha256}`);
