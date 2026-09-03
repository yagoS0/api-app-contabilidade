// As regras PURAS do assistente: preço, sessão do contato, confirmação por código.

import { custoEstimadoCentavos, somarUsage, precoDoModelo, MODELO_MAIS_CARO, PRECOS_POR_MILHAO_CENTAVOS } from "../precosIa.js";
import { sessaoDoContato, papelAlcanca, MOTIVOS_SEM_SESSAO, fraseSemSessao, PAPEL_MINIMO_SITUACAO_FISCAL, PAPEL_MINIMO_EMISSAO } from "../sessaoDoContato.js";
import { gerarCodigo, lerConfirmacao, decidirResposta, expirada, rodapeDeConfirmacao, ALFABETO, TTL_MS, FRASES } from "../confirmacaoPendente.js";
import { pesoDoPapelCliente } from "../../nfse/emissaoClienteAutorizacao.js";

describe("precosIa — a estimativa", () => {
  it("modelo desconhecido cai no MAIS CARO — superestimar protege o teto", () => {
    expect(precoDoModelo("modelo-que-nao-existe")).toBe(PRECOS_POR_MILHAO_CENTAVOS[MODELO_MAIS_CARO]);
  });
  it("1M de entrada + 1M de saída no opus-5 = US$ 30,00 = 3000 centavos", () => {
    expect(custoEstimadoCentavos({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-opus-5")).toBe(3000);
  });
  it("⚠ chamada pequena NUNCA arredonda a zero (arredonda para cima), e zero tokens é zero", () => {
    expect(custoEstimadoCentavos({ input_tokens: 10, output_tokens: 10 }, "claude-opus-5")).toBe(1);
    expect(custoEstimadoCentavos({}, "claude-opus-5")).toBe(0);
    expect(custoEstimadoCentavos(null, "claude-opus-5")).toBe(0);
  });
  it("cache lido é mais barato que entrada; escrita de cache mais cara", () => {
    const p = precoDoModelo("claude-opus-5");
    expect(p.cacheLeitura).toBeLessThan(p.entrada);
    expect(p.cacheEscrita).toBeGreaterThan(p.entrada);
  });
  it("somarUsage soma iterações, ignorando nulos", () => {
    expect(somarUsage([{ input_tokens: 5, output_tokens: 1 }, null, { input_tokens: 2, cache_read_input_tokens: 7 }]))
      .toEqual({ input_tokens: 7, output_tokens: 1, cache_read_input_tokens: 7, cache_creation_input_tokens: 0 });
  });
});

describe("sessaoDoContato — vínculo não é autorização", () => {
  const contato = { userId: "u1", nome: "Maria" };
  it("sem empresa no fio → SEM_EMPRESA", () => {
    expect(sessaoDoContato({ portalClientId: null, contato, vinculoRbac: { role: "OWNER", status: "ACTIVE" } }).motivo).toBe(MOTIVOS_SEM_SESSAO.SEM_EMPRESA);
  });
  it("contato sem userId → SEM_PESSOA, papel nulo", () => {
    const s = sessaoDoContato({ portalClientId: "pc-1", contato: { nome: "X" }, vinculoRbac: null });
    expect(s).toMatchObject({ ok: false, motivo: MOTIVOS_SEM_SESSAO.SEM_PESSOA, papel: null, userId: null });
  });
  it("vínculo inativo → VINCULO_INATIVO, papel nulo mesmo com role gravado", () => {
    const s = sessaoDoContato({ portalClientId: "pc-1", contato, vinculoRbac: { role: "OWNER", status: "SUSPENDED" } });
    expect(s.ok).toBe(false);
    expect(s.motivo).toBe(MOTIVOS_SEM_SESSAO.VINCULO_INATIVO);
    expect(s.papel).toBeNull();
  });
  it("vínculo ativo → sessão com papel em caixa alta", () => {
    const s = sessaoDoContato({ portalClientId: "pc-1", contato, vinculoRbac: { role: "client_admin", status: "ACTIVE" } });
    expect(s).toEqual({ ok: true, portalClientId: "pc-1", userId: "u1", papel: "CLIENT_ADMIN", motivo: null, contatoNome: "Maria" });
  });
  it("⚠ papelAlcanca usa a MESMA tabela de pesos da emissão", () => {
    expect(papelAlcanca("FINANCEIRO", PAPEL_MINIMO_SITUACAO_FISCAL)).toBe(false);
    expect(papelAlcanca("CLIENT_ADMIN", PAPEL_MINIMO_SITUACAO_FISCAL)).toBe(true);
    expect(papelAlcanca("OWNER", PAPEL_MINIMO_EMISSAO)).toBe(true);
    expect(papelAlcanca(null, "FINANCEIRO")).toBe(false);
    expect(pesoDoPapelCliente("OWNER")).toBeGreaterThan(pesoDoPapelCliente("CLIENT_ADMIN"));
  });
  it("as frases sem sessão nunca prometem consulta", () => {
    for (const m of Object.values(MOTIVOS_SEM_SESSAO)) expect(fraseSemSessao(m)).toMatch(/escritório/);
  });
});

describe("confirmacaoPendente — o código e a leitura", () => {
  it("gerarCodigo: 4 caracteres do alfabeto sem 0/O/1/I, determinístico com rand injetado", () => {
    expect(ALFABETO).not.toMatch(/[01OI]/);
    const c = gerarCodigo(() => 0);
    expect(c).toBe("AAAA");
    expect(gerarCodigo()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });
  it("lerConfirmacao aceita caixa e espaços; 'sim' NÃO confirma", () => {
    expect(lerConfirmacao("  confirmar a7k2 ")).toEqual({ ehConfirmacao: true, codigo: "A7K2", ehCancelamento: false });
    expect(lerConfirmacao("CONFIRMAR A7K2.")).toMatchObject({ ehConfirmacao: true, codigo: "A7K2" });
    expect(lerConfirmacao("sim")).toMatchObject({ ehConfirmacao: false, codigo: null });
    expect(lerConfirmacao("confirmar")).toMatchObject({ ehConfirmacao: false });
    expect(lerConfirmacao("não, cancela")).toMatchObject({ ehConfirmacao: false, ehCancelamento: true });
  });
  it("expirada: 10 minutos, conferido na leitura", () => {
    const agora = new Date("2026-09-02T12:00:00Z");
    expect(TTL_MS).toBe(600000);
    expect(expirada({ expiraEm: new Date(agora.getTime() + 1000) }, agora)).toBe(false);
    expect(expirada({ expiraEm: new Date(agora.getTime() - 1) }, agora)).toBe(true);
    expect(expirada({}, agora)).toBe(true);
  });
  describe("decidirResposta", () => {
    const agora = new Date("2026-09-02T12:00:00Z");
    const pendente = { codigo: "A7K2", expiraEm: new Date(agora.getTime() + 60_000) };
    it("código certo → EXECUTAR; errado → CODIGO_ERRADO; expirada → EXPIRADA", () => {
      expect(decidirResposta({ texto: "confirmar A7K2", pendente, agora }).decisao).toBe("EXECUTAR");
      expect(decidirResposta({ texto: "confirmar ZZZZ", pendente, agora }).decisao).toBe("CODIGO_ERRADO");
      expect(decidirResposta({ texto: "confirmar A7K2", pendente: { ...pendente, expiraEm: new Date(0) }, agora }).decisao).toBe("EXPIRADA");
    });
    it("⚠ 'sim' com pendência aberta CANCELA — nunca executa", () => {
      expect(decidirResposta({ texto: "sim", pendente, agora }).decisao).toBe("CANCELAR");
      expect(decidirResposta({ texto: "manda a guia do inss", pendente, agora }).decisao).toBe("CANCELAR");
    });
    it("sem pendência: 'confirmar' → SEM_PENDENCIA; qualquer outra → SEGUE_PARA_IA", () => {
      expect(decidirResposta({ texto: "confirmar A7K2", pendente: null, agora }).decisao).toBe("SEM_PENDENCIA");
      expect(decidirResposta({ texto: "quanto devo?", pendente: null, agora }).decisao).toBe("SEGUE_PARA_IA");
    });
  });
  it("o rodapé nomeia o código e o prazo; as frases fixas existem", () => {
    expect(rodapeDeConfirmacao("A7K2")).toMatch(/CONFIRMAR A7K2/);
    expect(rodapeDeConfirmacao("A7K2")).toMatch(/10 minutos/);
    expect(FRASES.CODIGO_ERRADO("A7K2")).toMatch(/A7K2/);
  });
});
