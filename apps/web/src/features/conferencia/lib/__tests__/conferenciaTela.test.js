// A LEITURA DE TELA DA CONFERÊNCIA.
//
// ⚠ O que se prende aqui são as LEIS que a tela pode desfazer sem querer: a lei de cor deste
// projeto, a procedência da data de pagamento, e a recusa de oferecer um clique que o servidor vai
// negar. A regra de transição em si é do backend e tem teste lá — aqui não se reimplementa nada.

import {
  ACAO,
  COMPETENCIA_AUSENTE,
  ESTADO,
  ORIGEM_PAGAMENTO,
  acaoPedeData,
  acoesDaLinha,
  agruparPorFornecedor,
  cnpjFormatado,
  contagemParaTela,
  dataCivil,
  dataSugeridaParaPagamento,
  dinheiro,
  leituraDaOrigemDoPagamento,
  leituraDoDocumento,
  leituraDoEstado,
  motivoDeBloqueio,
} from "../conferenciaTela.js";

const linha = (extra = {}) => ({
  id: "d-1",
  origem: "NOTA_RECEBIDA",
  estado: ESTADO.A_CONFERIR,
  valor: "1500.00",
  valorAjustado: null,
  competencia: "2026-07",
  descricaoOriginal: "GOOGLE CLOUD BRASIL",
  cnpjFornecedor: "12345678000190",
  dataDocumento: "2026-07-02",
  dataPagamento: "2026-07-15",
  origemPagamento: ORIGEM_PAGAMENTO.OFX,
  mesFechado: false,
  nota: { numero: "123", serie: "1", chaveAcesso: "x".repeat(50), tipo: "NFSE" },
  ...extra,
});

describe("⚠⚠ A LEI DE COR — âmbar é pendência, vermelho BLOQUEIA o fechamento", () => {
  it("⚠⚠ AGUARDANDO_PAGAMENTO é NEUTRO, nunca âmbar", () => {
    // Nota sem pagamento identificado não é pendência NOSSA: é a resposta certa. Âmbar ali diria
    // que o sistema falhou em algo, e âmbar permanente treina o olho a ignorar a cor.
    expect(leituraDoEstado(ESTADO.AGUARDANDO_PAGAMENTO).token).toBe("--state-neutral");
  });

  it("A_CONFERIR é âmbar — aí SIM há trabalho esperando alguém", () => {
    expect(leituraDoEstado(ESTADO.A_CONFERIR).token).toBe("--state-warn");
  });

  it("CONTABILIZADO é verde — concluído", () => {
    expect(leituraDoEstado(ESTADO.CONTABILIZADO).token).toBe("--state-ok");
  });

  it("⚠⚠ NENHUM estado usa `--state-danger` — nada aqui bloqueia o fechamento", () => {
    const tokens = Object.values(ESTADO).map((e) => leituraDoEstado(e).token);
    expect(tokens).not.toContain("--state-danger");
  });

  it("⚠ estado desconhecido não inventa rótulo bonito — diz que não conhece", () => {
    const r = leituraDoEstado("ESTADO_QUE_NAO_EXISTE_AINDA");
    expect(r.rotulo).toMatch(/desconhecid/i);
    expect(r.token).toBe("--state-neutral");
  });

  it("⚠ verde NUNCA é o tom de um botão de ação", () => {
    // Verde é CONCLUÍDO nesta casa; botão verde de "faça isto" ensina o contrário.
    const tons = Object.values(ACAO).map((a) => a.tom);
    expect(tons).not.toContain("ok");
    expect(tons).not.toContain("verde");
    expect(tons).toContain("accent");
  });
});

describe("⚠⚠ A PROCEDÊNCIA DA DATA — prova × declaração", () => {
  it("OFX é PROVA", () => {
    const r = leituraDaOrigemDoPagamento(ORIGEM_PAGAMENTO.OFX);
    expect(r.ehProva).toBe(true);
    expect(r.rotulo).toMatch(/extrato/i);
  });

  it("⚠⚠ DECLARADO_PELO_CONTADOR NÃO é prova, e a frase diz isso com essas palavras", () => {
    const r = leituraDaOrigemDoPagamento(ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR);
    expect(r.ehProva).toBe(false);
    expect(r.frase).toMatch(/declaração, não prova/i);
  });

  it("⚠ o que o CLIENTE informou também não é prova", () => {
    expect(leituraDaOrigemDoPagamento(ORIGEM_PAGAMENTO.CLIENTE).ehProva).toBe(false);
  });

  it("⚠⚠ AUSÊNCIA NÃO VIRA PROVA — nulo devolve `ehProva: false` com motivo", () => {
    const r = leituraDaOrigemDoPagamento(null);
    expect(r.ehProva).toBe(false);
    expect(r.rotulo).toMatch(/sem data/i);
    expect(r.frase).toBeTruthy();
  });

  it("⚠ procedência desconhecida também não vira prova", () => {
    expect(leituraDaOrigemDoPagamento("PIX_DIRETO_DO_BANCO").ehProva).toBe(false);
  });

  it("⚠⚠ SÓ O OFX é prova — a lista é de INCLUSÃO", () => {
    const provas = Object.values(ORIGEM_PAGAMENTO).filter((o) => leituraDaOrigemDoPagamento(o).ehProva);
    expect(provas).toEqual([ORIGEM_PAGAMENTO.OFX]);
  });
});

describe("⚠ as ações oferecidas — mapa de INCLUSÃO, como o backend", () => {
  it("AGUARDANDO_PAGAMENTO oferece informar, confirmar (o atalho do dono) e recusar", () => {
    expect(acoesDaLinha(linha({ estado: ESTADO.AGUARDANDO_PAGAMENTO }))).toEqual([
      "informar-pagamento",
      "confirmar",
      "recusar",
    ]);
  });

  it("CONTABILIZADO só oferece desfazer", () => {
    expect(acoesDaLinha(linha({ estado: ESTADO.CONTABILIZADO }))).toEqual(["desfazer"]);
  });

  it("⚠ RECUSADO oferece REABRIR — recusar por engano não é beco sem saída", () => {
    expect(acoesDaLinha(linha({ estado: ESTADO.RECUSADO }))).toEqual(["reabrir"]);
  });

  it("⚠⚠ FUNDIDO não oferece nada — ele foi absorvido por outra linha", () => {
    expect(acoesDaLinha(linha({ estado: ESTADO.FUNDIDO }))).toEqual([]);
  });

  it("⚠⚠ ESTADO NOVO NASCE SEM AÇÃO NENHUMA, não com todas", () => {
    expect(acoesDaLinha(linha({ estado: "ESTADO_FUTURO" }))).toEqual([]);
  });

  it("⚠ toda ação oferecida existe no vocabulário", () => {
    for (const e of Object.values(ESTADO)) {
      for (const a of acoesDaLinha(linha({ estado: e }))) expect(ACAO[a]).toBeDefined();
    }
  });
});

describe("⚠⚠ CONFIRMAR SEM DATA PEDE A DATA — a tela não descobre a regra pelo erro", () => {
  it("confirmar a partir de AGUARDANDO_PAGAMENTO pede a data", () => {
    const item = linha({ estado: ESTADO.AGUARDANDO_PAGAMENTO, dataPagamento: null, origemPagamento: null });
    expect(acaoPedeData("confirmar", item)).toBe(true);
  });

  it("confirmar com data já conhecida NÃO pergunta de novo", () => {
    expect(acaoPedeData("confirmar", linha())).toBe(false);
  });

  it("`informar-pagamento` sempre pede a data — é o que ela faz", () => {
    expect(acaoPedeData("informar-pagamento", linha())).toBe(true);
  });

  it("recusar e reabrir não pedem data", () => {
    expect(acaoPedeData("recusar", linha())).toBe(false);
    expect(acaoPedeData("reabrir", linha())).toBe(false);
  });
});

describe("⚠⚠ A DATA SUGERIDA — a emissão da nota, NUNCA hoje", () => {
  it("sugere a data do documento quando não há pagamento", () => {
    const item = linha({ dataPagamento: null, dataDocumento: "2026-07-02" });
    expect(dataSugeridaParaPagamento(item)).toBe("2026-07-02");
  });

  it("⚠⚠ SEM DATA NO DOCUMENTO, O CAMPO NASCE VAZIO — nunca 'hoje'", () => {
    // "Hoje" é a data do CLIQUE: ela afirmaria que a empresa pagou no instante em que alguém abriu
    // a tela. Vazio é honesto; um palpite não é.
    const item = linha({ dataPagamento: null, dataDocumento: null });
    const hoje = new Date().toISOString().slice(0, 10);
    expect(dataSugeridaParaPagamento(item)).toBe("");
    expect(dataSugeridaParaPagamento(item)).not.toBe(hoje);
  });

  it("a data de pagamento já conhecida vence a do documento", () => {
    expect(dataSugeridaParaPagamento(linha())).toBe("2026-07-15");
  });
});

describe("⚠ o bloqueio vem com o MOTIVO — botão mudo é pior que botão ausente", () => {
  it("linha normal não bloqueia nada", () => {
    expect(motivoDeBloqueio("confirmar", linha())).toBeNull();
  });

  it("⚠⚠ MÊS FECHADO bloqueia contabilizar E desfazer", () => {
    const item = linha({ mesFechado: true });
    expect(motivoDeBloqueio("confirmar", item)).toMatch(/fechada/i);
    expect(motivoDeBloqueio("desfazer", { ...item, estado: ESTADO.CONTABILIZADO })).toMatch(/fechada/i);
  });

  it("⚠ mês fechado NÃO bloqueia recusar nem reabrir — nada disso chega ao razão", () => {
    const item = linha({ mesFechado: true });
    expect(motivoDeBloqueio("recusar", item)).toBeNull();
    expect(motivoDeBloqueio("reabrir", { ...item, estado: ESTADO.RECUSADO })).toBeNull();
  });

  it("⚠⚠ COMPETÊNCIA NULA impede contabilizar, e o motivo nomeia o conserto", () => {
    // Deduzi-la da data seria o sistema decidindo em qual apuração a despesa entra.
    const item = linha({ competencia: null });
    expect(motivoDeBloqueio("confirmar", item)).toMatch(/competência/i);
  });

  it("⚠ competência nula NÃO impede recusar — recusar não vira lançamento", () => {
    expect(motivoDeBloqueio("recusar", linha({ competencia: null }))).toBeNull();
  });

  it("⚠ quem não pode escrever recebe o motivo do PAPEL, antes de qualquer outro", () => {
    const item = linha({ mesFechado: true, competencia: null });
    expect(motivoDeBloqueio("confirmar", item, { podeEscrever: false })).toMatch(/perfil/i);
  });
});

describe("⚠⚠ O DOCUMENTO — quando não dá para abrir, a tela DIZ POR QUÊ", () => {
  it("nota presente devolve o rótulo com número e série", () => {
    const r = leituraDoDocumento(linha());
    expect(r.temDocumento).toBe(true);
    expect(r.rotulo).toBe("NFSE 123/1");
  });

  it("⚠⚠ nota apagada NÃO some do desenho — devolve o motivo", () => {
    const r = leituraDoDocumento(linha({ nota: null }));
    expect(r.temDocumento).toBe(false);
    expect(r.motivo).toMatch(/não está mais na base/i);
  });

  it("⚠ débito de extrato diz que não há nota, e isso não é defeito", () => {
    const r = leituraDoDocumento(linha({ origem: "OFX_CLIENTE", nota: null }));
    expect(r.temDocumento).toBe(false);
    expect(r.motivo).toMatch(/extrato/i);
  });

  it("⚠ componente ausente vira traço, nunca string colada", () => {
    const r = leituraDoDocumento(linha({ nota: { numero: null, serie: null, tipo: "NFE" } }));
    expect(r.rotulo).toBe("NFE —");
  });
});

describe("⚠⚠ O AGRUPAMENTO POR FORNECEDOR — é o que torna a fila conferível", () => {
  it("agrupa pelo CNPJ, não pelo nome", () => {
    // Duas grafias do mesmo CNPJ são o MESMO fornecedor.
    const g = agruparPorFornecedor([
      linha({ id: "a", cnpjFornecedor: "111", descricaoOriginal: "GOOGLE CLOUD BRASIL" }),
      linha({ id: "b", cnpjFornecedor: "111", descricaoOriginal: "GOOGLE CLOUD BRASIL LTDA" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].itens).toHaveLength(2);
  });

  it("⚠ sem CNPJ, agrupa pelo nome — melhor que um balde 'sem fornecedor'", () => {
    const g = agruparPorFornecedor([
      linha({ id: "a", cnpjFornecedor: null, descricaoOriginal: "TARIFA BANCARIA" }),
      linha({ id: "b", cnpjFornecedor: null, descricaoOriginal: "TARIFA BANCARIA" }),
      linha({ id: "c", cnpjFornecedor: null, descricaoOriginal: "PAGTO ALUGUEL" }),
    ]);
    expect(g).toHaveLength(2);
  });

  it("⚠⚠ CNPJ e nome NÃO se misturam — o CNPJ identifica, o nome só se parece", () => {
    const g = agruparPorFornecedor([
      linha({ id: "a", cnpjFornecedor: "111", descricaoOriginal: "ACME" }),
      linha({ id: "b", cnpjFornecedor: null, descricaoOriginal: "ACME" }),
    ]);
    expect(g).toHaveLength(2);
  });

  it("⚠ o total do grupo usa o valor AJUSTADO quando ele existe", () => {
    const g = agruparPorFornecedor([
      linha({ id: "a", cnpjFornecedor: "111", valor: "1000.00", valorAjustado: "900.00" }),
    ]);
    expect(g[0].total).toBe(900);
  });

  it("⚠ ordem por VOLUME — o fornecedor que concentra dinheiro vem primeiro", () => {
    const g = agruparPorFornecedor([
      linha({ id: "a", cnpjFornecedor: "111", descricaoOriginal: "PEQUENO", valor: "10.00" }),
      linha({ id: "b", cnpjFornecedor: "222", descricaoOriginal: "GRANDE", valor: "9000.00" }),
    ]);
    expect(g.map((x) => x.nome)).toEqual(["GRANDE", "PEQUENO"]);
  });

  it("⚠ valor ilegível não vira NaN no total do grupo", () => {
    const g = agruparPorFornecedor([
      linha({ id: "a", cnpjFornecedor: "111", valor: "1000.00", valorAjustado: null }),
      linha({ id: "b", cnpjFornecedor: "111", valor: null, valorAjustado: null }),
    ]);
    expect(g[0].total).toBe(1000);
  });

  it("lista vazia devolve lista vazia, sem estourar", () => {
    expect(agruparPorFornecedor([])).toEqual([]);
    expect(agruparPorFornecedor(null)).toEqual([]);
  });
});

describe("⚠⚠ A CONTAGEM vem do servidor — nunca de `itens.length`", () => {
  it("todos os estados aparecem, inclusive os zerados", () => {
    const c = contagemParaTela({ [ESTADO.A_CONFERIR]: 12 });
    expect(c).toHaveLength(Object.keys(ESTADO).length);
    expect(c.find((x) => x.estado === ESTADO.CONTABILIZADO).quantidade).toBe(0);
  });

  it("⚠ estado ausente do groupBy é ZERO, e zero aparece — sumir faria 'não há' e 'não perguntei' ficarem iguais", () => {
    const c = contagemParaTela({});
    expect(c.every((x) => x.quantidade === 0)).toBe(true);
  });

  it("⚠ A_CONFERIR vem primeiro — é o que espera alguém", () => {
    expect(contagemParaTela({})[0].estado).toBe(ESTADO.A_CONFERIR);
  });

  it("⚠ contagem ilegível não vira NaN na tela", () => {
    expect(contagemParaTela({ [ESTADO.A_CONFERIR]: "doze" })[0].quantidade).toBe(0);
  });
});

describe("⚠ formatação", () => {
  it("dinheiro sai em pt-BR", () => {
    expect(dinheiro("1500.5").replace(/\s/g, " ")).toBe("R$ 1.500,50");
  });

  it("⚠ valor ausente vira traço, nunca R$ 0,00 — zero é uma afirmação", () => {
    expect(dinheiro(null)).toBe("—");
    expect(dinheiro("abc")).toBe("—");
  });

  it("⚠⚠ a data NÃO passa por `new Date` — o UTC comeria um dia", () => {
    // `new Date("2026-07-15").toLocaleDateString("pt-BR")` imprime 14/07 no Brasil.
    expect(dataCivil("2026-07-15")).toBe("15/07/2026");
    expect(dataCivil("2026-01-01")).toBe("01/01/2026");
  });

  it("data ausente ou torta vira traço", () => {
    expect(dataCivil(null)).toBe("—");
    expect(dataCivil("15/07/2026")).toBe("—");
  });

  it("CNPJ formatado; o que não tem 14 dígitos volta como veio", () => {
    expect(cnpjFormatado("12345678000190")).toBe("12.345.678/0001-90");
    expect(cnpjFormatado("123")).toBe("123");
    expect(cnpjFormatado(null)).toBeNull();
  });

  it("⚠ o recorte das sem competência é o MESMO literal que a rota aceita", () => {
    expect(COMPETENCIA_AUSENTE).toBe("sem-competencia");
  });
});

describe("⚠⚠ AUSÊNCIA × AFIRMAÇÃO no dinheiro — a distinção que o teste acima achou", () => {
  it("zero INFORMADO imprime R$ 0,00 — é uma afirmação legítima", () => {
    expect(dinheiro(0).replace(/\s/g, " ")).toBe("R$ 0,00");
    expect(dinheiro("0.00").replace(/\s/g, " ")).toBe("R$ 0,00");
  });

  it("⚠⚠ mas ausência NUNCA imprime zero", () => {
    // `Number(null)` é 0 e passa em `Number.isFinite` — sem a guarda explícita, a tela afirmaria
    // que a despesa é de zero reais.
    for (const ausente of [null, undefined, ""]) expect(dinheiro(ausente)).toBe("—");
  });
});

describe("⚠ o tom vira `variant` do Button — num mapa nomeado, não numa tradução solta", () => {
  const { variantDoTom } = require("../conferenciaTela.js");

  it("accent é a ação primária; perigo é o destrutivo", () => {
    expect(variantDoTom("accent")).toBe("primary");
    expect(variantDoTom("perigo")).toBe("danger");
    expect(variantDoTom("neutro")).toBe("secondary");
  });

  it("⚠⚠ tom desconhecido cai no DISCRETO, nunca vira ação primária", () => {
    expect(variantDoTom("tom_novo")).toBe("secondary");
    expect(variantDoTom(undefined)).toBe("secondary");
  });

  it("⚠⚠ nenhuma ação vira `success` — verde é CONCLUÍDO, e o Button nem o aceita", () => {
    const variants = Object.values(ACAO).map((a) => variantDoTom(a.tom));
    expect(variants).not.toContain("success");
    expect(new Set(variants)).toEqual(new Set(["primary", "secondary", "danger"]));
  });
});

describe("⚠⚠ O CASAMENTO — o sistema NUNCA escolhe entre notas", () => {
  const {
    SEM_CASAMENTO, leituraDoCasamento, podeCasar, ordenarCasamentos,
  } = require("../conferenciaTela.js");

  const comSugestao = { debito: { id: "o-1" }, sugestao: { nota: { id: "n-1" } }, candidatos: [{}], motivo: null };
  const ambiguo = { debito: { id: "o-2" }, sugestao: null, candidatos: [{}, {}], motivo: SEM_CASAMENTO.AMBIGUO };
  const semNota = { debito: { id: "o-3" }, sugestao: null, candidatos: [], motivo: SEM_CASAMENTO.NENHUM_CANDIDATO };

  it("⚠⚠ O BOTÃO DE CASAR SÓ EXISTE COM SUGESTÃO ÚNICA", () => {
    expect(podeCasar(comSugestao)).toBe(true);
    expect(podeCasar(ambiguo)).toBe(false);
    expect(podeCasar(semNota)).toBe(false);
  });

  it("⚠⚠ com dois candidatos NÃO há como casar — nem com o primeiro", () => {
    // Um "casar" ao lado de cada candidato pareceria inofensivo e desfaria a regra: a ambiguidade
    // existe para o sistema não decidir, e um clique fácil converte isso na decisão do dedo de quem
    // está com pressa.
    expect(podeCasar({ ...ambiguo, candidatos: [{ nota: { id: "n-7" } }, { nota: { id: "n-8" } }] })).toBe(false);
  });

  it("⚠ sugestão sem id de nota não habilita o botão", () => {
    expect(podeCasar({ debito: { id: "o-1" }, sugestao: { nota: {} } })).toBe(false);
    expect(podeCasar({ sugestao: { nota: { id: "n-1" } } })).toBe(false);
  });

  it("⚠⚠ AMBÍGUO é ÂMBAR, não vermelho — é o sistema funcionando, não quebrando", () => {
    expect(leituraDoCasamento(ambiguo).token).toBe("--state-warn");
  });

  it("⚠ SEM NOTA é NEUTRO — débito sem nota é comum e legítimo", () => {
    // Âmbar ali encheria a tela de pendência falsa.
    expect(leituraDoCasamento(semNota).token).toBe("--state-neutral");
  });

  it("⚠ o rótulo da sugestão diz SUGESTÃO, nunca 'casado'", () => {
    const r = leituraDoCasamento(comSugestao);
    expect(r.rotulo).toMatch(/sugest/i);
    expect(r.frase).toMatch(/não decide isso sozinho/i);
  });

  it("⚠⚠ NENHUMA resposta do casamento usa `--state-danger`", () => {
    const tokens = [comSugestao, ambiguo, semNota, {}].map((l) => leituraDoCasamento(l).token);
    expect(tokens).not.toContain("--state-danger");
  });

  it("⚠ ordem: decisão esperando primeiro, sem-nota por último", () => {
    const ordenado = ordenarCasamentos([semNota, ambiguo, comSugestao]);
    expect(ordenado.map((l) => l.debito.id)).toEqual(["o-1", "o-2", "o-3"]);
  });

  it("⚠ ordenar não muta a lista recebida", () => {
    const lista = [semNota, comSugestao];
    ordenarCasamentos(lista);
    expect(lista[0]).toBe(semNota);
  });
});

describe("⚠⚠ A VARREDURA — a data-piso não tem default", () => {
  const { dataPisoEhValida, leituraDaVarredura, fraseDaRecusa } = require("../conferenciaTela.js");

  it("aceita AAAA-MM-DD e recusa o resto", () => {
    expect(dataPisoEhValida("2026-07-01")).toBe(true);
    expect(dataPisoEhValida("01/07/2026")).toBe(false);
    expect(dataPisoEhValida("2026-07")).toBe(false);
    expect(dataPisoEhValida("")).toBe(false);
    expect(dataPisoEhValida(null)).toBe(false);
  });

  it("⚠⚠ o relatório sai INTEIRO — criadas, já existiam e as que não entraram", () => {
    const r = leituraDaVarredura({
      varridas: 18, criados: 12, jaExistiam: 4,
      fora: [{ notaId: "a" }],
      recusados: [{ notaId: "b", motivo: "sem_valor" }],
    });
    expect(r).toMatchObject({ varridas: 18, criados: 12, jaExistiam: 4, fora: 1 });
    expect(r.recusados).toHaveLength(1);
  });

  it("⚠⚠ 'nada criado, tudo já existia' é a IDEMPOTÊNCIA funcionando — e tem nome", () => {
    // Sem isto o contador roda três vezes achando que não funcionou.
    const r = leituraDaVarredura({ varridas: 12, criados: 0, jaExistiam: 12, fora: [], recusados: [] });
    expect(r.tudoJaExistia).toBe(true);
    expect(r.nadaVarrido).toBe(false);
  });

  it("⚠ 'nada varrido' é diferente de 'nada criado'", () => {
    const r = leituraDaVarredura({ varridas: 0, criados: 0, jaExistiam: 0, fora: [], recusados: [] });
    expect(r.nadaVarrido).toBe(true);
    expect(r.tudoJaExistia).toBe(false);
  });

  it("sem relatório, devolve null — não um objeto zerado que afirmaria varredura vazia", () => {
    expect(leituraDaVarredura(null)).toBeNull();
  });

  it("⚠ motivo conhecido vira português; DESCONHECIDO volta CRU, nunca sumindo", () => {
    expect(fraseDaRecusa("sem_valor")).toMatch(/não tem valor/i);
    expect(fraseDaRecusa("motivo_novo_do_backend")).toBe("motivo_novo_do_backend");
    expect(fraseDaRecusa(null)).toMatch(/sem motivo/i);
  });
});
