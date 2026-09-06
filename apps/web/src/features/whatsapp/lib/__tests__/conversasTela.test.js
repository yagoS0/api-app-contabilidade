import {
  situacaoDoFio,
  SITUACAO_FIO,
  rotuloDaSituacao,
  rotuloDoAutor,
  estadoDaResposta,
  fraseDoConsumo,
  ordenarConversas,
  FILTROS,
  identidadeDaConversa,
  ORIGEM_DO_NOME,
  descricaoDaMidia,
  frasePaginacao,
} from "../conversasTela";

describe("situacaoDoFio — o que a linha É", () => {
  it("sem empresa → fila sem empresa; assumida; chamou o escritório; com a IA", () => {
    expect(situacaoDoFio({ portalClientId: null })).toBe(SITUACAO_FIO.FILA_SEM_EMPRESA);
    expect(situacaoDoFio({ portalClientId: "pc", atendidaPor: "u1" })).toBe(SITUACAO_FIO.ASSUMIDA);
    expect(situacaoDoFio({ portalClientId: "pc", atendidaDesde: "2026-09-02" })).toBe(SITUACAO_FIO.FILA_DO_ESCRITORIO);
    expect(situacaoDoFio({ portalClientId: "pc" })).toBe(SITUACAO_FIO.COM_A_IA);
  });
  it("o rótulo distingue DESCONHECIDO de AMBIGUO, e nomeia quem assumiu", () => {
    expect(rotuloDaSituacao({ portalClientId: null, vinculo: { motivo: "AMBIGUO" } }).texto).toMatch(/mais de uma empresa/);
    expect(rotuloDaSituacao({ portalClientId: null, vinculo: { motivo: "DESCONHECIDO" } }).texto).toMatch(/sem cadastro/);
    expect(rotuloDaSituacao({ portalClientId: "pc", atendidaPor: "u1", atendente: { nome: "Ana" } }).texto).toBe("assumida por Ana");
    expect(rotuloDaSituacao({ portalClientId: null }).tom).toBe("aviso");
  });
});

describe("rotuloDoAutor", () => {
  it("entrada é o cliente; saída lê o autor; saída antiga sem autor é o escritório", () => {
    expect(rotuloDoAutor({ direcao: "in" }, { nomeDoCliente: "Maria" })).toBe("Maria");
    expect(rotuloDoAutor({ direcao: "out", autor: "IA" })).toBe("assistente (IA)");
    expect(rotuloDoAutor({ direcao: "out", autor: "HUMANO" })).toBe("escritório");
    expect(rotuloDoAutor({ direcao: "out", autor: "SISTEMA" })).toBe("mensagem fixa");
    expect(rotuloDoAutor({ direcao: "out", autor: null, tipo: "template" })).toBe("escritório (modelo)");
  });
});

describe("estadoDaResposta — a janela dita ANTES de digitar", () => {
  it("ABERTA pode; EXPIRADA e NUNCA_ABERTA não, com motivos diferentes; sem janela não sabe", () => {
    expect(estadoDaResposta({ janela: { situacao: "ABERTA" } }).pode).toBe(true);
    const e = estadoDaResposta({ janela: { situacao: "EXPIRADA" } });
    expect(e.pode).toBe(false);
    expect(e.motivo).toMatch(/fechou/);
    const n = estadoDaResposta({ janela: { situacao: "NUNCA_ABERTA" } });
    expect(n.motivo).toMatch(/nunca escreveu/);
    expect(estadoDaResposta({}).pode).toBe(false);
  });
});

describe("fraseDoConsumo e ordenação", () => {
  it("consumo é ESTIMATIVA e diz o teto; estourado grita", () => {
    expect(fraseDoConsumo({ escritorio: { centavos: 123, teto: 6000, chamadas: 4 } })).toBe("Assistente (IA) neste mês: US$ 1.23 de US$ 60.00 (estimativa, 4 chamadas).");
    expect(fraseDoConsumo({ escritorio: { centavos: 6000, teto: 6000, chamadas: 9, estourado: true } })).toMatch(/TETO ATINGIDO/);
    expect(fraseDoConsumo(null)).toMatch(/não foi possível/);
  });
  it("a fila vem primeiro, depois por atualização", () => {
    const l = ordenarConversas([
      { id: "a", portalClientId: "pc", updatedAt: "2026-09-02T10:00:00Z" },
      { id: "b", portalClientId: null, updatedAt: "2026-09-01T10:00:00Z" },
      { id: "c", portalClientId: "pc", updatedAt: "2026-09-02T12:00:00Z" },
    ]);
    expect(l.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("os três filtros são os do servidor", () => {
    expect(FILTROS.map((f) => f.valor)).toEqual(["todas", "nao-vinculadas", "atendidas-por-mim"]);
  });
});

// ── ⚠⚠ QUEM está falando E de QUAL empresa (06/09/2026) ────────────────────────────────────────
//
// A linha fazia `empresa?.razao || nomePerfilProvedor || telefone`: numa conversa de cliente o
// contador via a EMPRESA e nunca sabia QUEM estava falando. São duas perguntas, e uma não
// substitui a outra.

describe("identidadeDaConversa", () => {
  const base = { telefoneMascarado: "+55…8888" };

  it("o nome do CADASTRO manda, e a empresa vem junto — nunca uma OU outra", () => {
    const r = identidadeDaConversa({
      ...base,
      contato: { nome: "Maria Silva", papel: "sócia" },
      nomePerfilProvedor: "Mari 💅",
      empresa: { razao: "ACME LTDA", cnpj: "11222333000181" },
    });
    expect(r.pessoa).toBe("Maria Silva");
    expect(r.empresa).toBe("ACME LTDA");
    expect(r.papel).toBe("sócia");
    expect(r.origemDoNome).toBe(ORIGEM_DO_NOME.CADASTRO);
    // Nome do cadastro não precisa de ressalva.
    expect(r.avisoDoNome).toBeNull();
  });

  it("⚠ sem cadastro, o nome do PERFIL aparece — mas sai MARCADO", () => {
    // É o nome que a própria pessoa escreveu no aparelho dela; por isso ele nunca casa contato.
    const r = identidadeDaConversa({ ...base, nomePerfilProvedor: "Financeiro", empresa: null });
    expect(r.pessoa).toBe("Financeiro");
    expect(r.origemDoNome).toBe(ORIGEM_DO_NOME.PERFIL);
    expect(r.avisoDoNome).toMatch(/não do cadastro/);
  });

  it("sem nome nenhum, o telefone — e a origem diz isso", () => {
    const r = identidadeDaConversa({ ...base });
    expect(r.pessoa).toBe("+55…8888");
    expect(r.origemDoNome).toBe(ORIGEM_DO_NOME.TELEFONE);
  });

  it("⚠ sem empresa não se inventa: o estado da fila é DITO", () => {
    const r = identidadeDaConversa({ ...base, nomePerfilProvedor: "Novo contato" });
    expect(r.semEmpresa).toBe(true);
    expect(r.linhaDaEmpresa).toMatch(/sem empresa/);
  });

  it("conversa nula não quebra", () => {
    expect(identidadeDaConversa(null).pessoa).toBe("número desconhecido");
    expect(identidadeDaConversa(undefined).semEmpresa).toBe(true);
  });
});

describe("descricaoDaMidia", () => {
  it("texto não vira frase de mídia", () => {
    expect(descricaoDaMidia({ tipo: "text", corpo: "oi" })).toBeNull();
  });

  it("diz O QUE chegou e que não dá para abrir ainda", () => {
    expect(descricaoDaMidia({ tipo: "image" })).toMatch(/imagem/);
    expect(descricaoDaMidia({ tipo: "image" })).toMatch(/ainda não baixa/);
    expect(descricaoDaMidia({ tipo: "audio" })).toMatch(/áudio/);
  });

  it("⚠ tipo desconhecido aparece COMO VEIO — não vira o nome do vizinho", () => {
    expect(descricaoDaMidia({ tipo: "poll" })).toMatch(/"poll"/);
    expect(descricaoDaMidia({ tipo: "poll" })).toMatch(/não sei exibir/);
  });
});

describe("⚠ frasePaginacao — três respostas, e a terceira é 'não sei'", () => {
  it("com mais, avisa", () => {
    expect(frasePaginacao(true)).toMatch(/mais antigas/);
  });

  it("cabendo tudo, cala", () => {
    expect(frasePaginacao(false)).toBeNull();
  });

  it("⚠ servidor antigo (sem o campo) NÃO vira 'não há mais'", () => {
    expect(frasePaginacao(undefined)).toMatch(/Não dá para afirmar/);
  });
});
