// AS DESCRIÇÕES JÁ USADAS NESTE NAVEGADOR — escopo por empresa e o apagamento no "Sair".
//
// ⚠ ISTO É DADO DO CLIENTE EM `localStorage`: descrição de serviço, CNPJ e NOME de tomadores. Não é
// cache de UI, e as duas invariantes que estes casos travam existem por isso:
//
//   1. ESCOPO POR EMPRESA — a chave inclui o `companyId`. Descrição de uma empresa não pode ser
//      oferecida na nota de outra; é o mesmo cuidado que zera o formulário ao trocar de empresa,
//      e o desfecho de errá-lo seria um texto do cliente A aparecendo na nota do cliente B.
//   2. O "SAIR" APAGA — este portal é usado em computador compartilhado. Sair tem de levar embora
//      o que a sessão trouxe, de TODAS as empresas, e não só da que estava aberta.
//
// ⚠ E uma terceira, de procedência: a fonte é ESTE NAVEGADOR, nunca o histórico do servidor — que
// não sabe o que foi descrito (nem `PortalInvoice` nem `ServiceInvoice` têm coluna de descrição).
// Nada aqui fabrica sugestão a partir de tipo/valor/tomador: seria inventar o texto de um
// documento fiscal.

import {
  esquecerTodasAsDescricoes,
  registrarDescricao,
  sugerirDescricoes,
} from "../descricoesRecentes";

const EMPRESA_A = "pc-001";
const EMPRESA_B = "pc-002";
const DOC_A = "11.222.333/0001-81";
const DOC_B = "44555666000177";

beforeEach(() => {
  window.localStorage.clear();
});

describe("⚠ ESCOPO POR EMPRESA — a chave carrega o `companyId`", () => {
  test("o que foi emitido na empresa A não é oferecido na empresa B", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Consultoria em TI", tomadorDoc: DOC_A, tomadorNome: "ACME" });
    expect(sugerirDescricoes(EMPRESA_A)).toHaveLength(1);
    expect(sugerirDescricoes(EMPRESA_B)).toEqual([]);
  });

  test("as duas empresas guardam em chaves diferentes, e uma não apaga a outra", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Serviço da A", tomadorDoc: DOC_A });
    registrarDescricao(EMPRESA_B, { descricao: "Serviço da B", tomadorDoc: DOC_A });
    expect(sugerirDescricoes(EMPRESA_A)[0].descricao).toBe("Serviço da A");
    expect(sugerirDescricoes(EMPRESA_B)[0].descricao).toBe("Serviço da B");
    expect(window.localStorage.getItem("pcw.descricoes.pc-001")).toBeTruthy();
    expect(window.localStorage.getItem("pcw.descricoes.pc-002")).toBeTruthy();
  });

  // ⚠ Sem empresa não há escopo — e sem escopo não se guarda nada em nome de ninguém.
  test("sem `companyId` nada é guardado", () => {
    registrarDescricao(null, { descricao: "Serviço órfão", tomadorDoc: DOC_A });
    registrarDescricao("", { descricao: "Serviço órfão", tomadorDoc: DOC_A });
    expect(window.localStorage.length).toBe(0);
  });
});

describe("⚠ O 'SAIR' APAGA — computador compartilhado", () => {
  test("apaga o histórico de TODAS as empresas, não só o da que estava aberta", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Serviço da A", tomadorDoc: DOC_A, tomadorNome: "ACME LTDA" });
    registrarDescricao(EMPRESA_B, { descricao: "Serviço da B", tomadorDoc: DOC_B, tomadorNome: "OUTRA SA" });

    esquecerTodasAsDescricoes();

    expect(sugerirDescricoes(EMPRESA_A)).toEqual([]);
    expect(sugerirDescricoes(EMPRESA_B)).toEqual([]);
    expect(window.localStorage.getItem("pcw.descricoes.pc-001")).toBeNull();
    expect(window.localStorage.getItem("pcw.descricoes.pc-002")).toBeNull();
  });

  // ⚠ Nome e CNPJ de tomador são o que MAIS importa apagar — a sugestão guarda os dois.
  test("nenhum resquício de nome ou CNPJ de tomador sobra no armazenamento", () => {
    registrarDescricao(EMPRESA_A, {
      descricao: "Assessoria mensal",
      tomadorDoc: DOC_A,
      tomadorNome: "PADARIA DO JOAO ME",
    });
    esquecerTodasAsDescricoes();
    const tudo = Object.keys(window.localStorage)
      .map((k) => `${k}=${window.localStorage.getItem(k)}`)
      .join("|");
    expect(tudo).not.toMatch(/PADARIA DO JOAO/);
    expect(tudo).not.toMatch(/11222333000181/);
  });

  // ⚠ O "Sair" não pode levar embora o que não é dele: a chave de outro assunto fica.
  test("só as chaves do prefixo saem — o resto do armazenamento fica intacto", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Serviço", tomadorDoc: DOC_A });
    window.localStorage.setItem("pcw.outra.coisa", "fica");
    esquecerTodasAsDescricoes();
    expect(window.localStorage.getItem("pcw.outra.coisa")).toBe("fica");
  });

  test("sair com o histórico já vazio não quebra", () => {
    expect(() => esquecerTodasAsDescricoes()).not.toThrow();
  });
});

describe("o que se guarda, e o que não se guarda", () => {
  test("a descrição volta com o tomador junto — sugestão sem dono é texto sem procedência", () => {
    registrarDescricao(EMPRESA_A, {
      descricao: "  Consultoria em TI  ",
      tomadorDoc: DOC_A,
      tomadorNome: "  ACME LTDA  ",
    });
    const [s] = sugerirDescricoes(EMPRESA_A);
    expect(s).toMatchObject({ descricao: "Consultoria em TI", doc: "11222333000181", nome: "ACME LTDA" });
    expect(typeof s.em).toBe("string");
  });

  test("descrição vazia ou só espaços não vira sugestão", () => {
    registrarDescricao(EMPRESA_A, { descricao: "   ", tomadorDoc: DOC_A });
    registrarDescricao(EMPRESA_A, { descricao: "", tomadorDoc: DOC_A });
    registrarDescricao(EMPRESA_A, {});
    expect(sugerirDescricoes(EMPRESA_A)).toEqual([]);
  });

  test("a MESMA descrição para o MESMO tomador não vira duas linhas — sobe para o topo", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Mensalidade", tomadorDoc: DOC_A });
    registrarDescricao(EMPRESA_A, { descricao: "Outro serviço", tomadorDoc: DOC_A });
    registrarDescricao(EMPRESA_A, { descricao: "Mensalidade", tomadorDoc: DOC_A });
    const lista = sugerirDescricoes(EMPRESA_A);
    expect(lista.map((i) => i.descricao)).toEqual(["Mensalidade", "Outro serviço"]);
  });

  test("a mesma descrição para tomadores DIFERENTES são duas linhas", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Mensalidade", tomadorDoc: DOC_A });
    registrarDescricao(EMPRESA_A, { descricao: "Mensalidade", tomadorDoc: DOC_B });
    expect(sugerirDescricoes(EMPRESA_A)).toHaveLength(2);
  });

  test("armazenamento corrompido não quebra a tela — sem sugestão e segue", () => {
    window.localStorage.setItem("pcw.descricoes.pc-001", "{isto não é json");
    expect(sugerirDescricoes(EMPRESA_A)).toEqual([]);
    expect(() => registrarDescricao(EMPRESA_A, { descricao: "Nova", tomadorDoc: DOC_A })).not.toThrow();
    expect(sugerirDescricoes(EMPRESA_A).map((i) => i.descricao)).toEqual(["Nova"]);
  });

  test("linhas fora de forma dentro do JSON são descartadas uma a uma", () => {
    window.localStorage.setItem(
      "pcw.descricoes.pc-001",
      JSON.stringify([{ descricao: "Boa", doc: "11222333000181" }, null, { doc: "x" }, 42])
    );
    expect(sugerirDescricoes(EMPRESA_A).map((i) => i.descricao)).toEqual(["Boa"]);
  });
});

describe("o que se OFERECE agora", () => {
  test("⚠ não interrompe quem já está escrevendo — com algo digitado, nada é sugerido", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Consultoria", tomadorDoc: DOC_A });
    expect(sugerirDescricoes(EMPRESA_A, { jaDigitado: "Serv" })).toEqual([]);
    expect(sugerirDescricoes(EMPRESA_A, { jaDigitado: "   " })).toHaveLength(1);
  });

  test("o MESMO tomador vem primeiro, e cada linha diz se é dele", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Do B", tomadorDoc: DOC_B, tomadorNome: "OUTRA SA" });
    registrarDescricao(EMPRESA_A, { descricao: "Do A", tomadorDoc: DOC_A, tomadorNome: "ACME" });
    registrarDescricao(EMPRESA_A, { descricao: "Do C", tomadorDoc: "99888777000166" });

    const lista = sugerirDescricoes(EMPRESA_A, { tomadorDoc: DOC_B });
    expect(lista[0]).toMatchObject({ descricao: "Do B", doMesmoTomador: true });
    expect(lista.slice(1).every((i) => i.doMesmoTomador === false)).toBe(true);
  });

  test("sem tomador identificado, oferece as últimas em geral e nenhuma se diz 'do mesmo tomador'", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Primeira", tomadorDoc: DOC_A });
    registrarDescricao(EMPRESA_A, { descricao: "Segunda", tomadorDoc: DOC_B });
    const lista = sugerirDescricoes(EMPRESA_A);
    expect(lista.map((i) => i.descricao)).toEqual(["Segunda", "Primeira"]);
    expect(lista.every((i) => i.doMesmoTomador === false)).toBe(true);
  });

  test("no máximo três sugestões", () => {
    for (const d of ["Uma", "Duas", "Três", "Quatro", "Cinco"]) {
      registrarDescricao(EMPRESA_A, { descricao: d, tomadorDoc: DOC_A });
    }
    expect(sugerirDescricoes(EMPRESA_A)).toHaveLength(3);
  });

  test("o armazenamento não cresce sem limite (24 linhas)", () => {
    for (let i = 0; i < 40; i += 1) {
      registrarDescricao(EMPRESA_A, { descricao: `Serviço ${i}`, tomadorDoc: DOC_A });
    }
    const guardado = JSON.parse(window.localStorage.getItem("pcw.descricoes.pc-001"));
    expect(guardado).toHaveLength(24);
    expect(guardado[0].descricao).toBe("Serviço 39");
  });

  test("a máscara do documento não separa o mesmo tomador em dois", () => {
    registrarDescricao(EMPRESA_A, { descricao: "Mensalidade", tomadorDoc: "11.222.333/0001-81" });
    const [s] = sugerirDescricoes(EMPRESA_A, { tomadorDoc: "11222333000181" });
    expect(s.doMesmoTomador).toBe(true);
  });
});

describe("localStorage indisponível (modo privado) não atrapalha a emissão", () => {
  test("ler, gravar e apagar continuam silenciosos quando o armazenamento recusa", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    const explode = () => {
      throw new Error("SecurityError: localStorage bloqueado");
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        return { get length() { return explode(); }, getItem: explode, setItem: explode, removeItem: explode, key: explode };
      },
    });
    try {
      expect(sugerirDescricoes(EMPRESA_A)).toEqual([]);
      expect(() => registrarDescricao(EMPRESA_A, { descricao: "X", tomadorDoc: DOC_A })).not.toThrow();
      expect(() => esquecerTodasAsDescricoes()).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});
