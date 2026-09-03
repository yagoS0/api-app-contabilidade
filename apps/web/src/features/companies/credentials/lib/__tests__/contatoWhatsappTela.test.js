// A regra da tela de contatos de WhatsApp — e o AMARRE com o servidor.
//
// ⚠ O amarre é o teste mais importante deste arquivo: `normalizarE164`/`formatarTelefone` daqui são
// espelho de `apps/api/src/application/whatsapp/telefone.js`. Sem importar a função de lá e exigir
// o mesmo veredito, "espelho" é intenção, não fato — e a divergência apareceria como "a tela aceitou
// e o servidor recusou" no cadastro do número que recebe guia.

import {
  normalizarE164,
  formatarTelefone,
  pareceFormatoAntigo,
  CANAIS_DE_ENVIO,
  rotuloDoCanal,
  SITUACAO_CONTATO,
  situacaoDoContato,
  situacaoDaEmpresa,
  validarFormulario,
  montarPayload,
  fraseDeConfirmacaoRemocao,
  estadoDaLista,
  CARGA,
  pessoaDoContato,
} from "../contatoWhatsappTela";
import {
  normalizarE164 as normalizarNoServidor,
  formatarTelefone as formatarNoServidor,
} from "../../../../../../../api/src/application/whatsapp/telefone.js";
import { CANAL_PADRAO } from "../../../../../../../api/src/application/whatsapp/ContatoWhatsappService.js";

const CASOS = [
  "(21) 99999-8888",
  "21999998888",
  "2133334444",
  "5521999998888",
  "+55 21 99999-8888",
  "+1 415 555 2671",
  "14155552671", // 11 dígitos SEM `+`: é lido como celular brasileiro sem DDI
  "999",
  "",
  null,
  "abc",
  "+55219999988889999",
];

describe("⚠ o amarre com o servidor — a MESMA leitura de telefone", () => {
  it("normalizarE164 dá o mesmo veredito que a api em todos os casos", () => {
    for (const caso of CASOS) expect(normalizarE164(caso)).toBe(normalizarNoServidor(caso));
  });
  it("formatarTelefone idem", () => {
    for (const e164 of ["5521999998888", "552133334444", "14155552671", "", null]) {
      expect(formatarTelefone(e164)).toBe(formatarNoServidor(e164));
    }
  });
  it("as opções de canal são exatamente as que o servidor aceita no PATCH /canal-envio", () => {
    expect(CANAIS_DE_ENVIO.map((c) => c.valor)).toEqual([...CANAL_PADRAO]);
  });
});

describe("normalizarE164 — os casos que decidem o cadastro", () => {
  it("o `+` é o único desambiguador de DDI", () => {
    expect(normalizarE164("+1 415 555 2671")).toBe("14155552671");
    expect(normalizarE164("14155552671")).toBe("5514155552671");
  });
  it("fixo com 8 dígitos passa; lixo não", () => {
    expect(normalizarE164("(21) 3333-4444")).toBe("552133334444");
    expect(normalizarE164("999")).toBeNull();
    expect(normalizarE164("")).toBeNull();
  });
});

describe("pareceFormatoAntigo — AVISO, nunca correção", () => {
  it("8 dígitos com prefixo de celular (6–9): parece o formato antigo", () => {
    expect(pareceFormatoAntigo("552199998888")).toBe(true);
  });
  it("fixo (2–5) com 8 dígitos NÃO acende", () => {
    expect(pareceFormatoAntigo("552133334444")).toBe(false);
  });
  it("9 dígitos nunca acende; estrangeiro nunca acende", () => {
    expect(pareceFormatoAntigo("5521999998888")).toBe(false);
    expect(pareceFormatoAntigo("14155552671")).toBe(false);
  });
});

describe("a situação do contato e da empresa", () => {
  it("com opt-in recebe; sem opt-in não; inativo é inativo mesmo com opt-in", () => {
    expect(situacaoDoContato({ optInEm: "2026-09-01", ativo: true })).toBe(SITUACAO_CONTATO.RECEBE);
    expect(situacaoDoContato({ optInEm: null, ativo: true })).toBe(SITUACAO_CONTATO.SEM_OPT_IN);
    expect(situacaoDoContato({ optInEm: "2026-09-01", ativo: false })).toBe(SITUACAO_CONTATO.INATIVO);
  });
  it("a empresa: sem contato · sem opt-in · ok — espelho do `situacao` da carteira", () => {
    expect(situacaoDaEmpresa([])).toBe("sem_contato");
    expect(situacaoDaEmpresa([{ optInEm: null, ativo: true }])).toBe("sem_optin");
    expect(situacaoDaEmpresa([{ optInEm: "2026-09-01", ativo: false }])).toBe("sem_optin");
    expect(situacaoDaEmpresa([{ optInEm: null }, { optInEm: "2026-09-01", ativo: true }])).toBe("ok");
  });
  it("rotuloDoCanal cai em E-mail para valor desconhecido/ausente", () => {
    expect(rotuloDoCanal("WHATSAPP")).toBe("WhatsApp");
    expect(rotuloDoCanal("perguntar")).toBe("Perguntar a cada envio");
    expect(rotuloDoCanal(null)).toBe("E-mail");
  });
});

describe("validarFormulario e montarPayload", () => {
  it("nome vazio e telefone inválido são DOIS erros, nomeados", () => {
    const r = validarFormulario({ nome: " ", telefone: "12" });
    expect(r.ok).toBe(false);
    expect(r.erros.nome).toMatch(/nome/i);
    expect(r.erros.telefone).toMatch(/inválido/i);
  });
  it("válido devolve o E.164 que o servidor vai gravar", () => {
    const r = validarFormulario({ nome: "Maria", telefone: "(21) 99999-8888" });
    expect(r).toEqual({ ok: true, erros: {}, telefoneE164: "5521999998888" });
  });
  it("⚠ opt-in marcado grava a ORIGEM; desmarcado não manda origem nenhuma", () => {
    const com = montarPayload({ nome: "Maria", telefone: "21999998888", optIn: true });
    expect(com.optIn).toBe(true);
    expect(com.optInOrigem).toBe("cadastro_pelo_escritorio");
    const sem = montarPayload({ nome: "Maria", telefone: "21999998888", optIn: false });
    expect(sem.optIn).toBe(false);
    expect(sem).not.toHaveProperty("optInOrigem");
  });
  it("⚠ userId: '' vira null (apagar), ausente não viaja (não mexer), valor viaja como string", () => {
    expect(montarPayload({ nome: "M", telefone: "21999998888", userId: "" }).userId).toBeNull();
    expect(montarPayload({ nome: "M", telefone: "21999998888" })).not.toHaveProperty("userId");
    expect(montarPayload({ nome: "M", telefone: "21999998888", userId: "u1" }).userId).toBe("u1");
  });
  it("`id` só viaja quando é edição", () => {
    expect(montarPayload({ nome: "M", telefone: "21999998888" })).not.toHaveProperty("id");
    expect(montarPayload({ id: "c1", nome: "M", telefone: "21999998888" }).id).toBe("c1");
  });
});

describe("a confirmação de remoção REPETE nome e telefone", () => {
  it("nome e telefone formatado aparecem; 'tem certeza' não basta", () => {
    const f = fraseDeConfirmacaoRemocao({ nome: "Maria Silva", telefoneE164: "5521999998888" });
    expect(f).toMatch(/Maria Silva/);
    expect(f).toMatch(/\+55 \(21\) 99999-8888/);
    expect(f).toMatch(/histórico de conversas não é apagado/);
  });
  it("ausências são ditas, não escondidas", () => {
    const f = fraseDeConfirmacaoRemocao({});
    expect(f).toMatch(/\(sem nome\)/);
    expect(f).toMatch(/\(sem telefone\)/);
  });
});

describe("estadoDaLista — vazio ≠ falhou ≠ carregando", () => {
  it("os quatro estados", () => {
    expect(estadoDaLista({ carregando: true }).estado).toBe(CARGA.CARREGANDO);
    expect(estadoDaLista({ erro: { mensagem: "403" } }).estado).toBe(CARGA.FALHOU);
    expect(estadoDaLista({}).estado).toBe(CARGA.VAZIA);
    expect(estadoDaLista({ quantidade: 2 }).estado).toBe(CARGA.OK);
  });
  it("⚠ erro com lista já carregada NÃO derruba a lista para 'falhou'", () => {
    expect(estadoDaLista({ erro: { mensagem: "x" }, quantidade: 2 }).estado).toBe(CARGA.OK);
  });
});

describe("pessoaDoContato — quem é, nunca adivinhado", () => {
  const usuarios = [{ userId: "u1", nome: "Maria", email: "m@x.com" }];
  it("sem userId é null; com userId acha na lista; userId fora da lista vem SEM nome, não inventado", () => {
    expect(pessoaDoContato({ userId: null }, usuarios)).toBeNull();
    expect(pessoaDoContato({ userId: "u1" }, usuarios).nome).toBe("Maria");
    expect(pessoaDoContato({ userId: "u9" }, usuarios)).toEqual({ userId: "u9", nome: null, email: null });
  });
});
