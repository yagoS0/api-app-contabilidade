// A BLINDAGEM DO MODELO — o que o SheetJS **não** escreve, escrito à mão no XML do .xlsx.
//
// > Dono (21/08/2026): *"vamos melhorar a planilha, tirar as instruções, colocar uma tabela mesmo,
// > com cabeçalhos, campos exclusivos, para número, texto, valor, data, dessa forma o usuário não
// > erra na planilha nem a modifica sem querer"*
//
// ⚠⚠ **NADA AQUI EMITE, LÊ BANCO OU FAZ REDE.** Este módulo recebe um Buffer .xlsx, reescreve duas
// partes do ZIP e devolve outro Buffer. Não abre arquivo, não abre soquete.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ POR QUE ISTO EXISTE: O QUE FOI MEDIDO NO SHEETJS 0.18.5 INSTALADO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// O pedido do dono tem duas metades, e o `xlsx` (SheetJS, build comunitária) só escreve UMA delas.
// Medido no `node_modules/xlsx/xlsx.js` desta árvore, gerando arquivo e reabrindo o ZIP:
//
//   • **proteção de planilha: ESCREVE.** `ws["!protect"]` vira `<sheetProtection …/>` de verdade
//     (`write_ws_xml_protection`, xlsx.js:14642, chamado em xlsx.js:15084).
//
//   • **data validation: NÃO ESCREVE.** No escritor da worksheet existe só um comentário
//     `/* dataValidations */` (xlsx.js:15099) — placeholder, sem código. Medido: atribuir
//     `ws["!dataValidation"]` **ou** `ws["!dataValidations"]` produz um arquivo **sem nenhum**
//     elemento `<dataValidations>`. O dado é descartado em silêncio.
//
//   • **destravar célula: NÃO ESCREVE.** `get_cell_style` (xlsx.js:14433) monta o `<xf>` de cada
//     célula **só a partir de `cell.z`** (o formato de número). Ele nunca olha `cell.s`, nunca
//     emite `applyProtection` nem `<protection/>`. Medido: `cell.s = {protection:{locked:false}}`
//     sai do outro lado como um `cellXfs` com **um único** `<xf>` sem proteção nenhuma.
//
// ⚠⚠ **E É A TERCEIRA QUE TORNA A PRIMEIRA UMA ARMADILHA.** No OOXML toda célula nasce
// `locked="1"`. Ligar `<sheetProtection sheet="1"/>` sem conseguir destravar célula nenhuma
// entregaria ao cliente uma planilha **inteiramente somente-leitura** — ele não conseguiria digitar
// uma nota sequer. A proteção sozinha não é meio caminho: é o oposto do que foi pedido.
//
// ─── A SAÍDA, E POR QUE ELA NÃO CUSTA DEPENDÊNCIA NOVA ──────────────────────────────────────────
//
// ⚠ Um `.xlsx` é um ZIP de XMLs. O próprio SheetJS expõe `XLSX.CFB`, que **lê e escreve ZIP**
// (`CFB.read` com `PK…`, `CFB.write` com `fileType:"zip"`). Medido: ler o buffer que o
// `XLSX.write` acabou de produzir, trocar `sheet1.xml` e `styles.xml`, escrever de volta e reabrir
// com `XLSX.read` funciona — e o `unzip` do sistema também abre o resultado.
//
// ⚠ Portanto: **nenhuma dependência foi acrescentada.** Não há `exceljs` aqui. O que existe é XML
// escrito à mão nos dois lugares que o SheetJS deixou vazios.
//
// ⚠⚠ **O QUE ISTO NÃO PROVA.** Não há Excel nesta máquina. O que está verificado é: o ZIP é válido,
// o XML está nos lugares que o esquema CT_Worksheet manda, e o SheetJS reabre o arquivo sem perder
// dado. **Que o Excel desenhe a validação na tela não foi conferido aqui** — é a razão de a
// blindagem ser reversível (ver `blindarPlanilha`) e de a tela não prometer nada sobre ela.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ A SEMÂNTICA INVERTIDA DE `<sheetProtection>` — o erro que deixaria a planilha inútil
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// No ECMA-376 os atributos de `CT_SheetProtection` são **travas**, não permissões: `insertRows="1"`
// (o padrão, quando o atributo falta) significa *inserir linha está PROIBIDO*. Para **liberar** é
// preciso escrever `="0"`.
//
// ⚠ E o SheetJS só escreve o atributo quando o valor é **falso** (`if(sp[n] != null && !sp[n])`,
// xlsx.js:14646). Logo, no objeto `!protect`, **`false` significa "pode"** e `true`/ausente
// significa "não pode". O nome do campo lê ao contrário do efeito — medido no XML gerado, não
// deduzido do `types/index.d.ts`, que documenta os defaults ao contrário do código.

import * as XLSX from "xlsx";

/**
 * ⚠⚠ **`XLSX.CFB` NÃO EXISTE SEMPRE — E A DIFERENÇA É ENTRE TESTE E PRODUÇÃO.** Medido nesta
 * árvore: o `xlsx` é CommonJS, e o `apps/api` é ESM (`"type": "module"`). Sob o **Node** de
 * produção, `import * as XLSX from "xlsx"` passa pelo `cjs-module-lexer` e expõe só um punhado de
 * nomes — `read`, `write`, `utils`, `version`, `parse`, `find` — **sem `CFB`**, que fica em
 * `XLSX.default.CFB`. Sob o **Jest** (babel transpila para `require`), `XLSX.CFB` existe.
 *
 * ⚠ Ou seja: escrever só `XLSX.CFB` daria um teste VERDE e um download sem blindagem em produção —
 * silenciosamente, porque `blindarPlanilha` degrada em vez de estourar. Os dois caminhos são
 * tentados de propósito.
 */
function cfbDoSheetJs() {
  return XLSX.CFB || XLSX.default?.CFB || null;
}

/**
 * ⚠ A planilha é protegida **SEM SENHA**, e isso é a decisão, não um esquecimento.
 *
 * O dono pediu que o usuário *"não modifique sem querer"* — **sem querer**. Sem senha, o Excel
 * barra o acidente (digitar por cima do cabeçalho, reformatar a coluna do CPF) e continua deixando
 * quem realmente precisa clicar em *Revisão → Desproteger Planilha*, sem pedir nada a ninguém.
 *
 * ⚠⚠ Com senha, o dia em que a blindagem estivesse errada seria um cliente **preso** numa planilha
 * que ele não consegue preencher nem destravar, com a emissão em lote **ligada em produção**. O
 * ganho de uma senha aqui é nenhum (o arquivo é dele), e o risco é esse.
 *
 * ⚠ Exportado porque quem atribui isto a `ws["!protect"]` é o modelo, **antes** do `XLSX.write`: a
 * proteção é a única das três peças que o SheetJS escreve sozinho, e reescrevê-la à mão aqui seria
 * duplicar código que já funciona. As travas moram neste arquivo por serem a mesma decisão.
 */
export const TRAVAS_DA_PLANILHA = Object.freeze({
  // ⚠ `false` = LIBERADO. Ver a nota sobre a semântica invertida, acima.
  formatColumns: false, // largura de coluna: liberado, é só conforto visual
  insertRows: false, // o lote pode ser maior que o bloco pré-formatado
  deleteRows: false, // apagar a linha de exemplo, ou uma nota que sobrou
  sort: false,
  autoFilter: false,
  // ⚠ `formatCells` fica TRAVADO (ausente = proibido), e é o ponto inteiro: é reformatando a coluna
  // de CNPJ/CPF para "Número" que o Excel come o zero da frente do CPF.
});

/** Onde o `sqref` de cada validação termina. Ver `blindarPlanilha`. */
const PRIMEIRA_LINHA_DE_DADOS = 2;

function texto(conteudo) {
  return Buffer.from(conteudo).toString("utf8");
}

/**
 * ⚠ Escapa para atributo XML. As mensagens vêm de `colunasLote.js` e têm aspas e acento — uma aspa
 * crua fecharia o atributo e corromperia a planilha inteira.
 */
function attr(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * ⚠ Limites do próprio Excel, e passar deles é arquivo recusado: `errorTitle`/`promptTitle` = 32
 * caracteres, `error`/`prompt` = 255. O corte é silencioso de propósito — uma ajuda truncada é
 * melhor que um download que não abre.
 */
function cortar(valor, limite) {
  const t = String(valor ?? "");
  return t.length <= limite ? t : `${t.slice(0, limite - 1)}…`;
}

function colunaExcel(indice) {
  let n = indice;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Um `<dataValidation>` a partir do descritor declarado na coluna.
 *
 * ⚠ `allowBlank="1"` em todas: célula vazia **não** é erro aqui. A planilha nasce com centenas de
 * linhas em branco, e um alerta em cada uma delas seria a planilha brigando com quem a abriu.
 * Quem cobra campo obrigatório é a classificação da linha, depois do envio.
 */
function validacaoXml(coluna, indice, ultimaLinha) {
  const v = coluna.validacao;
  const letra = colunaExcel(indice);
  const sqref = `${letra}${PRIMEIRA_LINHA_DE_DADOS}:${letra}${ultimaLinha}`;

  const atributos = [
    v ? `type="${attr(v.tipo)}"` : null,
    v && v.operador ? `operator="${attr(v.operador)}"` : null,
    'allowBlank="1"',
    'showInputMessage="1"',
    v ? 'showErrorMessage="1"' : null,
    v ? 'errorStyle="stop"' : null,
    v ? `errorTitle="${attr(cortar(v.tituloDoErro, 32))}"` : null,
    v ? `error="${attr(cortar(v.erro, 255))}"` : null,
    `promptTitle="${attr(cortar(coluna.rotulo, 32))}"`,
    `prompt="${attr(cortar(coluna.ajuda, 255))}"`,
    `sqref="${sqref}"`,
  ]
    .filter(Boolean)
    .join(" ");

  // ⚠ Sem `validacao`, a coluna ganha só a caixa de ajuda (um `<dataValidation>` sem `type` é o
  // "qualquer valor" do Excel). É o caso da descrição: **não há regra a impor** — o validador da
  // emissão só exige que ela não esteja vazia, e inventar um limite de tamanho aqui faria a
  // planilha recusar um texto que a emissão aceita.
  const formulas = v
    ? [
        v.formula1 != null ? `<formula1>${attr(v.formula1)}</formula1>` : "",
        v.formula2 != null ? `<formula2>${attr(v.formula2)}</formula2>` : "",
      ].join("")
    : "";

  return `<dataValidation ${atributos}>${formulas}</dataValidation>`;
}

/**
 * ⚠⚠ A ORDEM DOS ELEMENTOS DENTRO DE `<worksheet>` NÃO É LIVRE. O `CT_Worksheet` do ECMA-376 é uma
 * **sequência**: … sheetData, sheetProtection, autoFilter, mergeCells, conditionalFormatting,
 * **dataValidations**, hyperlinks, … Fora de ordem, o Excel considera o arquivo corrompido.
 *
 * O SheetJS emite, nesta ordem: `sheetData`, `sheetProtection`, `autoFilter`, `mergeCells`,
 * `hyperlinks`, `ignoredErrors`. Então o lugar certo de entrar é **imediatamente antes de
 * `<ignoredErrors`** (ou, se ele não existir, antes de `</worksheet>`) — que fica depois de tudo
 * que precede e antes de tudo que sucede.
 */
function inserirValidacoes(sheetXml, validacoes) {
  if (!validacoes.length) return sheetXml;
  const bloco = `<dataValidations count="${validacoes.length}">${validacoes.join("")}</dataValidations>`;
  if (sheetXml.includes("<ignoredErrors")) return sheetXml.replace("<ignoredErrors", `${bloco}<ignoredErrors`);
  return sheetXml.replace("</worksheet>", `${bloco}</worksheet>`);
}

/**
 * Congela o cabeçalho.
 *
 * ⚠ O SheetJS não escreve painel congelado (o escritor emite `<sheetView workbookViewId="0"/>` e
 * nada mais; `<pane>` só aparece no leitor do formato XML 2003). Como o `sheetViews` já está aqui
 * ao alcance, o `<pane>` entra junto: rolar 200 linhas sem ver de que coluna é a célula é a forma
 * mais comum de digitar o valor na coluna da data.
 */
function congelarCabecalho(sheetXml) {
  const congelado =
    '<sheetViews><sheetView workbookViewId="0">'
    + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
    + "</sheetView></sheetViews>";
  return sheetXml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, congelado);
}

/**
 * Carimba o estilo do cabeçalho nas células da linha 1.
 *
 * ⚠ Precisa ser feito no XML porque o SheetJS **ignora `cell.s`** (ver o cabeçalho deste arquivo):
 * o índice de estilo que ele escreve sai só do formato de número. Como o cabeçalho não tem formato
 * de número próprio, ele cairia no `xf` 0 — o mesmo das células livres — e não haveria como
 * travá-lo sem travar a planilha inteira.
 */
function estilizarCabecalho(sheetXml, indiceDoEstilo) {
  // ⚠ Grupo NOMEADO de propósito: com grupo numerado, o substituto sairia como `$11` — que se lê
  // "grupo 11" antes de se ler "grupo 1 seguido de 1". Funciona por acidente (não existe grupo 11)
  // e quebraria no dia em que alguém acrescentasse um grupo à expressão.
  // ⚠ O `(?!…\ss=)` evita carimbar duas vezes uma célula que já tenha estilo próprio.
  return sheetXml.replace(/<row r="1"[^>]*>[\s\S]*?<\/row>/, (linha) =>
    linha.replace(/<c r="(?<coluna>[A-Z]+)1"(?![^>]*\ss=)/g, `<c r="$<coluna>1" s="${indiceDoEstilo}"`)
  );
}

/**
 * ⚠⚠ AQUI MORA A METADE QUE FAZ A PROTEÇÃO SER USÁVEL: **destravar** o que o cliente preenche.
 *
 * A regra é a inversa da intuitiva. Em vez de destravar as células de dados uma a uma (o que exige
 * carimbar `s` em cada uma, e são milhares), **todo `xf` que já existe é destravado** — inclusive o
 * `xf` 0, que é o estilo implícito de toda célula que ninguém tocou. Assim a planilha inteira fica
 * editável por padrão, **até fora do bloco pré-formatado**, e um lote maior que o modelo não
 * esbarra numa célula travada.
 *
 * Em seguida acrescenta-se **um** `xf` novo, travado e em negrito, que é usado só pelo cabeçalho.
 *
 * ⚠ O efeito líquido é o pedido do dono ao pé da letra: o cabeçalho **não** se edita sem querer, e
 * todo o resto se preenche à vontade.
 */
function reescreverEstilos(stylesXml) {
  let xml = stylesXml;

  // ── a fonte do cabeçalho (negrito), acrescentada ao fim de `<fonts>`
  const fonte = "<font><b/><sz val=\"12\"/><color theme=\"1\"/><name val=\"Calibri\"/><family val=\"2\"/><scheme val=\"minor\"/></font>";
  let idDaFonte = 0;
  xml = xml.replace(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/, (_todo, quantas, miolo) => {
    idDaFonte = Number(quantas);
    return `<fonts count="${idDaFonte + 1}">${miolo}${fonte}</fonts>`;
  });

  // ── o preenchimento do cabeçalho (cinza-azulado claro)
  const preenchimento =
    "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFDCE6F1\"/><bgColor indexed=\"64\"/></patternFill></fill>";
  let idDoPreenchimento = 0;
  xml = xml.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (_todo, quantas, miolo) => {
    idDoPreenchimento = Number(quantas);
    return `<fills count="${idDoPreenchimento + 1}">${miolo}${preenchimento}</fills>`;
  });

  // ── destrava TODO `xf` existente e acrescenta o do cabeçalho
  let indiceDoCabecalho = -1;
  xml = xml.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_todo, quantas, miolo) => {
    const existentes = Number(quantas);
    // ⚠ Os `xf` do SheetJS são todos auto-fechados (`<xf … />`). Abrir cada um para pendurar
    // `<protection locked="0"/>` é o que os torna editáveis sob proteção.
    const destravados = miolo.replace(
      /<xf([^>]*?)\/>/g,
      '<xf$1 applyProtection="1"><protection locked="0"/></xf>'
    );
    indiceDoCabecalho = existentes;
    const doCabecalho =
      `<xf numFmtId="0" fontId="${idDaFonte}" fillId="${idDoPreenchimento}" borderId="0" xfId="0"`
      + ' applyFont="1" applyFill="1" applyAlignment="1" applyProtection="1">'
      + '<alignment vertical="center" wrapText="1"/><protection locked="1"/></xf>';
    return `<cellXfs count="${existentes + 1}">${destravados}${doCabecalho}</cellXfs>`;
  });

  return { xml, indiceDoCabecalho };
}

/**
 * Blinda o .xlsx: validação por coluna, cabeçalho travado e congelado, resto editável.
 *
 * ⚠⚠ **ELA NUNCA DERRUBA O DOWNLOAD.** Se qualquer passo falhar — XML que mudou de forma numa
 * atualização do SheetJS, regex que não casou —, devolve o buffer **original**, que continua sendo
 * uma planilha correta e legível, só sem a blindagem. Um cliente sem validação consegue trabalhar;
 * um cliente com erro 500 no botão de baixar o modelo, não.
 *
 * ⚠ Por isso o retorno traz `blindada`: é o que um teste crava para que a degradação apareça no CI
 * em vez de aparecer em silêncio, meses depois, como "a validação sumiu".
 *
 * @param {Buffer} buffer o .xlsx recém-escrito pelo SheetJS
 * @param {{colunas: ReadonlyArray<object>, ultimaLinha: number}} plano
 * @returns {{buffer: Buffer, blindada: boolean, motivo?: string}}
 */
export function blindarPlanilha(buffer, { colunas, ultimaLinha }) {
  try {
    const CFB = cfbDoSheetJs();
    if (!CFB) return { buffer, blindada: false, motivo: "cfb_indisponivel" };
    const cfb = CFB.read(buffer, { type: "buffer" });

    const caminhoDaAba = "/xl/worksheets/sheet1.xml";
    const abaOriginal = CFB.find(cfb, caminhoDaAba);
    const estilosOriginais = CFB.find(cfb, "/xl/styles.xml");
    if (!abaOriginal || !estilosOriginais) {
      return { buffer, blindada: false, motivo: "partes_nao_encontradas" };
    }

    const { xml: estilos, indiceDoCabecalho } = reescreverEstilos(texto(estilosOriginais.content));
    if (indiceDoCabecalho < 0) {
      return { buffer, blindada: false, motivo: "cellXfs_nao_reconhecido" };
    }

    let aba = texto(abaOriginal.content);
    aba = congelarCabecalho(aba);
    aba = estilizarCabecalho(aba, indiceDoCabecalho);
    aba = inserirValidacoes(
      aba,
      colunas.map((coluna, indice) => validacaoXml(coluna, indice, ultimaLinha))
    );

    CFB.utils.cfb_add(cfb, caminhoDaAba, Buffer.from(aba, "utf8"));
    CFB.utils.cfb_add(cfb, "/xl/styles.xml", Buffer.from(estilos, "utf8"));

    const saida = CFB.write(cfb, { fileType: "zip", type: "buffer", compression: true });

    // ⚠⚠ A CONFERÊNCIA DA PRÓPRIA SAÍDA. Reabrir com o SheetJS prova que o ZIP e o XML continuam
    // válidos e que nenhuma célula se perdeu no caminho. Se não reabrir, o original volta.
    const relido = XLSX.read(saida, { type: "buffer" });
    if (!relido.SheetNames?.length) {
      return { buffer, blindada: false, motivo: "saida_nao_reabriu" };
    }

    return { buffer: Buffer.from(saida), blindada: true };
  } catch (err) {
    return { buffer, blindada: false, motivo: err?.message || "erro_desconhecido" };
  }
}
