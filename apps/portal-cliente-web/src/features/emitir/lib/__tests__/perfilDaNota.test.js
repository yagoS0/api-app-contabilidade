// O PERFIL DE EMISSÃO NA TELA DO CLIENTE.
//
// ⚠⚠ O QUE ESTE ARQUIVO TRAVA, além do óbvio: **o que NÃO sai da tela**. A tentação é esvaziar o
// formulário do cliente até o fim — e três campos não podem sair, cada um por um motivo diferente.
// Há casos abaixo prendendo os três, porque a próxima pessoa a "simplificar" vai querer tirá-los.

import {
  SITUACAO,
  camposDoPerfil,
  conferirPerfilEscolhido,
  lerPerfis,
  perfilParaOPayload,
  textoDoPerfil,
} from "../perfilDaNota.js";

const P = (id, nome, padrao = false) => ({ id, nome, padrao });

describe("⚠ quatro situações, e a primeira é sobre a RESPOSTA", () => {
  it("resposta ausente é NAO_RECEBIDA — não é 'esta empresa não tem perfil'", () => {
    // Perfil é melhoria, não pré-requisito: rota fora do ar ou contrato antigo deixam a tela
    // exatamente como ela era.
    for (const r of [null, undefined, {}, { total: 0 }, "x", 3]) {
      expect(lerPerfis(r).situacao).toBe(SITUACAO.NAO_RECEBIDA);
    }
  });

  it("lista vazia é SEM_PERFIL", () => {
    expect(lerPerfis({ data: [] }).situacao).toBe(SITUACAO.SEM_PERFIL);
    expect(lerPerfis([]).situacao).toBe(SITUACAO.SEM_PERFIL);
  });

  it("um perfil é UNICO; dois ou mais é VARIOS", () => {
    expect(lerPerfis({ data: [P("a", "Consultoria")] }).situacao).toBe(SITUACAO.UNICO);
    expect(lerPerfis({ data: [P("a", "A"), P("b", "B")] }).situacao).toBe(SITUACAO.VARIOS);
  });

  it("⚠ perfil sem nome não vira opção — opção sem rótulo não se escolhe", () => {
    const r = lerPerfis({ data: [P("a", "Consultoria"), P("b", "  "), { id: "c" }] });
    expect(r.perfis.map((p) => p.id)).toEqual(["a"]);
    expect(r.situacao).toBe(SITUACAO.UNICO);
  });
});

describe("⚠⚠ o que SOME da tela — e só o que o perfil de fato responde", () => {
  it("sem perfil, NADA muda", () => {
    // É o estado de toda empresa até o contador configurar. Esconder campo que ninguém respondeu
    // produziria emissão recusada com o campo do conserto fora da tela.
    const c = camposDoPerfil(lerPerfis({ data: [] }));
    expect(c).toEqual({
      mostrarSeletor: false,
      codigoServicoNoFormulario: true,
      municipioDaPrestacaoNoFormulario: true,
    });
  });

  it("com perfil, o código de serviço e o município da prestação somem", () => {
    const c = camposDoPerfil(lerPerfis({ data: [P("a", "Consultoria")] }));
    expect(c.codigoServicoNoFormulario).toBe(false);
    expect(c.municipioDaPrestacaoNoFormulario).toBe(false);
  });

  it("⚠ o SELETOR só existe com mais de um — com um só não há o que escolher", () => {
    expect(camposDoPerfil(lerPerfis({ data: [P("a", "A")] })).mostrarSeletor).toBe(false);
    expect(camposDoPerfil(lerPerfis({ data: [P("a", "A"), P("b", "B")] })).mostrarSeletor).toBe(true);
  });

  it("resposta não recebida se comporta como 'sem perfil' na TELA", () => {
    // A distinção existe para o TEXTO (não afirmar coisa sobre o cadastro quando o problema é a
    // chamada); para os campos, o desfecho seguro é o mesmo: mostrar tudo.
    const c = camposDoPerfil(lerPerfis(null));
    expect(c.codigoServicoNoFormulario).toBe(true);
    expect(c.municipioDaPrestacaoNoFormulario).toBe(true);
  });
});

describe("⚠⚠ TRÊS CAMPOS NÃO SAEM DA TELA — e a lista não pode encolher por conta própria", () => {
  it("a alíquota efetiva do Simples NÃO é decidida por este módulo", () => {
    // ⚠ Ela é `DAS ÷ faturamento` DA COMPETÊNCIA e muda todo mês. Um perfil é estático: guardá-la
    // ali congelaria uma alíquota variável, impressa na nota (Lei 12.741/2012). Quem decide se ela
    // aparece continua sendo `impostosDaNota`, pelo REGIME.
    const c = camposDoPerfil(lerPerfis({ data: [P("a", "A")] }));
    expect(Object.keys(c).sort()).toEqual([
      "codigoServicoNoFormulario", "mostrarSeletor", "municipioDaPrestacaoNoFormulario",
    ]);
    expect(c.pTotTribSNNoFormulario).toBeUndefined();
  });

  it("a caixa de ISS retido NÃO é decidida por este módulo", () => {
    // Decisão do dono, 01/09/2026: a retenção depende do TOMADOR daquela nota, e o cliente marca.
    const c = camposDoPerfil(lerPerfis({ data: [P("a", "A")] }));
    expect(c.issNoFormulario).toBeUndefined();
    expect(c.issRetido).toBeUndefined();
  });

  it("a alíquota do ISS NÃO é decidida por este módulo", () => {
    // `pAliq` ainda não existe no perfil (o gerador não monta `tribMun/pAliq`). Enquanto isso ela
    // continua na tela, e só com a caixa marcada.
    const c = camposDoPerfil(lerPerfis({ data: [P("a", "A")] }));
    expect(c.aliquotaNoFormulario).toBeUndefined();
  });
});

describe("⚠⚠ com vários e nenhum escolhido, a tela RECUSA — não cai no padrão", () => {
  const varios = lerPerfis({ data: [P("a", "Consultoria"), P("b", "Exportação", true)] });

  it("recusa e diz o que falta", () => {
    // Cair no `padrao` faria o padrão virar a resposta de quem não respondeu — e os perfis existem
    // justamente porque a empresa tem operações com tributação diferente.
    for (const v of ["", null, undefined, "   "]) {
      const r = conferirPerfilEscolhido(varios, v);
      expect({ v: String(v), ok: r.ok }).toEqual({ v: String(v), ok: false });
      expect(r.falta).toBeTruthy();
    }
  });

  it("⚠ id que não está na lista também recusa — perfil desativado no meio do preenchimento", () => {
    const r = conferirPerfilEscolhido(varios, "zzz");
    expect(r.ok).toBe(false);
    expect(r.falta).toMatch(/não está mais disponível/);
  });

  it("com o escolhido válido, passa", () => {
    expect(conferirPerfilEscolhido(varios, "a")).toEqual({ ok: true });
  });

  it("nas outras situações não há o que conferir", () => {
    for (const s of [lerPerfis(null), lerPerfis({ data: [] }), lerPerfis({ data: [P("a", "A")] })]) {
      expect(conferirPerfilEscolhido(s, "")).toEqual({ ok: true });
    }
  });
});

describe("⚠ o que vai no payload — e o que NÃO vai", () => {
  it("com VÁRIOS, o id escolhido viaja", () => {
    const varios = lerPerfis({ data: [P("a", "A"), P("b", "B")] });
    expect(perfilParaOPayload(varios, "b")).toBe("b");
  });

  it("⚠⚠ com UM perfil, o campo NÃO é enviado — o servidor resolve sozinho", () => {
    // `null` = não mandar o campo. Mandar o id não mudaria o resultado e criaria uma segunda fonte
    // para a mesma decisão. Mesma escolha do ramo `UNICO` do código de serviço.
    const unico = lerPerfis({ data: [P("a", "A")] });
    expect(perfilParaOPayload(unico, "a")).toBeNull();
  });

  it("sem perfil ou sem resposta, nada viaja", () => {
    expect(perfilParaOPayload(lerPerfis({ data: [] }), "x")).toBeNull();
    expect(perfilParaOPayload(lerPerfis(null), "x")).toBeNull();
  });

  it("⚠ escolha vazia com vários vira `null`, nunca string vazia", () => {
    const varios = lerPerfis({ data: [P("a", "A"), P("b", "B")] });
    expect(perfilParaOPayload(varios, "  ")).toBeNull();
  });
});

describe("⚠ o texto nomeia o CONTADOR — o cliente precisa saber a quem recorrer", () => {
  it("com um perfil, diz qual é e de quem veio", () => {
    const t = textoDoPerfil(lerPerfis({ data: [P("a", "Consultoria RJ")] }));
    expect(t).toMatch(/"Consultoria RJ"/);
    expect(t).toMatch(/seu contador/);
  });

  it("com vários, pede a escolha e diz de quem são", () => {
    expect(textoDoPerfil(lerPerfis({ data: [P("a", "A"), P("b", "B")] }))).toMatch(/seu contador/);
  });

  it("⚠ sem perfil, NADA é dito — ausência visível não precisa de legenda", () => {
    // Critério transversal deste portal: *"sem sugestão não precisa ser falado, pois já está sem"*.
    expect(textoDoPerfil(lerPerfis({ data: [] }))).toBeNull();
    expect(textoDoPerfil(lerPerfis(null))).toBeNull();
  });

  it("⚠ o texto não usa vocabulário de DPS", () => {
    // Quem lê é o dono da empresa. `cTribNac`, `tribISSQN` e `regApTribSN` não aparecem na tela do
    // cliente — nem no nome do perfil, que é escolhido pelo contador, nem nestas frases.
    const textos = [
      textoDoPerfil(lerPerfis({ data: [P("a", "Consultoria")] })),
      textoDoPerfil(lerPerfis({ data: [P("a", "A"), P("b", "B")] })),
    ].join(" ");
    expect(textos).not.toMatch(/cTribNac|tribISSQN|regApTribSN|cLocPrestacao|DPS/);
  });
});
