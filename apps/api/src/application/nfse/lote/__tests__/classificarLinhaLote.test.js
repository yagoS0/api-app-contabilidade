// A CLASSIFICAÇÃO DE CADA LINHA — a lista fechada, e o que NUNCA vira "pronta".
//
// ⚠ NADA AQUI EMITE, CONSULTA OU ESCREVE. A função é pura; o teste também.

import {
  classificarLinhaLote,
  classificarPlanilhaLote,
  ESTADO,
  ORIGEM_DO_DADO,
  PENDENCIA,
  CONFERENCIA,
} from "../classificarLinhaLote.js";

const CNPJ = "39254243000191";
const CPF = "12219079724";

const ENDERECO_COMPLETO = {
  cMun: "3304557",
  cep: "20031005",
  xLgr: "Avenida Rio Branco",
  nro: "100",
  xBairro: "Centro",
};

/** A lista oficial do IBGE, injetada. Só as linhas que o teste usa — a forma é `[codigo, nome, uf]`. */
const MUNICIPIOS = [
  ["3304557", "Rio de Janeiro", "RJ"],
  ["3550308", "São Paulo", "SP"],
];

/**
 * Uma consulta BEM-SUCEDIDA, na forma que o front manda desde 20/08/2026.
 *
 * ⚠ `municipio`/`uf` são o NOME e a UF da MESMA resposta que trouxe o `cMun`. Sem eles o servidor
 * não fecha a prova 3 e recusa a linha — falha fechado, de propósito.
 */
const CONSULTA_OK = {
  ok: true,
  cMunVerificado: true,
  endereco: ENDERECO_COMPLETO,
  municipio: "Rio de Janeiro",
  uf: "RJ",
  /** ⚠ A razão social da MESMA resposta — desde 20/08/2026 é ela que preenche o nome do tomador. */
  nome: "COMERCIAL AURORA LTDA",
};

/**
 * ⚠ As células de uma linha. Só `documento`, `descricao`, `valor` e `competencia` podem ter vindo
 * da PLANILHA — as outras só existem se alguém as preencheu na tela de revisão. O `nome` fica no
 * padrão porque a maioria dos casos aqui mede outra coisa; os casos em que ele importa o apagam.
 */
function linha(valores, numero = 2) {
  return {
    numero,
    valores: {
      documento: CNPJ,
      nome: "TOMADOR LTDA",
      descricao: "Consultoria contábil",
      valor: "1500,00",
      competencia: "31/07/2026",
      email: "",
      cMun: "",
      cep: "",
      xLgr: "",
      nro: "",
      xBairro: "",
      xCpl: "",
      ...valores,
    },
  };
}

const codigos = (r) => [...r.pendencias, ...r.conferencias].map((p) => p.codigo);

describe("PRONTA — o caminho feliz, e ele exige endereço resolvido", () => {
  it("planilha com endereço completo e município conferido", () => {
    const r = classificarLinhaLote(linha(ENDERECO_COMPLETO), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.origemEndereco).toBe(ORIGEM_DO_DADO.REVISAO);
    expect(r.pendencias).toEqual([]);
    expect(r.dados.tomador.doc).toBe(CNPJ);
    expect(r.dados.tomador.endereco.CEP).toBe("20031005");
    expect(r.dados.servico.valorServicos).toBe(1500);
    expect(r.dados.competencia.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("⚠ tomador já conhecido: só preencher — sem consulta, sem conferência", () => {
    const r = classificarLinhaLote(linha({}), {
      tomadorConhecido: { ...ENDERECO_COMPLETO, xCpl: "Sala 2" },
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.origemEndereco).toBe(ORIGEM_DO_DADO.MEMORIA);
    expect(r.dados.tomador.endereco.xCpl).toBe("Sala 2");
  });

  it("⚠ o que a planilha traz VENCE a memória — o cliente está afirmando o endereço de hoje", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, xLgr: "Rua Nova" }), {
      tomadorConhecido: { ...ENDERECO_COMPLETO, xLgr: "Rua Antiga" },
      municipios: MUNICIPIOS,
    });
    expect(r.origemEndereco).toBe(ORIGEM_DO_DADO.REVISAO);
    expect(r.dados.tomador.endereco.xLgr).toBe("Rua Nova");
  });

  it("e-mail em branco NÃO é pendência — o validador não o exige", () => {
    const r = classificarLinhaLote(linha(ENDERECO_COMPLETO), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.dados.tomador.email).toBeNull();
  });
});

describe("CONSULTAR — e só para CNPJ", () => {
  it("CNPJ sem endereço e sem memória pede consulta", () => {
    const r = classificarLinhaLote(linha({}));
    expect(r.estado).toBe(ESTADO.CONSULTAR);
    expect(r.documento).toBe(CNPJ);
  });

  it("⚠⚠ CPF NÃO SE CONSULTA — vira pendência na hora, sem sugerir chamada nenhuma", () => {
    const r = classificarLinhaLote(linha({ documento: CPF }));
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CPF_SEM_ENDERECO);
  });

  it("CPF com endereço na planilha fica PRONTA — nada é consultado", () => {
    const r = classificarLinhaLote(linha({ documento: CPF, ...ENDERECO_COMPLETO }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.tipoDocumento).toBe("CPF");
  });

  it("consulta com o município provado CONTRA A LISTA preenche o endereço", () => {
    const r = classificarLinhaLote(linha({}), {
      municipios: MUNICIPIOS,
      consulta: {
        ok: true,
        endereco: { cMun: "3304557", CEP: "20031005", xLgr: "Av. Rio Branco", nro: "1", xBairro: "Centro" },
        // ⚠ O nome e a UF da MESMA resposta — é o que fecha a prova 3, agora no servidor.
        municipio: "Rio de Janeiro",
        uf: "RJ",
      },
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.origemEndereco).toBe(ORIGEM_DO_DADO.CONSULTA);
  });

  // ⚠⚠ O TESTE QUE DÁ SENTIDO À MUDANÇA DE 20/08/2026. Até aqui o servidor lia `cMunVerificado` e
  // aceitava. Um front adulterado — ou só defeituoso — afirmando `true` com o código de OUTRO
  // município emitiria a nota no município errado, e em lote isso é 50 notas de uma vez.
  it("⚠⚠ `cMunVerificado: true` NÃO é mais prova: código que não bate com a resposta é RECUSADO", () => {
    const r = classificarLinhaLote(linha({}), {
      municipios: MUNICIPIOS,
      consulta: {
        ok: true,
        cMunVerificado: true,
        // 3550308 é São Paulo/SP…
        endereco: { cMun: "3550308", CEP: "20031005", xLgr: "Av.", nro: "1", xBairro: "Centro" },
        // …e a resposta que trouxe esse código diz Rio de Janeiro/RJ.
        municipio: "Rio de Janeiro",
        uf: "RJ",
      },
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO);
    expect(r.pendencias[0].texto).toContain("São Paulo");
    expect(r.pendencias[0].texto).toContain("Rio de Janeiro");
  });

  it("⚠ consulta sem NOME/UF não fecha a prova 3 — recusa em vez de aceitar pela metade", () => {
    const r = classificarLinhaLote(linha({}), {
      municipios: MUNICIPIOS,
      consulta: {
        ok: true,
        cMunVerificado: true,
        endereco: { cMun: "3304557", CEP: "20031005", xLgr: "Av.", nro: "1", xBairro: "Centro" },
      },
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO);
  });

  it("⚠ código da consulta fora da lista oficial é RECUSADO", () => {
    const r = classificarLinhaLote(linha({}), {
      municipios: MUNICIPIOS,
      consulta: {
        ok: true,
        endereco: { cMun: "9999999", CEP: "20031005", xLgr: "Av.", nro: "1", xBairro: "Centro" },
        municipio: "Cidade Que Não Existe",
        uf: "RJ",
      },
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_MUNICIPIO_NAO_PROVADO);
  });

  // ⚠ Falha FECHADO, igual ao caminho da planilha: sem lista não se prova, e não provado não emite.
  it("⚠⚠ sem a lista injetada, a consulta NÃO vira PRONTA — cai em conferência", () => {
    const r = classificarLinhaLote(linha({}), {
      municipios: null,
      consulta: {
        ok: true,
        cMunVerificado: true,
        endereco: { cMun: "3304557", CEP: "20031005", xLgr: "Av.", nro: "1", xBairro: "Centro" },
        municipio: "Rio de Janeiro",
        uf: "RJ",
      },
    });
    expect(r.estado).toBe(ESTADO.CONFERIR);
    expect(codigos(r)).toContain(CONFERENCIA.MUNICIPIO_NAO_CONFERIDO);
  });

  it("⚠ falha da consulta é pendência DA LINHA, com o motivo — não é erro do cliente", () => {
    const r = classificarLinhaLote(linha({}), { consulta: { ok: false, motivo: "a BrasilAPI não respondeu" } });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_FALHOU);
    expect(r.pendencias[0].texto).toContain("a BrasilAPI não respondeu");
  });

  it("consulta que respondeu sem endereço completo é pendência, com o que faltou", () => {
    const r = classificarLinhaLote(linha({}), {
      consulta: { ok: true, cMunVerificado: true, endereco: null, faltantes: ["o número"] },
    });
    expect(codigos(r)).toContain(PENDENCIA.CONSULTA_SEM_ENDERECO);
    expect(r.pendencias[0].texto).toContain("o número");
  });
});

describe("CONFERIR — completa, mas com algo que esta camada não provou", () => {
  it("⚠⚠ sem a lista do IBGE, o cMun da planilha sai `municipio_nao_conferido` e a linha NÃO é PRONTA", () => {
    const r = classificarLinhaLote(linha(ENDERECO_COMPLETO), { municipios: null });
    expect(r.estado).toBe(ESTADO.CONFERIR);
    expect(codigos(r)).toContain(CONFERENCIA.MUNICIPIO_NAO_CONFERIDO);
    // Os dados continuam montados — a conferência é adiante, não uma recusa.
    expect(r.dados.tomador.endereco.cMun).toBe("3304557");
  });

  it("⚠ zero à esquerda recuperado vai para CONFERÊNCIA — nós mudamos o número que veio", () => {
    const r = classificarLinhaLote(linha({ documento: 1234567890, ...ENDERECO_COMPLETO }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.CONFERIR);
    expect(codigos(r)).toContain(CONFERENCIA.ZERO_A_ESQUERDA_RECUPERADO);
    expect(r.documento).toBe("01234567890");
  });

  it("⚠ e-mail malformado NÃO derruba a linha: ela sai sem e-mail, marcada", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, email: "financeiro" }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.CONFERIR);
    expect(codigos(r)).toContain(CONFERENCIA.EMAIL_FORA_DE_FORMA);
    expect(r.dados.tomador.email).toBeNull();
  });
});

describe("PENDENTE — o que só uma pessoa resolve", () => {
  const casos = [
    ["documento em branco", { documento: "" }, PENDENCIA.DOCUMENTO_AUSENTE],
    ["documento fora de forma", { documento: "123" }, PENDENCIA.DOCUMENTO_FORA_DE_FORMA],
    ["CPF com DV errado", { documento: "12219079725" }, PENDENCIA.CPF_DV_INVALIDO],
    ["zero comido sem DV que feche", { documento: 1221907972 }, PENDENCIA.DOCUMENTO_ZERO_A_ESQUERDA],
    ["descrição em branco", { descricao: "  " }, PENDENCIA.DESCRICAO_AUSENTE],
    ["valor em branco", { valor: "" }, PENDENCIA.VALOR_AUSENTE],
    ["valor ambíguo", { valor: "1.500" }, PENDENCIA.VALOR_AMBIGUO],
    ["valor zero", { valor: "0,00" }, PENDENCIA.VALOR_NAO_POSITIVO],
    ["competência em branco", { competencia: "" }, PENDENCIA.COMPETENCIA_AUSENTE],
    ["competência ilegível", { competencia: "julho" }, PENDENCIA.COMPETENCIA_ILEGIVEL],
  ];

  it.each(casos)("%s", (_nome, valores, codigo) => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, ...valores }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(codigo);
    expect(r.dados).toBeNull();
  });

  it("⚠⚠ ENDEREÇO É TUDO-OU-NADA: meio endereço é pendência, nunca “quase pronta”", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, nro: "" }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.ENDERECO_INCOMPLETO);
    expect(r.pendencias[0].texto).toContain("o número");
  });

  it("⚠ só o complemento preenchido também é meio endereço", () => {
    const r = classificarLinhaLote(linha({ xCpl: "Sala 2" }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.ENDERECO_INCOMPLETO);
  });

  // ⚠⚠ O NOME DE UM MUNICÍPIO NUNCA VIRA CÓDIGO. Este campo é preenchido por um SELETOR, e um nome
  // chegando aqui significa que alguém contornou a tela — a resposta é recusar e mandar escolher,
  // nunca resolver por semelhança: 240 nomes cobrem 521 municípios na lista oficial.
  it("nome de município no lugar do código é RECUSADO — e a frase manda escolher na lista", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, cMun: "Bom Jesus" }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.MUNICIPIO_FORA_DE_FORMA);
    expect(r.pendencias[0].texto).toContain("Escolha o município");
    expect(r.pendencias[0].texto).toContain("Bom Jesus");
  });

  it("⚠ com a lista injetada, código que não existe nela é RECUSADO", () => {
    const r = classificarLinhaLote(linha({ ...ENDERECO_COMPLETO, cMun: "9999999" }), {
      municipios: MUNICIPIOS,
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.MUNICIPIO_INEXISTENTE);
  });

  it("uma linha pode acumular pendências, e todas voltam nomeadas", () => {
    const r = classificarLinhaLote(linha({ documento: CPF, nome: "", valor: "", competencia: "" }));
    expect(r.pendencias.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O NOME DO TOMADOR — TRÊS ORIGENS, desde que ele deixou de ser coluna (20/08/2026)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Dono: *"não precisamos de nada do tomador, apenas o CNPJ ou CPF. Em caso que precise de mais
// > informações, na hora da revisão nós avisamos e permitimos o preenchimento."*
//
// O validador continua exigindo o nome (`tomador_nome_obrigatorio`) — o que mudou é de onde ele vem.
describe("⚠⚠ o NOME do tomador: revisão → memória → consulta", () => {
  it("o que a REVISÃO digitou vence memória e consulta", () => {
    const r = classificarLinhaLote(linha({ nome: "ESCRITO NA REVISAO", ...ENDERECO_COMPLETO }), {
      municipios: MUNICIPIOS,
      tomadorConhecido: { nome: "DA MEMORIA", ...ENDERECO_COMPLETO },
      consulta: CONSULTA_OK,
    });
    expect(r.dados.tomador.nome).toBe("ESCRITO NA REVISAO");
    expect(r.origemNome).toBe(ORIGEM_DO_DADO.REVISAO);
  });

  it("⚠ sem nome, a MEMÓRIA preenche — e a linha fica PRONTA, sem conferência extra", () => {
    const r = classificarLinhaLote(linha({ nome: "" }), {
      municipios: MUNICIPIOS,
      tomadorConhecido: { nome: "TOMADOR RECORRENTE LTDA", email: "fin@x.com.br", ...ENDERECO_COMPLETO },
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.dados.tomador.nome).toBe("TOMADOR RECORRENTE LTDA");
    expect(r.dados.tomador.email).toBe("fin@x.com.br");
    expect(r.origemNome).toBe(ORIGEM_DO_DADO.MEMORIA);
  });

  it("⚠ sem nome e sem memória, a CONSULTA preenche com a razão social", () => {
    const r = classificarLinhaLote(linha({ nome: "" }), { municipios: MUNICIPIOS, consulta: CONSULTA_OK });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.dados.tomador.nome).toBe("COMERCIAL AURORA LTDA");
    expect(r.origemNome).toBe(ORIGEM_DO_DADO.CONSULTA);
  });

  // ⚠⚠ Sem isto, um CNPJ cujo endereço a pessoa já digitou na revisão iria a PENDENTE por
  // `nome_ausente` sem que a Receita fosse sequer perguntada.
  it("⚠⚠ falta SÓ o nome e o endereço já veio da revisão: a linha pede CONSULTA, não pendência", () => {
    const r = classificarLinhaLote(linha({ nome: "", ...ENDERECO_COMPLETO }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.CONSULTAR);
  });

  it("⚠ consulta que responde SEM razão social não inventa nome — a linha fica pendente", () => {
    const r = classificarLinhaLote(linha({ nome: "", ...ENDERECO_COMPLETO }), {
      municipios: MUNICIPIOS,
      consulta: { ...CONSULTA_OK, nome: "" },
    });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toContain(PENDENCIA.NOME_AUSENTE);
  });

  // ⚠⚠ O CASO QUE O DONO NOMEOU: CPF novo NÃO TEM ORIGEM NENHUMA, e sempre vai à revisão.
  it("⚠⚠ CPF que nunca recebeu nota: sem nome e sem endereço, PENDENTE — e é a regra, não um buraco", () => {
    const r = classificarLinhaLote(linha({ documento: CPF, nome: "" }), { municipios: MUNICIPIOS });
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(codigos(r)).toEqual(
      expect.arrayContaining([PENDENCIA.NOME_AUSENTE, PENDENCIA.CPF_SEM_ENDERECO])
    );
    // As duas frases dizem POR QUE não sabemos — e nenhuma sugere consultar um CPF.
    const texto = r.pendencias.map((p) => p.texto).join(" ");
    expect(texto).toContain("CPF não se consulta");
  });

  it("⚠ CPF JÁ conhecido não vai à revisão: memória traz nome e endereço", () => {
    const r = classificarLinhaLote(linha({ documento: CPF, nome: "" }), {
      municipios: MUNICIPIOS,
      tomadorConhecido: { nome: "MARIA DE SOUZA", ...ENDERECO_COMPLETO },
    });
    expect(r.estado).toBe(ESTADO.PRONTA);
    expect(r.dados.tomador.nome).toBe("MARIA DE SOUZA");
  });

  // ⚠ A conferência já diz "a nota sai SEM e-mail". Preencher de outra fonte na mesma linha faria
  // a frase virar mentira.
  it("⚠ e-mail malformado NÃO cai para a memória", () => {
    const r = classificarLinhaLote(linha({ email: "financeiro" }), {
      municipios: MUNICIPIOS,
      tomadorConhecido: { nome: "X LTDA", email: "guardado@x.com.br", ...ENDERECO_COMPLETO },
    });
    expect(r.dados.tomador.email).toBeNull();
    expect(codigos(r)).toContain(CONFERENCIA.EMAIL_FORA_DE_FORMA);
  });
});

describe("⚠⚠ A LISTA É FECHADA — e o padrão nunca é “pronta”", () => {
  const cenarios = [
    [{}, {}],
    [{}, { municipios: MUNICIPIOS }],
    [ENDERECO_COMPLETO, {}],
    [ENDERECO_COMPLETO, { municipios: MUNICIPIOS }],
    [{ documento: CPF }, { municipios: MUNICIPIOS }],
    [{ documento: "" }, {}],
    [{ documento: 1234567890 }, { municipios: MUNICIPIOS }],
    [{ valor: "1,500" }, { municipios: MUNICIPIOS }],
    [{ email: "x" }, { municipios: MUNICIPIOS, tomadorConhecido: ENDERECO_COMPLETO }],
    [{}, { consulta: { ok: false, motivo: "timeout" } }],
    [{}, { consulta: { ok: true, endereco: null } }],
    [{}, { consulta: CONSULTA_OK }],
    [{ nro: "10" }, { municipios: MUNICIPIOS }],
  ];

  it("todo código produzido está na lista fechada", () => {
    const conhecidos = new Set([...Object.values(PENDENCIA), ...Object.values(CONFERENCIA)]);
    for (const [valores, opcoes] of cenarios) {
      for (const codigo of codigos(classificarLinhaLote(linha(valores), opcoes))) {
        expect([...conhecidos]).toContain(codigo);
      }
    }
  });

  it("todo estado produzido está na lista fechada", () => {
    for (const [valores, opcoes] of cenarios) {
      expect(Object.values(ESTADO)).toContain(classificarLinhaLote(linha(valores), opcoes).estado);
    }
  });

  it("⚠⚠ PRONTA exige as duas listas vazias E o endereço resolvido — sempre", () => {
    for (const [valores, opcoes] of cenarios) {
      const r = classificarLinhaLote(linha(valores), opcoes);
      if (r.estado !== ESTADO.PRONTA) continue;
      expect(r.pendencias).toEqual([]);
      expect(r.conferencias).toEqual([]);
      expect(r.origemEndereco).not.toBeNull();
      expect(Object.values(ORIGEM_DO_DADO)).toContain(r.origemEndereco);
    }
  });

  it("⚠ linha completamente desconhecida (objeto vazio) NÃO vira pronta", () => {
    const r = classificarLinhaLote({});
    expect(r.estado).toBe(ESTADO.PENDENTE);
    expect(r.dados).toBeNull();
  });

  it("⚠ toda pendência e toda conferência têm TEXTO — nenhuma é um código mudo", () => {
    for (const [valores, opcoes] of cenarios) {
      const r = classificarLinhaLote(linha(valores), opcoes);
      for (const item of [...r.pendencias, ...r.conferencias]) {
        expect(typeof item.texto).toBe("string");
        expect(item.texto.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("a planilha inteira — e os resultados PARCIAIS de consulta", () => {
  const planilha = [
    linha(ENDERECO_COMPLETO, 2),
    linha({ documento: CNPJ }, 3),
    linha({ documento: "39254243000282" }, 4),
    linha({ documento: CPF }, 5),
    linha({ valor: "1.500", ...ENDERECO_COMPLETO }, 6),
  ];

  it("classifica linha a linha e resume", () => {
    const r = classificarPlanilhaLote(planilha, { municipios: MUNICIPIOS });
    expect(r.resumo).toEqual({ total: 5, prontas: 1, conferir: 0, consultar: 2, pendentes: 2 });
  });

  it("⚠⚠ UMA LINHA RUIM NÃO INVALIDA A PLANILHA — as boas seguem", () => {
    const r = classificarPlanilhaLote(planilha, { municipios: MUNICIPIOS });
    expect(r.linhas[0].estado).toBe(ESTADO.PRONTA);
    expect(r.linhas[4].estado).toBe(ESTADO.PENDENTE);
  });

  it("⚠ `aConsultar` traz os CNPJs sem repetição, e nunca um CPF", () => {
    const r = classificarPlanilhaLote(planilha, { municipios: MUNICIPIOS });
    expect(r.aConsultar).toEqual([CNPJ, "39254243000282"]);
    expect(r.aConsultar).not.toContain(CPF);
  });

  it("⚠⚠ RESULTADO PARCIAL: reclassifica o que já foi consultado e deixa o resto em CONSULTAR", () => {
    const r = classificarPlanilhaLote(planilha, {
      municipios: MUNICIPIOS,
      consultas: {
        [CNPJ]: CONSULTA_OK,
        // 39254243000282 ainda não foi consultado — e isso não derruba nada.
      },
    });
    expect(r.linhas[1].estado).toBe(ESTADO.PRONTA);
    expect(r.linhas[2].estado).toBe(ESTADO.CONSULTAR);
    expect(r.aConsultar).toEqual(["39254243000282"]);
  });

  it("⚠ o mapa é POR DOCUMENTO: N linhas do mesmo CNPJ consomem UMA consulta", () => {
    const repetidas = [linha({}, 2), linha({}, 3), linha({}, 4)];
    expect(classificarPlanilhaLote(repetidas).aConsultar).toEqual([CNPJ]);
  });

  it("⚠ a memória é buscada pelo documento JÁ CORRIGIDO (zero recolocado)", () => {
    const r = classificarPlanilhaLote([linha({ documento: 1234567890 }, 2)], {
      municipios: MUNICIPIOS,
      tomadoresConhecidos: new Map([["01234567890", ENDERECO_COMPLETO]]),
    });
    expect(r.linhas[0].origemEndereco).toBe(ORIGEM_DO_DADO.MEMORIA);
    expect(r.linhas[0].estado).toBe(ESTADO.CONFERIR); // o zero recuperado continua marcado
  });

  // ⚠ O QUE ESTE TESTE MEDE É A FORMA DO MAPA (Map × objeto simples), não a regra do município —
  // por isso a lista é injetada nos DOIS lados. Até 20/08/2026 o primeiro caso rodava sem lista e
  // ainda assim esperava `PRONTA`, porque o servidor aceitava o `cMunVerificado` do navegador.
  // Hoje quem prova é o servidor: sem lista, nada da consulta vira `PRONTA` (há teste próprio para
  // isso, em "sem a lista injetada"), e manter aqui o caso sem lista mediria duas coisas ao mesmo
  // tempo — e falharia pela razão errada.
  it("aceita Map e objeto simples nos dois mapas", () => {
    const comMap = classificarPlanilhaLote([linha({}, 2)], {
      municipios: MUNICIPIOS,
      consultas: new Map([[CNPJ, CONSULTA_OK]]),
    });
    expect(comMap.linhas[0].estado).toBe(ESTADO.PRONTA);
    const comObjeto = classificarPlanilhaLote([linha({}, 2)], {
      municipios: MUNICIPIOS,
      consultas: { [CNPJ]: CONSULTA_OK },
    });
    expect(comObjeto.linhas[0].estado).toBe(ESTADO.PRONTA);
  });
});
