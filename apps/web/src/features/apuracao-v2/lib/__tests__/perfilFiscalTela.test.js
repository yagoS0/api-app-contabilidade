// O QUE A TELA DO PERFIL FISCAL PODE AFIRMAR.
//
// ⚠⚠ O defeito que isto conserta foi o que mais confundiu o dono: Empresa → Perfil fiscal mostrava
// "Simples Nacional" com duas atividades ATIVAS, e a aba Apuração da MESMA empresa dizia "A empresa
// não tem Cadastro Fiscal preenchido". Medido: **28 das 34 empresas não têm linha em
// `cadastros_fiscais`** — para elas o backend MONTA o perfil a partir da `Company` e devolve
// `temCadastro: false`, e nenhuma tela lia esse campo.

import {
  origemDoPerfil, avisoDoFatorR, ORIGEM_DO_PERFIL,
  COLUNAS_SEM_LEITOR, COLUNAS_COM_LEITOR, semLeitor,
  estadoDoRegime, ESTADO_DO_REGIME,
} from "../perfilFiscalTela";

describe("⚠⚠ A TELA PRECISA DIZER SE O PERFIL ESTÁ SALVO", () => {
  it("sem cadastro, o aviso aparece e diz que NADA está gravado", () => {
    const r = origemDoPerfil({ temCadastro: false, candidatos: [{ cnae: "6201501" }] });
    expect(r.origem).toBe(ORIGEM_DO_PERFIL.DERIVADO);
    expect(r.aviso.titulo).toMatch(/ainda NÃO está salvo/i);
    expect(r.aviso.texto).toMatch(/CNAEs da ficha da empresa/i);
  });

  it("⚠ e ele nomeia as TRÊS coisas que mudam a leitura", () => {
    // De onde vieram as atividades · que os marcadores são default · que o regime pode não ter sido
    // conferido por ninguém. Sem as três, o contador acha que está olhando um cadastro.
    const t = origemDoPerfil({ temCadastro: false }).aviso.texto;
    expect(t).toMatch(/ATIVAS por padrão/i);
    expect(t).toMatch(/nenhuma está marcada como padrão/i);
    expect(t).toMatch(/default do sistema/i);
  });

  it("⚠⚠ e ele explica a CONTRADIÇÃO que o dono viu entre as duas telas", () => {
    // É o fecho: as duas telas estavam certas. Uma mostra o que dá para derivar, a outra exige o
    // que foi gravado.
    const c = origemDoPerfil({ temCadastro: false }).aviso.consequencia;
    expect(c).toMatch(/não tem Cadastro Fiscal preenchido/);
    expect(c).toMatch(/as duas telas estão certas/i);
  });

  it("com cadastro salvo, NENHUM aviso — âmbar permanente treina o olho a ignorar", () => {
    const r = origemDoPerfil({ temCadastro: true, candidatos: [] });
    expect(r.origem).toBe(ORIGEM_DO_PERFIL.SALVO);
    expect(r.aviso).toBeNull();
  });

  it("⚠ `temCadastro` AUSENTE não vira \"derivado\" — só `false` explícito", () => {
    // Contrato antigo (ou resposta parcial) não pode acender um alarme que afirma algo sobre o
    // banco. A ausência do campo não é a informação "não existe linha".
    for (const perfil of [{}, { temCadastro: undefined }, null, undefined]) {
      expect(origemDoPerfil(perfil).origem).toBe(ORIGEM_DO_PERFIL.SALVO);
    }
  });
});

describe("⚠⚠ O \"27%–29%\" ERA UM NÚMERO QUE NENHUM CÓDIGO CALCULA", () => {
  // Varredura em 25/08/2026: zero ocorrências de 0.27 / 0.29 no repositório. Era texto fixo, e um
  // número inventado numa tela fiscal é pior que texto nenhum — ele parece resultado de conta.
  it("o aviso novo NÃO traz faixa inventada", () => {
    const a = avisoDoFatorR({ fatorR: { resposta: "sim", cnaes: ["7319003"] } });
    expect(a.texto).not.toMatch(/27%|29%|zona/i);
  });

  it("ele diz o que o perfil REALMENTE sabe: quais atividades são de Fator R", () => {
    const a = avisoDoFatorR({ fatorR: { resposta: "sim", cnaes: ["7319003", "6319400"] } });
    expect(a.texto).toMatch(/7319003, 6319400/);
    expect(a.texto).toMatch(/sai da folha dos 12 meses ÷ RBT12/);
  });

  it("⚠ e manda onde VER o número, já que esta tela não o calcula", () => {
    const a = avisoDoFatorR({ fatorR: { resposta: "sim", cnaes: [] } });
    expect(a.ondeVerOValor).toMatch(/Apuração/);
    expect(a.ondeVerOValor).toMatch(/Planejamento/);
  });

  it("sem CNAE conhecido, a frase genérica — mas ainda sem faixa inventada", () => {
    const a = avisoDoFatorR({ fatorR: { resposta: "sim", cnaes: [] } });
    expect(a.texto).toMatch(/Há atividade sujeita ao Fator R/);
    expect(a.texto).not.toMatch(/27|29/);
  });

  it("sem Fator R, nenhum aviso", () => {
    expect(avisoDoFatorR({ fatorR: { resposta: "nao" } })).toBeNull();
    expect(avisoDoFatorR({ temFatorR: false })).toBeNull();
    expect(avisoDoFatorR(null)).toBeNull();
  });

  it("⚠⚠ INDEFINIDO não acende o aviso — \"não sei\" não é \"sim\"", () => {
    expect(avisoDoFatorR({ fatorR: { resposta: "indefinido" } })).toBeNull();
  });

  it("⚠ o contrato ANTIGO (`temFatorR`) continua funcionando enquanto o backend não sobe", () => {
    expect(avisoDoFatorR({ temFatorR: true })).not.toBeNull();
  });

  it("⚠ e a resposta NOVA vence a antiga quando as duas vêm", () => {
    // `temFatorR: true` com `resposta: "nao"` só acontece com backend antigo servindo campo novo —
    // e aí a regra é a que decide, não o booleano.
    expect(avisoDoFatorR({ temFatorR: true, fatorR: { resposta: "nao" } })).toBeNull();
  });

  it("a divergência entre perfil e cadastro viaja para a tela", () => {
    const a = avisoDoFatorR({ fatorR: { resposta: "sim", cnaes: ["1"], divergencia: { frase: "confirme o cadastro" } } });
    expect(a.divergencia).toBe("confirme o cadastro");
  });
});

describe("⚠⚠ AS COLUNAS QUE ACEITAM DIGITAÇÃO E NINGUÉM LÊ", () => {
  // Medido: dos oito campos de `perfilAtividades`, só `aliquotaIss` tem leitor. Campo que aceita
  // digitação e não é lido é pior que campo ausente — o contador preenche e nada acontece.
  it("as quatro write-only estão nomeadas", () => {
    expect(Object.keys(COLUNAS_SEM_LEITOR).sort())
      .toEqual(["codigoServicoMunicipal", "domicilioFiscal", "obs", "retencaoFonte"]);
  });

  it("⚠ e `aliquotaIss` NÃO está entre elas — ela tem leitor, e a tela diz quem", () => {
    expect(semLeitor("aliquotaIss")).toBe(false);
    expect(COLUNAS_COM_LEITOR.aliquotaIss).toMatch(/Planejamento tribut/i);
    expect(COLUNAS_COM_LEITOR.aliquotaIss).toMatch(/PADRÃO desempata/i);
  });

  it("⚠⚠ o aviso do código municipal explica a diferença de GRANULARIDADE", () => {
    // Quem a emissão lê é `Company.codigoServicoMunicipal` — UM por empresa. Este é por CNAE.
    // Sem essa frase, "não alimenta nada" parece defeito a consertar, quando é decisão pendente.
    expect(COLUNAS_SEM_LEITOR.codigoServicoMunicipal).toMatch(/um por empresa/i);
    expect(COLUNAS_SEM_LEITOR.codigoServicoMunicipal).toMatch(/por CNAE/i);
  });

  it("toda coluna sem leitor tem uma frase, e nenhuma é vazia", () => {
    for (const [campo, frase] of Object.entries(COLUNAS_SEM_LEITOR)) {
      expect(semLeitor(campo)).toBe(true);
      expect(frase.length).toBeGreaterThan(20);
    }
  });
});

describe("⚠⚠ O REGIME PRÉ-PREENCHIDO NÃO PODE PARECER CADASTRADO", () => {
  // O caso que morde em produção não é o regime VAZIO — esse `RegimeDaEmpresa` já recusava. É o
  // regime PREENCHIDO POR DEFAULT: `apuracaoV2.mapRegime` termina em `return "SIMPLES_NACIONAL"`,
  // então empresa SEM cadastro chega à tela dizendo "Simples Nacional", em verde — que nesta casa
  // quer dizer CONCLUÍDO. O backend devolve `prefill: true` para distinguir, e ninguém lia.
  //
  // ⚠ Este bloco nasceu de um EXPERIMENTO que voltou ZERO vermelhos: desligando o ramo do
  // `prefill`, os 18 testes continuavam passando. A regra existia sem prova nenhuma.
  it("⚠⚠ com `prefill`, o estado é DERIVADO e NÃO é confiável", () => {
    const r = estadoDoRegime({ regime: "SIMPLES_NACIONAL", prefill: true });
    expect(r.estado).toBe(ESTADO_DO_REGIME.DERIVADO);
    expect(r.confiavel).toBe(false);
  });

  it("⚠⚠ e a nota diz que o Simples Nacional pode ser o DEFAULT do sistema", () => {
    // Sem esta frase o contador lê "derivado da ficha" e confia — a ficha é dele. O que ele não
    // sabe é que texto irreconhecível E texto ausente produzem o MESMO "Simples Nacional".
    const nota = estadoDoRegime({ regime: "SIMPLES_NACIONAL", prefill: true }).nota;
    expect(nota).toMatch(/assume Simples Nacional quando não reconhece/i);
    expect(nota).toMatch(/Confirme antes de usar/i);
  });

  it("sem `prefill`, é CADASTRADO — e aí sim é confiável, sem nota", () => {
    const r = estadoDoRegime({ regime: "SIMPLES_NACIONAL", prefill: false });
    expect(r).toMatchObject({ estado: ESTADO_DO_REGIME.CADASTRADO, confiavel: true, nota: null });
  });

  it("⚠ `prefill` AUSENTE não vira derivado — contrato antigo não acende alarme sobre o banco", () => {
    // Mesma disciplina de `origemDoPerfil`: a ausência do campo não é a informação "foi derivado".
    for (const p of [undefined, null, "true", 1]) {
      expect(estadoDoRegime({ regime: "SIMPLES_NACIONAL", prefill: p }).estado)
        .toBe(ESTADO_DO_REGIME.CADASTRADO);
    }
  });

  it("regime VAZIO é AUSENTE, e nunca vira Simples Nacional por conta própria", () => {
    for (const v of [null, undefined, "", "   "]) {
      const r = estadoDoRegime({ regime: v });
      expect(r.estado).toBe(ESTADO_DO_REGIME.AUSENTE);
      expect(r.rotulo).toBe("não cadastrado");
      expect(r.confiavel).toBe(false);
    }
  });

  it("⚠ regime DESCONHECIDO sai como veio — a tela não traduz o que não conhece", () => {
    expect(estadoDoRegime({ regime: "LUCRO_REAL" }).rotulo).toBe("LUCRO_REAL");
  });
});
