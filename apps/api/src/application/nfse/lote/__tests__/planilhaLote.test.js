// O MODELO E A LEITURA — a viagem de ida e volta, e as recusas que não são silenciosas.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA. Gera um .xlsx em memória e o lê de volta; sem banco, sem rede.

import * as XLSX from "xlsx";
import { gerarModeloPlanilhaLote, NOME_DA_ABA, LINHAS_VALIDADAS } from "../modeloPlanilhaLote.js";
import { lerPlanilhaLote, RECUSA_PLANILHA, MAX_LINHAS } from "../lerPlanilhaLote.js";
import {
  COLUNAS_LOTE,
  COLUNAS_DE_TEXTO,
  CAMPOS_DA_REVISAO,
  LINHA_DE_EXEMPLO,
  chaveDaColuna,
} from "../colunasLote.js";
import { classificarPlanilhaLote, ESTADO } from "../classificarLinhaLote.js";

const CABECALHOS = COLUNAS_LOTE.map((c) => c.rotulo);

/** Monta um .xlsx a partir de uma matriz. */
function planilhaDe(matriz, { aba = "Notas" } = {}) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), aba);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function linhaDe(valores) {
  return COLUNAS_LOTE.map((c) => valores[c.chave] ?? "");
}

/**
 * ⚠ QUATRO CAMPOS — a planilha inteira, desde 20/08/2026. Nome, e-mail e endereço saíram das
 * colunas; eles chegam pela memória, pela consulta ou pela revisão.
 */
const NOTA = {
  documento: "39254243000191",
  descricao: "Consultoria",
  valor: "1500,00",
  competencia: "31/07/2026",
};

const MUNICIPIOS = [["3304557", "Rio de Janeiro", "RJ"]];

/**
 * O tomador que a MEMÓRIA conhece — é ela que dá nome e endereço a uma linha de quatro colunas.
 * ⚠ Sem isto nenhuma linha desta suíte chegaria a `PRONTA`, e esse é exatamente o desenho novo:
 * com menos colunas, quem completa o tomador é o cadastro, a consulta ou a revisão.
 */
const ENDERECO = {
  cMun: "3304557",
  cep: "20031005",
  xLgr: "Av. Rio Branco",
  nro: "100",
  xBairro: "Centro",
};
const CONHECIDO = new Map([
  ["39254243000191", { nome: "TOMADOR LTDA", ...ENDERECO }],
  ["01234567890", { nome: "MARIA DE SOUZA", ...ENDERECO }],
]);

const CLASSIFICAR = { municipios: MUNICIPIOS, tomadoresConhecidos: CONHECIDO };

describe("o modelo", () => {
  const modelo = gerarModeloPlanilhaLote();
  const wb = XLSX.read(modelo.buffer, { type: "buffer" });

  it("⚠⚠ nasce com as QUATRO colunas, na ordem, e a aba de dados é a PRIMEIRA", () => {
    expect(COLUNAS_LOTE).toHaveLength(4);
    expect(wb.SheetNames[0]).toBe(NOME_DA_ABA);
    const [cabecalho] = XLSX.utils.sheet_to_json(wb.Sheets[NOME_DA_ABA], { header: 1 });
    expect(cabecalho).toEqual(CABECALHOS);
  });

  // ⚠⚠ A ABA DE INSTRUÇÕES SAIU (dono, 21/08/2026: *"tirar as instruções"*). O que ela dizia virou
  // mecanismo — formato de coluna, validação e proteção —, e o porquê de cada frase cortada está
  // no cabeçalho de `modeloPlanilhaLote.js`. Uma aba a mais também era um risco: `lerPlanilhaLote`
  // lê `SheetNames[0]` e dependia da ordem em que as abas foram acrescentadas.
  it("⚠⚠ tem UMA aba só — a de instruções saiu, e com ela a dependência da ordem das abas", () => {
    expect(wb.SheetNames).toEqual([NOME_DA_ABA]);
  });

  it("⚠⚠ as colunas de dígitos nascem formatadas como TEXTO — e não só na linha de exemplo", () => {
    const xml = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    // A prova real é o estilo escrito na célula. Lemos com `cellStyles` para ver o formato.
    const relido = XLSX.read(modelo.buffer, { type: "buffer", cellStyles: true });
    const ws = relido.Sheets[NOME_DA_ABA];
    for (const chave of COLUNAS_DE_TEXTO) {
      const coluna = COLUNAS_LOTE.findIndex((c) => c.chave === chave);
      // linha do exemplo (r=1) e as vazias logo abaixo (r=2, r=50)
      for (const r of [1, 2, 50]) {
        const celula = ws[XLSX.utils.encode_cell({ c: coluna, r })];
        expect(celula).toBeDefined();
        expect(celula.z).toBe("@");
      }
    }
    expect(xml.length).toBeGreaterThan(0);
  });

  it("⚠ o exemplo tem só os quatro campos — não sobrou nada do tomador para preencher", () => {
    expect(Object.keys(LINHA_DE_EXEMPLO)).toEqual(["documento", "descricao", "valor", "competencia"]);
  });

  it("⚠ o CPF de exemplo começa com zero e sobrevive à ida e volta", () => {
    expect(LINHA_DE_EXEMPLO.documento.startsWith("0")).toBe(true);
    const ws = wb.Sheets[NOME_DA_ABA];
    const coluna = COLUNAS_LOTE.findIndex((c) => c.chave === "documento");
    expect(ws[XLSX.utils.encode_cell({ c: coluna, r: 1 })].v).toBe(LINHA_DE_EXEMPLO.documento);
  });

  it("todo cabeçalho do modelo se reconhece a si mesmo", () => {
    for (const rotulo of CABECALHOS) expect(chaveDaColuna(rotulo)).not.toBeNull();
  });

  it("⚠⚠ o modelo em branco NÃO produz nota nenhuma — a linha de exemplo é descartada", () => {
    const r = lerPlanilhaLote(modelo.buffer);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.SEM_LINHAS);
    expect(r.mensagem).toContain("linha de exemplo");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A TABELA TIPADA E A BLINDAGEM (21/08/2026)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Dono: *"colocar uma tabela mesmo, com cabeçalhos, campos exclusivos, para número, texto, valor,
// > data, dessa forma o usuário não erra na planilha nem a modifica sem querer"*
//
// ⚠ Estes testes olham o **XML de dentro do .xlsx**, e não a API do SheetJS, porque é justamente
// onde o SheetJS **não** escreve: `dataValidations` e `<protection locked="0"/>` são escritos à mão
// por `protecaoPlanilhaLote.js`. Um teste que perguntasse ao SheetJS o que ele leu não veria nada
// disso — ele não tem por onde devolver.
//
// ⚠⚠ **O QUE ESTES TESTES NÃO PROVAM: que o Excel desenha a validação na tela.** Não há Excel no
// CI. O que está provado é que o arquivo é um ZIP válido, que o XML está nos lugares que o esquema
// `CT_Worksheet` exige e que o próprio SheetJS reabre o arquivo sem perder célula.
describe("⚠ o modelo blindado — a tabela tipada, a validação e a proteção", () => {
  const modelo = gerarModeloPlanilhaLote();

  /** Abre o .xlsx como o ZIP que ele é, para ler as partes que o SheetJS não devolve. */
  function partesDo(buffer) {
    // ⚠ O mesmo `XLSX.CFB || XLSX.default.CFB` de `protecaoPlanilhaLote.js`, e pelo mesmo motivo:
    // sob o Jest (babel → `require`) o primeiro existe; sob o Node de produção (ESM sobre CJS), o
    // segundo. Ver a nota naquele arquivo.
    const CFB = XLSX.CFB || XLSX.default?.CFB;
    const cfb = CFB.read(buffer, { type: "buffer" });
    const ler = (caminho) => Buffer.from(CFB.find(cfb, caminho).content).toString("utf8");
    return { aba: ler("/xl/worksheets/sheet1.xml"), estilos: ler("/xl/styles.xml") };
  }

  // ⚠⚠ A TRAVA CONTRA A DEGRADAÇÃO SILENCIOSA. `blindarPlanilha` devolve o buffer original quando
  // qualquer passo falha, para nunca derrubar o download. Sem este teste, uma mudança no SheetJS
  // (ou o `XLSX.CFB` sumindo na interop de módulos) apagaria a validação inteira e **nada avisaria**
  // — o cliente continuaria baixando uma planilha que abre, só que sem nenhuma das defesas.
  it("⚠⚠ a blindagem foi de fato aplicada (se degradar, é AQUI que se descobre)", () => {
    expect(modelo.blindada).toBe(true);
  });

  it("⚠ cada coluna tem seu tipo exclusivo — texto, texto, valor, data", () => {
    const ws = XLSX.read(modelo.buffer, { type: "buffer", cellStyles: true }).Sheets[NOME_DA_ABA];
    const formatoNa = (chave, linha) => {
      const c = COLUNAS_LOTE.findIndex((x) => x.chave === chave);
      return ws[XLSX.utils.encode_cell({ c, r: linha })]?.z;
    };
    // ⚠ Na linha do exemplo (r=1) E nas vazias abaixo (r=2, r=50) — é a célula VAZIA que carrega o
    // formato para o que a pessoa vai digitar.
    for (const r of [1, 2, 50]) {
      expect(formatoNa("documento", r)).toBe("@");
      expect(formatoNa("descricao", r)).toBe("@");
      expect(formatoNa("valor", r)).toBe("#,##0.00");
      expect(formatoNa("competencia", r)).toBe("dd/mm/yyyy");
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ O TESTE QUE PEGA O ERRO DE UM DIA NA COMPETÊNCIA
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  //
  // Medido no SheetJS 0.18.5 sob `TZ=America/Sao_Paulo`: escrever a data como `{ t: "d", v: Date }`
  // produz um serial FRACIONÁRIO (46233,8746…) e a data volta **um dia antes**. Sob `TZ=UTC` o
  // mesmo código acerta — que é como o defeito se esconde de quem só roda teste em UTC.
  //
  // ⚠ O desfecho seria nota fiscal emitida com a competência errada. A trava é o serial INTEIRO.
  it("⚠⚠ a competência do exemplo é um serial INTEIRO — o `t:\"d\"` do SheetJS erra um dia sob UTC-3", () => {
    const ws = XLSX.read(modelo.buffer, { type: "buffer" }).Sheets[NOME_DA_ABA];
    const c = COLUNAS_LOTE.findIndex((x) => x.chave === "competencia");
    const celula = ws[XLSX.utils.encode_cell({ c, r: 1 })];
    expect(celula.t).toBe("n");
    expect(Number.isInteger(celula.v)).toBe(true);
  });

  it("⚠⚠ e ela volta da leitura como o dia que está escrito no modelo, não o anterior", () => {
    const lida = XLSX.read(modelo.buffer, { type: "buffer", cellDates: true }).Sheets[NOME_DA_ABA];
    const c = COLUNAS_LOTE.findIndex((x) => x.chave === "competencia");
    const valor = lida[XLSX.utils.encode_cell({ c, r: 1 })].v;
    // ⚠ Componentes LOCAIS, que é o que `lerCompetenciaDaPlanilha` usa — ver `utils/dataCivil.js`.
    const escrito = `${String(valor.getDate()).padStart(2, "0")}/${String(valor.getMonth() + 1).padStart(2, "0")}/${valor.getFullYear()}`;
    expect(escrito).toBe(LINHA_DE_EXEMPLO.competencia);
  });

  it("⚠ cada coluna ganhou um `<dataValidation>` com o alcance que passa do bloco pré-formatado", () => {
    const { aba } = partesDo(modelo.buffer);
    expect(aba).toContain(`<dataValidations count="${COLUNAS_LOTE.length}">`);
    // documento: comprimento — é o que barra o CPF que perdeu o zero (10 caracteres).
    expect(aba).toContain('type="textLength"');
    expect(aba).toContain(`sqref="A2:A${LINHAS_VALIDADAS}"`);
    // valor: a MESMA regra do validador da emissão (`servico_valor_invalido` exige > 0).
    expect(aba).toContain('type="decimal" operator="greaterThan"');
    // competência: exige que SEJA data, sem inventar janela fiscal nenhuma.
    expect(aba).toContain('type="date"');
  });

  // ⚠ A descrição é a única sem regra, e isso é decisão medida: `validateNfsePayload` só exige que
  // ela não seja vazia — não há limite de tamanho em lugar nenhum do fluxo. Um `textLength`
  // inventado aqui recusaria, na planilha, um texto que a emissão aceita.
  it("⚠ a coluna de descrição NÃO ganha regra inventada — só a caixa de ajuda", () => {
    expect(COLUNAS_LOTE.find((c) => c.chave === "descricao").validacao).toBeNull();
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ A PROTEÇÃO SÓ É ÚTIL COM AS CÉLULAS DE DADOS DESTRAVADAS
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  //
  // No OOXML toda célula nasce `locked="1"`. Proteger a planilha sem destravar nada entregaria ao
  // cliente um arquivo **inteiramente somente-leitura** — ele não digitaria uma nota sequer, com a
  // emissão em lote LIGADA EM PRODUÇÃO. Este par de testes é o que impede esse desfecho.
  it("⚠⚠ todo estilo de célula existente está DESTRAVADO — a planilha se preenche", () => {
    const { estilos } = partesDo(modelo.buffer);
    const miolo = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(estilos);
    expect(miolo).not.toBeNull();
    const xfs = miolo[2].match(/<xf[\s\S]*?<\/xf>/g) || [];
    // O último é o do cabeçalho; todos os outros são de dados e têm de estar destravados.
    const deDados = xfs.slice(0, -1);
    expect(deDados.length).toBeGreaterThanOrEqual(4);
    for (const xf of deDados) expect(xf).toContain('<protection locked="0"/>');
  });

  it("⚠⚠ e só o CABEÇALHO fica travado — é o que não se altera sem querer", () => {
    const { aba, estilos } = partesDo(modelo.buffer);
    const xfs = /<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/.exec(estilos)[1].match(/<xf[\s\S]*?<\/xf>/g);
    const indiceDoCabecalho = xfs.length - 1;
    expect(xfs[indiceDoCabecalho]).toContain('<protection locked="1"/>');
    // E as células da linha 1 apontam para ele.
    const linha1 = /<row r="1"[^>]*>[\s\S]*?<\/row>/.exec(aba)[0];
    for (let c = 0; c < COLUNAS_LOTE.length; c += 1) {
      const ref = `${XLSX.utils.encode_col(c)}1`;
      expect(linha1).toContain(`<c r="${ref}" s="${indiceDoCabecalho}"`);
    }
  });

  // ⚠ Semântica INVERTIDA do `<sheetProtection>`: o atributo é uma TRAVA. `insertRows="0"` LIBERA
  // inserir linha; `formatCells` AUSENTE significa que reformatar está PROIBIDO — e é o ponto
  // inteiro, porque é reformatando a coluna do CNPJ/CPF que o Excel come o zero da frente do CPF.
  it("⚠⚠ a planilha é protegida, reformatar célula fica PROIBIDO e inserir/apagar linha, LIBERADO", () => {
    const { aba } = partesDo(modelo.buffer);
    const tag = /<sheetProtection[^>]*\/>/.exec(aba);
    expect(tag).not.toBeNull();
    expect(tag[0]).toContain('sheet="1"');
    expect(tag[0]).not.toContain("formatCells");
    expect(tag[0]).toContain('insertRows="0"');
    expect(tag[0]).toContain('deleteRows="0"');
  });

  // ⚠⚠ SEM SENHA, e isso é a decisão. O dono pediu que não se modifique **sem querer**. Com senha,
  // o dia em que a blindagem estivesse errada seria um cliente PRESO numa planilha que ele não
  // consegue preencher nem destravar — com a emissão em lote ligada em produção.
  it("⚠⚠ a proteção NÃO tem senha — ela barra o acidente, nunca a pessoa", () => {
    const { aba } = partesDo(modelo.buffer);
    expect(/<sheetProtection[^>]*\/>/.exec(aba)[0]).not.toContain("password");
  });

  it("o cabeçalho fica congelado ao rolar", () => {
    expect(partesDo(modelo.buffer).aba).toContain('state="frozen"');
  });

  // ⚠ A prova de que a cirurgia no ZIP não corrompeu nada: o arquivo blindado continua sendo uma
  // planilha legítima, e a leitura continua descartando a linha de exemplo.
  it("⚠⚠ o arquivo blindado continua abrindo, e o exemplo continua não virando nota", () => {
    const r = lerPlanilhaLote(modelo.buffer);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.SEM_LINHAS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A PLANILHA DO FORMATO ANTIGO NÃO PODE PASSAR A SER LIDA ERRADO
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// A tabela tipada mudou o modelo: o valor virou célula numérica e a competência, serial de data. A
// comparação que reconhece a linha de exemplo deixou de ser de TEXTO e passou a ser pela forma
// canônica do domínio (`lerDocumentoDaPlanilha`, `lerValorDaPlanilha`, `lerCompetenciaDaPlanilha`).
//
// ⚠⚠ Se ela só entendesse o formato novo, o cliente que ainda tem o modelo antigo mandaria **uma
// nota fiscal para o CPF do exemplo**. É o pior desfecho possível de um modelo, e é o que estes
// testes vigiam.
describe("⚠⚠ compatibilidade — a planilha do formato ANTIGO continua sendo lida certo", () => {
  const EXEMPLO_EM_TEXTO = COLUNAS_LOTE.map((c) => LINHA_DE_EXEMPLO[c.chave]);

  it("⚠⚠ o exemplo em TEXTO (modelo antigo) continua sendo descartado, não vira nota", () => {
    const r = lerPlanilhaLote(planilhaDe([CABECALHOS, EXEMPLO_EM_TEXTO]));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.SEM_LINHAS);
  });

  it("⚠ e, junto de uma nota de verdade, some sozinho e deixa a nota passar", () => {
    const r = lerPlanilhaLote(planilhaDe([CABECALHOS, EXEMPLO_EM_TEXTO, linhaDe(NOTA)]));
    expect(r.ok).toBe(true);
    expect(r.exemploDescartado).toEqual([2]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].valores.documento).toBe(NOTA.documento);
  });

  // ⚠ O descarte nunca adivinha: uma célula diferente já basta para a linha ser dado de verdade.
  it("⚠⚠ com UM campo editado, a linha do exemplo é DADO e entra como nota", () => {
    const editada = COLUNAS_LOTE.map((c) =>
      c.chave === "descricao" ? "Outra descrição" : LINHA_DE_EXEMPLO[c.chave]
    );
    const r = lerPlanilhaLote(planilhaDe([CABECALHOS, editada]));
    expect(r.ok).toBe(true);
    expect(r.exemploDescartado).toEqual([]);
    expect(r.linhas).toHaveLength(1);
  });

  it("⚠ o exemplo TIPADO (modelo novo, salvo pelo Excel) também é descartado", () => {
    const ws = XLSX.utils.aoa_to_sheet([CABECALHOS]);
    ws.A2 = { t: "s", v: LINHA_DE_EXEMPLO.documento, z: "@" };
    ws.B2 = { t: "s", v: LINHA_DE_EXEMPLO.descricao, z: "@" };
    ws.C2 = { t: "n", v: 1500, z: "#,##0.00" };
    // 46234 = 31/07/2026 na época do Excel, que é o que a pessoa vê na célula.
    ws.D2 = { t: "n", v: 46234, z: "dd/mm/yyyy" };
    ws["!ref"] = "A1:D2";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Notas");
    const r = lerPlanilhaLote(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.SEM_LINHAS);
  });

  // ⚠ As sete colunas que saíram em 20/08/2026 continuam voltando NOMEADAS em `colunasIgnoradas` —
  // coluna que a pessoa acha que estamos lendo e que ignoramos em silêncio é dado sumindo sem aviso.
  it("⚠ o modelo de DOZE colunas continua sendo lido, com as sete extras nomeadas", () => {
    const doze = [
      "CNPJ/CPF do tomador",
      "Nome / razão social do tomador",
      "E-mail do tomador",
      "Descrição do serviço",
      "Valor do serviço (R$)",
      "Data da competência (dd/mm/aaaa)",
      "Município (código IBGE)",
      "CEP",
      "Logradouro",
      "Número",
      "Bairro",
      "Complemento",
    ];
    const linha = [
      NOTA.documento, "X LTDA", "a@b.com", NOTA.descricao, NOTA.valor, NOTA.competencia,
      "3304557", "20031005", "Av. Rio Branco", "100", "Centro", "",
    ];
    const r = lerPlanilhaLote(planilhaDe([doze, linha]));
    expect(r.ok).toBe(true);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].valores.documento).toBe(NOTA.documento);
    expect(r.colunasIgnoradas.length).toBe(8);
  });
});

describe("a leitura — ida e volta", () => {
  it("lê o modelo preenchido e classifica tudo", () => {
    const buffer = planilhaDe([CABECALHOS, linhaDe(NOTA), linhaDe({ ...NOTA, descricao: "Outro" })]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.ok).toBe(true);
    expect(lida.linhas).toHaveLength(2);
    expect(lida.linhas[0].numero).toBe(2);
    expect(lida.linhas[1].numero).toBe(3);

    const r = classificarPlanilhaLote(lida.linhas, CLASSIFICAR);
    expect(r.resumo.prontas).toBe(2);
  });

  it("⚠ a linha de exemplo INTACTA é descartada, mas EDITADA é dado de verdade", () => {
    const intacta = lerPlanilhaLote(planilhaDe([CABECALHOS, linhaDe(LINHA_DE_EXEMPLO), linhaDe(NOTA)]));
    expect(intacta.linhas).toHaveLength(1);
    expect(intacta.exemploDescartado).toEqual([2]);

    const editada = lerPlanilhaLote(
      planilhaDe([CABECALHOS, linhaDe({ ...LINHA_DE_EXEMPLO, valor: "999,00" }), linhaDe(NOTA)])
    );
    expect(editada.linhas).toHaveLength(2);
    expect(editada.exemploDescartado).toEqual([]);
  });

  it("acha o cabeçalho mesmo com título e linha em branco em cima", () => {
    const buffer = planilhaDe([["Minhas notas de julho"], [], CABECALHOS, linhaDe(NOTA)]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.ok).toBe(true);
    expect(lida.linhaDoCabecalho).toBe(3);
    expect(lida.linhas[0].numero).toBe(4);
  });

  it("reconhece cabeçalhos com grafia diferente (sem acento, minúsculo, alias)", () => {
    const buffer = planilhaDe([
      ["cnpj cpf", "descricao", "valor", "competencia"],
      ["39254243000191", "Serviço", "1500,00", "31/07/2026"],
    ]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.ok).toBe(true);
    expect(lida.linhas[0].valores.descricao).toBe("Serviço");
  });

  // ⚠⚠ A PLANILHA DO MODELO ANTIGO (doze colunas) CONTINUA SENDO LIDA — as quatro que importam
  // são reconhecidas —, e as sete do tomador voltam NOMEADAS em `colunasIgnoradas`, que a tela
  // mostra. Aceitá-las em silêncio manteria viva uma segunda porta de entrada para o endereço,
  // com memória e consulta sendo puladas sem que ninguém visse.
  it("⚠⚠ o modelo ANTIGO é lido, e as sete colunas que saíram voltam NOMEADAS", () => {
    const antigo = [
      "CNPJ/CPF do tomador",
      "Nome / razão social do tomador",
      "Descrição do serviço",
      "Valor do serviço (R$)",
      "Data da competência (dd/mm/aaaa)",
      "E-mail do tomador",
      "Código IBGE do município do tomador",
      "CEP do tomador",
      "Logradouro do tomador",
      "Número",
      "Bairro",
      "Complemento",
    ];
    const lida = lerPlanilhaLote(
      planilhaDe([
        antigo,
        ["39254243000191", "X LTDA", "S", "1500,00", "31/07/2026", "a@b.com", "3304557", "20031005", "Av.", "1", "Centro", ""],
      ])
    );
    expect(lida.ok).toBe(true);
    expect([...lida.colunasReconhecidas].sort()).toEqual(["competencia", "descricao", "documento", "valor"]);
    expect(lida.colunasIgnoradas).toHaveLength(8);
    expect(lida.colunasIgnoradas).toContain("Nome / razão social do tomador");
    expect(lida.colunasIgnoradas).toContain("Código IBGE do município do tomador");
    // ⚠ E o endereço da planilha antiga NÃO entra: a linha segue para a consulta, como outra qualquer.
    expect(lida.linhas[0].valores.cMun).toBeUndefined();
  });

  it("⚠ linhas totalmente vazias são puladas, e as parciais NÃO", () => {
    const buffer = planilhaDe([CABECALHOS, linhaDe(NOTA), [], ["", "", ""], linhaDe({ valor: "10,00" })]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.linhas).toHaveLength(2);
    expect(lida.linhas[1].valores.valor).toBe("10,00");
  });

  it("⚠ colunas que não reconhecemos voltam NOMEADAS, e não recusam a planilha", () => {
    const buffer = planilhaDe([
      [...CABECALHOS, "Meu controle interno"],
      [...linhaDe(NOTA), "abc"],
    ]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.ok).toBe(true);
    expect(lida.colunasIgnoradas).toEqual(["Meu controle interno"]);
  });
});

describe("⚠⚠ formato desconhecido NÃO é aceito em silêncio", () => {
  it("cabeçalho irreconhecível recusa, dizendo o que fazer", () => {
    const buffer = planilhaDe([["a", "b", "c"], [1, 2, 3]]);
    const r = lerPlanilhaLote(buffer);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.SEM_CABECALHO);
    expect(r.mensagem).toContain("modelo");
  });

  it("coluna obrigatória faltando recusa NOMEANDO a coluna e mostrando o cabeçalho encontrado", () => {
    const semValor = CABECALHOS.filter((c) => !c.startsWith("Valor"));
    const buffer = planilhaDe([semValor, semValor.map(() => "x")]);
    const r = lerPlanilhaLote(buffer);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.COLUNAS_FALTANDO);
    expect(r.faltando).toEqual(["valor"]);
    expect(r.mensagem).toContain("Valor do serviço");
    expect(r.mensagem).toContain("Cabeçalho encontrado");
  });

  it("⚠ NÃO existe casamento por POSIÇÃO — coluna 1 no lugar da 2 não é adivinhada", () => {
    const buffer = planilhaDe([
      ["coluna a", "coluna b", "coluna c", "coluna d"],
      ["39254243000191", "Serviço", "1500,00", "31/07/2026"],
    ]);
    expect(lerPlanilhaLote(buffer).ok).toBe(false);
  });

  it("arquivo que não é planilha recusa sem lançar", () => {
    const r = lerPlanilhaLote(Buffer.from("isto não é uma planilha"));
    expect(r.ok).toBe(false);
    expect([RECUSA_PLANILHA.ARQUIVO_ILEGIVEL, RECUSA_PLANILHA.SEM_CABECALHO, RECUSA_PLANILHA.SEM_ABA]).toContain(
      r.codigo
    );
  });

  it("planilha só com cabeçalho recusa", () => {
    const r = lerPlanilhaLote(planilhaDe([CABECALHOS]));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.SEM_LINHAS);
  });

  it("planilha grande demais recusa em vez de arrastar", () => {
    const linhas = Array.from({ length: MAX_LINHAS + 5 }, () => linhaDe(NOTA));
    const r = lerPlanilhaLote(planilhaDe([CABECALHOS, ...linhas]));
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_PLANILHA.LINHAS_DEMAIS);
  });

  it("⚠ toda recusa tem código E mensagem — nenhuma é muda", () => {
    const recusas = [
      lerPlanilhaLote(Buffer.from("x")),
      lerPlanilhaLote(planilhaDe([["a", "b"], [1, 2]])),
      lerPlanilhaLote(planilhaDe([CABECALHOS])),
    ];
    for (const r of recusas) {
      expect(Object.values(RECUSA_PLANILHA)).toContain(r.codigo);
      expect(r.mensagem.length).toBeGreaterThan(20);
    }
  });
});

describe("⚠⚠ a viagem completa: o zero do CPF sobrevive ao Excel", () => {
  it("coluna de TEXTO preserva o zero e a linha sai PRONTA", () => {
    const buffer = planilhaDe([CABECALHOS, linhaDe({ ...NOTA, documento: "01234567890" })]);
    const lida = lerPlanilhaLote(buffer);
    const r = classificarPlanilhaLote(lida.linhas, CLASSIFICAR);
    expect(r.linhas[0].estado).toBe(ESTADO.PRONTA);
    expect(r.linhas[0].documento).toBe("01234567890");
  });

  it("⚠ coluna NUMÉRICA come o zero — e a leitura o recupera, marcando a linha para CONFERÊNCIA", () => {
    // 1234567890 como NÚMERO é exatamente o que o Excel deixa de `01234567890`.
    const buffer = planilhaDe([CABECALHOS, linhaDe({ ...NOTA, documento: 1234567890 })]);
    const lida = lerPlanilhaLote(buffer);
    expect(typeof lida.linhas[0].valores.documento).toBe("number");
    const r = classificarPlanilhaLote(lida.linhas, CLASSIFICAR);
    expect(r.linhas[0].estado).toBe(ESTADO.CONFERIR);
    expect(r.linhas[0].documento).toBe("01234567890");
  });

  it("⚠⚠ o valor `1.500` numa célula de TEXTO chega ambíguo e vira pendência", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([CABECALHOS, linhaDe(NOTA)]);
    const coluna = COLUNAS_LOTE.findIndex((c) => c.chave === "valor");
    ws[XLSX.utils.encode_cell({ c: coluna, r: 1 })] = { t: "s", v: "1.500", z: "@" };
    XLSX.utils.book_append_sheet(wb, ws, "Notas");
    const lida = lerPlanilhaLote(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const r = classificarPlanilhaLote(lida.linhas, CLASSIFICAR);
    expect(r.linhas[0].estado).toBe(ESTADO.PENDENTE);
    expect(r.linhas[0].pendencias[0].codigo).toBe("valor_ambiguo");
  });

  it("⚠ competência como célula de DATA de verdade chega como Date e é lida como data civil", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([CABECALHOS, linhaDe(NOTA)], { cellDates: true });
    const coluna = COLUNAS_LOTE.findIndex((c) => c.chave === "competencia");
    ws[XLSX.utils.encode_cell({ c: coluna, r: 1 })] = { t: "d", v: new Date(2026, 6, 31), z: "dd/mm/yyyy" };
    XLSX.utils.book_append_sheet(wb, ws, "Notas");
    const lida = lerPlanilhaLote(XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }));
    const r = classificarPlanilhaLote(lida.linhas, CLASSIFICAR);
    expect(r.linhas[0].estado).toBe(ESTADO.PRONTA);
    expect(r.linhas[0].dados.competencia.toISOString().slice(0, 10)).toBe("2026-07-31");
  });
});

describe("⚠ o que NÃO entra na planilha — a trava contra emitir contradizendo o cadastro", () => {
  const proibidas = [
    "cnpj do emitente",
    "codigo de servico",
    "codigo servico nacional",
    "serie",
    "serie da dps",
    "aliquota",
    "carga tributaria",
    "municipio emissor",
    "local da prestacao",
  ];

  it("nenhum desses rótulos é reconhecido como coluna", () => {
    for (const rotulo of proibidas) expect(chaveDaColuna(rotulo)).toBeNull();
  });

  // ⚠⚠ AS QUATRO, e nada do tomador além do documento. Dono, 20/08/2026: *"não precisamos de
  // nada do tomador, apenas o CNPJ ou CPF."*
  it("⚠⚠ as chaves da PLANILHA são exatamente as QUATRO", () => {
    expect(COLUNAS_LOTE.map((c) => c.chave)).toEqual(["documento", "descricao", "valor", "competencia"]);
  });

  it("⚠⚠ as quatro são TODAS obrigatórias — não há coluna opcional", () => {
    expect(COLUNAS_LOTE.every((c) => c.obrigatoria)).toBe(true);
  });

  // ⚠ Elas não sumiram do fluxo: mudaram de lugar. Quem as pede é a tela de revisão, e só
  // quando memória e consulta não responderem.
  it("⚠⚠ as sete do tomador saíram da PLANILHA e continuam em `CAMPOS_DA_REVISAO`", () => {
    const naPlanilha = CAMPOS_DA_REVISAO.filter((c) => c.naPlanilha).map((c) => c.chave);
    const soNaRevisao = CAMPOS_DA_REVISAO.filter((c) => !c.naPlanilha).map((c) => c.chave);
    expect(naPlanilha).toEqual(["documento", "descricao", "valor", "competencia"]);
    expect(soNaRevisao).toEqual(["nome", "email", "cMun", "cep", "xLgr", "nro", "xBairro", "xCpl"]);
    for (const chave of soNaRevisao) {
      // Nenhum rótulo delas é reconhecível como cabeçalho: a porta da planilha está fechada.
      const rotulo = CAMPOS_DA_REVISAO.find((c) => c.chave === chave).rotulo;
      expect(chaveDaColuna(rotulo)).toBeNull();
    }
  });

  // ⚠ *"Retire o campo de atividade — o cliente não sabe escolher isso"* (dono, 20/08/2026).
  // Nunca houve coluna de atividade, e continua não havendo: o código de serviço sai do CADASTRO.
  it("⚠ nem a planilha nem a revisão têm campo de atividade / código de serviço", () => {
    const chaves = CAMPOS_DA_REVISAO.map((c) => c.chave);
    for (const proibida of ["atividade", "cTribNac", "codigoServicoNacional", "codigoServicoMunicipal"]) {
      expect(chaves).not.toContain(proibida);
    }
  });
});
