// A LIGAÇÃO DAS REGRAS COM O BANCO.
//
// ⚠ A REGRA tem teste próprio (`lib/__tests__/motorDeSugestao.test.js` e `aprendizado.test.js`).
// O que se prende aqui é a LIGAÇÃO: que a memória seja lida por EMPRESA, que o plano venha com a
// precedência certa, que o aprendizado NUNCA derrube o trabalho do contador, e que nada disto
// contabilize.

jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));

import {
  RECUSA_DA_REGRA,
  alternarRegra,
  criarRegraManual,
  listarRegras,
  reavaliarAprendizado,
  sugerirContaPara,
  sugerirContaParaLote,
} from "../RegraService.js";

const AGORA = new Date("2026-08-25T10:00:00.000Z");

const PLANO_GLOBAL = [
  { portalClientId: null, codigo: "557", codigoCompleto: "411030012", nome: "SOFTWARE" },
  { portalClientId: null, codigo: "464", codigoCompleto: "411020008", nome: "SERVIÇOS PJ" },
];

function fazerClient(opcoes = {}) {
  const chamadas = { historicoWhere: [], planoWhere: [], criadas: [], atualizadas: [] };
  return {
    chamadas,
    client: {
      chartOfAccount: {
        findMany: jest.fn(async ({ where }) => {
          chamadas.planoWhere.push(where);
          return opcoes.plano || PLANO_GLOBAL;
        }),
      },
      accountingHistorico: {
        findMany: jest.fn(async ({ where }) => {
          chamadas.historicoWhere.push(where);
          return opcoes.historico || [];
        }),
      },
      regraContabilizacao: {
        findMany: jest.fn(async () => opcoes.regras || []),
        findFirst: jest.fn(async () => opcoes.regraExistente ?? null),
        create: jest.fn(async ({ data }) => {
          if (opcoes.falharCreate) throw Object.assign(new Error("P2021"), { code: "P2021" });
          chamadas.criadas.push(data);
          return { id: "r-nova", ...data };
        }),
        update: jest.fn(async ({ where, data }) => {
          chamadas.atualizadas.push({ where, data });
          return { id: where.id, ...data };
        }),
      },
      lancamentoDeclarado: {
        findMany: jest.fn(async () => opcoes.declarados || []),
      },
    },
  };
}

const declarado = (extra = {}) => ({
  id: "d-1",
  cnpjFornecedor: "12345678000190",
  descricaoOriginal: "GOOGLE CLOUD BRASIL",
  valor: 1500,
  ...extra,
});

describe("⚠⚠ A MEMÓRIA É LIDA POR EMPRESA — e os GLOBAIS ficam de fora", () => {
  it("o `where` é a empresa, sem filtrar usuário", async () => {
    // A pergunta é "o que esta EMPRESA já lançou nesta descrição?", não "o que este usuário lançou".
    const { client, chamadas } = fazerClient();
    await sugerirContaPara({ portalClientId: "emp-1", declarado: declarado(), client });
    expect(chamadas.historicoWhere[0]).toEqual({ companyPortalClientId: "emp-1" });
    expect(JSON.stringify(chamadas.historicoWhere[0])).not.toMatch(/createdByUserId/);
  });

  it("⚠⚠ registro GLOBAL (companyPortalClientId nulo) NÃO entra", async () => {
    // Eles guardam o REDUZIDO, e um reduzido só significa algo dentro de UM plano. Usar o global de
    // uma empresa para traduzir noutra é o erro que a tradução pelo plano existe para impedir.
    const { client, chamadas } = fazerClient();
    await sugerirContaPara({ portalClientId: "emp-1", declarado: declarado(), client });
    const w = chamadas.historicoWhere[0];
    expect(w.companyPortalClientId).toBe("emp-1");
    expect(w).not.toHaveProperty("OR");
  });
});

describe("⚠⚠ O PLANO VEM COM A PRECEDÊNCIA: global é padrão, a da empresa SOBRESCREVE", () => {
  it("busca global + a da empresa", async () => {
    const { client, chamadas } = fazerClient();
    await sugerirContaPara({ portalClientId: "emp-1", declarado: declarado(), client });
    expect(chamadas.planoWhere[0]).toEqual({ OR: [{ portalClientId: null }, { portalClientId: "emp-1" }] });
  });

  it("⚠⚠ a conta DA EMPRESA vence a global no mesmo reduzido", async () => {
    // Sem isso, a empresa que renumerou o próprio plano receberia a tradução da global — e a
    // despesa iria para outra conta, em silêncio.
    const { client } = fazerClient({
      plano: [
        { portalClientId: null, codigo: "557", codigoCompleto: "411030012", nome: "GLOBAL" },
        { portalClientId: "emp-1", codigo: "557", codigoCompleto: "999999999", nome: "DA EMPRESA" },
      ],
      historico: [{ text: "GOOGLE CLOUD BRASIL", contaDebito: "557" }],
    });
    const r = await sugerirContaPara({
      portalClientId: "emp-1",
      declarado: declarado({ cnpjFornecedor: null }),
      client,
    });
    expect(r.conta).toBe("999999999");
  });

  it("⚠ a ordem em que as contas voltam do banco não decide — a da empresa vence nos dois sentidos", async () => {
    const { client } = fazerClient({
      plano: [
        { portalClientId: "emp-1", codigo: "557", codigoCompleto: "999999999", nome: "DA EMPRESA" },
        { portalClientId: null, codigo: "557", codigoCompleto: "411030012", nome: "GLOBAL" },
      ],
      historico: [{ text: "GOOGLE CLOUD BRASIL", contaDebito: "557" }],
    });
    const r = await sugerirContaPara({
      portalClientId: "emp-1",
      declarado: declarado({ cnpjFornecedor: null }),
      client,
    });
    expect(r.conta).toBe("999999999");
  });
});

describe("⚠ o lote faz UMA busca de cada coisa", () => {
  it("229 linhas não viram 229×3 consultas", async () => {
    const { client } = fazerClient();
    const muitos = Array.from({ length: 50 }, (_, i) => declarado({ id: `d-${i}` }));
    const r = await sugerirContaParaLote({ portalClientId: "emp-1", declarados: muitos, client });
    expect(r).toHaveLength(50);
    expect(client.accountingHistorico.findMany).toHaveBeenCalledTimes(1);
    expect(client.chartOfAccount.findMany).toHaveBeenCalledTimes(1);
    expect(client.regraContabilizacao.findMany).toHaveBeenCalledTimes(1);
  });

  it("⚠ cada resposta carrega o id da linha", async () => {
    const { client } = fazerClient();
    const r = await sugerirContaParaLote({
      portalClientId: "emp-1",
      declarados: [declarado({ id: "a" }), declarado({ id: "b" })],
      client,
    });
    expect(r.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("⚠⚠ SÓ REGRA VIVA É CONSULTADA", () => {
  it("o `where` exige ativa, não suspensa e não revogada", async () => {
    const { client } = fazerClient();
    await sugerirContaPara({ portalClientId: "emp-1", declarado: declarado(), client });
    expect(client.regraContabilizacao.findMany).toHaveBeenCalledWith({
      where: { portalClientId: "emp-1", ativa: true, suspensaEm: null, revogadaEm: null },
    });
  });
});

describe("⚠⚠ O APRENDIZADO NUNCA DERRUBA O TRABALHO DO CONTADOR", () => {
  const confirmado = (extra = {}) => ({
    id: "d-1",
    estado: "CONTABILIZADO",
    contaAplicada: "411030012",
    valor: 1000,
    regraId: null,
    ...extra,
  });

  it("duas confirmações unânimes CRIAM a regra aprendida", async () => {
    const { client, chamadas } = fazerClient({
      declarados: [confirmado({ id: "a" }), confirmado({ id: "b" })],
    });
    const r = await reavaliarAprendizado({
      portalClientId: "emp-1",
      cnpjFornecedor: "12345678000190",
      usuarioId: "u-1",
      agora: AGORA,
      client,
    });
    expect(r.acao).toBe("CRIAR");
    expect(chamadas.criadas[0]).toMatchObject({
      portalClientId: "emp-1",
      cnpjFornecedor: "12345678000190",
      contaDestino: "411030012",
      origemRegra: "APRENDIDA",
      ativa: true,
    });
    // ⚠ A trilha é gravada — é ela que torna o aprendizado auditável.
    expect(chamadas.criadas[0].confirmacoesBase).toEqual(["a", "b"]);
  });

  it("⚠⚠ TABELA INEXISTENTE (migration não aplicada) NÃO estoura — devolve `NADA`", async () => {
    // A confirmação que acabou de acontecer continua válida. Mesma disciplina de
    // `listarTomadoresEmitidos`, que não pode derrubar a tela de emissão.
    const { client } = fazerClient({
      declarados: [confirmado({ id: "a" }), confirmado({ id: "b" })],
      falharCreate: true,
    });
    const r = await reavaliarAprendizado({
      portalClientId: "emp-1",
      cnpjFornecedor: "12345678000190",
      agora: AGORA,
      client,
    });
    expect(r.acao).toBe("NADA");
    expect(r.motivo).toBe("falhou");
    expect(r.erro).toBe("P2021");
  });

  it("⚠ sem CNPJ não faz nada, e nem consulta o banco", async () => {
    const { client } = fazerClient();
    const r = await reavaliarAprendizado({ portalClientId: "emp-1", cnpjFornecedor: null, agora: AGORA, client });
    expect(r).toEqual({ acao: "NADA", motivo: "sem_cnpj" });
    expect(client.lancamentoDeclarado.findMany).not.toHaveBeenCalled();
  });

  it("⚠⚠ divergência SUSPENDE a regra existente, com o motivo", async () => {
    const { client, chamadas } = fazerClient({
      declarados: [confirmado({ id: "a" }), confirmado({ id: "b", contaAplicada: "411020008" })],
      regraExistente: { id: "r-1", origemRegra: "APRENDIDA", contaDestino: "411030012", suspensaEm: null },
    });
    const r = await reavaliarAprendizado({
      portalClientId: "emp-1",
      cnpjFornecedor: "12345678000190",
      agora: AGORA,
      client,
    });
    expect(r.acao).toBe("SUSPENDER");
    expect(chamadas.atualizadas[0].data).toMatchObject({ suspensaEm: AGORA, motivoSuspensao: "divergencia" });
  });

  it("⚠⚠ a busca da regra existente INCLUI as suspensas", async () => {
    // Sem isso, `decidirAprendizado` acharia que não existe regra e proporia criar uma SEGUNDA para
    // o mesmo fornecedor.
    const { client } = fazerClient({ declarados: [] });
    await reavaliarAprendizado({ portalClientId: "emp-1", cnpjFornecedor: "12345678000190", agora: AGORA, client });
    const w = client.regraContabilizacao.findFirst.mock.calls[0][0].where;
    expect(w).not.toHaveProperty("suspensaEm");
    expect(w).not.toHaveProperty("ativa");
    expect(w).toMatchObject({ portalClientId: "emp-1", cnpjFornecedor: "12345678000190", revogadaEm: null });
  });

  it("⚠⚠ ESTA FUNÇÃO NÃO CONTABILIZA — não há `accountingEntry` no client", async () => {
    const { client } = fazerClient({ declarados: [confirmado({ id: "a" }), confirmado({ id: "b" })] });
    await reavaliarAprendizado({ portalClientId: "emp-1", cnpjFornecedor: "12345678000190", agora: AGORA, client });
    expect(client.accountingEntry).toBeUndefined();
  });

  it("⚠ `agora` é INJETADO — a data de criação não sai de um relógio interno", async () => {
    const { client, chamadas } = fazerClient({ declarados: [confirmado({ id: "a" }), confirmado({ id: "b" })] });
    await reavaliarAprendizado({ portalClientId: "emp-1", cnpjFornecedor: "12345678000190", agora: AGORA, client });
    expect(chamadas.criadas[0].criadaEm).toBe(AGORA);
  });
});

describe("⚠ desligar à mão é DIFERENTE de suspender sozinho", () => {
  it("desligar grava `ativa: false`, e NÃO toca em `suspensaEm`", async () => {
    // As duas colunas respondem coisas diferentes: `suspensaEm` é "o sistema se freou"; `ativa` é
    // "o contador decidiu". Colapsá-las faria a tela não distinguir as duas.
    const { client, chamadas } = fazerClient({ regraExistente: { id: "r-1", portalClientId: "emp-1" } });
    await alternarRegra({ portalClientId: "emp-1", regraId: "r-1", ativa: false, client });
    expect(chamadas.atualizadas[0].data).toEqual({ ativa: false });
  });

  it("⚠⚠ RELIGAR à mão LIMPA a suspensão automática", async () => {
    // Sem isso a regra ficaria `ativa: true` com `suspensaEm` preenchido — e o motor, que exige as
    // duas, continuaria a ignorá-la. O botão pareceria não fazer nada.
    const { client, chamadas } = fazerClient({ regraExistente: { id: "r-1", portalClientId: "emp-1" } });
    await alternarRegra({ portalClientId: "emp-1", regraId: "r-1", ativa: true, client });
    expect(chamadas.atualizadas[0].data).toEqual({ ativa: true, suspensaEm: null, motivoSuspensao: null });
  });

  it("⚠ regra de OUTRA empresa não é encontrada", async () => {
    const { client } = fazerClient({ regraExistente: null });
    expect(await alternarRegra({ portalClientId: "emp-2", regraId: "r-1", ativa: false, client })).toBeNull();
  });
});

describe("⚠ a listagem leva a TRILHA para a tela", () => {
  it("`confirmacoesBase` viaja, e vazio é `[]` — nunca `null`", async () => {
    const client = {
      regraContabilizacao: {
        findMany: jest.fn(async () => [
          { id: "r-1", origemRegra: "APRENDIDA", contaDestino: "411030012", ativa: true, confirmacoesBase: ["a", "b"], valorMin: 850, valorMax: 1150 },
          { id: "r-2", origemRegra: "MANUAL", contaDestino: "411020008", ativa: true, confirmacoesBase: null },
        ]),
      },
    };
    const r = await listarRegras({ portalClientId: "emp-1", client });
    expect(r[0].confirmacoesBase).toEqual(["a", "b"]);
    expect(r[1].confirmacoesBase).toEqual([]);
  });

  it("⚠ o Decimal vira TEXTO — `Number` perderia centavos na faixa", async () => {
    const client = {
      regraContabilizacao: {
        findMany: jest.fn(async () => [
          { id: "r-1", valorMin: "850.00", valorMax: "1150.00", confirmacoesBase: [] },
        ]),
      },
    };
    const r = await listarRegras({ portalClientId: "emp-1", client });
    expect(r[0].valorMin).toBe("850.00");
  });

  it("⚠ regra revogada não aparece", async () => {
    const client = { regraContabilizacao: { findMany: jest.fn(async () => []) } };
    await listarRegras({ portalClientId: "emp-1", client });
    expect(client.regraContabilizacao.findMany.mock.calls[0][0].where).toMatchObject({ revogadaEm: null });
  });
});

describe("⚠ a fonte do serviço", () => {
  it("⚠⚠ NÃO cria `AccountingEntry` em lugar nenhum", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "RegraService.js"), "utf8");
    expect(fonte).not.toMatch(/accountingEntry/);
  });

  it("⚠ não reimplementa a regra — ela vem das libs puras", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "RegraService.js"), "utf8");
    expect(fonte).toMatch(/from "\.\/lib\/motorDeSugestao\.js"/);
    expect(fonte).toMatch(/from "\.\/lib\/aprendizado\.js"/);
    // ⚠ Nenhuma decisão de piso/unanimidade escrita aqui.
    expect(fonte).not.toMatch(/PISO_DE_CONFIRMACOES\s*=|contas\.size/);
  });

  it("⚠ nenhum `new Date()` — o relógio é injetado", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "RegraService.js"), "utf8")
      // ⚠⚠ A VARREDURA É SOBRE O CÓDIGO — e ela passou a tirar os comentários em 29/08/2026, quando
      // o comentário que EXPLICA a proibição derrubou o próprio teste. Um teste que só pode ficar
      // verde enquanto ninguém escreve o porquê da regra é um teste que empurra o porquê para fora
      // do arquivo.
      // ⚠ BLOCO antes de LINHA: um `//` dentro de um comentário de bloco apaga o `*/`, e o regex
      // não-guloso engole o código real até o `*/` seguinte. Lição de 27/08/2026.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(fonte).not.toMatch(/new Date\(\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A REGRA MANUAL — a porta que faltava (29/08/2026).
//
// > Dono: *"a Lente tem todo mês um pagamento a Alessandro Nigro, CNPJ (…) o contador deve poder
// > colocar o código de débito e crédito nessa despesa."*
//
// ⚠⚠ `RegraContabilizacao` já guardava tudo e SÓ NASCIA `APRENDIDA` — não havia `POST` nenhum. O que
// estes casos travam é o que a porta nova não pode deixar passar: regra sem âncora (casaria com toda
// despesa), conta sintética (a ECD recusa meses depois) e crédito fora da disponibilidade.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ criarRegraManual", () => {
  const PLANO_COM_CAIXA = [
    { portalClientId: null, codigo: "557", codigoCompleto: "411030012", nome: "SOFTWARE", analitica: true },
    { portalClientId: null, codigo: "1", codigoCompleto: "111010001", nome: "CAIXA MATRIZ", analitica: true },
    { portalClientId: null, codigo: "2", codigoCompleto: "111020003", nome: "BANCO ITAU", analitica: true },
    { portalClientId: null, codigo: "9", codigoCompleto: "411", nome: "DESPESAS ADMINISTRATIVAS", analitica: false },
    { portalClientId: null, codigo: "77", codigoCompleto: "121010001", nome: "CLIENTES", analitica: true },
  ];

  const criar = (extra = {}, plano = PLANO_COM_CAIXA) => {
    const { client } = fazerClient({ plano });
    return {
      client,
      chamar: () => criarRegraManual({
        portalClientId: "emp-1",
        cnpjFornecedor: "12345678000190",
        valorMin: 1000,
        valorMax: 1500,
        contaDestino: "411030012",
        usuarioId: "u-1",
        agora: AGORA,
        client,
        ...extra,
      }),
    };
  };

  it("cria a regra MANUAL, ativa, com a âncora do CNPJ", async () => {
    const { client, chamar } = criar();
    const r = await chamar();
    const dados = client.regraContabilizacao.create.mock.calls[0][0].data;
    expect(dados.origemRegra).toBe("MANUAL");
    expect(dados.ativa).toBe(true);
    expect(dados.cnpjFornecedor).toBe("12345678000190");
    // ⚠ Sem aprendizado atrás dela: preencher `confirmacoesBase` faria uma decisão do contador
    // parecer uma observação do sistema.
    expect(dados.confirmacoesBase).toBeNull();
    expect(r).toBeTruthy();
  });

  it("⚠ o CNPJ entra só com dígitos — a máscara não vira parte da âncora", async () => {
    const { client, chamar } = criar({ cnpjFornecedor: "12.345.678/0001-90" });
    await chamar();
    expect(client.regraContabilizacao.create.mock.calls[0][0].data.cnpjFornecedor).toBe("12345678000190");
  });

  it("⚠⚠ SEM ÂNCORA recusa — ela casaria com QUALQUER despesa, e ela lança sozinha", async () => {
    const { client, chamar } = criar({ cnpjFornecedor: null, padraoDescricao: "   " });
    await expect(chamar()).rejects.toMatchObject({ codigo: RECUSA_DA_REGRA.SEM_ANCORA });
    expect(client.regraContabilizacao.create).not.toHaveBeenCalled();
  });

  it("⚠ só o padrão de descrição já é âncora bastante", async () => {
    const { chamar } = criar({ cnpjFornecedor: null, padraoDescricao: "ALESSANDRO NIGRO" });
    await expect(chamar()).resolves.toBeTruthy();
  });

  describe("⚠⚠ o CRÉDITO tem de ser DISPONIBILIDADE — resposta do dono", () => {
    it("caixa passa", async () => {
      const { client, chamar } = criar({ contaCredito: "111010001" });
      await chamar();
      expect(client.regraContabilizacao.create.mock.calls[0][0].data.contaCredito).toBe("111010001");
    });

    it("banco passa", async () => {
      const { chamar } = criar({ contaCredito: "111020003" });
      await expect(chamar()).resolves.toBeTruthy();
    });

    it("⚠⚠ conta de DESPESA no crédito RECUSA — o lançamento afirma de onde o dinheiro saiu", async () => {
      const { client, chamar } = criar({ contaCredito: "411030012" });
      await expect(chamar()).rejects.toMatchObject({
        codigo: RECUSA_DA_REGRA.CREDITO_NAO_E_DISPONIBILIDADE,
      });
      expect(client.regraContabilizacao.create).not.toHaveBeenCalled();
    });

    it("⚠⚠ conta de ATIVO fora de `111` também recusa — quem decide é o PREFIXO, não o nome", async () => {
      // `121010001 CLIENTES` é ativo, e não é disponibilidade. Um critério pelo nome ("parece conta
      // de recebimento") deixaria passar.
      const { chamar } = criar({ contaCredito: "121010001" });
      await expect(chamar()).rejects.toMatchObject({
        codigo: RECUSA_DA_REGRA.CREDITO_NAO_E_DISPONIBILIDADE,
      });
    });

    it("⚠⚠ crédito AUSENTE é aceito — `null` é 'esta regra não escolheu', e o caixa de hoje segue", async () => {
      // A ausência não é recusada; o que é recusado é a escolha ERRADA. Preencher com o caixa
      // afirmaria uma escolha que ninguém fez.
      const { client, chamar } = criar({ contaCredito: null });
      await chamar();
      expect(client.regraContabilizacao.create.mock.calls[0][0].data.contaCredito).toBeNull();
    });
  });

  describe("⚠⚠ as travas que já existiam continuam valendo", () => {
    it("conta fora do plano recusa", async () => {
      const { chamar } = criar({ contaDestino: "999999999" });
      await expect(chamar()).rejects.toMatchObject({ codigo: RECUSA_DA_REGRA.CONTA_FORA_DO_PLANO });
    });

    it("⚠⚠ conta SINTÉTICA recusa — a ECD recusa o arquivo meses depois (I250)", async () => {
      const { chamar } = criar({ contaDestino: "411" });
      await expect(chamar()).rejects.toMatchObject({ codigo: RECUSA_DA_REGRA.CONTA_SINTETICA });
    });

    it("⚠ TRI-ESTADO: `analitica: null` (plano não reimportado) NÃO é sintética", async () => {
      const plano = [{ portalClientId: null, codigo: "5", codigoCompleto: "411030012", nome: "X", analitica: null }];
      const { chamar } = criar({}, plano);
      await expect(chamar()).resolves.toBeTruthy();
    });
  });

  describe("⚠⚠ a FAIXA é o portão do lançamento automático", () => {
    it.each([
      ["mínimo zero", { valorMin: 0, valorMax: 100 }],
      ["máximo zero", { valorMin: 10, valorMax: 0 }],
      ["invertida", { valorMin: 200, valorMax: 100 }],
      ["ausente", { valorMin: null, valorMax: null }],
      ["não numérica", { valorMin: "abc", valorMax: "def" }],
    ])("%s recusa", async (_nome, faixa) => {
      // ⚠ `> 0` por TIPO: `Number(null)` é 0 e 0 é finito — uma faixa que começa em zero casaria com
      // toda nota, e ela é o que decide o que lança sozinho.
      const { chamar } = criar(faixa);
      await expect(chamar()).rejects.toMatchObject({ codigo: RECUSA_DA_REGRA.FAIXA_INVALIDA });
    });

    it("⚠ mínimo igual ao máximo passa — é a regra de valor fixo", async () => {
      const { chamar } = criar({ valorMin: 1200, valorMax: 1200 });
      await expect(chamar()).resolves.toBeTruthy();
    });
  });

  it("⚠⚠ criar a regra NÃO LANÇA NADA — ela só passa a existir para o motor consultar", async () => {
    const { client, chamar } = criar();
    await chamar();
    expect(client.accountingEntry).toBeUndefined();
  });

  it("⚠ sem a tabela, recusa NOMEADA — a migration é ato do dono", async () => {
    const { client, chamar } = criar();
    client.regraContabilizacao.create = jest.fn(async () => {
      const e = new Error("no table"); e.code = "P2021"; throw e;
    });
    await expect(chamar()).rejects.toMatchObject({ codigo: RECUSA_DA_REGRA.INDISPONIVEL });
  });
});
