// ⚠⚠ O PRÉ-VOO DO BOTÃO «SUGERIR CONTAS COM IA» e a leitura do relatório (02/09/2026).
//
// A tela não decide quem vai ao modelo — o servidor decide. O que se prende aqui é que o botão
// desabilita COM o motivo (nunca mudo), que ele não aparece com a integração desligada, e que o
// relatório distingue cinco desfechos que um "0 propostas" colapsaria.

import {
  MOTIVO_SEM_IA,
  fraseDaGuarda,
  fraseDaRecusaIa,
  leituraDaClassificacaoIa,
  linhaSemNinguem,
  podeSugerirComIa,
} from "../conferenciaTela";

const linha = (extra = {}) => ({ id: "d-1", estado: "AGUARDANDO_PAGAMENTO", sugestao: null, ...extra });

describe("linhaSemNinguem — o espelho de `linhasParaIa`", () => {
  it("sem sugestão ⇒ vai; com conta de regra/histórico ⇒ não", () => {
    expect(linhaSemNinguem(linha())).toBe(true);
    expect(linhaSemNinguem(linha({ sugestao: { conta: null, motivo: "nada_conhecido" } }))).toBe(true);
    expect(linhaSemNinguem(linha({ sugestao: { conta: "411020008", procedencia: "REGRA_CNPJ" } }))).toBe(false);
    expect(linhaSemNinguem(linha({ sugestao: { conta: "411020008", procedencia: "HISTORICO" } }))).toBe(false);
  });

  it("⚠⚠ DIVIDIDO e FORA_DA_FAIXA ficam de fora — alguém sabe e recusou por motivo", () => {
    expect(linhaSemNinguem(linha({ sugestao: { conta: null, motivo: "dividido" } }))).toBe(false);
    expect(linhaSemNinguem(linha({ sugestao: { conta: null, motivo: "fora_da_faixa" } }))).toBe(false);
  });

  it("só estados lançáveis", () => {
    expect(linhaSemNinguem(linha({ estado: "CONTABILIZADO" }))).toBe(false);
    expect(linhaSemNinguem(linha({ estado: "A_CONFERIR" }))).toBe(true);
  });
});

describe("⚠⚠ podeSugerirComIa — o botão desabilita COM o motivo", () => {
  const fila = (itens, ligada = true) => ({ itens, iaClassificacaoLigada: ligada });

  it("⚠ integração DESLIGADA ⇒ o botão nem aparece", () => {
    const r = podeSugerirComIa(fila([linha()], false));
    expect(r).toMatchObject({ visivel: false, pode: false, motivo: MOTIVO_SEM_IA.DESLIGADA });
    // ⚠ `undefined` também é desligada — a flag só liga com `true` explícito do servidor
    expect(podeSugerirComIa({ itens: [linha()] }).visivel).toBe(false);
  });

  it("sem papel de escrita ⇒ visível, desabilitado, com a frase", () => {
    const r = podeSugerirComIa(fila([linha()]), { podeEscrever: false });
    expect(r).toMatchObject({ visivel: true, pode: false, motivo: MOTIVO_SEM_IA.SEM_PAPEL });
    expect(r.frase).toMatch(/perfil/i);
  });

  it("fila vazia ⇒ SEM_FILA", () => {
    expect(podeSugerirComIa(fila([]))).toMatchObject({ pode: false, motivo: MOTIVO_SEM_IA.SEM_FILA });
  });

  it("⚠⚠ todas com regra/histórico ⇒ TODAS_TEM_CONTA, e a frase diz isso", () => {
    const r = podeSugerirComIa(fila([linha({ sugestao: { conta: "411020008", procedencia: "REGRA_CNPJ" } })]));
    expect(r).toMatchObject({ pode: false, motivo: MOTIVO_SEM_IA.TODAS_TEM_CONTA, candidatas: 0 });
    expect(r.frase).toMatch(/regra ou histórico/i);
  });

  it("uma linha sem ninguém basta — e o número de candidatas viaja", () => {
    const r = podeSugerirComIa(fila([
      linha({ id: "a", sugestao: { conta: "411020008", procedencia: "REGRA_CNPJ" } }),
      linha({ id: "b" }),
      linha({ id: "c", estado: "A_CONFERIR" }),
    ]));
    expect(r).toEqual({ visivel: true, pode: true, motivo: null, frase: null, candidatas: 2 });
  });
});

describe("as frases", () => {
  it("recusa da IA em português; desconhecida volta CRUA", () => {
    expect(fraseDaRecusaIa("conta_fora_do_plano")).toMatch(/não existe no plano/);
    expect(fraseDaRecusaIa("credito_nao_e_disponibilidade")).toMatch(/caixa nem banco/);
    expect(fraseDaRecusaIa("xyz_nova")).toBe("xyz_nova");
  });
  it("recusa da guarda em português; desconhecida volta CRUA", () => {
    expect(fraseDaGuarda("teto_empresa")).toMatch(/teto mensal/);
    expect(fraseDaGuarda("sem_chave")).toMatch(/chave/i);
    expect(fraseDaGuarda("outro")).toBe("outro");
  });
});

describe("⚠⚠ leituraDaClassificacaoIa — cinco desfechos que não se parecem", () => {
  const base = { ok: true, semLinhas: false, linhasOlhadas: 10, linhasEnviadas: 4, lotes: 1, propostas: 3, gravadas: 3, recusadas: [], ilegiveis: 0, erros: [], recusadaPelaGuarda: null, custoEstimadoCentavos: 2, modelo: "claude-opus-5" };

  it("nulo ⇒ nulo", () => expect(leituraDaClassificacaoIa(null)).toBeNull());

  it("propostas gravadas", () => {
    expect(leituraDaClassificacaoIa(base)).toMatchObject({ propostas: 3, gravadas: 3, naoGravadas: 0, guardaRecusouTudo: false, guardaParouNoMeio: false, semLinhas: false });
  });

  it("nada a sugerir (`semLinhas`) não é 'não funcionou'", () => {
    expect(leituraDaClassificacaoIa({ ...base, semLinhas: true, lotes: 0, propostas: 0, gravadas: 0 })).toMatchObject({ semLinhas: true, guardaRecusouTudo: false });
  });

  it("⚠ a guarda recusando ANTES do primeiro lote é `guardaRecusouTudo`", () => {
    const r = leituraDaClassificacaoIa({ ...base, lotes: 0, propostas: 0, gravadas: 0, recusadaPelaGuarda: { motivo: "teto_empresa", mensagem: "teto", apartirDoLote: 1 } });
    expect(r.guardaRecusouTudo).toBe(true);
    expect(r.guardaParouNoMeio).toBe(false);
    expect(r.guarda.motivo).toBe("teto_empresa");
  });

  it("⚠ a guarda recusando no MEIO guarda o que entrou", () => {
    const r = leituraDaClassificacaoIa({ ...base, lotes: 2, recusadaPelaGuarda: { motivo: "teto_escritorio", apartirDoLote: 3 } });
    expect(r.guardaRecusouTudo).toBe(false);
    expect(r.guardaParouNoMeio).toBe(true);
  });

  it("proposta que o banco não confirmou aparece em `naoGravadas`", () => {
    expect(leituraDaClassificacaoIa({ ...base, propostas: 3, gravadas: 1 }).naoGravadas).toBe(2);
  });

  it("recusadas e erros viajam inteiros", () => {
    const r = leituraDaClassificacaoIa({ ...base, recusadas: [{ id: "d-1", motivo: "conta_sintetica" }], erros: [{ lote: 1, codigo: "IA_CONEXAO", mensagem: "x" }], ilegiveis: 1 });
    expect(r.recusadas).toHaveLength(1);
    expect(r.erros).toHaveLength(1);
    expect(r.ilegiveis).toBe(1);
  });
});
