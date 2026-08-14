// A REGRA do município emissor, e a SANIDADE da lista oficial embarcada.
//
// ⚠ O que este arquivo protege, em uma frase: que ninguém volte a derivar o código IBGE do NOME do
// município. O de-para por nome erra em homônimo (cinco "Bom Jesus" no país) e o erro só apareceria
// como nota emitida no município errado — silencioso e caro. A busca existe para o contador
// ENCONTRAR a linha; escolher continua sendo ato dele.

import {
  buscarMunicipios,
  impedimentoDeEmissao,
  lerCodigoMunicipioIbge,
  municipioPorCodigo,
  normalizarParaBusca,
  rotuloMunicipio,
} from "../municipios/municipioIbge";
import { MUNICIPIOS_IBGE } from "../municipios/municipiosIbge.data";

describe("lerCodigoMunicipioIbge — a MESMA leitura do servidor", () => {
  it("vazio é ausência, não erro (a empresa apenas não emite)", () => {
    expect(lerCodigoMunicipioIbge("")).toEqual({ preenchido: false, valor: null, problema: null });
    expect(lerCodigoMunicipioIbge(null).problema).toBeNull();
    expect(lerCodigoMunicipioIbge(undefined).preenchido).toBe(false);
  });

  it("7 dígitos passam; pontuação é limpa, como o `replace(/\\D+/g)` do backend", () => {
    expect(lerCodigoMunicipioIbge("3304557").valor).toBe("3304557");
    expect(lerCodigoMunicipioIbge(" 3.304.557 ").valor).toBe("3304557");
  });

  it("qualquer outro tamanho é problema NOMEADO — nunca completado com zeros", () => {
    // ⚠ Era o `padStart(7, "0")` que transformava "3304" em "0003304" e a string vazia em
    // "0000000". Município zerado derruba a emissão inteira (E0037).
    for (const ruim of ["3304", "33045570", "abc"]) {
      const leitura = lerCodigoMunicipioIbge(ruim);
      expect(leitura.valor).toBeNull();
      expect(leitura.problema).toMatch(/7 dígitos/);
    }
  });
});

describe("impedimentoDeEmissao — espelho de NFSE_MUNICIPIO_NAO_CONFIGURADO", () => {
  it("sem código, bloqueia e diz onde resolver", () => {
    const r = impedimentoDeEmissao(null);
    expect(r.bloqueia).toBe(true);
    expect(r.motivo).toMatch(/Editar cadastro/);
    // Versão curta para o `title` do botão e a lista de pendências, que ficam a um palmo do bloco.
    expect(r.motivoCurto.length).toBeLessThan(r.motivo.length);
  });

  it("código incompleto também bloqueia — meio código não é código", () => {
    expect(impedimentoDeEmissao("3304").bloqueia).toBe(true);
  });

  it("com os 7 dígitos, não bloqueia", () => {
    expect(impedimentoDeEmissao("3304557")).toEqual({ bloqueia: false, motivo: null, motivoCurto: null });
  });
});

describe("buscarMunicipios — para ENCONTRAR, nunca para escolher", () => {
  // Fixture minúscula e explícita: a regra é testada aqui, não na lista de 5.571 (que tem sanidade
  // própria, no fim do arquivo).
  const lista = [
    ["3304557", "Rio de Janeiro", "RJ"],
    ["3302601", "Mangaratiba", "RJ"],
    ["4302204", "Bom Jesus", "RS"],
    ["2602207", "Bom Jesus", "PE"],
    ["3508603", "Bom Jesus dos Perdões", "SP"],
    ["3550308", "São Paulo", "SP"],
  ];

  it("termo vazio não devolve nada — lista inteira sem busca é ruído", () => {
    expect(buscarMunicipios(lista, "")).toEqual({ itens: [], total: 0 });
    expect(buscarMunicipios(lista, "   ").total).toBe(0);
  });

  it("acento não atrapalha: quem digita 'sao paulo' acha 'São Paulo'", () => {
    expect(buscarMunicipios(lista, "sao paulo").itens.map((m) => m[0])).toEqual(["3550308"]);
  });

  it("⚠ homônimo devolve TODOS — e a tela mostra a UF de cada um", () => {
    const r = buscarMunicipios(lista, "bom jesus");
    expect(r.total).toBe(3);
    // O exato vem antes do que só começa igual; e nenhum deles é "o escolhido".
    expect(r.itens.map(rotuloMunicipio)).toEqual([
      "Bom Jesus / PE",
      "Bom Jesus / RS",
      "Bom Jesus dos Perdões / SP",
    ]);
  });

  it("a UF entra na busca em qualquer ordem — é ela que desambigua", () => {
    expect(buscarMunicipios(lista, "bom jesus rs").itens.map((m) => m[0])).toEqual(["4302204"]);
    expect(buscarMunicipios(lista, "rs bom jesus").itens.map((m) => m[0])).toEqual(["4302204"]);
  });

  it("busca por código também vale — quem tem o número confere de quem ele é", () => {
    expect(buscarMunicipios(lista, "33045").itens.map((m) => m[1])).toEqual(["Rio de Janeiro"]);
    expect(buscarMunicipios(lista, "3.304.557").itens.map((m) => m[1])).toEqual(["Rio de Janeiro"]);
  });

  it("o recorte é ANUNCIADO: `total` continua contando os que ficaram de fora", () => {
    // Sem isso o contador escolhe dentro de uma lista parcial achando que é a lista inteira.
    const r = buscarMunicipios(lista, "bom jesus", { limite: 1 });
    expect(r.itens).toHaveLength(1);
    expect(r.total).toBe(3);
  });

  it("nada casa → total 0, e nenhum “parecido” é oferecido como se fosse", () => {
    expect(buscarMunicipios(lista, "municipio que nao existe")).toEqual({ itens: [], total: 0 });
  });
});

describe("municipioPorCodigo", () => {
  const lista = [["3304557", "Rio de Janeiro", "RJ"]];

  it("acha pelo código exato", () => {
    expect(rotuloMunicipio(municipioPorCodigo(lista, "3304557"))).toBe("Rio de Janeiro / RJ");
  });

  it("código fora do formato não vira busca aproximada — devolve nulo", () => {
    expect(municipioPorCodigo(lista, "3304")).toBeNull();
    expect(municipioPorCodigo(lista, "")).toBeNull();
  });
});

// ── A LISTA EMBARCADA ────────────────────────────────────────────────────────────────────────
// Não é teste de conteúdo do IBGE (não somos autoridade sobre isso): é sanidade do arquivo GERADO.
// Uma extração truncada ou com a UF vindo por outro caminho passaria despercebida até alguém não
// achar o próprio município.
describe("municipiosIbge.data — sanidade do arquivo gerado", () => {
  it("tem 5.571 linhas (5.570 municípios + o Distrito Federal)", () => {
    expect(MUNICIPIOS_IBGE).toHaveLength(5571);
  });

  it("toda linha é [7 dígitos, nome, UF de 2 letras]", () => {
    const foraDoFormato = MUNICIPIOS_IBGE.filter(
      ([codigo, nome, uf]) => !/^\d{7}$/.test(codigo) || !nome || !/^[A-Z]{2}$/.test(uf)
    );
    expect(foraDoFormato).toEqual([]);
  });

  it("nenhum código repetido — o código é a identidade", () => {
    expect(new Set(MUNICIPIOS_IBGE.map((m) => m[0])).size).toBe(MUNICIPIOS_IBGE.length);
  });

  it("as 27 unidades da federação estão representadas", () => {
    expect(new Set(MUNICIPIOS_IBGE.map((m) => m[2])).size).toBe(27);
  });

  it("o código que o projeto já conhecia (3304557) é mesmo o do Rio de Janeiro/RJ", () => {
    // ⚠ Esta é a AMARRAÇÃO da lista com o resto do sistema: `NfseService` tem `cLocEmi !== "3304557"`
    // numa regra de inscrição municipal e `docs/nfse-preenchimento.md` §2 registra
    // "cLocEmi: IBGE do município emissor, ex.: 3304557 (Rio de Janeiro)". Se a lista discordasse
    // disso, ela não seria a tabela que o `cLocEmi` espera.
    expect(rotuloMunicipio(municipioPorCodigo(MUNICIPIOS_IBGE, "3304557"))).toBe("Rio de Janeiro / RJ");
  });

  it("a busca funciona sobre a lista real, com os homônimos de verdade", () => {
    const bonsJesus = buscarMunicipios(MUNICIPIOS_IBGE, "bom jesus", { limite: 100 });
    // Cinco municípios chamados exatamente "Bom Jesus", em cinco estados diferentes.
    const exatos = bonsJesus.itens.filter((m) => normalizarParaBusca(m[1]) === "bom jesus");
    expect(exatos).toHaveLength(5);
    expect(new Set(exatos.map((m) => m[2])).size).toBe(5);
  });
});
