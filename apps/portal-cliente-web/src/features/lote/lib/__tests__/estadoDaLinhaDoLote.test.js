// O ESTADO DA LINHA NA TELA — e a SEGUNDA METADE da prova do município.
//
// ⚠⚠ O QUE ESTA SUÍTE PROTEGE, em uma frase: **a tela só rebaixa, nunca promove**. Numa planilha de
// 200 linhas o erro caro é a linha ruim passando por boa.
//
// ⚠ A lista de estados é a do backend (`classificarLinhaLote.js`), e o teste do espelho está no
// fim: ele importa o `ESTADO` de lá.

import {
  CODIGO,
  ESTADO,
  apresentacaoDoEstado,
  conferirMunicipioDaLinha,
  ehEstadoConhecido,
  quantasNaoProntas,
  rotuloDaOrigemDoNome,
  ORIGEM_DO_DADO,
  vereditoDaLinha,
  vereditosDoLote,
} from "../estadoDaLinhaDoLote";
// A AUTORIDADE da lista de estados e das origens.
import {
  ESTADO as ESTADO_DO_BACKEND,
  ORIGEM_DO_DADO as ORIGEM_DO_BACKEND,
} from "../../../../../../api/src/application/nfse/lote/classificarLinhaLote.js";

/** Um recorte da lista oficial, no formato `[codigo, nome, uf]` de `municipiosIbge.data.js`. */
const MUNICIPIOS = [
  ["3304557", "Rio de Janeiro", "RJ"],
  ["3550308", "São Paulo", "SP"],
];

function linha(patch = {}) {
  return {
    numero: 7,
    estado: ESTADO.CONFERIR,
    pendencias: [],
    conferencias: [],
    documento: "11222333000181",
    tipoDocumento: "CNPJ",
    origemEndereco: "planilha",
    dados: {
      tomador: { doc: "11222333000181", nome: "X", endereco: { cMun: "3304557" } },
      servico: { descricao: "d", valorServicos: 10 },
      competencia: "2026-07-31",
    },
    ...patch,
  };
}

const COM_MUNICIPIO_NAO_CONFERIDO = {
  conferencias: [
    { codigo: CODIGO.MUNICIPIO_NAO_CONFERIDO, texto: "…a conferência acontece na tela de ajuste…" },
  ],
};

describe("⚠⚠ a conferência do município — a metade que o backend não pode fazer", () => {
  test("linha sem `municipio_nao_conferido` não é conferida (não há o que provar)", () => {
    expect(conferirMunicipioDaLinha(linha(), MUNICIPIOS).situacao).toBe("nao_pedida");
  });

  test("sem a lista carregada, a conferência não acontece — e não vira aprovação", () => {
    const r = conferirMunicipioDaLinha(linha(COM_MUNICIPIO_NAO_CONFERIDO), null);
    expect(r.situacao).toBe("sem_lista");
    // ⚠ E a linha continua em CONFERIR: ninguém a promoveu por falta de lista.
    expect(vereditoDaLinha(linha(COM_MUNICIPIO_NAO_CONFERIDO), { municipios: null }).estado).toBe(
      ESTADO.CONFERIR
    );
  });

  test("código que existe: a linha continua CONFERIR e a tela mostra de quem ele é", () => {
    const v = vereditoDaLinha(linha(COM_MUNICIPIO_NAO_CONFERIDO), { municipios: MUNICIPIOS });
    expect(v.estado).toBe(ESTADO.CONFERIR);
    expect(v.municipio).toBe("Rio de Janeiro / RJ");
  });

  test("⚠ o texto do backend é SUBSTITUÍDO — ele dizia que a conferência ainda ia acontecer", () => {
    const v = vereditoDaLinha(linha(COM_MUNICIPIO_NAO_CONFERIDO), { municipios: MUNICIPIOS });
    const aviso = v.conferencias.find((c) => c.codigo === CODIGO.MUNICIPIO_NAO_CONFERIDO);
    expect(aviso.texto).toBe("Confira o município do tomador: Rio de Janeiro / RJ.");
    expect(aviso.texto).not.toMatch(/tela de ajuste/);
  });

  test("⚠⚠ código que NÃO existe derruba a linha para PENDENTE — o veredito é do backend", () => {
    const alvo = linha({
      ...COM_MUNICIPIO_NAO_CONFERIDO,
      dados: { ...linha().dados, tomador: { ...linha().dados.tomador, endereco: { cMun: "9999999" } } },
    });
    const v = vereditoDaLinha(alvo, { municipios: MUNICIPIOS });
    expect(v.estado).toBe(ESTADO.PENDENTE);
    expect(v.pendencias.map((p) => p.codigo)).toContain(CODIGO.MUNICIPIO_INEXISTENTE);
    expect(v.pendencias.at(-1).texto).toMatch(/9999999/);
    // ⚠ A conferência resolvida sai da lista: ela virou pendência, e mostrar as duas diria duas
    // coisas sobre o mesmo campo.
    expect(v.conferencias).toHaveLength(0);
  });

  test("⚠ a linha rebaixada perde os `dados` — payload de emissão não sobrevive a uma pendência", () => {
    const alvo = linha({
      ...COM_MUNICIPIO_NAO_CONFERIDO,
      dados: { ...linha().dados, tomador: { ...linha().dados.tomador, endereco: { cMun: "9999999" } } },
    });
    expect(vereditoDaLinha(alvo, { municipios: MUNICIPIOS }).dados).toBeNull();
  });

  test("o código é lido de `dados`, que é o que o servidor ACEITOU", () => {
    const alvo = linha({
      ...COM_MUNICIPIO_NAO_CONFERIDO,
      valores: { cMun: "3550308" }, // o que a pessoa digitou não decide a conferência
      dados: { ...linha().dados, tomador: { ...linha().dados.tomador, endereco: { cMun: "3304557" } } },
    });
    expect(vereditoDaLinha(alvo, { municipios: MUNICIPIOS }).municipio).toBe("Rio de Janeiro / RJ");
  });
});

describe("⚠⚠ a linha que JÁ é pendente não ganha um defeito inventado", () => {
  // Medido em 19/08/2026: a linha pendente por outro motivo (valor ambíguo, competência em branco)
  // volta com `dados: null`, então o `cMun` some com ele. A primeira versão desta regra lia `""` e
  // acusava `municipio_inexistente` — com o código VAZIO no texto — em três linhas do mock.
  test("pendente sem `dados` não vira `municipio_inexistente`", () => {
    const alvo = linha({ estado: ESTADO.PENDENTE, ...COM_MUNICIPIO_NAO_CONFERIDO, dados: null });
    const v = vereditoDaLinha(alvo, { municipios: MUNICIPIOS });
    expect(v.pendencias.map((p) => p.codigo)).not.toContain(CODIGO.MUNICIPIO_INEXISTENTE);
    expect(conferirMunicipioDaLinha(alvo, MUNICIPIOS).situacao).toBe("sem_codigo");
  });
});

describe("⚠⚠ a tela NUNCA promove", () => {
  test.each([
    [ESTADO.PENDENTE],
    [ESTADO.CONSULTAR],
    [ESTADO.CONFERIR],
  ])("`%s` continua `%s` depois do veredito", (estado) => {
    expect(vereditoDaLinha(linha({ estado }), { municipios: MUNICIPIOS }).estado).toBe(estado);
  });

  test("nenhuma entrada conhecida produz `pronta` a partir de outro estado", () => {
    const casos = [
      linha({ estado: ESTADO.PENDENTE, ...COM_MUNICIPIO_NAO_CONFERIDO }),
      linha({ estado: ESTADO.CONSULTAR, ...COM_MUNICIPIO_NAO_CONFERIDO }),
      linha({ estado: ESTADO.CONFERIR, ...COM_MUNICIPIO_NAO_CONFERIDO }),
    ];
    for (const caso of casos) {
      expect(vereditoDaLinha(caso, { municipios: MUNICIPIOS }).estado).not.toBe(ESTADO.PRONTA);
    }
  });
});

describe("⚠ estado que a tela não conhece não vira PRONTA", () => {
  test("é marcado como desconhecido e sai com desenho de bloqueio", () => {
    const v = vereditoDaLinha(linha({ estado: "aguardando_carimbo" }), { municipios: MUNICIPIOS });
    expect(v.conhecido).toBe(false);
    expect(apresentacaoDoEstado("aguardando_carimbo").chip).toBe("linha-pendente");
    expect(apresentacaoDoEstado("aguardando_carimbo").rotulo).toBe("aguardando_carimbo");
  });

  test("ele NÃO entra na conta de prontas, e entra na de 'ainda não'", () => {
    const { resumo } = vereditosDoLote(
      { linhas: [linha({ estado: ESTADO.PRONTA }), linha({ estado: "aguardando_carimbo" })] },
      { municipios: MUNICIPIOS }
    );
    expect(resumo.prontas).toBe(1);
    expect(resumo.desconhecidas).toBe(1);
    // ⚠ `total - prontas`: o estado novo entra aqui por construção, em vez de sumir da conta.
    expect(quantasNaoProntas(resumo)).toBe(1);
  });

  test("`ehEstadoConhecido` conhece os quatro, e só os quatro", () => {
    for (const e of Object.values(ESTADO)) expect(ehEstadoConhecido(e)).toBe(true);
    for (const e of ["", null, undefined, "PRONTA", "emitida"]) expect(ehEstadoConhecido(e)).toBe(false);
  });
});

describe("o resumo é RECONTADO na tela", () => {
  test("uma linha rebaixada muda o número que decide se dá para seguir", () => {
    const boa = linha({ estado: ESTADO.CONFERIR, ...COM_MUNICIPIO_NAO_CONFERIDO });
    const ruim = linha({
      numero: 8,
      estado: ESTADO.CONFERIR,
      ...COM_MUNICIPIO_NAO_CONFERIDO,
      dados: { ...linha().dados, tomador: { ...linha().dados.tomador, endereco: { cMun: "9999999" } } },
    });
    const { resumo } = vereditosDoLote({ linhas: [boa, ruim] }, { municipios: MUNICIPIOS });
    expect(resumo).toMatchObject({ total: 2, prontas: 0, conferir: 1, pendentes: 1 });
  });

  test("leitura vazia não quebra e não inventa número", () => {
    expect(vereditosDoLote(null).resumo).toMatchObject({ total: 0, prontas: 0 });
    expect(quantasNaoProntas(null)).toBe(0);
  });
});

describe("⚠⚠ o espelho da lista de estados", () => {
  test("são exatamente os quatro do classificador do backend", () => {
    expect(Object.values(ESTADO).sort()).toEqual(Object.values(ESTADO_DO_BACKEND).sort());
  });

  test("⚠ as origens do dado são as MESMAS do backend", () => {
    expect(Object.values(ORIGEM_DO_DADO).sort()).toEqual(Object.values(ORIGEM_DO_BACKEND).sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A PROCEDÊNCIA DO NOME — ela existe porque o nome deixou de ser coluna (20/08/2026)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Quem confere um lote de 50 notas precisa distinguir o nome que ELE escreveu do que veio do
// cadastro ou da Receita. Valor preenchido sem procedência é indistinguível de valor conferido.
describe("de onde veio o nome do tomador", () => {
  test("a MEMÓRIA e a CONSULTA ganham rótulo — e são rótulos diferentes", () => {
    const daMemoria = rotuloDaOrigemDoNome({ origemNome: ORIGEM_DO_DADO.MEMORIA });
    const daConsulta = rotuloDaOrigemDoNome({ origemNome: ORIGEM_DO_DADO.CONSULTA });
    expect(daMemoria).toMatch(/nota já emitida/i);
    expect(daConsulta).toMatch(/Receita/i);
    expect(daMemoria).not.toBe(daConsulta);
  });

  // ⚠ A linha já diz "ajustada aqui": repetir a mesma informação na mesma célula é o ruído que o
  // corte de legendas de 19/08/2026 mandou tirar.
  test("⚠ o que a pessoa escreveu na REVISÃO não ganha rótulo", () => {
    expect(rotuloDaOrigemDoNome({ origemNome: ORIGEM_DO_DADO.REVISAO })).toBeNull();
  });

  test("sem origem, não há o que dizer", () => {
    expect(rotuloDaOrigemDoNome({})).toBeNull();
    expect(rotuloDaOrigemDoNome(null)).toBeNull();
  });

  // ⚠⚠ ORIGEM QUE ESTA TELA NÃO CONHECE NÃO VIRA SILÊNCIO. Um valor novo no backend sumiria da
  // tela, e sumiria justamente a informação que ele foi criado para dar.
  test("⚠⚠ origem desconhecida SAI NOMEADA, nunca em silêncio", () => {
    expect(rotuloDaOrigemDoNome({ origemNome: "inventada" })).toContain("inventada");
  });
});
