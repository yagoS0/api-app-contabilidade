// ⚠ ORIGEM: espelha `apps/web/src/features/notas/lib/__tests__/descricaoSugerida.test.js` (portal do
// escritório), caso a caso. Os dois apps têm a MESMA regra em cópias separadas (não há código
// compartilhado entre eles); duas suítes é o que impede uma das cópias de derivar em silêncio —
// mesmo arranjo de `consultaTomador.test.js` aqui do lado.
//
// A REGRA DA DESCRIÇÃO SUGERIDA — nenhuma tela aqui.
//
// ⚠⚠ O QUE SAI DAQUI VIRA `xDescServ` E É IMPRESSO NO DANFSe QUE O TOMADOR RECEBE. Por isso os
// casos abaixo são frases inteiras, conferidas por igualdade: um teste que só verificasse "contém a
// atividade" deixaria passar português quebrado.
//
// ⚠ AS ATIVIDADES SÃO AS REAIS, medidas em produção (33 empresas, só leitura) — inclusive a que
// tem QUATRO códigos NUS, sem descrição nenhuma. Ela é o caso que prova a regra de não inventar.

import {
  ESCOLHA,
  SEM_SUGESTAO,
  escolherAtividade,
  lerAtividade,
  montarFrase,
  sugerirDescricaoDaNota,
  textoDoMotivo,
} from "../descricaoSugerida";

// As quatro empresas medidas, com o `atividades` como está gravado.
const FADINI = ["46.19-2-00 - Representantes comerciais e agentes do comércio de mercadorias em geral não especializado"];
const KLAUS = ["73.19-0-03 - Marketing direto"];
const GL = ["70.20-4-00 - Atividades de consultoria em gestão empresarial, exceto consultoria técnica específica"];
const KAIZEN = ["71.12-0-00", "4120400", "4399101", "4399103"];

describe("ler a entrada do cadastro", () => {
  it("a forma `código - descrição` é reconhecida", () => {
    expect(lerAtividade(KLAUS[0])).toEqual({
      bruto: KLAUS[0],
      codigo: "7319003",
      descricao: "Marketing direto",
    });
  });

  // ⚠⚠ CÓDIGO NU NÃO VIRA TEXTO. Não existe tabela CNAE→descrição neste repositório; o `CnaeAnexo`
  // mapeia para ANEXO DO SIMPLES, que é outra coisa. Sem texto ao lado do número não há descrição.
  it("código nu fica SEM descrição, e não se deduz nada do número", () => {
    for (const bruto of KAIZEN) {
      expect(lerAtividade(bruto).descricao).toBeNull();
    }
  });

  // ⚠ A ARMADILHA DO TRAÇO DE DENTRO DO PRÓPRIO CNAE: `71.12-0-00` tem dois traços, e uma busca
  // ingênua pelo separador leria código `71.12-0` e descrição `00`. Por isso a descrição precisa
  // COMEÇAR POR LETRA.
  it("o traço interno do CNAE não vira separador", () => {
    expect(lerAtividade("71.12-0-00").descricao).toBeNull();
    expect(lerAtividade("46.19-2-00 - 00").descricao).toBeNull();
  });

  it("entrada vazia não vira atividade", () => {
    expect(lerAtividade("")).toBeNull();
    expect(lerAtividade(null)).toBeNull();
  });
});

describe("qual atividade — encontra, nunca escolhe", () => {
  it("uma só com texto: é ela", () => {
    const r = escolherAtividade(KLAUS, "7319003");
    expect(r.como).toBe(ESCOLHA.UNICA);
    expect(r.escolhida.descricao).toBe("Marketing direto");
  });

  it("várias, e o CNAE principal desempata", () => {
    const varias = [
      "62.01-5-01 - Desenvolvimento de programas de computador sob encomenda",
      "62.04-0-00 - Consultoria em tecnologia da informação",
    ];
    const r = escolherAtividade(varias, "6204000");
    expect(r.como).toBe(ESCOLHA.CNAE_PRINCIPAL);
    expect(r.escolhida.descricao).toBe("Consultoria em tecnologia da informação");
  });

  // ⚠⚠ SEM CASAMENTO ÚNICO, NÃO SE ELEGE NINGUÉM. A ordem de um `String[]` não significa nada;
  // pegar a primeira seria o sistema decidindo o que vai escrito na nota.
  it("várias e nenhuma é a do CNAE principal: NÃO escolhe, e devolve as opções", () => {
    const varias = [
      "62.01-5-01 - Desenvolvimento de programas de computador sob encomenda",
      "62.04-0-00 - Consultoria em tecnologia da informação",
    ];
    const r = escolherAtividade(varias, "8599604");
    expect(r.escolhida).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.VARIAS);
    expect(r.opcoes).toHaveLength(2);
  });

  it("só códigos nus: não há descrição a oferecer", () => {
    const r = escolherAtividade(KAIZEN, "7112000");
    expect(r.escolhida).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.SEM_DESCRICAO);
  });

  it("sem atividade cadastrada", () => {
    expect(escolherAtividade([], "7112000").motivo).toBe(SEM_SUGESTAO.SEM_ATIVIDADE);
  });
});

describe("a frase — e o português que ela não pode quebrar", () => {
  // ⚠⚠ OS DOIS PONTOS SÃO A PEÇA QUE FAZ ISSO FUNCIONAR SEMPRE. "Serviço prestado DE Representantes
  // comerciais" não é redundância, é frase errada — e não existe heurística confiável para decidir
  // se "de" cabe antes de um sintagma nominal que não controlamos.
  it("nome de AGENTE no plural continua lendo bem", () => {
    expect(montarFrase("Representantes comerciais e agentes do comércio de mercadorias", "2026-07"))
      .toBe("Serviço prestado: Representantes comerciais e agentes do comércio de mercadorias — competência 07/2026");
  });

  it("nome de atividade simples", () => {
    expect(montarFrase("Marketing direto", "2026-07"))
      .toBe("Serviço prestado: Marketing direto — competência 07/2026");
  });

  it("descrição que começa com “Atividades de…” mantém o prefixo", () => {
    expect(montarFrase("Atividades de consultoria em gestão empresarial", "2026-07"))
      .toBe("Serviço prestado: Atividades de consultoria em gestão empresarial — competência 07/2026");
  });

  // ⚠⚠ O RAMO 1: a descrição JÁ é o serviço, e o prefixo SOME em vez de duplicar a palavra.
  // Medido: 61 dos 335 códigos da lista oficial do Anexo B começam assim (34 deles com "Serviços
  // de"), e descrições de CNAE também. "Serviço prestado de Serviços de consultoria" é o que isto
  // impede de sair impresso.
  it("descrição que já começa com “Serviços…” PERDE o prefixo — nunca duplica a palavra", () => {
    expect(montarFrase("Serviços de consultoria em gestão empresarial", "2026-07"))
      .toBe("Serviços de consultoria em gestão empresarial — competência 07/2026");
    expect(montarFrase("Serviço de engenharia", "2026-07"))
      .toBe("Serviço de engenharia — competência 07/2026");
    expect(montarFrase("Servicos de engenharia", "2026-07"))
      .toBe("Servicos de engenharia — competência 07/2026");
  });

  it("nenhuma frase montada repete “serviço” duas vezes", () => {
    const amostras = [
      "Serviços de consultoria em gestão empresarial",
      "Serviços técnicos em telecomunicações",
      "Marketing direto",
      "Atividades de contabilidade",
    ];
    for (const a of amostras) {
      const frase = montarFrase(a, "2026-07").toLowerCase();
      expect(frase.match(/servi[çc]o/g).length).toBe(1);
    }
  });

  // ⚠ O TEXTO OFICIAL NÃO É REESCRITO. O único ajuste mecânico é o ponto final, senão a cláusula de
  // competência ficaria depois de um ponto.
  it("o ponto final da descrição sai para a competência não ficar depois dele", () => {
    expect(montarFrase("Atividades de contabilidade.", "2026-07"))
      .toBe("Serviço prestado: Atividades de contabilidade — competência 07/2026");
  });

  // ⚠ No assistente do contador a competência nasce VAZIA (a nota sem `dCompet` recebe a data de
  // hoje no servidor). Exigir os três pedaços faria a sugestão nunca aparecer lá.
  it("sem competência, a frase sai completa e SEM cláusula pendurada", () => {
    expect(montarFrase("Marketing direto", "")).toBe("Serviço prestado: Marketing direto");
    expect(montarFrase("Marketing direto", null)).toBe("Serviço prestado: Marketing direto");
  });

  // O portal do cliente guarda a competência como DATA (`dCompet` é dia, não mês).
  it("competência como data completa vira MM/AAAA igual", () => {
    expect(montarFrase("Marketing direto", "2026-08-19"))
      .toBe("Serviço prestado: Marketing direto — competência 08/2026");
  });

  it("descrição vazia não vira frase", () => {
    expect(montarFrase("", "2026-07")).toBeNull();
    expect(montarFrase(null, "2026-07")).toBeNull();
  });
});

describe("a sugestão inteira — as quatro empresas medidas", () => {
  const sugerir = (atividades, cnaePrincipal) =>
    sugerirDescricaoDaNota({ atividades, cnaePrincipal, competencia: "2026-07" });

  it("FADINI", () => {
    expect(sugerir(FADINI, "4619200").texto).toBe(
      "Serviço prestado: Representantes comerciais e agentes do comércio de mercadorias em geral "
      + "não especializado — competência 07/2026"
    );
  });

  it("KLAUS", () => {
    expect(sugerir(KLAUS, "7319003").texto).toBe("Serviço prestado: Marketing direto — competência 07/2026");
  });

  it("GL", () => {
    expect(sugerir(GL, "7020400").texto).toBe(
      "Serviço prestado: Atividades de consultoria em gestão empresarial, exceto consultoria "
      + "técnica específica — competência 07/2026"
    );
  });

  // ⚠⚠ O CASO QUE PROVA A REGRA 1 DO PROJETO: quatro códigos, nenhum texto, NENHUMA sugestão.
  it("KAIZEN — quatro códigos nus ⇒ campo vazio, e a tela diz por quê", () => {
    const r = sugerir(KAIZEN, "7112000");
    expect(r.texto).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.SEM_DESCRICAO);
    expect(textoDoMotivo(r.motivo)).toMatch(/não\s+deduzimos o texto a partir do número/i);
  });

  // ⚠ A PROCEDÊNCIA VAI PARA A TELA. Frase de documento fiscal sem origem é o que ninguém confere.
  it("toda sugestão vem com a procedência, nomeando o CNAE de onde saiu", () => {
    const r = sugerir(KLAUS, "7319003");
    expect(r.procedencia).toMatch(/7319003/);
    expect(r.procedencia).toMatch(/Marketing direto/);
  });

  // ⚠ PROP AUSENTE ≠ CADASTRO VAZIO — sem o cadastro a tela não afirma que a empresa não tem
  // atividade; ela apenas não sugere e fica calada.
  it("sem cadastro, não sugere E não acusa", () => {
    const r = sugerirDescricaoDaNota({ temCadastro: false });
    expect(r.texto).toBeNull();
    expect(r.motivo).toBe(SEM_SUGESTAO.SEM_CADASTRO);
    expect(textoDoMotivo(r.motivo)).toBeNull();
  });

  // ⚠ SEM DADO, CAMPO VAZIO — NUNCA MEIA FRASE. Nenhum motivo pode produzir um texto pela metade.
  it("nenhum caminho sem dado produz frase parcial", () => {
    for (const [ativ, cnae] of [[[], "1"], [KAIZEN, "7112000"], [null, null], [["   "], "1"]]) {
      expect(sugerirDescricaoDaNota({ atividades: ativ, cnaePrincipal: cnae, competencia: "2026-08" }).texto)
        .toBeNull();
    }
  });
});
