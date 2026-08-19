// O MODELO E A LEITURA — a viagem de ida e volta, e as recusas que não são silenciosas.
//
// ⚠ NADA AQUI EMITE COISA ALGUMA. Gera um .xlsx em memória e o lê de volta; sem banco, sem rede.

import * as XLSX from "xlsx";
import { gerarModeloPlanilhaLote, NOME_DA_ABA, NOME_DA_ABA_INSTRUCOES } from "../modeloPlanilhaLote.js";
import { lerPlanilhaLote, RECUSA_PLANILHA, MAX_LINHAS } from "../lerPlanilhaLote.js";
import { COLUNAS_LOTE, COLUNAS_DE_TEXTO, LINHA_DE_EXEMPLO, chaveDaColuna } from "../colunasLote.js";
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

const NOTA = {
  documento: "39254243000191",
  nome: "TOMADOR LTDA",
  descricao: "Consultoria",
  valor: "1500,00",
  competencia: "31/07/2026",
  cMun: "3304557",
  cep: "20031005",
  xLgr: "Av. Rio Branco",
  nro: "100",
  xBairro: "Centro",
};

describe("o modelo", () => {
  const modelo = gerarModeloPlanilhaLote();
  const wb = XLSX.read(modelo.buffer, { type: "buffer" });

  it("nasce com as 12 colunas, na ordem, e a aba de dados é a PRIMEIRA", () => {
    expect(COLUNAS_LOTE).toHaveLength(12);
    expect(wb.SheetNames[0]).toBe(NOME_DA_ABA);
    expect(wb.SheetNames).toContain(NOME_DA_ABA_INSTRUCOES);
    const [cabecalho] = XLSX.utils.sheet_to_json(wb.Sheets[NOME_DA_ABA], { header: 1 });
    expect(cabecalho).toEqual(CABECALHOS);
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

describe("a leitura — ida e volta", () => {
  it("lê o modelo preenchido e classifica tudo", () => {
    const buffer = planilhaDe([CABECALHOS, linhaDe(NOTA), linhaDe({ ...NOTA, nome: "OUTRO LTDA" })]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.ok).toBe(true);
    expect(lida.linhas).toHaveLength(2);
    expect(lida.linhas[0].numero).toBe(2);
    expect(lida.linhas[1].numero).toBe(3);

    const r = classificarPlanilhaLote(lida.linhas, { municipios: [["3304557", "Rio de Janeiro", "RJ"]] });
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
      ["cnpj cpf", "razao social", "descricao", "valor", "competencia"],
      ["39254243000191", "X LTDA", "Serviço", "1500,00", "31/07/2026"],
    ]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.ok).toBe(true);
    expect(lida.linhas[0].valores.nome).toBe("X LTDA");
  });

  it("⚠ linhas totalmente vazias são puladas, e as parciais NÃO", () => {
    const buffer = planilhaDe([CABECALHOS, linhaDe(NOTA), [], ["", "", ""], linhaDe({ nome: "SÓ O NOME" })]);
    const lida = lerPlanilhaLote(buffer);
    expect(lida.linhas).toHaveLength(2);
    expect(lida.linhas[1].valores.nome).toBe("SÓ O NOME");
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
      ["coluna a", "coluna b", "coluna c", "coluna d", "coluna e"],
      ["39254243000191", "X LTDA", "Serviço", "1500,00", "31/07/2026"],
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
    const r = classificarPlanilhaLote(lida.linhas, { municipios: [["3304557", "Rio de Janeiro", "RJ"]] });
    expect(r.linhas[0].estado).toBe(ESTADO.PRONTA);
    expect(r.linhas[0].documento).toBe("01234567890");
  });

  it("⚠ coluna NUMÉRICA come o zero — e a leitura o recupera, marcando a linha para CONFERÊNCIA", () => {
    // 1234567890 como NÚMERO é exatamente o que o Excel deixa de `01234567890`.
    const buffer = planilhaDe([CABECALHOS, linhaDe({ ...NOTA, documento: 1234567890 })]);
    const lida = lerPlanilhaLote(buffer);
    expect(typeof lida.linhas[0].valores.documento).toBe("number");
    const r = classificarPlanilhaLote(lida.linhas, { municipios: [["3304557", "Rio de Janeiro", "RJ"]] });
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
    const r = classificarPlanilhaLote(lida.linhas, { municipios: [["3304557", "Rio de Janeiro", "RJ"]] });
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
    const r = classificarPlanilhaLote(lida.linhas, { municipios: [["3304557", "Rio de Janeiro", "RJ"]] });
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

  it("as chaves da lista fechada são exatamente as 12 combinadas", () => {
    expect(COLUNAS_LOTE.map((c) => c.chave)).toEqual([
      "documento",
      "nome",
      "descricao",
      "valor",
      "competencia",
      "email",
      "cMun",
      "cep",
      "xLgr",
      "nro",
      "xBairro",
      "xCpl",
    ]);
  });

  it("as obrigatórias são cinco, e o e-mail NÃO é uma delas", () => {
    const obrigatorias = COLUNAS_LOTE.filter((c) => c.obrigatoria).map((c) => c.chave);
    expect(obrigatorias).toEqual(["documento", "nome", "descricao", "valor", "competencia"]);
  });
});
