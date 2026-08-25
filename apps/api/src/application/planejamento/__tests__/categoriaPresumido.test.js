// A CATEGORIA DE PRESUNÇÃO SUGERIDA PELO CNAE — e as quatro coisas que ela se recusa a fazer.
//
// ⚠⚠ ISTO REVERTE, DE FORMA CONTROLADA, UMA DECISÃO ESCRITA DO PROJETO. O que estava em
// `DadosPlanejamentoService`: "A atividade do Lucro Presumido NÃO é derivada do CNAE, de propósito
// (…) errar entre 8% e 32% inverteria a comparação". Continua verdadeiro — o que mudou, por decisão
// do dono em 25/08/2026, é o desenho: **sugerir e pedir confirmação** em vez de **derivar**.
//
// Estes testes existem para que a diferença entre as duas coisas não se apague com o tempo.

import fs from "node:fs";
import path from "node:path";
import {
  sugerirCategoriaPresumido, sugerirCategoriaDaEmpresa,
  CATEGORIA, CONFIANCA, EXCECOES_DO_SERVICO,
} from "../lib/categoriaPresumido.js";

const atv = (over = {}) => ({ cnae: "6201501", tipoReceita: "SERVICO_FATOR_R", ativo: true, ...over });

describe("⚠⚠ NUNCA CONFIRMA SOZINHA", () => {
  it.each([
    ["REVENDA_MERCADORIA"], ["INDUSTRIALIZACAO"], ["SERVICO_ANEXO_III"],
    ["SERVICO_ANEXO_IV"], ["SERVICO_FATOR_R"], ["BOBAGEM"], [null],
  ])("com tipoReceita %p, `confirmadoPeloContador` sai FALSE", (tipoReceita) => {
    // Um módulo que pudesse devolver `true` acabaria confirmando sozinho na primeira refatoração
    // distraída — e o que ele confirmaria é a diferença entre 8% e 32% de IRPJ.
    expect(sugerirCategoriaPresumido(atv({ tipoReceita })).confirmadoPeloContador).toBe(false);
  });
});

describe("⚠ A TRADUÇÃO SÓ É FORTE NUMA DIREÇÃO", () => {
  it("mercadoria e indústria ⇒ comércio, com confiança ALTA", () => {
    for (const t of ["REVENDA_MERCADORIA", "INDUSTRIALIZACAO"]) {
      const r = sugerirCategoriaPresumido(atv({ tipoReceita: t }));
      expect(r.categoria).toBe(CATEGORIA.COMERCIO);
      expect(r.confianca).toBe(CONFIANCA.ALTA);
    }
  });

  it("⚠⚠ TODO serviço ⇒ \"serviços em geral\", mas com confiança MÉDIA — e é aqui que mora o dinheiro", () => {
    // "Serviço" no Simples e "serviço em geral" na Lei 9.249 NÃO são o mesmo conjunto. O catálogo
    // mapeia ANEXO DO SIMPLES — outra lei — e nunca foi feito para esta pergunta.
    for (const t of ["SERVICO_ANEXO_III", "SERVICO_ANEXO_IV", "SERVICO_ANEXO_V", "SERVICO_FATOR_R"]) {
      const r = sugerirCategoriaPresumido(atv({ tipoReceita: t }));
      expect(r.categoria).toBe(CATEGORIA.SERVICOS);
      expect(r.confianca).toBe(CONFIANCA.MEDIA);
    }
  });

  it("⚠⚠ e as EXCEÇÕES viajam NOMEADAS — sem elas o contador confirma sem saber o quê", () => {
    const r = sugerirCategoriaPresumido(atv({ tipoReceita: "SERVICO_ANEXO_IV" }));
    const texto = r.excecoes.join(" | ");
    expect(texto).toMatch(/hospitalares/i);
    expect(texto).toMatch(/transporte de CARGAS é 8%/i);
    expect(texto).toMatch(/empreitada COM fornecimento de material/i);
    expect(r.excecoes).toEqual([...EXCECOES_DO_SERVICO]);
  });

  it("⚠ o comércio também tem exceção nomeada: combustível é 1,6%, não 8%", () => {
    const r = sugerirCategoriaPresumido(atv({ tipoReceita: "REVENDA_MERCADORIA" }));
    expect(r.excecoes.join(" ")).toMatch(/COMBUSTÍVEL.*1,6%/i);
  });
});

describe("⚠⚠ SEM BASE NÃO É \"SERVIÇOS\"", () => {
  it("CNAE fora do catálogo devolve categoria NULA, com o motivo", () => {
    // Medido em 25/08/2026: 18 dos 64 CNAEs da carteira estão fora do catálogo (127 de ~1.330
    // subclasses). Cair no default de serviços ali afirmaria 32% para quem pode ser 8%.
    const r = sugerirCategoriaPresumido(atv({ cnae: "6462000", tipoReceita: null }));
    expect(r.categoria).toBeNull();
    expect(r.confianca).toBeNull();
    expect(r.motivo).toMatch(/6462000/);
    expect(r.motivo).toMatch(/não está no catálogo/i);
  });

  it("⚠ `RECEITA_NAO_CLASSIFICADA` também não vira categoria — é o \"não sei\" do classificador", () => {
    expect(sugerirCategoriaPresumido(atv({ tipoReceita: "RECEITA_NAO_CLASSIFICADA" })).categoria).toBeNull();
  });

  it.each([undefined, {}, { tipoReceita: "" }])("entrada %p não estoura nem inventa", (a) => {
    const r = sugerirCategoriaPresumido(a);
    expect(r.categoria).toBeNull();
    expect(typeof r.motivo).toBe("string");
  });
});

describe("⚠⚠ ATIVIDADES QUE DISCORDAM ⇒ NENHUMA SUGESTÃO", () => {
  it("comércio + serviço na mesma empresa não elege uma categoria", () => {
    // No Presumido cada receita tem a sua presunção. Escolher uma pelo número de CNAEs seria eleger
    // por CONTAGEM um número que decide imposto — mesma disciplina do `DIVIDIDO` do motor de conta
    // e do `AMBIGUO` do vínculo de telefone.
    const r = sugerirCategoriaDaEmpresa([
      atv({ cnae: "4751201", tipoReceita: "REVENDA_MERCADORIA" }),
      atv({ cnae: "6201501", tipoReceita: "SERVICO_FATOR_R" }),
    ]);
    expect(r.categoria).toBeNull();
    expect(r.motivo).toMatch(/categorias DIFERENTES/i);
    expect(r.motivo).toMatch(/cada receita tem a sua presunção/i);
  });

  it("⚠ MAIORIA não decide: dois de comércio e um de serviço continua sem sugestão", () => {
    const r = sugerirCategoriaDaEmpresa([
      atv({ cnae: "4751201", tipoReceita: "REVENDA_MERCADORIA" }),
      atv({ cnae: "4781400", tipoReceita: "REVENDA_MERCADORIA" }),
      atv({ cnae: "6201501", tipoReceita: "SERVICO_FATOR_R" }),
    ]);
    expect(r.categoria).toBeNull();
  });

  it("⚠ a atividade PADRÃO manda — ela é a escolha que o contador já fez", () => {
    const r = sugerirCategoriaDaEmpresa([
      atv({ cnae: "4751201", tipoReceita: "REVENDA_MERCADORIA" }),
      atv({ cnae: "6201501", tipoReceita: "SERVICO_FATOR_R", padrao: true }),
    ]);
    expect(r.categoria).toBe(CATEGORIA.SERVICOS);
  });

  it("⚠ atividade DESATIVADA não entra na conta da divergência", () => {
    const r = sugerirCategoriaDaEmpresa([
      atv({ cnae: "4751201", tipoReceita: "REVENDA_MERCADORIA" }),
      atv({ cnae: "6201501", tipoReceita: "SERVICO_FATOR_R", ativo: false }),
    ]);
    expect(r.categoria).toBe(CATEGORIA.COMERCIO);
  });

  it("todas concordando, a confiança é a MAIS FRACA — nunca a mais forte", () => {
    const r = sugerirCategoriaDaEmpresa([
      atv({ tipoReceita: "SERVICO_ANEXO_III" }),
      atv({ cnae: "6201501", tipoReceita: "SERVICO_FATOR_R" }),
    ]);
    expect(r.confianca).toBe(CONFIANCA.MEDIA);
  });

  it("perfil vazio devolve nulo com o motivo próprio", () => {
    expect(sugerirCategoriaDaEmpresa([]).categoria).toBeNull();
    expect(sugerirCategoriaDaEmpresa([]).motivo).toMatch(/Nenhuma atividade ativa/i);
  });
});

describe("⚠⚠ OS RÓTULOS SÃO CÓPIA, E A CÓPIA ESTÁ AMARRADA", () => {
  // `ATIVIDADES_PRESUMIDO` mora no app do contador e NÃO é importável daqui (cruzar apps quebra o
  // boot). A amarração é TEXTUAL, como a de `"autorizada"` × `whereFaturamentoEmit`: este teste lê
  // o arquivo do outro app e exige as mesmas chaves com os mesmos rótulos. Muda lá, cai aqui.
  const FONTE = path.resolve(__dirname, "../../../../../web/src/features/planejamento/lib/lucroPresumido.js");

  it("o arquivo-fonte existe (se ele mudar de lugar, este teste cai — que é o ponto)", () => {
    expect(fs.existsSync(FONTE)).toBe(true);
  });

  it("as cinco chaves e os cinco rótulos batem", () => {
    const texto = fs.readFileSync(FONTE, "utf-8");
    const bloco = texto.slice(texto.indexOf("ATIVIDADES_PRESUMIDO = Object.freeze({"));
    const esperado = {
      comercio: "Comércio / Indústria",
      servicos: "Serviços em geral",
      transporteCargas: "Transporte de cargas",
      transportePassageiros: "Transporte de passageiros",
      combustiveis: "Revenda de combustíveis",
    };
    for (const [chave, rotulo] of Object.entries(esperado)) {
      expect(bloco).toContain(`${chave}: { rotulo: "${rotulo}"`);
    }
    // ⚠ E que não NASCEU uma sexta categoria lá sem chegar aqui.
    const chaves = [...bloco.matchAll(/^\s{2}(\w+): \{ rotulo:/gm)].map((m) => m[1]);
    expect(chaves.sort()).toEqual(Object.keys(esperado).sort());
  });

  it("⚠ e as PRESUNÇÕES continuam num lugar só — nenhuma alíquota foi copiada para cá", () => {
    // Duas cópias de alíquota divergiriam, e a divergência sai como imposto errado.
    const meu = fs.readFileSync(path.resolve(__dirname, "../lib/categoriaPresumido.js"), "utf-8");
    const codigo = meu.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    expect(codigo).not.toMatch(/0\.32|0\.16|0\.08|0\.012|0\.016/);
  });
});
