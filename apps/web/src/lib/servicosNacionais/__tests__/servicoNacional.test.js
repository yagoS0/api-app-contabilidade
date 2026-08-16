// A LISTA OFICIAL DE cTribNac — e a prova do zero à esquerda.
//
// ⚠ POR QUE ESTE TESTE EXISTE, e por que ele importa a lista DE VERDADE em vez de uma fixture.
// A fonte é uma PLANILHA, e a coluna do código nela é NUMÉRICA: `010101` sai do arquivo como o
// número `10101`. Uma lista gerada sem padding teria dezenas de códigos com 5 dígitos, e o
// `cTribNac` da DPS tem 6 — a nota seria recusada, ou (pior) um `padStart` cego mais adiante
// fabricaria um código plausível e ERRADO, que ninguém descobre até o DANFSe sair com o serviço
// de outra atividade.
//
// Uma fixture provaria a função e não provaria o DADO. Aqui o alvo é o dado.

import {
  SERVICOS_NACIONAIS,
  GRUPOS_SERVICO_NACIONAL,
} from "../servicosNacionais.data.js";
import {
  TAMANHO_CTRIB_NAC,
  normalizarCodigoServicoNacional,
  formatarCodigoServicoNacional,
  partesDoCodigo,
  servicoPorCodigo,
  rotuloServico,
  grupoDoServico,
  buscarServicos,
  lerCodigosServicoNacional,
} from "../servicoNacional.js";

describe("a lista oficial (Anexo B, gov.br/nfse) — o DADO", () => {
  it("⚠ o PRIMEIRO código é 010101, nunca 10101", () => {
    // Esta é a linha 3 da aba `LISTA.SERV.NAC.` ("Análise e desenvolvimento de sistemas"), e é
    // exatamente a que a planilha entrega como o número 10101.
    expect(SERVICOS_NACIONAIS[0][0]).toBe("010101");
    expect(SERVICOS_NACIONAIS[0][0]).not.toBe("10101");
    expect(SERVICOS_NACIONAIS[0][1]).toBe("Análise e desenvolvimento de sistemas.");
  });

  it("TODO código tem exatamente 6 dígitos", () => {
    const fora = SERVICOS_NACIONAIS.filter((s) => !/^\d{6}$/.test(s[0]));
    expect(fora).toEqual([]);
  });

  it("nenhum código se repete e nenhuma descrição é vazia", () => {
    expect(new Set(SERVICOS_NACIONAIS.map((s) => s[0])).size).toBe(SERVICOS_NACIONAIS.length);
    expect(SERVICOS_NACIONAIS.filter((s) => !String(s[1]).trim())).toEqual([]);
  });

  it("contagem medida na planilha: 335 códigos e 242 grupos", () => {
    // Se a Receita publicar uma versão nova, este teste cai — é o aviso de que o artefato em
    // `docs/lista-servico-nacional/` mudou e o hash do README precisa mudar junto.
    expect(SERVICOS_NACIONAIS).toHaveLength(335);
    expect(GRUPOS_SERVICO_NACIONAL).toHaveLength(242);
  });

  it("⚠ o código É item+subitem+desdobro — conferido contra os GRUPOS da própria planilha", () => {
    // O gerador já confere isso contra as colunas ITEM/SUBITEM/DESDOBRO. Aqui a verificação é pela
    // outra ponta: todo código tem de pertencer a um grupo existente pelo PREFIXO. Se o padding
    // tivesse comido um zero, `10101` procuraria o item "10" (Serviços de intermediação) em vez do
    // "01" (Informática) — e o agrupamento da tela mentiria em silêncio.
    const chaves = new Set(GRUPOS_SERVICO_NACIONAL.map((g) => g[0]));
    const orfaos = SERVICOS_NACIONAIS.filter((s) => !chaves.has(s[0].slice(0, 2)));
    expect(orfaos).toEqual([]);
  });

  it("o exemplo do DANFSe: 310104 é o DESDOBRAMENTO, não o item 31.01 da LC 116", () => {
    const desdobro = servicoPorCodigo(SERVICOS_NACIONAIS, "310104");
    expect(desdobro[1]).toMatch(/telecomunica/i);
    const grupo = grupoDoServico(GRUPOS_SERVICO_NACIONAL, "310104");
    // O grupo é o item guarda-chuva da LC 116 — e ele NÃO é selecionável.
    expect(grupo[0]).toBe("3101");
    expect(servicoPorCodigo(SERVICOS_NACIONAIS, "3101")).toBeNull();
  });

  it("o exemplo da única emissão que voltou issued (171201) está na lista", () => {
    // `docs/nfse-preenchimento.md` §12. Se a lista não o tivesse, ela não serviria para o que o
    // projeto já emitiu uma vez.
    expect(servicoPorCodigo(SERVICOS_NACIONAIS, "171201")).not.toBeNull();
  });
});

describe("normalização — o padding é à ESQUERDA", () => {
  it("completa com zero à esquerda até 6", () => {
    expect(normalizarCodigoServicoNacional("10101")).toBe("010101");
    expect(normalizarCodigoServicoNacional(10101)).toBe("010101");
    expect(normalizarCodigoServicoNacional("01.01.01")).toBe("010101");
  });

  it("recusa em vez de truncar quando passa de 6", () => {
    // Truncar produziria um código plausível e errado — o defeito que este módulo existe para
    // impedir. `null` é a resposta honesta.
    expect(normalizarCodigoServicoNacional("1234567")).toBeNull();
    expect(normalizarCodigoServicoNacional("")).toBeNull();
    expect(normalizarCodigoServicoNacional(null)).toBeNull();
    expect(normalizarCodigoServicoNacional("abc")).toBeNull();
  });

  it("formata como a NT 008 §2.4.5 manda imprimir: nn.nn.nn", () => {
    expect(formatarCodigoServicoNacional("010101")).toBe("01.01.01");
    expect(formatarCodigoServicoNacional("310104")).toBe("31.01.04");
  });

  it("as três partes", () => {
    expect(partesDoCodigo("310104")).toEqual({ item: "31", subitem: "01", desdobro: "04" });
    expect(partesDoCodigo("nada")).toBeNull();
  });

  it("o rótulo traz código E texto — o número não diz nada sozinho, o texto não emite nada sozinho", () => {
    expect(rotuloServico(["010101", "Análise e desenvolvimento de sistemas."]))
      .toBe("01.01.01 — Análise e desenvolvimento de sistemas.");
    expect(rotuloServico(null)).toBe("");
  });
});

describe("busca — ENCONTRA, nunca escolhe", () => {
  const opcoes = { grupos: GRUPOS_SERVICO_NACIONAL };

  it("termo vazio não devolve nada (nem a lista inteira)", () => {
    expect(buscarServicos(SERVICOS_NACIONAIS, "", opcoes)).toEqual({ itens: [], total: 0 });
    expect(buscarServicos(SERVICOS_NACIONAIS, "   ", opcoes)).toEqual({ itens: [], total: 0 });
  });

  it("acha pelo TEXTO, sem acento e em qualquer ordem", () => {
    const r = buscarServicos(SERVICOS_NACIONAIS, "analise sistemas", opcoes);
    expect(r.itens.some((s) => s[0] === "010101")).toBe(true);
    const invertido = buscarServicos(SERVICOS_NACIONAIS, "sistemas analise", opcoes);
    expect(invertido.total).toBe(r.total);
  });

  it("acha pelo texto do GRUPO — é o nome que o contador tem na cabeça", () => {
    // "Serviços de Informática e congêneres" é o ITEM 01; nenhum desdobramento se chama assim.
    const r = buscarServicos(SERVICOS_NACIONAIS, "informatica", opcoes);
    expect(r.total).toBeGreaterThan(0);
    expect(r.itens.every((s) => s[0].startsWith("01"))).toBe(true);
  });

  it("acha por prefixo do CÓDIGO, com ou sem máscara", () => {
    const r = buscarServicos(SERVICOS_NACIONAIS, "3101", opcoes);
    expect(r.total).toBeGreaterThan(0);
    expect(r.itens.every((s) => s[0].startsWith("3101"))).toBe(true);
    expect(buscarServicos(SERVICOS_NACIONAIS, "31.01", opcoes).total).toBe(r.total);
  });

  it("devolve o TOTAL além da página — senão a tela esconde um recorte sem dizer", () => {
    const r = buscarServicos(SERVICOS_NACIONAIS, "servicos", { ...opcoes, limite: 5 });
    expect(r.itens.length).toBeLessThanOrEqual(5);
    expect(r.total).toBeGreaterThan(r.itens.length);
  });

  it("⚠ resultado único NÃO se autosseleciona — a função só devolve linhas", () => {
    const r = buscarServicos(SERVICOS_NACIONAIS, "010101", opcoes);
    expect(r.itens).toHaveLength(1);
    // Nada aqui devolve "selecionado", "sugerido" ou "provável". Quem escolhe é o contador.
    expect(Object.keys(r).sort()).toEqual(["itens", "total"]);
  });

  it("lista ausente não explode", () => {
    expect(buscarServicos(null, "informatica", opcoes)).toEqual({ itens: [], total: 0 });
  });
});

describe("leitura do que está gravado na empresa", () => {
  it("normaliza, deduplica e preserva a ordem", () => {
    expect(lerCodigosServicoNacional(["10101", "010101", "171201"])).toEqual({
      codigos: ["010101", "171201"],
      invalidos: [],
    });
  });

  it("valor único (o formato antigo, de uma coluna só) continua legível", () => {
    // ⚠ O campo era UM texto. Uma empresa cadastrada antes desta mudança tem de continuar sendo
    // lida — e a leitura devolve a lista de um item, não vazio.
    expect(lerCodigosServicoNacional("171201").codigos).toEqual(["171201"]);
  });

  it("⚠ código torto NÃO some — volta em `invalidos`", () => {
    // Descartar em silêncio faria o contador achar que a empresa tem menos códigos do que tem.
    const r = lerCodigosServicoNacional(["171201", "1234567", "", null, "xyz"]);
    expect(r.codigos).toEqual(["171201"]);
    expect(r.invalidos).toEqual(["1234567", "xyz"]);
  });

  it("nada gravado é lista vazia, não erro", () => {
    expect(lerCodigosServicoNacional(null)).toEqual({ codigos: [], invalidos: [] });
    expect(lerCodigosServicoNacional([])).toEqual({ codigos: [], invalidos: [] });
  });
});
