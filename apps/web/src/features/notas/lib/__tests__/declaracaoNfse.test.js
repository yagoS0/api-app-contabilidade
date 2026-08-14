// A REGRA DE TELA DA DECLARAÇÃO, sozinha.
//
// Os defeitos que originaram o módulo:
//   1. o assistente não coletava `totTrib.pTotTribSN`, que o servidor exige quando a nota é
//      declarada como Simples — sem ele, `MISSING_P_TOT_TRIB_SN`, que a rota não mapeia e vira
//      `rejected` no banco (parecendo rejeição fiscal da prefeitura);
//   2. o `window.confirm` repetia DOIS campos e o espelho mostrava sete — duas descrições da mesma
//      nota, e a mais pobre era a que se lê no instante do clique;
//   3. a tela não mostrava o regime que a nota vai DECLARAR, que é o que define `opSimpNac`.
//
// ⚠ ESTE TESTE TRAVA UM ESPELHO. A regra do XML é do backend (`application/nfse/dpsCodigos.js`);
// aqui se trava que a TELA prevê o mesmo desfecho — inclusive as recusas, para que elas apareçam
// antes do clique em vez de depois de gastar uma emissão.

import {
  regimeDeclaradoNaNota,
  lerPTotTribSN,
  problemaAliquotaComRetencao,
  linhasDoEspelho,
  textoDeConfirmacao,
  textoIssRetido,
  formatarDoc,
  fmtPercent,
  RESOLUCAO,
} from "../declaracaoNfse";

const SIMPLES = regimeDeclaradoNaNota("SIMPLES");

const NOTA = {
  tomador: { nome: "ACME LTDA", doc: "12345678000199", email: "fin@acme.com" },
  endereco: null,
  servico: { descricao: "Consultoria contábil", valor: 1500, aliquota: 2, issRetido: false },
  competencia: "2026-08",
  referencia: "contrato 7",
  pTotTribSN: 6,
  regime: SIMPLES,
};

describe("o regime decide o opSimpNac — e o que não resolve RECUSA", () => {
  // As duas grafias do Simples convivem no projeto: `SIMPLES` vem do cadastro da empresa,
  // `SIMPLES_NACIONAL` do cadastro fiscal. As duas são o mesmo regime.
  it.each(["SIMPLES", "SIMPLES_NACIONAL"])("%s declara opSimpNac 3 e exige o pTotTribSN", (valor) => {
    const r = regimeDeclaradoNaNota(valor);
    expect(r.resolucao).toBe(RESOLUCAO.RESOLVIDO);
    expect(r.opSimpNac).toBe("3");
    expect(r.ehSimples).toBe(true);
    expect(r.exigePTotTribSN).toBe(true);
    expect(r.bloqueiaEmissao).toBe(false);
  });

  // ⚠ O defeito relatado: `opSimpNac` era cravado em "3" e a empresa do Lucro Presumido emitia nota
  // declarando Simples ME/EPP. Hoje ela resolve para 1 — e a emissão para de sair por outro motivo.
  it.each(["LUCRO_PRESUMIDO", "LUCRO_REAL"])("%s declara opSimpNac 1 e NÃO exige o pTotTribSN", (valor) => {
    const r = regimeDeclaradoNaNota(valor);
    expect(r.opSimpNac).toBe("1");
    expect(r.ehSimples).toBe(false);
    expect(r.exigePTotTribSN).toBe(false);
    expect(r.exigeTotTribNaoSimples).toBe(true);
  });

  // ⚠ E o não optante ainda NÃO emite: o servidor exige os percentuais da Lei 12.741/2012 e a
  // estrutura desse grupo no XML não foi confirmada. A tela diz isso antes do clique.
  it("não optante bloqueia a emissão, com o motivo nomeado", () => {
    const r = regimeDeclaradoNaNota("LUCRO_PRESUMIDO");
    expect(r.bloqueiaEmissao).toBe(true);
    expect(r.motivoDoBloqueio).toContain("não está liberada");
    expect(r.motivoDoBloqueio).toContain("12.741");
  });

  // ⚠ Duas versões do mesmo motivo: a longa explica, a curta cabe no `title` do botão e na lista
  // de pendências. Sem a curta, o mesmo parágrafo aparecia duas vezes na mesma tela.
  it("todo bloqueio tem motivo CURTO além do longo", () => {
    for (const valor of [null, "MEI", "REGIME_NOVO", "LUCRO_PRESUMIDO"]) {
      const r = regimeDeclaradoNaNota(valor);
      expect(r.bloqueiaEmissao).toBe(true);
      expect(r.motivoCurto).toBeTruthy();
      expect(r.motivoCurto.length).toBeLessThan(r.motivoDoBloqueio.length);
    }
    expect(regimeDeclaradoNaNota("SIMPLES").motivoCurto).toBeNull();
  });

  // ⚠ Terceira resposta obrigatória — sem regime não se afirma nem Simples nem não optante.
  it("empresa sem regime cadastrado é INDEFINIDO e não vira Simples por omissão", () => {
    const r = regimeDeclaradoNaNota(null);
    expect(r.resolucao).toBe(RESOLUCAO.INDEFINIDO);
    expect(r.opSimpNac).toBeNull();
    expect(r.rotuloCadastrado).toBeNull();
    expect(r.bloqueiaEmissao).toBe(true);
    expect(r.motivoDoBloqueio).toContain("não tem regime tributário cadastrado");
  });

  it("MEI é indefinido de propósito, e o motivo diz por quê", () => {
    const r = regimeDeclaradoNaNota("MEI");
    expect(r.resolucao).toBe(RESOLUCAO.INDEFINIDO);
    expect(r.motivoDoBloqueio).toContain("valor fixo");
  });

  it("regime desconhecido não escolhe código nenhum", () => {
    const r = regimeDeclaradoNaNota("REGIME_NOVO");
    expect(r.resolucao).toBe(RESOLUCAO.INDEFINIDO);
    expect(r.motivoDoBloqueio).toContain("não está mapeado");
  });

  // Sem resolução, exigir o percentual é o lado barato do erro: informado à toa é ignorado;
  // faltando, o servidor recusa.
  it("indefinido continua exigindo o pTotTribSN", () => {
    expect(regimeDeclaradoNaNota(null).exigePTotTribSN).toBe(true);
  });
});

describe("pTotTribSN — o campo que faltava", () => {
  it("vazio BLOQUEIA quando exigido, e diz por quê", () => {
    const l = lerPTotTribSN("");
    expect(l.preenchido).toBe(false);
    expect(l.valor).toBeNull();
    expect(l.problema).toContain("recusa a emissão");
  });

  it("vazio NÃO bloqueia quando a nota não é declarada como Simples", () => {
    expect(lerPTotTribSN("", { exigido: false }).problema).toBeNull();
  });

  it("aceita vírgula decimal, que é como o contador digita", () => {
    expect(lerPTotTribSN("6,84").valor).toBeCloseTo(6.84, 5);
  });

  it("zero é valor válido", () => {
    expect(lerPTotTribSN("0")).toEqual({ preenchido: true, valor: 0, problema: null });
  });

  it("texto não é número", () => {
    expect(lerPTotTribSN("seis").problema).toContain("número");
  });

  // ⚠ A faixa é a do VALIDADOR do servidor (`p_tot_trib_sn_invalido`): fora de 0–100 não é um
  // número grande, é outra unidade — provavelmente reais no lugar do percentual.
  it.each(["-1", "150", "1500"])("%s está fora de 0–100 e bloqueia", (valor) => {
    const l = lerPTotTribSN(valor);
    expect(l.valor).toBeNull();
    expect(l.problema).toContain("entre 0 e 100");
  });
});

describe("ISS retido — o rótulo diz a consequência, e a retenção exige alíquota", () => {
  it("retido nomeia o TOMADOR como quem recolhe", () => {
    expect(textoIssRetido(true)).toContain("TOMADOR");
    expect(textoIssRetido(true)).toContain("menos o ISS");
  });

  it("não retido nomeia o PRESTADOR", () => {
    expect(textoIssRetido(false)).toContain("PRESTADOR");
  });

  // ⚠ Sem retenção, alíquota vazia é legítima ("a da prefeitura").
  it("sem retenção, alíquota vazia não é problema", () => {
    expect(problemaAliquotaComRetencao({ issRetido: false, aliquota: "" })).toBeNull();
  });

  // ⚠ Com retenção o provedor exige alíquota > 0 (E0625) e o servidor recusa antes de emitir.
  it.each(["", "0", "abc"])("com retenção, alíquota %p bloqueia", (aliquota) => {
    expect(problemaAliquotaComRetencao({ issRetido: true, aliquota })).toContain("maior que zero");
  });

  it("com retenção e alíquota informada, passa", () => {
    expect(problemaAliquotaComRetencao({ issRetido: true, aliquota: "2,5" })).toBeNull();
  });
});

describe("uma descrição só da nota — espelho e confirm", () => {
  const rotulos = (dados) => linhasDoEspelho(dados).map((l) => l.rotulo);

  it("o espelho traz TODOS os dados que vão na declaração", () => {
    expect(rotulos(NOTA)).toEqual(expect.arrayContaining([
      "Tomador", "E-mail", "Endereço", "Serviço", "Competência", "Referência",
      "Valor dos serviços", "Alíquota de ISS", "ISS retido", "Regime declarado",
      "Total de tributos (Simples)",
    ]));
  });

  it("o percentual do Simples some do espelho de quem não é do Simples", () => {
    const r = rotulos({ ...NOTA, regime: regimeDeclaradoNaNota("LUCRO_PRESUMIDO") });
    expect(r).toContain("Regime declarado");
    expect(r).not.toContain("Total de tributos (Simples)");
  });

  it("o regime declarado aparece com o código que vai no XML", () => {
    const linha = linhasDoEspelho(NOTA).find((l) => l.rotulo === "Regime declarado");
    expect(linha.valor).toBe("Simples Nacional — ME/EPP (opSimpNac 3)");
  });

  it("regime indefinido aparece dizendo que a emissão será recusada", () => {
    const linha = linhasDoEspelho({ ...NOTA, regime: regimeDeclaradoNaNota(null) })
      .find((l) => l.rotulo === "Regime declarado");
    expect(linha.valor).toContain("recusada");
  });

  // ⚠ ESTE É O TESTE DO DEFEITO 2. O confirm é a MESMA lista, não um resumo.
  it("o confirm repete cada linha do espelho", () => {
    const texto = textoDeConfirmacao(NOTA);
    for (const l of linhasDoEspelho(NOTA)) {
      expect(texto).toContain(`• ${l.rotulo}: ${l.valor}`);
    }
    expect(texto).toContain("cancelamento com justificativa");
  });

  it("o confirm mostra alíquota, retenção, regime e percentual — o que ele omitia", () => {
    const texto = textoDeConfirmacao({ ...NOTA, servico: { ...NOTA.servico, issRetido: true } });
    expect(texto).toContain("2,00%");
    expect(texto).toContain("TOMADOR");
    expect(texto).toContain("6,00%");
    expect(texto).toContain("opSimpNac 3");
  });

  // Ausência nunca é resposta: campo que falta diz que falta, em vez de sumir da lista.
  it("percentual ausente aparece como 'não informado', não some da lista", () => {
    const linha = linhasDoEspelho({ ...NOTA, pTotTribSN: null })
      .find((l) => l.rotulo === "Total de tributos (Simples)");
    expect(linha.valor).toBe("não informado");
  });

  it("competência vazia e endereço ausente são ditos", () => {
    const linhas = linhasDoEspelho({ ...NOTA, competencia: "", endereco: null });
    expect(linhas.find((l) => l.rotulo === "Competência").valor).toBe("não informada");
    expect(linhas.find((l) => l.rotulo === "Endereço").valor).toBe("não informado");
  });

  it("endereço completo é impresso inteiro", () => {
    const v = linhasDoEspelho({
      ...NOTA,
      endereco: { cMun: "3304557", CEP: "20040002", xLgr: "Rua da Assembleia", nro: "10", xCpl: "sala 3", xBairro: "Centro" },
    }).find((l) => l.rotulo === "Endereço").valor;
    expect(v).toContain("Rua da Assembleia, 10");
    expect(v).toContain("sala 3");
    expect(v).toContain("Centro");
    expect(v).toContain("3304557");
  });

  it("alíquota vazia diz que vale a da prefeitura, em vez de mostrar 0%", () => {
    const linhas = linhasDoEspelho({ ...NOTA, servico: { ...NOTA.servico, aliquota: null } });
    expect(linhas.find((l) => l.rotulo === "Alíquota de ISS").valor).toBe("a da prefeitura");
  });
});

describe("formatação", () => {
  it("documento sai pontuado nos dois tamanhos", () => {
    expect(formatarDoc("12345678000199")).toBe("12.345.678/0001-99");
    expect(formatarDoc("12345678901")).toBe("123.456.789-01");
  });
  it("percentual usa vírgula", () => {
    expect(fmtPercent(6)).toBe("6,00%");
  });
});
