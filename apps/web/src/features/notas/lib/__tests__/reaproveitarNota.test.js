// REAPROVEITAR UMA NOTA — o contrato que impede a nota nova de se dizer ser outra.
//
// A invariante mais cara está no primeiro describe: NENHUM identificador atravessa. Ela é testada
// por VARREDURA do objeto devolvido (não campo a campo), porque o defeito que ela previne é alguém
// acrescentar `chaveAcesso` ao objeto "só para a tela mostrar" — e um teste que só olhasse os
// campos conhecidos passaria por isso sem piscar.

import {
  CAMPOS_COPIADOS,
  CAMPOS_NAO_COPIADOS,
  MOTIVO_NAO_REAPROVEITAVEL,
  avisosDoReaproveitamento,
  modeloDeEmissaoDaNota,
  podeReaproveitar,
  valoresIniciaisDaNota,
} from "../reaproveitarNota";

function notaEmitida(patch = {}) {
  return {
    id: "nota-1",
    type: "NFSE",
    papel: "EMIT",
    numero: "13000",
    serie: "1",
    chaveAcesso: "33045572255387580000103000000013000260889699241",
    idNfse: "3304557202606000000013000",
    idDps: "DPS-13000",
    statusEfetivo: "autorizada",
    status: "EMITIDA",
    competencia: "2026-06-01T00:00:00.000Z",
    issueDate: "2026-06-10T00:00:00.000Z",
    total: "2300.00",
    tomadorNome: "TOMADOR EXEMPLO LTDA",
    tomadorDoc: "11.222.333/0001-91",
    ciclo: { situacao: "autorizada", eventoRegistrado: false, avisos: [] },
    itens: [{ id: "i1", descricao: "CONSULTORIA EM GESTAO", codigoServico: "140201", valor: "2300.00" }],
    ...patch,
  };
}

// Varre o objeto inteiro (chaves e valores, em qualquer profundidade) procurando um texto.
function contemEmQualquerLugar(objeto, alvo) {
  const pilha = [objeto];
  while (pilha.length) {
    const atual = pilha.pop();
    if (atual == null) continue;
    if (typeof atual === "string" || typeof atual === "number") {
      if (String(atual).includes(alvo)) return true;
      continue;
    }
    if (typeof atual !== "object") continue;
    for (const [chave, valor] of Object.entries(atual)) {
      if (chave.includes(alvo)) return true;
      pilha.push(valor);
    }
  }
  return false;
}

describe("⚠⚠ nota nova é nota nova — nenhum identificador é copiado", () => {
  const CAMPOS = ["numero", "chaveAcesso", "idNfse", "idDps", "serie", "rpsSerie", "rpsNumero"];

  it.each(CAMPOS)("o objeto de valores iniciais não tem campo `%s`", (campo) => {
    const valores = valoresIniciaisDaNota(notaEmitida());
    expect(valores.tomador).not.toHaveProperty(campo);
    expect(valores.servico).not.toHaveProperty(campo);
    expect(valores).not.toHaveProperty(campo);
  });

  it("o VALOR da chave de acesso não aparece em lugar nenhum do que vai para o formulário", () => {
    const nota = notaEmitida();
    const { origem, ...paraOFormulario } = valoresIniciaisDaNota(nota);
    expect(contemEmQualquerLugar(paraOFormulario, nota.chaveAcesso)).toBe(false);
    expect(contemEmQualquerLugar(paraOFormulario, nota.idDps)).toBe(false);
    expect(contemEmQualquerLugar(paraOFormulario, nota.idNfse)).toBe(false);
    // O NÚMERO da original só existe em `origem`, que é o texto da tela ("a partir da nota nº X"),
    // e nunca um campo do formulário.
    expect(contemEmQualquerLugar(paraOFormulario, "13000")).toBe(false);
    expect(origem.numero).toBe("13000");
  });

  it("a competência da original NÃO vira a competência da nota nova", () => {
    const valores = valoresIniciaisDaNota(notaEmitida());
    expect(valores.competencia).toBe("");
  });

  it("status e ciclo não entram no formulário", () => {
    const valores = valoresIniciaisDaNota(notaEmitida());
    expect(valores).not.toHaveProperty("status");
    expect(valores).not.toHaveProperty("statusEfetivo");
    expect(valores).not.toHaveProperty("ciclo");
  });
});

describe("o que É copiado", () => {
  it("documento (só dígitos), nome, descrição e valor", () => {
    const valores = valoresIniciaisDaNota(notaEmitida());
    expect(valores.tomador.cnpjCpf).toBe("11222333000191");
    expect(valores.tomador.nome).toBe("TOMADOR EXEMPLO LTDA");
    expect(valores.servico.descricao).toBe("CONSULTORIA EM GESTAO");
    expect(valores.servico.valorServicos).toBe("2300,00");
  });

  // ⚠ O assistente lê o campo com `Number(String(v).replace(",", "."))` — um replace só. Separador
  // de milhar viraria `NaN` e o valor preenchido apareceria como "precisa ser maior que zero".
  it("valor grande sai SEM separador de milhar, e o parse do assistente o aceita", () => {
    const valores = valoresIniciaisDaNota(notaEmitida({ total: "1234567.89" }));
    expect(valores.servico.valorServicos).toBe("1234567,89");
    expect(Number(String(valores.servico.valorServicos).replace(",", "."))).toBe(1234567.89);
  });

  it("e-mail, alíquota e retenção NÃO são copiados — a nota capturada não os guarda", () => {
    const valores = valoresIniciaisDaNota(notaEmitida());
    expect(valores.tomador.email).toBe("");
    expect(valores.servico.aliquota).toBe("");
    expect(valores.servico.issRetido).toBe(false);
  });

  // ⚠ A NFS-e tem UMA descrição (`xDescServ`). Emendar itens escreveria na nota nova uma frase que
  // ninguém redigiu — e ela sai impressa no DANFSe que vai ao tomador.
  it("com mais de um item descrito a descrição fica VAZIA, e a tela avisa", () => {
    const nota = notaEmitida({
      itens: [
        { id: "i1", descricao: "CURSO EAD", valor: "100.00" },
        { id: "i2", descricao: "MATERIAL DIDATICO", valor: "50.00" },
      ],
    });
    expect(valoresIniciaisDaNota(nota).servico.descricao).toBe("");
    expect(avisosDoReaproveitamento(nota).map((a) => a.codigo)).toContain("varios_itens");
  });

  it("itens repetindo a MESMA descrição continuam sendo uma descrição só", () => {
    const nota = notaEmitida({
      itens: [
        { id: "i1", descricao: "CURSO EAD", valor: "100.00" },
        { id: "i2", descricao: "CURSO EAD", valor: "50.00" },
      ],
    });
    expect(valoresIniciaisDaNota(nota).servico.descricao).toBe("CURSO EAD");
  });

  it("sem item nenhum, a descrição vem vazia com aviso próprio (não é o mesmo que vários itens)", () => {
    const nota = notaEmitida({ itens: [] });
    const codigos = avisosDoReaproveitamento(nota).map((a) => a.codigo);
    expect(codigos).toContain("sem_descricao");
    expect(codigos).not.toContain("varios_itens");
  });

  it("o código de serviço da original viaja só como referência de tela", () => {
    const valores = valoresIniciaisDaNota(notaEmitida());
    expect(valores.origem.codigosDaOriginal).toEqual(["140201"]);
    expect(valores.servico).not.toHaveProperty("codigoServico");
  });
});

describe("quem pode servir de modelo", () => {
  it("NFS-e emitida pela empresa pode", () => {
    expect(podeReaproveitar(notaEmitida()).pode).toBe(true);
  });

  it("NF-e não pode — este portal não emite nota de venda", () => {
    const r = podeReaproveitar(notaEmitida({ type: "NFE" }));
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_NAO_REAPROVEITAVEL.NAO_E_NFSE);
    expect(r.texto).toMatch(/NF-e/);
  });

  // Mesma razão pela qual a aba só alimenta as sugestões de tomador com `papel: "EMIT"`.
  it("nota RECEBIDA não pode — ofereceria a empresa como tomadora dela mesma", () => {
    const r = podeReaproveitar(notaEmitida({ papel: "DEST" }));
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_NAO_REAPROVEITAVEL.RECEBIDA);
  });

  it("nota sem tomador E sem valor não pode — não há o que copiar", () => {
    const r = podeReaproveitar(notaEmitida({ tomadorNome: null, tomadorDoc: null, total: null }));
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_NAO_REAPROVEITAVEL.SEM_DADOS);
  });

  it("nota mutilada mas com valor ainda serve — o resto se digita", () => {
    expect(podeReaproveitar(notaEmitida({ tomadorNome: null, tomadorDoc: null })).pode).toBe(true);
  });

  // ⚠⚠ A DECISÃO SOBRE CANCELADA/SUBSTITUÍDA. Copiar dados não é reemitir, e o caso relatado pelo
  // dono ("cancelamos essa nota, emitimos outra") É o reaproveitamento de uma cancelada: a nota
  // errada é o melhor modelo para a certa. O que não pode é a tela CALAR — ver o describe abaixo.
  it("cancelada e substituída CONTINUAM podendo servir de modelo", () => {
    expect(podeReaproveitar(notaEmitida({
      statusEfetivo: "cancelada", ciclo: { situacao: "cancelada" },
    })).pode).toBe(true);
    expect(podeReaproveitar(notaEmitida({
      statusEfetivo: "cancelada", ciclo: { situacao: "substituida" },
    })).pode).toBe(true);
  });
});

describe("os avisos — o silêncio é que confundiria", () => {
  it("SEMPRE diz que é nota nova, mesmo numa origem autorizada e sem nenhuma ressalva", () => {
    const avisos = avisosDoReaproveitamento(notaEmitida());
    expect(avisos[0].codigo).toBe("nota_nova");
    expect(avisos[0].texto).toMatch(/n[ãa]o (é|e) alterada, cancelada nem substitu/i);
  });

  it("origem CANCELADA: diz que ela continua cancelada e que a nova não a corrige", () => {
    const nota = notaEmitida({ statusEfetivo: "cancelada", ciclo: { situacao: "cancelada" } });
    const aviso = avisosDoReaproveitamento(nota).find((a) => a.codigo === "origem_cancelada");
    expect(aviso).toBeTruthy();
    expect(aviso.texto).toMatch(/continua cancelada/i);
    expect(aviso.texto).toMatch(/n[ãa]o a corrige nem a substitui/i);
  });

  it("origem SUBSTITUÍDA: aponta que quem vale é a substituta e que esta seria uma terceira nota", () => {
    const nota = notaEmitida({ statusEfetivo: "cancelada", ciclo: { situacao: "substituida" } });
    const aviso = avisosDoReaproveitamento(nota).find((a) => a.codigo === "origem_substituida");
    expect(aviso).toBeTruthy();
    expect(aviso.texto).toMatch(/substituta/i);
    expect(aviso.tom).toBe("atencao");
  });

  it("o ciclo passado por fora vence o da nota (é a MESMA leitura da lista e do detalhe)", () => {
    const nota = notaEmitida({ ciclo: null, statusEfetivo: "cancelada" });
    const codigos = avisosDoReaproveitamento(nota, { situacao: "substituida" }).map((a) => a.codigo);
    expect(codigos).toContain("origem_substituida");
    expect(codigos).not.toContain("origem_cancelada");
  });
});

describe("modeloDeEmissaoDaNota — valores e avisos numa peça só", () => {
  it("junta os dois, para que a tela não possa esquecer a metade que avisa", () => {
    const modelo = modeloDeEmissaoDaNota(notaEmitida({
      statusEfetivo: "cancelada", ciclo: { situacao: "cancelada" },
    }));
    expect(modelo.tomador.cnpjCpf).toBe("11222333000191");
    expect(modelo.avisos.map((a) => a.codigo)).toEqual(
      expect.arrayContaining(["nota_nova", "origem_cancelada"]),
    );
  });

  it("sem nota devolve null — não um objeto vazio que abriria o assistente prometendo dados", () => {
    expect(modeloDeEmissaoDaNota(null)).toBeNull();
  });
});

describe("as listas da tela e o código não podem divergir", () => {
  it("tudo que a lista de copiados promete tem correspondente nos valores devolvidos", () => {
    const valores = valoresIniciaisDaNota(notaEmitida());
    const presente = {
      tomadorDoc: valores.tomador.cnpjCpf,
      tomadorNome: valores.tomador.nome,
      descricao: valores.servico.descricao,
      valor: valores.servico.valorServicos,
    };
    for (const campo of CAMPOS_COPIADOS) {
      expect(presente[campo.chave]).toBeTruthy();
    }
  });

  it("cada item da lista de NÃO copiados traz o motivo por extenso", () => {
    expect(CAMPOS_NAO_COPIADOS.length).toBeGreaterThan(0);
    for (const campo of CAMPOS_NAO_COPIADOS) {
      expect(campo.rotulo.length).toBeGreaterThan(3);
      expect(campo.motivo.length).toBeGreaterThan(20);
    }
  });
});
