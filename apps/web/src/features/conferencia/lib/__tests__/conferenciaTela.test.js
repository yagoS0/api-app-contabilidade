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
  cabecalhoDoGrupo,
  cnpjFormatado,
  contagemParaTela,
  dataCivil,
  dataSugeridaParaPagamento,
  dinheiro,
  leituraDaOrigemDoPagamento,
  leituraDoDocumento,
  leituraDoEstado,
  FRASE_LOCAL_DO_MOTIVO,
  ROTULO_CURTO_DO_MOTIVO,
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
  // ⚠ A linha normal TEM conta conhecida — sem ela o pré-voo bloqueia, e é o que se quer.
  contaSugerida: "411030012",
  sugestao: null,
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

  it("⚠⚠ A LISTA DE PROVA É DE INCLUSÃO, e são exatamente DUAS — as duas do BANCO", () => {
    // ⚠⚠ ESTE TESTE DIZIA "SÓ O OFX" ATÉ 01/09/2026, e a lista envelheceu, não a invariante.
    // `EXTRATO_EXCEL` sempre foi prova na FONTE (`application/declarados/lib/estadosDeclarado.js`,
    // que a documenta com um "**Por que PROVA**" próprio): quem afirma que o dinheiro saiu é o
    // banco, nos dois formatos. O que faltava era esta tela conhecer o valor — ela espelhava três
    // dos cinco, e a linha da planilha lia "Procedência desconhecida".
    // ⚠ O QUE NÃO MUDOU, e é o que este teste existe para guardar: a lista é de INCLUSÃO. Nada vira
    // prova por default — nem ausência, nem valor novo, nem o que uma pessoa declarou.
    const provas = Object.values(ORIGEM_PAGAMENTO).filter((o) => leituraDaOrigemDoPagamento(o).ehProva);
    expect(provas.sort()).toEqual([ORIGEM_PAGAMENTO.EXTRATO_EXCEL, ORIGEM_PAGAMENTO.OFX].sort());
  });

  it("⚠⚠ e as TRÊS declarações continuam fora dela — inclusive a presumida por REGRA", () => {
    // A presumida por regra é a mais delicada: o lançamento dela afirma uma saída de caixa que
    // ninguém testemunhou. Tratá-la como prova apagaria exatamente esse aviso.
    for (const o of [
      ORIGEM_PAGAMENTO.DECLARADO_PELO_CONTADOR,
      ORIGEM_PAGAMENTO.CLIENTE,
      ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA,
    ]) {
      expect(leituraDaOrigemDoPagamento(o).ehProva).toBe(false);
    }
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

  it("⚠⚠ o extrato em PLANILHA diz o mesmo — ele também nunca teve nota", () => {
    // Até 01/09/2026 a comparação era só `"OFX_CLIENTE"`, e a linha da planilha caía no ramo de
    // cima, afirmando *"a nota de origem não está mais na base"* sobre uma linha que NUNCA teve
    // nota. É afirmar um documento apagado que nunca existiu — e mandar o contador procurá-lo.
    const r = leituraDoDocumento(linha({ origem: "EXTRATO_EXCEL_CLIENTE", nota: null }));
    expect(r.temDocumento).toBe(false);
    expect(r.motivo).toMatch(/extrato/i);
    expect(r.motivo).not.toMatch(/não está mais na base/i);
  });

  it("⚠ origem que a tela NÃO conhece cai na leitura da NOTA, nunca em «veio do extrato»", () => {
    // Na dúvida, o caminho de sempre. Dizer "veio do extrato" sobre origem desconhecida inventaria
    // a procedência da despesa.
    const r = leituraDoDocumento(linha({ origem: "ORIGEM_NOVA_DO_BACKEND", nota: null }));
    expect(r.motivo).toMatch(/não está mais na base/i);
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
    SEM_CASAMENTO, leituraDoCasamento, podeCasar, podeAbsorver, fraseDaDivergencia, ordenarCasamentos,
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

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ NEM TODA SUGESTÃO SE FUNDE — o alargamento do casamento (dono, 27/08/2026: *"a prova
  // vence"*). Uma nota JÁ CONTABILIZADA vira sugestão para o débito ser RECONHECIDO — senão ele
  // entra no lote como despesa sem nota e o mesmo dinheiro é lançado duas vezes —, mas não há o
  // que fundir: a data dela já é a data do `AccountingEntry`.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ a nota já contabilizada aparece e NÃO ganha botão", () => {
    expect(podeCasar({ ...comSugestao, sugestao: { nota: { id: "n-1" }, podeFundir: false } })).toBe(false);
  });

  it("⚠ a fundível continua ganhando", () => {
    expect(podeCasar({ ...comSugestao, sugestao: { nota: { id: "n-1" }, podeFundir: true } })).toBe(true);
  });

  it("⚠ `podeFundir` AUSENTE é lido como true — contrato antigo, e quem recusa é o servidor", () => {
    // Recusar por omissão tiraria o botão de toda linha no dia em que o campo não viesse.
    expect(podeCasar(comSugestao)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠⚠ O QUARTO VERBO: ABSORVER (dono, 01/09/2026) — e ele existe porque a nota JÁ LANÇADA era um
  // beco sem saída. `podeFundir: false` e mais nada: o débito ficava na fila para sempre.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  it("⚠⚠ a nota já contabilizada é a que se ABSORVE", () => {
    expect(podeAbsorver({ ...comSugestao, sugestao: { nota: { id: "n-1" }, podeAbsorver: true } })).toBe(true);
  });

  it("⚠⚠ `podeAbsorver` AUSENTE é lido como FALSO — e a assimetria com `podeCasar` é proposital", () => {
    // Lá o contrato antigo era *"toda sugestão se funde"*, e omissão significa o de sempre. Aqui o
    // contrato antigo é *"este débito não tem saída"* — um botão que aparece por omissão de campo é
    // um botão que ninguém decidiu mostrar.
    expect(podeAbsorver(comSugestao)).toBe(false);
    expect(podeAbsorver({ ...comSugestao, sugestao: { nota: { id: "n-1" }, podeAbsorver: "sim" } })).toBe(false);
  });

  it("⚠ sem sugestão não há verbo nenhum", () => {
    expect(podeAbsorver({ debito: { id: "o-1" }, sugestao: null })).toBe(false);
    expect(podeAbsorver({ sugestao: { nota: { id: "n-1" }, podeAbsorver: true } })).toBe(false);
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

describe("⚠⚠ SEM CONTA NÃO SE CONTABILIZA — o pré-voo que faltava", () => {
  const { contaQueSeraUsada } = require("../conferenciaTela.js");

  it("⚠⚠ linha sem conta nenhuma BLOQUEIA confirmar, com o conserto nomeado", () => {
    // Achado por auditoria: a tela oferecia "Confirmar" em toda linha; o servidor recusava com
    // `sem_conta` e a tela descobria a regra pelo erro.
    const item = linha({ contaSugerida: null, sugestao: null });
    expect(motivoDeBloqueio("confirmar", item)).toMatch(/conta/i);
    expect(motivoDeBloqueio("ajustar", item)).toMatch(/conta/i);
  });

  it("⚠ mas NÃO bloqueia recusar nem reabrir — eles não viram lançamento", () => {
    const item = linha({ contaSugerida: null, sugestao: null });
    expect(motivoDeBloqueio("recusar", item)).toBeNull();
    expect(motivoDeBloqueio("reabrir", { ...item, estado: ESTADO.RECUSADO })).toBeNull();
  });

  it("⚠⚠ a SUGESTÃO derivada vence a coluna `contaSugerida`", () => {
    // A coluna foi gravada quando o declarado nasceu; uma regra criada depois não a atualizou.
    expect(contaQueSeraUsada({ contaSugerida: "111", sugestao: { conta: "999" } })).toBe("999");
  });

  it("a coluna vale quando não há sugestão derivada", () => {
    expect(contaQueSeraUsada({ contaSugerida: "111", sugestao: null })).toBe("111");
  });

  it("⚠ sem nenhuma das duas, devolve null — é o que o pré-voo usa", () => {
    expect(contaQueSeraUsada({ contaSugerida: null, sugestao: null })).toBeNull();
    expect(contaQueSeraUsada({})).toBeNull();
    expect(contaQueSeraUsada(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ "NÃO SEI QUAL CONTA" E "SEI, E ELA NÃO SERVE" PEDEM CONSERTOS OPOSTOS.
//
// Achado por agentes de verificação em 26/08/2026, depois que o servidor passou a recusar conta
// SINTÉTICA e o motor parou de sugeri-la: a tela chamava os dois casos de "sem conta" e mandava
// "confirme uma vez este fornecedor para o sistema aprender" — que para eles REENSINARIA a mesma
// regra torta. A frase certa existia e só chegava no `title`, que não aparece no teclado nem no
// toque.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ conta conhecida que não serve", () => {
  const linha = (sugestao) => ({
    id: "d-1",
    estado: "A_CONFERIR",
    competencia: "2026-07",
    dataPagamento: "2026-07-10",
    origemPagamento: "OFX",
    mesFechado: false,
    contaSugerida: null,
    sugestao,
  });

  const bloqueio = (sugestao) =>
    motivoDeBloqueio("confirmar", linha(sugestao), { podeEscrever: true });

  it("SINTÉTICA: o bloqueio manda corrigir a REGRA, nunca 'confirme para o sistema aprender'", () => {
    const m = bloqueio({ conta: null, motivo: "conta_sintetica", frase: "" });
    expect(m).toBeTruthy();
    expect(m).toMatch(/sintética|agregação/i);
    // ⚠⚠ o conselho errado NÃO pode aparecer aqui
    expect(m).not.toMatch(/para o sistema aprender/i);
  });

  it("AMBÍGUA: idem — confirmar não conserta duas contas com o mesmo código completo", () => {
    const m = bloqueio({ conta: null, motivo: "conta_ambigua", frase: "" });
    expect(m).toMatch(/mesmo código completo/i);
    expect(m).not.toMatch(/para o sistema aprender/i);
  });

  it("⚠ a frase do SERVIDOR vence a local — ela nomeia a conta", () => {
    const doServidor = "A conta 410 DESPESAS OPERACIONAIS é sintética (de agregação)…";
    expect(bloqueio({ conta: null, motivo: "conta_sintetica", frase: doServidor })).toBe(doServidor);
  });

  it("⚠ motivo DESCONHECIDO cai no texto genérico — conselho errado é pior que genérico", () => {
    const m = bloqueio({ conta: null, motivo: "motivo_que_ainda_nao_existe", frase: "" });
    expect(m).toMatch(/para o sistema aprender/i);
  });

  it("⚠ sem sugestão nenhuma continua no texto genérico", () => {
    expect(bloqueio(null)).toMatch(/Nenhuma conta conhecida/i);
  });

  it("os três motivos têm rótulo curto PRÓPRIO, e o desconhecido não", () => {
    expect(ROTULO_CURTO_DO_MOTIVO.fora_da_faixa).toBe("valor fora do normal");
    expect(ROTULO_CURTO_DO_MOTIVO.conta_sintetica).toBe("conta é de agregação");
    expect(ROTULO_CURTO_DO_MOTIVO.conta_ambigua).toBe("conta ambígua");
    expect(ROTULO_CURTO_DO_MOTIVO.nada_conhecido).toBeUndefined();
  });

  // ⚠⚠ O TEXTO LOCAL É CÓPIA LITERAL DO BACKEND. Duas redações fariam a tela dizer uma coisa e a
  // recusa do clique outra, sobre a MESMA linha. A amarração é textual porque o backend não é
  // importável do front — mesma disciplina do teste que amarra `"autorizada"`.
  it("⚠ o fallback local repete a frase do backend, palavra por palavra", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const backend = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "..", "..", "api", "src", "application",
        "declarados", "lib", "motorDeSugestao.js"),
      "utf8",
    );
    for (const frase of Object.values(FRASE_LOCAL_DO_MOTIVO)) {
      // a frase do backend é quebrada em concatenação; comparo o primeiro pedaço, que é o que
      // identifica o texto
      const inicio = frase.slice(0, 60);
      expect(backend).toContain(inicio);
    }
  });
});

// ⚠ Achado NA TELA, verificando o mock em 26/08/2026: a linha mostrava "valor fora do normal" na
// coluna e o botão dizia "Nenhuma conta conhecida" — a MESMA linha afirmando as duas coisas.
describe("⚠ fora da faixa também tem conta conhecida", () => {
  it("o bloqueio fala do VALOR, não manda ensinar o fornecedor de novo", () => {
    const m = motivoDeBloqueio(
      "confirmar",
      {
        id: "d-9", estado: "A_CONFERIR", competencia: "2026-07", dataPagamento: "2026-07-10",
        origemPagamento: "OFX", mesFechado: false, contaSugerida: null,
        sugestao: { conta: null, motivo: "fora_da_faixa", frase: "" },
      },
      { podeEscrever: true },
    );
    expect(m).toMatch(/fora da faixa/i);
    expect(m).not.toMatch(/Nenhuma conta conhecida/i);
    expect(m).not.toMatch(/para o sistema aprender/i);
  });
});

// ⚠ `podeEscolherConta` entrou em 26/08/2026 e a regra pura ficou SEM teste próprio — só a ligação
// a exercia. Regra da casa: regra de tela mora em `lib/` COM teste próprio.
describe("⚠⚠ podeEscolherConta — o seletor derruba o bloqueio, mas só quando há o que escolher", () => {
  const semConta = {
    id: "d-1", estado: "A_CONFERIR", competencia: "2026-07", dataPagamento: "2026-07-10",
    origemPagamento: "OFX", mesFechado: false, contaSugerida: null, sugestao: null,
  };

  it("COM seletor, linha sem conta deixa de ser bloqueada — o modal pergunta", () => {
    expect(motivoDeBloqueio("confirmar", semConta, { podeEscolherConta: true })).toBeNull();
  });

  it("⚠⚠ SEM seletor, o bloqueio com motivo volta — plano sem conta oferecível é caso real", () => {
    expect(motivoDeBloqueio("confirmar", semConta, { podeEscolherConta: false }))
      .toMatch(/Nenhuma conta conhecida/i);
  });

  it("⚠ o padrão é FALSO — chamador que esquecer o parâmetro bloqueia, nunca libera", () => {
    expect(motivoDeBloqueio("confirmar", semConta, {})).toMatch(/Nenhuma conta conhecida/i);
    expect(motivoDeBloqueio("confirmar", semConta)).toMatch(/Nenhuma conta conhecida/i);
  });

  it("⚠⚠ ele NÃO derruba os outros bloqueios — mês fechado e competência ausente ficam", () => {
    expect(motivoDeBloqueio("confirmar", { ...semConta, mesFechado: true }, { podeEscolherConta: true }))
      .toMatch(/fechada/i);
    expect(motivoDeBloqueio("confirmar", { ...semConta, competencia: null }, { podeEscolherConta: true }))
      .toMatch(/competência/i);
    expect(motivoDeBloqueio("confirmar", semConta, { podeEscrever: false, podeEscolherConta: true }))
      .toMatch(/perfil/i);
  });
});

// ⚠⚠ O CABEÇALHO DO GRUPO — medido no navegador antes de existir esta regra (01/09/2026): a fila
// mostrava **11 grupos para 11 linhas**, nenhum com mais de uma, e em 11 de 11 o título do grupo era
// a descrição EXATA da única linha dele, com um resumo "1 lançamento(s) · R$ X" repetindo o valor da
// coluna Valor logo abaixo. A regra não desliga o agrupamento: ela cala o grupo que não diz nada.
describe("⚠⚠ cabecalhoDoGrupo — o grupo só fala quando tem o que dizer", () => {
  const linha = (v) => ({ id: `d-${v}`, descricaoOriginal: "PAGTO KODA BEAR", valor: v });

  it("grupo de UMA linha SEM CNPJ não desenha cabeçalho — ele repetiria a linha", () => {
    const [g] = agruparPorFornecedor([linha(890)]);
    expect(g.itens).toHaveLength(1);
    expect(g.cnpj).toBeNull();
    expect(cabecalhoDoGrupo(g)).toBeNull();
  });

  it("⚠ COM CNPJ ele aparece mesmo com uma linha só — o CNPJ não está em nenhuma linha", () => {
    const [g] = agruparPorFornecedor([{ ...linha(890), cnpjFornecedor: "12345678000190" }]);
    const cab = cabecalhoDoGrupo(g);
    expect(cab).not.toBeNull();
    expect(cab.cnpj).toBe("12345678000190");
    // ⚠ E o RESUMO fica de fora: "1 lançamento(s) · R$ 890,00" repetiria a coluna Valor da linha.
    expect(cab.resumo).toBeNull();
  });

  it("⚠⚠ com DUAS ou mais linhas ele aparece sempre — o total do fornecedor não está em linha nenhuma", () => {
    const [g] = agruparPorFornecedor([linha(100), linha(50)]);
    expect(g.itens).toHaveLength(2);
    const cab = cabecalhoDoGrupo(g);
    expect(cab).not.toBeNull();
    expect(cab.resumo).toContain(dinheiro(150));
  });

  it("⚠ nulo/vazio não estoura e não inventa cabeçalho", () => {
    expect(cabecalhoDoGrupo(null)).toBeNull();
    expect(cabecalhoDoGrupo({ nome: "X", cnpj: null, itens: [], total: 0 })).toBeNull();
  });
});

describe("⚠⚠ fraseDaDivergencia — a metade «e AVISA» da decisão do dono", () => {
  const { fraseDaDivergencia } = require("../conferenciaTela.js");

  it("⚠⚠ diverge: a frase diz as DUAS datas, quantos dias, e que absorver NÃO corrige", () => {
    const f = fraseDaDivergencia({ diverge: true, dias: 5, dataDoLancamento: "2026-07-15", dataDoExtrato: "2026-07-20" });
    expect(f).toMatch(/15\/07\/2026/);
    expect(f).toMatch(/20\/07\/2026/);
    expect(f).toMatch(/5 dias/);
    expect(f).toMatch(/NÃO corrige/);
    // ⚠ E diz QUAL É O CONSERTO. Aviso sem conserto ensina a ignorar o aviso.
    expect(f).toMatch(/desfaça-o e refaça/i);
  });

  it("⚠ um dia é «1 dia», não «1 dias»", () => {
    expect(fraseDaDivergencia({ diverge: true, dias: 1, dataDoLancamento: "2026-07-15", dataDoExtrato: "2026-07-16" }))
      .toMatch(/1 dia de diferença/);
  });

  it("⚠ o sinal não vaza para a tela — «-5 dias de diferença» não é português", () => {
    expect(fraseDaDivergencia({ diverge: true, dias: -5, dataDoLancamento: "2026-07-20", dataDoExtrato: "2026-07-15" }))
      .toMatch(/5 dias de diferença/);
  });

  it("⚠⚠ mesma data NÃO vira aviso — e «não sei» também não", () => {
    // ⚠ `diverge: null` é o «não sei» do servidor (faltou uma das datas). Inventar uma diferença
    // que ninguém mediu é pior que não falar.
    expect(fraseDaDivergencia({ diverge: false, dias: 0 })).toBeNull();
    expect(fraseDaDivergencia({ diverge: null, dias: null })).toBeNull();
    expect(fraseDaDivergencia(null)).toBeNull();
    expect(fraseDaDivergencia(undefined)).toBeNull();
  });
});


// -------------------------------------------------------------------------------------------------
// ⚠⚠ O ESTADO DA VARREDURA AUTOMÁTICA — *"elas devem ser trazidas automaticamente, como tem na aba
// de notas fiscais deve aparecer ali"* (dono, 01/09/2026).
//
// ⚠⚠ SÃO CINCO RESPOSTAS, e amassá-las em duas é o defeito que esta leitura existe para impedir. A
// que sempre some é **"olhei e não veio nada"** — e confundi-la com "ninguém olhou" deixou a
// captura de notas 29 dias parada em produção sem ninguém perceber.
// -------------------------------------------------------------------------------------------------
describe("⚠⚠ leituraDaAutomacao — «ninguém olhou» ≠ «olhei e não veio nada»", () => {
  const { ESTADO_DA_AUTOMACAO, leituraDaAutomacao } = require("../conferenciaTela.js");

  const ligada = (extra = {}) => ({
    ligada: true, indisponivel: false, desde: "2026-07-01",
    ultimaTentativaEm: null, ultimoResultadoEm: null, ultimoCriados: null, ultimoErro: null, ...extra,
  });

  it("⚠ desligada: diz o que fazer, e não trata isso como erro", () => {
    const r = leituraDaAutomacao({ ligada: false, indisponivel: false });
    expect(r.estado).toBe(ESTADO_DA_AUTOMACAO.DESLIGADA);
    expect(r.frase).toMatch(/escolha a partir de que data/i);
  });

  it("⚠⚠ «não sei olhar» NÃO vira «desligada» — a segunda é uma afirmação sobre a empresa", () => {
    for (const caso of [null, undefined, { indisponivel: true }, { ligada: true, indisponivel: true }]) {
      expect(leituraDaAutomacao(caso).estado).toBe(ESTADO_DA_AUTOMACAO.INDISPONIVEL);
    }
  });

  it("ligada e nunca varrida: diz que a próxima busca vem no ciclo", () => {
    const r = leituraDaAutomacao(ligada());
    expect(r.estado).toBe(ESTADO_DA_AUTOMACAO.NUNCA_OLHOU);
    expect(r.frase).toMatch(/01\/07\/2026/);
  });

  it("⚠⚠⚠ OLHOU E NÃO VEIO NADA — e a frase DIZ que olhou", () => {
    // ⚠⚠ Esta é a resposta que some quando se conta mal, e a diferença entre ela e «ninguém olhou»
    // é a diferença entre esperar e ir consertar.
    const r = leituraDaAutomacao(ligada({ ultimaTentativaEm: "2026-09-02T08:00:00.000Z" }));
    expect(r.estado).toBe(ESTADO_DA_AUTOMACAO.SEM_NOVIDADE);
    expect(r.frase).toMatch(/última busca não encontrou nota nova/i);
  });

  it("trouxe: diz quantas, e a data-piso continua à vista", () => {
    const r = leituraDaAutomacao(ligada({
      ultimaTentativaEm: "2026-09-02T08:00:00.000Z",
      ultimoResultadoEm: "2026-08-31T08:00:00.000Z",
      ultimoCriados: 12,
    }));
    expect(r.estado).toBe(ESTADO_DA_AUTOMACAO.TROUXE);
    expect(r.frase).toMatch(/12 nota/);
    expect(r.frase).toMatch(/01\/07\/2026/);
  });

  it("⚠⚠ o ERRO vence as outras leituras — ele fica à vista até uma varredura dar certo", () => {
    // Falha silenciosa aqui é exatamente como a captura ficou 29 dias parada sem ninguém notar.
    const r = leituraDaAutomacao(ligada({
      ultimaTentativaEm: "2026-09-02T08:00:00.000Z",
      ultimoResultadoEm: "2026-08-31T08:00:00.000Z",
      ultimoCriados: 12,
      ultimoErro: "certificado A1 vencido",
    }));
    expect(r.estado).toBe(ESTADO_DA_AUTOMACAO.ERRO);
    expect(r.frase).toMatch(/certificado A1 vencido/);
    // ⚠ E diz o que se tentava fazer: "falhou" sozinho não é conserto de ninguém.
    expect(r.frase).toMatch(/01\/07\/2026/);
  });

  it("⚠ toda leitura tem frase — nenhuma volta muda", () => {
    const casos = [
      null, { indisponivel: true }, { ligada: false }, ligada(),
      ligada({ ultimaTentativaEm: "2026-09-02T08:00:00.000Z" }),
      ligada({ ultimaTentativaEm: "2026-09-02T08:00:00.000Z", ultimoResultadoEm: "2026-09-02T08:00:00.000Z", ultimoCriados: 1 }),
      ligada({ ultimoErro: "x" }),
    ];
    for (const c of casos) expect(leituraDaAutomacao(c).frase.length).toBeGreaterThan(10);
  });
});
