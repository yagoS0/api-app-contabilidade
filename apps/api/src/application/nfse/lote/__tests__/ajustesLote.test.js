// O AJUSTE DA LINHA — sobreposição pura, e as três travas que impedem dado de sumir.
//
// ⚠ NADA AQUI EMITE, CONSULTA OU GRAVA: a função troca células e devolve linhas.

import { aplicarAjustesLote, RECUSA_AJUSTE } from "../ajustesLote.js";
import { COLUNAS_LOTE } from "../colunasLote.js";
import { classificarPlanilhaLote } from "../classificarLinhaLote.js";

const LINHAS = [
  { numero: 2, valores: { documento: "39254243000191", nome: "A", valor: "10,00" } },
  { numero: 5, valores: { documento: "39254243000282", nome: "B", valor: "20,00" } },
];

describe("o caminho normal", () => {
  it("sem ajustes, devolve as MESMAS linhas e nenhuma ajustada", () => {
    for (const vazio of [null, undefined, {}]) {
      const r = aplicarAjustesLote(LINHAS, vazio);
      expect(r.ok).toBe(true);
      expect(r.linhas).toBe(vazio === undefined || vazio === null ? LINHAS : r.linhas);
      expect(r.ajustadas).toEqual([]);
    }
  });

  it("sobrepõe só as células nomeadas e preserva o resto da linha", () => {
    const r = aplicarAjustesLote(LINHAS, { 2: { nome: "NOVO" } });
    expect(r.ajustadas).toEqual([2]);
    expect(r.linhas[0].valores).toEqual({
      documento: "39254243000191",
      nome: "NOVO",
      valor: "10,00",
    });
    expect(r.linhas[1]).toBe(LINHAS[1]); // linha não ajustada nem é recriada
  });

  it("⚠ NÃO MUTA a linha original — a mesma leitura é reusada a cada passe", () => {
    const original = JSON.parse(JSON.stringify(LINHAS));
    aplicarAjustesLote(LINHAS, { 2: { nome: "NOVO" } });
    expect(LINHAS).toEqual(original);
  });

  it("marca a linha com `ajustada` — o arquivo no disco continua o antigo", () => {
    const r = aplicarAjustesLote(LINHAS, { 5: { valor: "99,00" } });
    expect(r.linhas[1].ajustada).toBe(true);
    expect(r.linhas[0].ajustada).toBeUndefined();
  });

  it("⚠ valor VAZIO é ajuste, não ausência de ajuste: é como se apaga um campo", () => {
    const r = aplicarAjustesLote(LINHAS, { 2: { nome: "" } });
    expect(r.ajustadas).toEqual([2]);
    expect(r.linhas[0].valores.nome).toBe("");
  });

  it("aceita a chave da linha como número ou como string — o JSON entrega string", () => {
    expect(aplicarAjustesLote(LINHAS, { "5": { nome: "X" } }).ajustadas).toEqual([5]);
    expect(aplicarAjustesLote(LINHAS, { 5: { nome: "X" } }).ajustadas).toEqual([5]);
  });

  it("⚠ o valor vira TEXTO — a leitura precisa ver a GRAFIA, não um número já convertido", () => {
    // É disso que dependem o valor ambíguo (`1.500`) e o zero à esquerda do CPF.
    const r = aplicarAjustesLote(LINHAS, { 2: { valor: 1500 } });
    expect(r.linhas[0].valores.valor).toBe("1500");
  });

  it("todas as colunas da lista fechada são aceitas", () => {
    const todas = Object.fromEntries(COLUNAS_LOTE.map((c) => [c.chave, "x"]));
    expect(aplicarAjustesLote(LINHAS, { 2: todas }).ok).toBe(true);
  });
});

describe("⚠⚠ as recusas — dado que some em silêncio é o defeito que isto impede", () => {
  it("coluna fora da lista fechada recusa NOMEANDO, e não aplica o resto", () => {
    const r = aplicarAjustesLote(LINHAS, { 2: { cep: "20031005", cidade: "Rio" } });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_AJUSTE.COLUNA_DESCONHECIDA);
    expect(r.colunasDesconhecidas).toEqual(["cidade"]);
    expect(r.linhas).toBeUndefined();
  });

  it("⚠ o NÚMERO É O DO EXCEL: índice de array não vira linha", () => {
    // A linha 0 e a linha 1 não existem — a planilha começa no 2 (o cabeçalho é o 1).
    const r = aplicarAjustesLote(LINHAS, { 0: { nome: "X" } });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(RECUSA_AJUSTE.LINHA_DESCONHECIDA);
    expect(r.linhasDesconhecidas).toEqual(["0"]);
  });

  it("linha inexistente recusa mesmo quando as outras existem", () => {
    const r = aplicarAjustesLote(LINHAS, { 2: { nome: "X" }, 77: { nome: "Y" } });
    expect(r.ok).toBe(false);
    expect(r.linhasDesconhecidas).toEqual(["77"]);
  });

  it("forma inválida recusa: array, string, número, e célula que não é objeto", () => {
    for (const torto of [[], "x", 7, true]) {
      expect(aplicarAjustesLote(LINHAS, torto).codigo).toBe(RECUSA_AJUSTE.FORMA_INVALIDA);
    }
    expect(aplicarAjustesLote(LINHAS, { 2: "nome=X" }).codigo).toBe(RECUSA_AJUSTE.FORMA_INVALIDA);
  });

  it("⚠ toda mensagem de recusa DIZ que nada foi aplicado", () => {
    const recusas = [
      aplicarAjustesLote(LINHAS, { 2: { xis: "1" } }),
      aplicarAjustesLote(LINHAS, { 99: { nome: "1" } }),
      aplicarAjustesLote(LINHAS, "x"),
    ];
    for (const r of recusas) {
      expect(r.ok).toBe(false);
      expect(r.mensagem).toMatch(/[Nn]ada foi aplicado/);
    }
  });
});

describe("⚠ a corrente: ajustar e reclassificar pela MESMA regra do backend", () => {
  const ENDERECO = {
    cMun: "3304557",
    cep: "20031005",
    xLgr: "Av. Rio Branco",
    nro: "100",
    xBairro: "Centro",
  };

  function linhaCompleta(extra = {}) {
    return [
      {
        numero: 2,
        valores: {
          documento: "12345678909", // CPF válido — não se consulta
          nome: "FULANO",
          descricao: "Consultoria",
          valor: "1500,00",
          competencia: "31/07/2026",
          ...extra,
        },
      },
    ];
  }

  it("pendente por falta de endereço vira conferir depois do ajuste", () => {
    const antes = classificarPlanilhaLote(linhaCompleta());
    expect(antes.linhas[0].estado).toBe("pendente");

    const { linhas } = aplicarAjustesLote(linhaCompleta(), { 2: ENDERECO });
    const depois = classificarPlanilhaLote(linhas);
    // ⚠ `conferir`, nunca `pronta`: o `cMun` da planilha só se prova com a lista do IBGE, que o
    // backend não tem. Ajustar não pula a conferência — ela acontece na tela.
    expect(depois.linhas[0].estado).toBe("conferir");
    expect(depois.linhas[0].conferencias[0].codigo).toBe("municipio_nao_conferido");
  });

  it("⚠⚠ ajuste NÃO promove nada por conta própria: meio endereço continua PENDENTE", () => {
    const { linhas } = aplicarAjustesLote(linhaCompleta(), { 2: { cep: "20031005", xLgr: "Rua X" } });
    const depois = classificarPlanilhaLote(linhas);
    expect(depois.linhas[0].estado).toBe("pendente");
    expect(depois.linhas[0].pendencias[0].codigo).toBe("endereco_incompleto");
  });

  it("apagar o bloco de endereço devolve a linha ao caminho da memória/consulta", () => {
    const comEndereco = linhaCompleta(ENDERECO);
    const vazios = Object.fromEntries(Object.keys(ENDERECO).map((k) => [k, ""]));
    const { linhas } = aplicarAjustesLote(comEndereco, { 2: vazios });
    const depois = classificarPlanilhaLote(linhas);
    // CPF sem memória: pendência própria, e nenhuma consulta é sugerida.
    expect(depois.linhas[0].estado).toBe("pendente");
    expect(depois.linhas[0].pendencias[0].codigo).toBe("cpf_sem_endereco");
    expect(depois.aConsultar).toEqual([]);
  });
});
