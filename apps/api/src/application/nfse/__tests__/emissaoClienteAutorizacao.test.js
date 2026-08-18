// A REGRA DO PORTÃO, sozinha — sem banco, sem HTTP.
//
// A matriz aqui é a mesma da suíte de rota (`routes/__tests__/portaoEmissaoNfse.test.js`): esta
// prova a DECISÃO, aquela prova a LIGAÇÃO (que a decisão é consultada nos dois atos fiscais e em
// nenhum caminho de leitura). Regra em `lib`/`application` com teste próprio + teste de ligação é
// o padrão do projeto.

import {
  decidirEmissaoCliente,
  pesoDoPapelCliente,
  CODIGO_NAO_LIBERADA,
  CODIGO_PAPEL_INSUFICIENTE,
  PAPEL_MINIMO_EMISSAO,
  PESO_PAPEL_CLIENTE,
} from "../emissaoClienteAutorizacao.js";

describe("pesos dos papéis do cliente", () => {
  it("são os mesmos do CLAUDE.md: OWNER(3) > CLIENT_ADMIN(2) > FINANCEIRO(1)", () => {
    expect(PESO_PAPEL_CLIENTE.OWNER).toBe(3);
    expect(PESO_PAPEL_CLIENTE.CLIENT_ADMIN).toBe(2);
    expect(PESO_PAPEL_CLIENTE.FINANCEIRO).toBe(1);
  });

  it("CLIENT_USER é legado e vale o mesmo que FINANCEIRO", () => {
    expect(PESO_PAPEL_CLIENTE.CLIENT_USER).toBe(PESO_PAPEL_CLIENTE.FINANCEIRO);
  });

  it("papel desconhecido/ausente pesa ZERO — nunca o mínimo", () => {
    expect(pesoDoPapelCliente(null)).toBe(0);
    expect(pesoDoPapelCliente("")).toBe(0);
    expect(pesoDoPapelCliente("SUPER_ADMIN")).toBe(0);
  });

  it("o mínimo da emissão é CLIENT_ADMIN (precedente: pró-labore, certificado A1 e sócios)", () => {
    expect(PAPEL_MINIMO_EMISSAO).toBe("CLIENT_ADMIN");
  });
});

describe("usuário do ESCRITÓRIO", () => {
  // ⚠ A REGRESSÃO MAIS CARA DESTA ENTREGA. Foi pelo caminho do contador que a única nota real do
  // sistema saiu (17/08/2026, em produção). Se a flag da empresa valesse para ele, ligar o portão
  // viraria pré-requisito para o escritório trabalhar.
  it("passa com a flag DESLIGADA", () => {
    expect(decidirEmissaoCliente({ ladoEscritorio: true, empresaLiberada: false, papelCliente: null }))
      .toEqual({ ok: true, via: "ESCRITORIO" });
  });

  it("passa com a flag desligada mesmo tendo um papel de cliente fraco no vínculo", () => {
    const r = decidirEmissaoCliente({ ladoEscritorio: true, empresaLiberada: false, papelCliente: "FINANCEIRO" });
    expect(r.ok).toBe(true);
  });
});

describe("usuário do CLIENTE — as duas guardas", () => {
  it("OWNER com a empresa liberada PASSA", () => {
    expect(decidirEmissaoCliente({ empresaLiberada: true, papelCliente: "OWNER" }).ok).toBe(true);
  });

  it("CLIENT_ADMIN com a empresa liberada PASSA (é exatamente o mínimo)", () => {
    expect(decidirEmissaoCliente({ empresaLiberada: true, papelCliente: "CLIENT_ADMIN" }).ok).toBe(true);
  });

  it("CLIENT_ADMIN com a empresa NÃO liberada é recusado, e o motivo é a EMPRESA", () => {
    const r = decidirEmissaoCliente({ empresaLiberada: false, papelCliente: "CLIENT_ADMIN" });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_NAO_LIBERADA);
    expect(r.motivos).toEqual([CODIGO_NAO_LIBERADA]);
  });

  it("FINANCEIRO com a empresa liberada é recusado, e o motivo é o PAPEL", () => {
    const r = decidirEmissaoCliente({ empresaLiberada: true, papelCliente: "FINANCEIRO" });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_PAPEL_INSUFICIENTE);
    expect(r.motivos).toEqual([CODIGO_PAPEL_INSUFICIENTE]);
    expect(r.papel).toBe("FINANCEIRO");
    expect(r.papelMinimo).toBe("CLIENT_ADMIN");
  });

  it("CLIENT_USER (legado) com a empresa liberada é recusado pelo papel", () => {
    const r = decidirEmissaoCliente({ empresaLiberada: true, papelCliente: "CLIENT_USER" });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_PAPEL_INSUFICIENTE);
  });

  it("sem vínculo de cliente (papel nulo) é recusado — ausência de papel não é papel", () => {
    const r = decidirEmissaoCliente({ empresaLiberada: true, papelCliente: null });
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_PAPEL_INSUFICIENTE);
    expect(r.papel).toBeNull();
  });

  it("faltando as DUAS, o código nomeia a empresa e `motivos` traz as duas", () => {
    // Nomear só uma esconderia a outra: o contador liberaria a empresa e o FINANCEIRO seria
    // recusado de novo, na chamada seguinte, por outro motivo.
    const r = decidirEmissaoCliente({ empresaLiberada: false, papelCliente: "FINANCEIRO" });
    expect(r.codigo).toBe(CODIGO_NAO_LIBERADA);
    expect(r.motivos).toEqual([CODIGO_NAO_LIBERADA, CODIGO_PAPEL_INSUFICIENTE]);
  });
});

describe("a recusa é sempre NOMEADA e acionável", () => {
  const casos = [
    ["empresa não liberada", { empresaLiberada: false, papelCliente: "OWNER" }],
    ["papel insuficiente", { empresaLiberada: true, papelCliente: "FINANCEIRO" }],
    ["as duas", { empresaLiberada: false, papelCliente: "FINANCEIRO" }],
  ];
  it.each(casos)("%s: traz codigo, message e correcao não vazios", (_nome, entrada) => {
    const r = decidirEmissaoCliente(entrada);
    expect(r.ok).toBe(false);
    expect(r.codigo).toBeTruthy();
    expect(String(r.message).length).toBeGreaterThan(10);
    expect(String(r.correcao).length).toBeGreaterThan(10);
  });

  it("os dois códigos são DISTINTOS — a empresa não liberada e o papel fraco têm conserto diferente", () => {
    expect(CODIGO_NAO_LIBERADA).not.toBe(CODIGO_PAPEL_INSUFICIENTE);
  });
});

describe("normalização do papel", () => {
  it("aceita minúsculas e espaços (o vínculo é dado de banco, não constante do código)", () => {
    expect(decidirEmissaoCliente({ empresaLiberada: true, papelCliente: " client_admin " }).ok).toBe(true);
  });
});

describe("entrada vazia", () => {
  it("sem argumento nenhum, RECUSA — o default do portão é fechado", () => {
    const r = decidirEmissaoCliente();
    expect(r.ok).toBe(false);
    expect(r.codigo).toBe(CODIGO_NAO_LIBERADA);
  });
});

// ⚠ AUTORIZAÇÃO NÃO SE ABRE POR COERÇÃO DE TIPO.
//
// A regra decidia por truthiness (`if (empresaLiberada && …)`), e `Boolean("false")` é `true`.
// Hoje a coluna é `BOOLEAN NOT NULL` e o portão coage antes de chamar — então isto não era
// alcançável pelo caminho atual. Mas a regra pura é o que um chamador futuro vai reusar sem ler o
// chamador de hoje, e é ela que precisa ser dura. Mesma disciplina de `semFaturamento === true`.
describe("⚠ a liberação exige `true`, não algo parecido com verdadeiro", () => {
  const cliente = { ladoEscritorio: false, papelCliente: "OWNER" };

  it.each([["true"], ["false"], [1], ["1"], [{}], [[]], ["sim"]])(
    "empresaLiberada=%p NÃO libera",
    (empresaLiberada) => {
      const r = decidirEmissaoCliente({ ...cliente, empresaLiberada });
      expect(r.ok).toBe(false);
      expect(r.codigo).toBe(CODIGO_NAO_LIBERADA);
    },
  );

  it("só o booleano `true` libera", () => {
    expect(decidirEmissaoCliente({ ...cliente, empresaLiberada: true }).ok).toBe(true);
  });

  it("⚠ e o relatório da decisão não mente sobre o que foi lido", () => {
    // `empresaLiberada: Boolean(entrada)` diria `true` para a string "false" — o eco da decisão
    // precisa refletir o que a regra de fato considerou.
    expect(decidirEmissaoCliente({ ...cliente, empresaLiberada: "false" }).empresaLiberada).toBe(false);
  });
});
