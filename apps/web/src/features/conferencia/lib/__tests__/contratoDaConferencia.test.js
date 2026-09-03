// O MOCK DA CONFERÊNCIA FALA A MESMA LÍNGUA QUE O SERVIDOR.
//
// ⚠⚠ POR QUE ESTE ARQUIVO EXISTE, e ele nasceu de um defeito real (25/08/2026): o mock devolvia
// `casamentos` e a rota devolve **`linhas`**. A tela lida com isso da pior maneira possível — ela
// funciona OFFLINE e quebra EM PRODUÇÃO, ou seja, o erro só aparece depois do deploy, na mão do
// contador, sem nada no console que aponte para a causa.
//
// A regra do `apps/web/CLAUDE.md` já dizia *"manter contratos de resposta idênticos entre mock e
// real"* — o que faltava era alguém verificar. É isso que este teste faz.
//
// ⚠ A AMARRAÇÃO É TEXTUAL, e é de propósito: o backend não é importável daqui (cruzar apps quebra o
// boot, e o Dockerfile não copia tudo). Mesma disciplina do teste que amarra `"autorizada"` à
// `whereFaturamentoEmit`, e das varreduras de fonte de `routes/client/__tests__/`.

import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(__dirname, "..", "..", "..", "..", "..", "..", "..");
const FONTE_DA_ROTA = fs.readFileSync(
  path.join(RAIZ, "apps", "api", "src", "routes", "firm", "conferencia.js"),
  "utf8",
);

const { createMockApi } = require("../../../../api/mock/mockApi");
const mock = createMockApi();

/**
 * Cada chave é conferida DUAS vezes: que o mock a produz, e que a fonte do servidor a escreve.
 * Renomear no backend derruba a segunda; esquecer no mock derruba a primeira.
 */
const CONTRATOS = [
  {
    o_que: "a fila",
    chamar: () => mock.getConferenciaFila("emp-1", { competencia: "2026-07" }),
    chaves: ["itens", "porEstado", "total"],
  },
  {
    o_que: "as sugestões de casamento",
    chamar: () => mock.getConferenciaCasamentos("emp-1"),
    // ⚠⚠ `linhas`, NÃO `casamentos`. Foi exatamente aqui que o mock divergiu.
    chaves: ["linhas", "totalDebitos", "totalNotas"],
  },
  {
    o_que: "a varredura de notas",
    chamar: () => mock.postVarrerNotas("emp-1", "2026-07-01"),
    chaves: ["varridas", "criados", "jaExistiam", "fora", "recusados"],
  },
  {
    o_que: "a varredura de invariantes",
    chamar: () => mock.getConferenciaVarredura("emp-1"),
    chaves: [
      "lancamentoForaDeContabilizado",
      "contabilizadoSemLancamento",
      "ponteiroPendurado",
      "semDataDePagamento",
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O ID DO DÉBITO DO CASAMENTO É UM ID DA FILA — e o mock já divergiu nisso também.
//
// Em produção `serializar(l.debito)` serializa um `LancamentoDeclarado`, ou seja o **mesmo** id que
// a fila devolve. O mock usava um espaço de ids próprio (`ofx-1`, `ofx-2`, `ofx-3`), e a interseção
// entre os dois conjuntos era **VAZIA**. Consequência medida em 27/08/2026: o ramo que impede a
// DESPESA EM DOBRO no lote (`CASA_COM_NOTA`) era inalcançável offline — a tela nunca excluía nada,
// e só em produção o comportamento apareceria. É a mesma família do `casamentos` × `linhas`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ O DÉBITO DO CASAMENTO É UMA LINHA DA FILA", () => {
  it("os ids dos débitos existem na fila — senão o filtro do lote nunca morde", async () => {
    const fila = await mock.getConferenciaFila("emp-1", { competencia: "2026-07" });
    const cas = await mock.getConferenciaCasamentos("emp-1");
    const idsDaFila = new Set(fila.itens.map((i) => i.id));
    const idsDosDebitos = cas.linhas.map((l) => l.debito.id);

    expect(idsDosDebitos.length).toBeGreaterThan(0);
    for (const id of idsDosDebitos) expect(idsDaFila.has(id)).toBe(true);
  });

  it("⚠ e pelo menos um deles TEM candidato — é o que exercita o ramo da despesa em dobro", async () => {
    const cas = await mock.getConferenciaCasamentos("emp-1");
    const comCandidato = cas.linhas.filter((l) => l.sugestao || (l.candidatos || []).length);
    expect(comCandidato.length).toBeGreaterThan(0);
  });

  it("⚠ e pelo menos um NÃO tem — é a despesa sem nota, cujo lugar É o lote", async () => {
    const cas = await mock.getConferenciaCasamentos("emp-1");
    const semCandidato = cas.linhas.filter((l) => !l.sugestao && !(l.candidatos || []).length);
    expect(semCandidato.length).toBeGreaterThan(0);
  });

  it("⚠⚠ a rota serializa o DÉBITO como declarado — é o que garante o espaço de ids comum", () => {
    expect(FONTE_DA_ROTA).toMatch(/debito:\s*serializar\(l\.debito\)/);
  });
});

describe("⚠⚠ AS CHAVES DO MOCK EXISTEM NA RESPOSTA DO SERVIDOR", () => {
  for (const c of CONTRATOS) {
    it(`${c.o_que}: o mock devolve exatamente as chaves que a rota promete`, async () => {
      const r = await c.chamar();
      for (const chave of c.chaves) expect(r).toHaveProperty(chave);
    });

    it(`${c.o_que}: cada chave aparece na FONTE da rota — renomear no backend quebra aqui`, () => {
      for (const chave of c.chaves) {
        // ⚠ A chave pode estar escrita literalmente na rota (`linhas:`) ou vir de um spread do
        // serviço (`...r`). No segundo caso ela aparece no serviço, então aceitamos as duas provas.
        const naRota = new RegExp(`\\b${chave}\\b`).test(FONTE_DA_ROTA);
        expect(naRota || FONTE_ESPALHADA.includes(chave)).toBe(true);
      }
    });
  }
});

/** As fontes que a rota espalha com `...r` — é lá que as chaves de fato nascem. */
const FONTE_ESPALHADA = [
  path.join(RAIZ, "apps", "api", "src", "application", "declarados", "DeclaradoService.js"),
  path.join(RAIZ, "apps", "api", "src", "application", "declarados", "VarreduraDeNotasService.js"),
]
  .map((p) => fs.readFileSync(p, "utf8"))
  .join("\n");

describe("⚠⚠ O CASO QUE ESTE ARQUIVO FOI ESCRITO PARA PEGAR", () => {
  it("⚠⚠ a chave do casamento é `linhas` — `casamentos` NÃO existe no servidor", async () => {
    const r = await mock.getConferenciaCasamentos("emp-1");
    expect(r).toHaveProperty("linhas");
    expect(r).not.toHaveProperty("casamentos");
    expect(FONTE_DA_ROTA).toMatch(/linhas: r\.linhas\.map/);
  });

  it("⚠ a sugestão devolve `pista` e `frase`, e NÃO `palavra`", async () => {
    // Campo a mais no mock vira tela que lê `undefined` em produção — e `undefined` não quebra
    // nada, só some da tela.
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const comSugestao = linhas.find((l) => l.sugestao);
    expect(comSugestao.sugestao).toEqual(
      expect.objectContaining({ nota: expect.any(Object), pista: expect.any(String), frase: expect.any(String) }),
    );
    expect(comSugestao.sugestao).not.toHaveProperty("palavra");
    // ⚠ A prova é de CONTEÚDO, não de formatação: a asserção era o texto exato de uma linha e
    // quebrou quando a rota ganhou campos novos e foi reindentada. O que importa é que a rota
    // publique `pista` e `frase` — e que `palavra` continue fora.
    // ⚠⚠ A VARREDURA OLHA `serializarCandidata`, e não mais o corpo da rota: em 01/09/2026 as duas
    // cópias do serializador (sugestão × candidatos) viraram uma função só — elas já divergiam,
    // porque `leitura`/`podeFundir` tinham sido acrescentados nos dois lugares à mão.
    // ⚠ A prova continua sendo de CONTEÚDO: o que importa é que a rota publique `pista` e `frase`,
    // e que `palavra` fique fora.
    expect(FONTE_DA_ROTA).toMatch(/pista:\s*c\.pista/);
    expect(FONTE_DA_ROTA).toMatch(/frase:\s*c\.frase/);
    expect(FONTE_DA_ROTA).not.toMatch(/palavra:\s*[lc]?\.?sugestao/);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ O QUE DÁ PARA FAZER COM A CANDIDATA — o alargamento do casamento (dono, 27/08/2026).
  //
  // Nem toda sugestão se funde: uma nota JÁ CONTABILIZADA aparece para o débito ser RECONHECIDO
  // (senão ele vira despesa em dobro no lote) e NÃO tem botão. Se `podeFundir` não viajar, a tela
  // oferece "Casar" e o clique volta recusado — e é um campo fora do serializador que some sem erro
  // nenhum, o defeito que este projeto já pagou três vezes.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ `podeFundir` e `fraseDaCandidata` VIAJAM na sugestão", async () => {
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const comSugestao = linhas.filter((l) => l.sugestao);
    expect(comSugestao.length).toBeGreaterThan(0);
    for (const l of comSugestao) {
      expect(typeof l.sugestao.podeFundir).toBe("boolean");
      expect(typeof l.sugestao.fraseDaCandidata).toBe("string");
    }
    expect(FONTE_DA_ROTA).toMatch(/podeFundir:\s*c\.podeFundir/);
    expect(FONTE_DA_ROTA).toMatch(/fraseDaCandidata:\s*c\.fraseDaCandidata/);
    // ⚠ E as duas pontas usam o MESMO serializador — sugestão e candidatos não podem divergir de
    // novo. Ele é chamado nos dois lugares, e é isso que este par de linhas prende.
    expect(FONTE_DA_ROTA).toMatch(/sugestao:\s*l\.sugestao\s*\?\s*serializarCandidata\(l\.sugestao\)/);
    expect(FONTE_DA_ROTA).toMatch(/candidatos:\s*l\.candidatos\.map\(serializarCandidata\)/);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ O QUARTO VERBO — ABSORVER (dono, 01/09/2026).
  //
  // > *"eu posso ter feito os lançamentos através da nota, e depois importar o extrato (…) como não
  // > duplicar isso?"*
  //
  // Sem `podeAbsorver` no serializador, o botão não aparece — e o caso volta a não ter saída
  // nenhuma. Sem `divergencia`, ele aparece MUDO: o contador absorve e nunca fica sabendo que o
  // razão está com outra data. É o mesmo defeito de campo-fora-do-serializador, agora no aviso.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ `podeAbsorver` e `divergencia` VIAJAM — senão o verbo novo some, ou aparece mudo", async () => {
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const absorvivel = linhas.find((l) => l.sugestao?.podeAbsorver === true);
    expect(absorvivel).toBeDefined();
    expect(absorvivel.sugestao.leitura).toBe("ja_contabilizada");
    expect(absorvivel.sugestao.divergencia).toEqual(
      expect.objectContaining({ diverge: true, dias: expect.any(Number) }),
    );
    expect(FONTE_DA_ROTA).toMatch(/podeAbsorver:\s*c\.podeAbsorver/);
    expect(FONTE_DA_ROTA).toMatch(/divergencia:\s*serializarDivergencia\(c\.divergencia\)/);
  });

  it("⚠⚠ os DOIS VERBOS nunca vêm juntos na mesma sugestão", async () => {
    // Quem decide é `lerCandidata`, no servidor: a nota em aberto se CASA, a já lançada se ABSORVE.
    // Os dois botões na mesma linha fariam a tela perguntar o que o estado da nota já responde.
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    for (const l of linhas.filter((x) => x.sugestao)) {
      expect(l.sugestao.podeFundir && l.sugestao.podeAbsorver).toBeFalsy();
    }
  });

  it("⚠⚠ e o mock EXERCITA a absorção — senão o ramo nasce inalcançável offline (nona vez)", async () => {
    // ⚠ A divergência do mock é DIFERENTE de zero de propósito: com as duas datas iguais, o aviso
    // — que é a metade *"e AVISA"* da decisão do dono — nunca apareceria numa conferência offline.
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const absorvivel = linhas.find((l) => l.sugestao?.podeAbsorver === true);
    expect(absorvivel.sugestao.divergencia.dias).not.toBe(0);
    expect(typeof mock.postConferenciaAbsorver).toBe("function");
    const r = await mock.postConferenciaAbsorver("emp-1", {
      declaradoOfxId: absorvivel.debito.id,
      declaradoNotaId: absorvivel.sugestao.nota.id,
    });
    // ⚠⚠ A NOTA VOLTA `CONTABILIZADO` — offline também: absorver não a toca. Devolvê-la
    // `A_CONFERIR` aqui (o que a fusão faz) esconderia a diferença inteira entre os dois verbos.
    expect(r.nota.estado).toBe("CONTABILIZADO");
    expect(r.declarado.estado).toBe("FUNDIDO");
    expect(r.divergencia.diverge).toBe(true);
  });

  it("⚠⚠ o mock exercita os DOIS desfechos — senão o ramo novo nasce inalcançável offline", async () => {
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const fundiveis = linhas.filter((l) => l.sugestao?.podeFundir === true);
    const naoFundiveis = linhas.filter((l) => l.sugestao?.podeFundir === false);
    expect(fundiveis.length).toBeGreaterThan(0);
    expect(naoFundiveis.length).toBeGreaterThan(0);
    // ⚠ E a não-fundível diz POR QUÊ — botão que some mudo é o defeito que a frase existe para evitar.
    expect(naoFundiveis[0].sugestao.fraseDaCandidata).toMatch(/duas vezes/i);
  });

  it("⚠⚠ e o caso da DECISÃO DO DONO está exercido: a nota com data declarada à mão", async () => {
    // *"a prova vence"* (27/08/2026). É o ramo que o alargamento criou — e o que estava furado.
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const declarada = linhas.find((l) => l.sugestao?.leitura === "pagamento_declarado");
    expect(declarada).toBeDefined();
    expect(declarada.sugestao.podeFundir).toBe(true);
    expect(declarada.sugestao.fraseDaCandidata).toMatch(/substitui a declaração/i);
  });

  it("⚠⚠ TODO débito dos casamentos continua existindo na fila — a trava do espaço de ids", async () => {
    // Repetida aqui de propósito para as linhas NOVAS: um débito acrescentado ao mock sem a linha
    // correspondente na fila reabriria o buraco que o teste do topo fechou.
    const fila = await mock.getConferenciaFila("emp-1", { competencia: "2026-07" });
    const cas = await mock.getConferenciaCasamentos("emp-1");
    const idsDaFila = new Set(fila.itens.map((i) => i.id));
    for (const l of cas.linhas) expect(idsDaFila.has(l.debito.id)).toBe(true);
  });

  it("⚠⚠ AMBIGUIDADE: com dois candidatos, `sugestao` é NULA e os dois voltam", async () => {
    // O sistema não escolhe entre notas. Se o mock trouxesse uma sugestão eleita aqui, a tela
    // nasceria sem o desenho que impede a despesa de ir para o fornecedor errado.
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const ambiguo = linhas.find((l) => l.motivo === "ambiguo");
    expect(ambiguo).toBeDefined();
    expect(ambiguo.sugestao).toBeNull();
    expect(ambiguo.candidatos.length).toBeGreaterThan(1);
  });

  it("⚠ o mock exercita as TRÊS respostas do casamento", async () => {
    const { linhas } = await mock.getConferenciaCasamentos("emp-1");
    const motivos = linhas.map((l) => l.motivo);
    expect(new Set(motivos)).toEqual(new Set([null, "ambiguo", "nenhum_candidato"]));
  });
});

describe("⚠⚠ A DATA-PISO DA VARREDURA É OBRIGATÓRIA no servidor", () => {
  it("a rota recusa sem `desde`, com código nomeado", () => {
    // São 1.897 notas recebidas: sem corte, a primeira varredura produz a base inteira de uma vez —
    // e isso não é fila, é muro. A tela NÃO pode inventar um default.
    expect(FONTE_DA_ROTA).toMatch(/error: "data_piso_obrigatoria"/);
    expect(FONTE_DA_ROTA).toMatch(/error: "data_piso_invalida"/);
  });

  it("⚠ a rota NÃO tem default de data — nenhum `desde ||` nem `?? new Date`", () => {
    const trecho = FONTE_DA_ROTA.slice(FONTE_DA_ROTA.indexOf("varrer-notas"));
    expect(trecho).not.toMatch(/desde\s*(\|\||\?\?)\s*[^;]*Date/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A PROPOSTA DA IA (02/09/2026) — as colunas `*Ia` e o relatório do botão
//
// Duas pontas, como sempre: o MOCK produz e a FONTE do servidor escreve. O relatório do botão sai do
// SERVIÇO (a rota espalha `relatorio` inteiro), então a segunda ponta é lida lá.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ A PROPOSTA DA IA viaja na fila e o relatório do botão tem a forma do serviço", () => {
  const FONTE_DO_SERVICO = fs.readFileSync(
    path.join(RAIZ, "apps", "api", "src", "application", "declarados", "ClassificacaoPorIaService.js"),
    "utf8",
  );
  const CHAVES_IA_DA_LINHA = ["contaSugeridaIa", "creditoSugeridoIa", "justificativaIa", "sugeridaIaModelo", "sugeridaIaEm"];

  it("⚠ toda linha do mock carrega as cinco colunas `*Ia` (nulas por padrão), e a rota as serializa", async () => {
    const fila = await mock.getConferenciaFila("emp-1", { competencia: "2026-07" });
    for (const item of fila.itens) {
      for (const chave of CHAVES_IA_DA_LINHA) expect(Object.prototype.hasOwnProperty.call(item, chave)).toBe(true);
    }
    for (const chave of CHAVES_IA_DA_LINHA) expect(new RegExp(`\\b${chave}:\\s*d\\.${chave}`).test(FONTE_DA_ROTA)).toBe(true);
  });

  it("⚠⚠ o mock EXERCITA a proposta — uma linha SEM regra nem histórico vem com débito, crédito e justificativa da IA", async () => {
    const fila = await mock.getConferenciaFila("emp-1", { competencia: "2026-07" });
    const comIa = fila.itens.filter((i) => i.contaSugeridaIa);
    expect(comIa.length).toBeGreaterThan(0);
    for (const i of comIa) {
      // ⚠ regra > histórico > IA: a linha com proposta da IA no mock NÃO pode ter sugestão de regra —
      // senão o chip "proposta da IA" seria inalcançável offline (a tela dá precedência à regra).
      expect(i.sugestao?.conta ?? null).toBeNull();
      expect(typeof i.justificativaIa).toBe("string");
      expect(i.creditoSugeridoIa).toBeTruthy();
    }
  });

  it("⚠ o pré-voo do botão (`iaClassificacaoLigada`) vem do servidor — e o mock o liga", async () => {
    const fila = await mock.getConferenciaFila("emp-1", { competencia: "2026-07" });
    expect(fila.iaClassificacaoLigada).toBe(true);
    expect(FONTE_DA_ROTA).toMatch(/iaClassificacaoLigada:\s*INTEGRACAO_IA_CLASSIFICACAO/);
  });

  it("o relatório do mock tem exatamente as chaves que o SERVIÇO monta", async () => {
    const r = await mock.postClassificarIa("emp-1", { competencia: "2026-07" });
    const chaves = ["ok", "recusa", "semLinhas", "linhasOlhadas", "linhasEnviadas", "lotes", "propostas", "gravadas", "recusadas", "ilegiveis", "erros", "recusadaPelaGuarda", "custoEstimadoCentavos", "modelo"];
    for (const chave of chaves) {
      expect(Object.prototype.hasOwnProperty.call(r, chave)).toBe(true);
      expect(new RegExp(`\\b${chave}\\b`).test(FONTE_DO_SERVICO)).toBe(true);
    }
  });

  it("⚠⚠ e o mock exercita uma RECUSADA com motivo — senão o bloco 'recusadas pelo sistema' nasce inalcançável offline", async () => {
    const r = await mock.postClassificarIa("emp-1", {});
    expect(r.recusadas.length).toBeGreaterThan(0);
    expect(r.recusadas[0]).toMatchObject({ id: expect.any(String), motivo: expect.any(String) });
    // o motivo é do vocabulário FECHADO da api
    const FONTE_DA_LIB = fs.readFileSync(path.join(RAIZ, "apps", "api", "src", "application", "declarados", "lib", "classificacaoPorIa.js"), "utf8");
    expect(FONTE_DA_LIB).toContain(`"${r.recusadas[0].motivo}"`);
  });

  it("⚠⚠ a rota do botão recusa com 503 NOMEADO quando a flag está OFF — quem recusa é o servidor", () => {
    expect(FONTE_DA_ROTA).toMatch(/classificar-ia/);
    expect(FONTE_DA_ROTA).toMatch(/status\(503\)/);
    expect(FONTE_DO_SERVICO).toMatch(/DESLIGADA:\s*"ia_classificacao_desligada"/);
  });

  it("⚠⚠ o serviço NUNCA escreve `contaAplicada` nem `estado` — a IA propõe, o contador lança", () => {
    const trecho = FONTE_DO_SERVICO.slice(FONTE_DO_SERVICO.indexOf("async function gravarPropostas"));
    const dataBloco = trecho.slice(trecho.indexOf("data: {"), trecho.indexOf("},", trecho.indexOf("data: {")));
    expect(dataBloco).not.toMatch(/contaAplicada|contaCredito:|estado:/);
    expect(dataBloco).toMatch(/contaSugeridaIa/);
  });
});
