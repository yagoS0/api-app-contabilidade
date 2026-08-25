// REAPROVEITAR UMA NOTA (portal do CLIENTE) — o contrato que impede a nota nova de se dizer ser
// outra, e a diferença pedida pelo dono: o VALOR vem vazio.
//
// ⚠ A invariante mais cara está no primeiro `describe`, e ela é testada por **VARREDURA** do objeto
// devolvido — não campo a campo. O defeito que ela previne é alguém acrescentar `chaveAcesso` ao
// objeto "só para a tela mostrar": um teste que olhasse só os campos conhecidos passaria por isso
// sem piscar. É a mesma disciplina de `apps/web/.../lib/__tests__/reaproveitarNota.test.js`.
//
// ⚠ A fixture traz identificadores que o contrato do cliente NÃO manda hoje (`chaveAcesso`,
// `idNfse`, `idDps`, `serie`). Isso é deliberado: a varredura tem de continuar valendo no dia em
// que `serializeInvoice` (`apps/api/src/routes/portalInvoices.js`) passar a mandá-los.

import {
  MOTIVO_NAO_REAPROVEITAVEL,
  avisosDoReaproveitamento,
  camposDaNota,
  modeloDeEmissaoDaNota,
  podeReaproveitar,
} from "../reaproveitarNota";
// ⚠ A leitura REAL do campo, não uma reimplementação: se o campo e o pré-preenchimento divergirem,
// é aqui que tem de aparecer.
import { lerValorDoCampo } from "../valorDaNota";

const CNPJ_DA_EMPRESA = "11222333000181";

/** A forma REAL do payload do cliente (`serializeInvoice`), mais os identificadores de guarda. */
function notaEmitida(patch = {}) {
  return {
    invoiceId: "inv-1001",
    type: "NFSE",
    numero: "13000",
    competencia: "2026-06",
    issueDate: "2026-06-10T00:00:00.000Z",
    status: "EMITIDA",
    total: 2300,
    emitente: { nome: "ACME SERVICOS LTDA", cnpj: CNPJ_DA_EMPRESA },
    tomador: { nome: "TOMADOR EXEMPLO LTDA", cnpjCpf: "44.555.666/0001-77" },
    updatedAt: "2026-06-11T00:00:00.000Z",
    hasXml: true,
    hasPdf: false,
    // ⚠ Não vêm no contrato de hoje — estão aqui para a varredura ter o que pegar.
    chaveAcesso: "33045572255387580000103000000013000260889699241",
    idNfse: "3304557202606000000013000",
    idDps: "DPS-13000",
    serie: "1",
    ...patch,
  };
}

/** Varre o objeto inteiro (chaves e valores, em qualquer profundidade) procurando um texto. */
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

const modelo = (patch, opcoes) =>
  modeloDeEmissaoDaNota(notaEmitida(patch), { companyId: "pc-001", cnpjDaEmpresa: CNPJ_DA_EMPRESA, ...opcoes });

describe("⚠⚠ nota nova é nota nova — nenhum identificador atravessa", () => {
  const IDENTIFICADORES = ["numero", "chaveAcesso", "idNfse", "idDps", "serie", "rpsSerie", "rpsNumero"];

  it.each(IDENTIFICADORES)("os campos do formulário não têm `%s`", (campo) => {
    expect(camposDaNota(notaEmitida())).not.toHaveProperty(campo);
  });

  it("nenhum VALOR de identificador aparece em lugar nenhum dos campos do formulário", () => {
    const nota = notaEmitida();
    const campos = camposDaNota(nota);
    for (const alvo of [nota.chaveAcesso, nota.idNfse, nota.idDps, nota.numero, nota.invoiceId]) {
      expect(contemEmQualquerLugar(campos, alvo)).toBe(false);
    }
  });

  // ⚠ O número da original existe SÓ em `origem` — o texto "a partir da nota nº X" — e nunca como
  // campo do formulário. É esta separação que a varredura acima protege.
  it("o número da original vive em `origem`, e `origem` não é campo de formulário", () => {
    const m = modelo();
    expect(m.origem.numero).toBe("13000");
    expect(contemEmQualquerLugar(m.campos, "13000")).toBe(false);
  });

  // ⚠ A LISTA FECHADA: campo novo no modelo tem de ser uma decisão, não um efeito colateral.
  it("os campos são EXATAMENTE os cinco do formulário — nem um a mais", () => {
    expect(Object.keys(camposDaNota(notaEmitida())).sort()).toEqual([
      "descricao",
      "tomadorDoc",
      "tomadorEmail",
      "tomadorNome",
      "valorServicos",
    ]);
  });

  it("competência, status e ciclo da original não entram no formulário", () => {
    const campos = camposDaNota(notaEmitida());
    expect(campos).not.toHaveProperty("competencia");
    expect(campos).not.toHaveProperty("status");
    expect(campos).not.toHaveProperty("statusEfetivo");
    expect(campos).not.toHaveProperty("ciclo");
    expect(contemEmQualquerLugar(campos, "2026-06")).toBe(false);
  });
});

// ⚠⚠ ESTE BLOCO FOI INVERTIDO EM 19/08/2026, E A INVERSÃO É O REGISTRO DE DUAS DECISÕES DO DONO.
//
//   18/08/2026 — *"apenas apagando o valor"*  ⇒ `valorServicos` saía `""`, e era isto que estes
//                casos travavam.
//   19/08/2026 — ele pediu a nota *"100% idêntica"*; os dois pedidos eram opostos, e perguntado
//                qual valia respondeu **"copia"**.
//
// ⚠ NÃO APAGUEI E NÃO RELAXEI: os mesmos cenários continuam aqui, medindo o comportamento OPOSTO.
// Apagá-los perderia a prova de que o "0,00" nunca aparece; relaxar para `toBeTruthy()` deixaria a
// decisão de 19/08 ser desfeita por acidente, que é justamente o que aconteceria se o bloco
// sumisse. A razão da segunda decisão: há uma tela inteira de conferência antes de emitir, e na
// prática o valor se repete (serviço recorrente).
describe("⚠⚠ O VALOR É COPIADO (dono, 19/08/2026 — reverte o vazio de 18/08), e nunca vira 0,00", () => {
  it("com total na nota, o campo do valor vem PREENCHIDO, na forma canônica do campo mascarado", () => {
    // ⚠ `1.234,56`, não `2300` nem `"2300.00"`: o campo é mascarado, e só esta forma ele sabe ler.
    expect(camposDaNota(notaEmitida({ total: 2300 })).valorServicos).toBe("2.300,00");
  });

  it("⚠ o valor copiado é RELIDO pelo campo como o mesmo número — ida e volta sem perda", () => {
    for (const [total, esperado] of [[2300, 2300], [1234567.89, 1234567.89], [0.5, 0.5], [1, 1]]) {
      const v = camposDaNota(notaEmitida({ total })).valorServicos;
      expect(lerValorDoCampo(v)).toBe(esperado);
    }
  });

  it("⚠ total AUSENTE ou não positivo continua abrindo o campo VAZIO — nunca 0,00", () => {
    // Este era o coração do bloco antigo, e ele NÃO mudou: zero é uma AFIRMAÇÃO sobre quanto vale
    // a nota, e um campo pré-preenchido com "0,00" a partir de dado ausente seria essa afirmação.
    for (const total of [0, null, undefined, -5, "abc"]) {
      const v = camposDaNota(notaEmitida({ total })).valorServicos;
      expect(v).toBe("");
      expect(v).not.toBe("0,00");
      expect(lerValorDoCampo(v)).toBeNull();
    }
  });

  // ⚠ A LINHA DO PAINEL MUDOU DE SENTIDO junto com o comportamento: era "digite", virou "confira".
  // Deixar a frase antiga sobreviver seria a mentira que esta rodada inteira está consertando.
  it("o aviso vira CONFERÊNCIA, e a frase antiga não sobrevive", () => {
    const aviso = avisosDoReaproveitamento(notaEmitida({ total: 2300 }))
      .find((a) => a.codigo === "valor_copiado");
    expect(aviso).toBeTruthy();
    expect(aviso.texto).toMatch(/confira antes de emitir/i);
    expect(aviso.texto).toMatch(/2\.300,00/);
    expect(aviso.tom).toBe("atencao");
    // ⚠ A frase de 18/08 não pode continuar em lugar nenhum dos avisos.
    const todos = avisosDoReaproveitamento(notaEmitida({ total: 2300 })).map((a) => a.texto).join(" ");
    expect(todos).not.toMatch(/N[ÃA]O foi copiado/i);
  });

  // ⚠ E o ramo oposto continua nomeado — mas agora ele diz outra coisa: não é "escolhemos não
  // copiar", é "a nota de origem não tinha total utilizável".
  it("sem total utilizável, o aviso volta a pedir que se digite — com o motivo certo", () => {
    const aviso = avisosDoReaproveitamento(notaEmitida({ total: null }))
      .find((a) => a.codigo === "valor_em_branco");
    expect(aviso).toBeTruthy();
    expect(aviso.texto).toMatch(/não veio da nota de origem/i);
    expect(aviso.texto).toMatch(/digite o valor/i);
  });
});

// ⚠⚠ A DESCRIÇÃO PASSOU A CHEGAR NO CONTRATO — 19/08/2026, pedido do dono.
//
// Antes, `serializeInvoice` não trazia a descrição e a rota de detalhe respondia `items: []`
// cravado: o campo abria SEMPRE vazio, com aviso. Hoje o contrato traz `descricao`, lida da COLUNA
// `PortalInvoice.xDescServ` — não de XML parseado a cada listagem, que era a alternativa cara e o
// motivo de a decisão ter subido antes de ser construída.
describe("⚠⚠ a DESCRIÇÃO vem da nota de origem (19/08/2026)", () => {
  it("com `descricao` no contrato, ela é copiada", () => {
    expect(camposDaNota(notaEmitida({ descricao: "CONSULTORIA EM GESTAO" })).descricao)
      .toBe("CONSULTORIA EM GESTAO");
  });

  it("o espaço em volta é aparado", () => {
    expect(camposDaNota(notaEmitida({ descricao: "  SERVICO X  " })).descricao).toBe("SERVICO X");
  });

  it("⚠ NULO CONTINUA SENDO RESPOSTA — nota anterior ao backfill abre o campo vazio, com aviso", () => {
    const campos = camposDaNota(notaEmitida({ descricao: null }));
    expect(campos.descricao).toBe("");
    const codigos = avisosDoReaproveitamento(notaEmitida({ descricao: null })).map((a) => a.codigo);
    expect(codigos).toContain("sem_descricao");
  });

  it("com descrição, o aviso de ausência NÃO aparece", () => {
    const codigos = avisosDoReaproveitamento(notaEmitida({ descricao: "SERVICO X" })).map((a) => a.codigo);
    expect(codigos).not.toContain("sem_descricao");
  });

  it("⚠⚠ MAIS DE UM ITEM continua vencendo: descrição VAZIA, com aviso", () => {
    // A regra é anterior a tudo isto e não foi tocada: emendar dois itens com " · " escreveria na
    // nota nova uma frase que ninguém redigiu, e ela sai impressa no DANFSe que vai ao tomador.
    const nota = notaEmitida({
      descricao: "ISTO NAO PODE VENCER",
      itens: [{ descricao: "ITEM A" }, { descricao: "ITEM B" }],
    });
    expect(camposDaNota(nota).descricao).toBe("");
    expect(avisosDoReaproveitamento(nota).map((a) => a.codigo)).toContain("varios_itens");
  });

  it("⚠ `itens` com UM item vence o campo único — ele é mais específico", () => {
    const nota = notaEmitida({ descricao: "DO CAMPO UNICO", itens: [{ descricao: "DO ITEM" }] });
    expect(camposDaNota(nota).descricao).toBe("DO ITEM");
  });

  it("⚠ a descrição NÃO é identificador — a varredura de identificadores continua valendo", () => {
    const campos = camposDaNota(notaEmitida({ descricao: "SERVICO X" }));
    expect(campos).not.toHaveProperty("numero");
    expect(campos).not.toHaveProperty("chaveAcesso");
    expect(campos).not.toHaveProperty("competencia");
  });
});

describe("o que É copiado", () => {
  it("documento (só dígitos) e nome do tomador", () => {
    const campos = camposDaNota(notaEmitida());
    expect(campos.tomadorDoc).toBe("44555666000177");
    expect(campos.tomadorNome).toBe("TOMADOR EXEMPLO LTDA");
  });

  it("e-mail do tomador não é copiado — a nota capturada não o guarda", () => {
    expect(camposDaNota(notaEmitida()).tomadorEmail).toBe("");
  });

  // ⚠ MEDIDO: `serializeInvoice` não devolve `itens`, e a rota de detalhe responde `items: []`.
  // Então este é o caminho de VERDADE deste portal — a descrição sempre vem vazia, com aviso.
  it("a descrição não chega neste portal: campo vazio e aviso próprio", () => {
    expect(camposDaNota(notaEmitida()).descricao).toBe("");
    const codigos = avisosDoReaproveitamento(notaEmitida()).map((a) => a.codigo);
    expect(codigos).toContain("sem_descricao");
    expect(codigos).not.toContain("varios_itens");
  });

  it("com UM item descrito (se o contrato passar a trazê-lo), a descrição é copiada", () => {
    const nota = notaEmitida({ itens: [{ descricao: "CONSULTORIA EM GESTAO", valor: "2300.00" }] });
    expect(camposDaNota(nota).descricao).toBe("CONSULTORIA EM GESTAO");
    expect(avisosDoReaproveitamento(nota).map((a) => a.codigo)).not.toContain("sem_descricao");
  });

  // ⚠ A NFS-e tem UMA descrição (`xDescServ`). Emendar itens escreveria na nota nova uma frase que
  // ninguém redigiu — e ela sai impressa no DANFSe que vai ao tomador.
  it("com mais de um item descrito a descrição fica VAZIA, e a tela avisa", () => {
    const nota = notaEmitida({
      itens: [{ descricao: "CURSO EAD" }, { descricao: "MATERIAL DIDATICO" }],
    });
    expect(camposDaNota(nota).descricao).toBe("");
    expect(avisosDoReaproveitamento(nota).map((a) => a.codigo)).toContain("varios_itens");
  });

  it("itens repetindo a MESMA descrição continuam sendo uma descrição só", () => {
    const nota = notaEmitida({ itens: [{ descricao: "CURSO EAD" }, { descricao: "CURSO EAD" }] });
    expect(camposDaNota(nota).descricao).toBe("CURSO EAD");
  });
});

describe("quem pode servir de modelo", () => {
  it("NFS-e emitida pela empresa pode", () => {
    expect(podeReaproveitar(notaEmitida(), { cnpjDaEmpresa: CNPJ_DA_EMPRESA }).pode).toBe(true);
  });

  it("NF-e não pode — este portal não emite nota de venda", () => {
    const r = podeReaproveitar(notaEmitida({ type: "NFE" }), { cnpjDaEmpresa: CNPJ_DA_EMPRESA });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_NAO_REAPROVEITAVEL.NAO_E_NFSE);
    expect(r.texto).toMatch(/NF-e/);
    // ⚠ Botão impossível NÃO SOME: fica desabilitado com o motivo em texto — daí o resumo curto.
    expect(r.resumo).toBeTruthy();
  });

  // ⚠⚠ Aqui a nota recebida é reconhecida pelo CNPJ, porque `papel` não vem neste contrato.
  it("nota em que a tomadora é a própria empresa NÃO pode", () => {
    const nota = notaEmitida({ tomador: { nome: "ACME SERVICOS LTDA", cnpjCpf: "11.222.333/0001-81" } });
    const r = podeReaproveitar(nota, { cnpjDaEmpresa: CNPJ_DA_EMPRESA });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_NAO_REAPROVEITAVEL.RECEBIDA);
  });

  it("o `papel: DEST` continua barrando, se ele passar a vir", () => {
    const r = podeReaproveitar(notaEmitida({ papel: "DEST" }), { cnpjDaEmpresa: CNPJ_DA_EMPRESA });
    expect(r.motivo).toBe(MOTIVO_NAO_REAPROVEITAVEL.RECEBIDA);
  });

  // ⚠ Ausência de dado não vira acusação: sem o CNPJ da empresa a comparação não acontece.
  it("sem o CNPJ da empresa, a nota não é acusada de recebida", () => {
    expect(podeReaproveitar(notaEmitida()).pode).toBe(true);
  });

  // ⚠⚠ ESTE CASO MEDIA O CONTRÁRIO ATÉ 24/08/2026, e o comentário dele dizia por quê:
  // *"Diferença deliberada do portal do escritório: lá 'ter valor' salvava a nota sem tomador.
  // Aqui o valor não viaja, então uma nota sem tomador não tem NADA a oferecer."*
  //
  // ⚠ **A premissa morreu em 19/08/2026**, quando o dono mandou copiar o valor (a história das duas
  // decisões está em `reaproveitarNota.js`). O teste continuou verde porque ele media a GUARDA, e a
  // guarda também não tinha sido atualizada — as duas concordavam entre si sobre um fato que já era
  // falso. ⚠ Isto não é a mesma coisa que reabrir uma decisão do dono: aqui não havia decisão, havia
  // um raciocínio técnico cuja base deixou de existir.
  it("nota sem tomador MAS com total pode — o valor é copiado, então há o que oferecer", () => {
    const r = podeReaproveitar(notaEmitida({ tomador: { nome: null, cnpjCpf: null }, total: 5000 }), {
      cnpjDaEmpresa: CNPJ_DA_EMPRESA,
    });
    expect(r.pode).toBe(true);
    // e o valor chega mesmo ao campo — senão "há o que oferecer" seria só uma afirmação do teste.
    expect(camposDaNota(notaEmitida({ tomador: { nome: null, cnpjCpf: null }, total: 5000 })).valorServicos)
      .toBe("5.000,00");
  });

  // ⚠ O critério não afrouxou, ele acompanhou o comportamento: NADA a copiar continua barrando.
  it("sem tomador E sem total, não pode — aí o formulário abriria vazio de verdade", () => {
    const r = podeReaproveitar(notaEmitida({ tomador: { nome: null, cnpjCpf: null }, total: null }), {
      cnpjDaEmpresa: CNPJ_DA_EMPRESA,
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_NAO_REAPROVEITAVEL.SEM_DADOS);
  });

  // ⚠ Zero não é valor: `formatarValorParaCampo` devolve "" para o que não é número positivo, e uma
  // nota de total zero sem tomador continua não tendo o que copiar.
  it("total ZERO não conta como valor", () => {
    expect(podeReaproveitar(notaEmitida({ tomador: { nome: null, cnpjCpf: null }, total: 0 }), {
      cnpjDaEmpresa: CNPJ_DA_EMPRESA,
    }).pode).toBe(false);
  });

  // ⚠⚠ E A FRASE DA TELA NÃO PODE VOLTAR A DIZER QUE O VALOR NÃO É COPIADO. Ela dizia isso, no
  // `texto` desta mesma recusa, enquanto três funções abaixo o aviso `valor_copiado` afirmava o
  // oposto — a tela contradizendo a si mesma sobre o mesmo campo.
  it("⚠ o texto da recusa NÃO afirma que o valor não é copiado", () => {
    const r = podeReaproveitar(notaEmitida({ tomador: { nome: null, cnpjCpf: null }, total: null }), {
      cnpjDaEmpresa: CNPJ_DA_EMPRESA,
    });
    expect(r.texto).not.toMatch(/valor n[ãa]o [ée] copiado/i);
  });

  it("só o nome do tomador já basta — o resto se digita", () => {
    expect(podeReaproveitar(notaEmitida({ tomador: { nome: "PADARIA DO JOAO", cnpjCpf: null } })).pode).toBe(true);
  });

  // ⚠⚠ Copiar dados não é reemitir, e o caso relatado pelo dono ("cancelamos essa nota, emitimos
  // outra") É o reaproveitamento de uma cancelada: a nota errada é o melhor modelo para a certa.
  it("cancelada e substituída CONTINUAM podendo servir de modelo", () => {
    expect(podeReaproveitar(notaEmitida({ status: "CANCELADA" })).pode).toBe(true);
    expect(podeReaproveitar(notaEmitida({ status: "SUBSTITUIDA" })).pode).toBe(true);
  });
});

describe("os avisos — o silêncio é que confundiria", () => {
  it("SEMPRE diz que é nota nova, mesmo numa origem sem nenhuma ressalva", () => {
    const avisos = avisosDoReaproveitamento(notaEmitida());
    expect(avisos[0].codigo).toBe("nota_nova");
    expect(avisos[0].texto).toMatch(/n[ãa]o é alterada, cancelada nem substitu/i);
  });

  it("origem CANCELADA: diz que ela continua cancelada e que a nova não a corrige", () => {
    const aviso = avisosDoReaproveitamento(notaEmitida({ status: "CANCELADA" }))
      .find((a) => a.codigo === "origem_cancelada");
    expect(aviso).toBeTruthy();
    expect(aviso.texto).toMatch(/continua cancelada/i);
    expect(aviso.texto).toMatch(/n[ãa]o a corrige nem a substitui/i);
  });

  it("origem SUBSTITUÍDA: aponta que quem vale é a substituta e que esta seria uma terceira nota", () => {
    const aviso = avisosDoReaproveitamento(notaEmitida({ status: "SUBSTITUIDA" }))
      .find((a) => a.codigo === "origem_substituida");
    expect(aviso).toBeTruthy();
    expect(aviso.texto).toMatch(/substituta/i);
    expect(aviso.tom).toBe("atencao");
  });

  it("o `ciclo` vence o `status`, se ele vier", () => {
    const codigos = avisosDoReaproveitamento(
      notaEmitida({ status: "EMITIDA", ciclo: { situacao: "substituida" } })
    ).map((a) => a.codigo);
    expect(codigos).toContain("origem_substituida");
    expect(codigos).not.toContain("origem_cancelada");
  });
});

describe("modeloDeEmissaoDaNota — campos, avisos e origem numa peça só", () => {
  it("junta tudo, para que a tela não possa esquecer a metade que avisa", () => {
    const m = modelo({ status: "CANCELADA" });
    expect(m.campos.tomadorDoc).toBe("44555666000177");
    // ⚠ `valor_copiado` desde 19/08/2026 (era `valor_em_branco`) — ver o bloco do VALOR acima.
    expect(m.avisos.map((a) => a.codigo)).toEqual(
      expect.arrayContaining(["nota_nova", "valor_copiado", "origem_cancelada"])
    );
    expect(m.companyId).toBe("pc-001");
  });

  // ⚠ Nota que não serve de modelo devolve `null` — não um objeto vazio que abriria a emissão
  // prometendo dados que não existem.
  it("nota que não pode servir de modelo devolve null", () => {
    expect(modelo({ type: "NFE" })).toBeNull();
    expect(modeloDeEmissaoDaNota(null)).toBeNull();
  });

  // ⚠⚠ MULTI-EMPRESA: o modelo atravessa a casca do app, e aplicar numa empresa a nota de OUTRA
  // seria emitir no CNPJ errado. O `companyId` viaja para a tela poder recusar.
  it("o companyId viaja junto com o modelo", () => {
    expect(modelo({}, { companyId: "pc-002" }).companyId).toBe("pc-002");
  });
});
