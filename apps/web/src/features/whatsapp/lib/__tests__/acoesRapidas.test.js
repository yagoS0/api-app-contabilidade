// AS AÇÕES RÁPIDAS — a regra, pura.
//
// ⚠⚠ O ponto inteiro deste arquivo: as três NÃO têm a mesma guarda. Guia é template (funciona fora
// da janela de 24h), documento é mensagem de serviço (só dentro), e virar anotação nem fala com a
// Meta. Uma guarda só para as três seria falsa nos dois sentidos — bloquearia a guia que pode sair
// e liberaria o documento que a Meta recusa.

import { ACAO, MOTIVO, acoesDisponiveis, rascunhoDeAnotacao } from "../acoesRapidas";

const fio = { id: "cv1", portalClientId: "pc-1" };
const ABERTA = { situacao: "ABERTA" };
const EXPIRADA = { situacao: "EXPIRADA" };

const por = (lista, acao) => lista.find((a) => a.acao === acao);

describe("dentro da janela, com empresa", () => {
  const r = acoesDisponiveis({ conversa: fio, janela: ABERTA, canalLigado: true, temDestinoDeAnotacao: true });

  it("as três aparecem e as três podem", () => {
    expect(r.map((a) => a.acao)).toEqual([ACAO.ENVIAR_GUIA, ACAO.ENVIAR_DOCUMENTO, ACAO.VIRAR_ANOTACAO]);
    expect(r.every((a) => a.pode)).toBe(true);
    expect(r.every((a) => a.frase === null)).toBe(true);
  });
});

describe("⚠⚠ FORA da janela — e é aqui que as duas se separam", () => {
  const r = acoesDisponiveis({ conversa: fio, janela: EXPIRADA, canalLigado: true, temDestinoDeAnotacao: true });

  it("a GUIA continua podendo: ela é template aprovado, e template é o que funciona fora da janela", () => {
    expect(por(r, ACAO.ENVIAR_GUIA).pode).toBe(true);
  });

  it("⚠⚠ o DOCUMENTO não: é mensagem de serviço, e a Meta recusa (131047)", () => {
    const d = por(r, ACAO.ENVIAR_DOCUMENTO);
    expect(d.pode).toBe(false);
    expect(d.motivo).toBe(MOTIVO.FORA_DA_JANELA);
    expect(d.frase).toMatch(/documento não é modelo/);
  });

  it("⚠ virar anotação não fala com a Meta — a janela não a alcança", () => {
    expect(por(r, ACAO.VIRAR_ANOTACAO).pode).toBe(true);
  });
});

describe("⚠⚠ janela DESCONHECIDA não vira aberta — nem expirada", () => {
  it("sem o estado da janela, o documento é bloqueado dizendo que não se sabe", () => {
    const r = acoesDisponiveis({ conversa: fio, janela: null, canalLigado: true });
    const d = por(r, ACAO.ENVIAR_DOCUMENTO);
    expect(d.pode).toBe(false);
    expect(d.motivo).toBe(MOTIVO.JANELA_DESCONHECIDA);
    expect(d.frase).toMatch(/Não dá para afirmar/);
    // ⚠ E não é chamado de "expirada": afirmaria um estado que ninguém viu.
    expect(d.frase).not.toMatch(/Fora da janela/);
  });
});

describe("fio da fila (sem empresa)", () => {
  const r = acoesDisponiveis({ conversa: { id: "cv3", portalClientId: null }, janela: ABERTA, canalLigado: true, temDestinoDeAnotacao: true });

  it("⚠ guia e documento são da EMPRESA — sem vínculo não há o que mandar, e a frase diz o conserto", () => {
    expect(por(r, ACAO.ENVIAR_GUIA).motivo).toBe(MOTIVO.SEM_EMPRESA);
    expect(por(r, ACAO.ENVIAR_DOCUMENTO).motivo).toBe(MOTIVO.SEM_EMPRESA);
    expect(por(r, ACAO.ENVIAR_GUIA).frase).toMatch(/vincule o fio/i);
  });

  it("virar anotação continua podendo: ela é sobre a conversa, não sobre a empresa", () => {
    expect(por(r, ACAO.VIRAR_ANOTACAO).pode).toBe(true);
  });
});

describe("⚠ SEM DESTINO, virar anotação não é OFERECIDA — não é 'bloqueada'", () => {
  it("no /whatsapp não há campo de anotação ao lado, então a ação não existe", () => {
    const r = acoesDisponiveis({ conversa: fio, janela: ABERTA, canalLigado: true, temDestinoDeAnotacao: false });
    expect(por(r, ACAO.VIRAR_ANOTACAO)).toBeUndefined();
    expect(r).toHaveLength(2);
  });
});

describe("⚠ canal desligado no servidor", () => {
  it("bloqueia os dois envios, com o motivo do SERVIDOR — não 'falhou'", () => {
    const r = acoesDisponiveis({ conversa: fio, janela: ABERTA, canalLigado: false });
    expect(por(r, ACAO.ENVIAR_GUIA).motivo).toBe(MOTIVO.CANAL_DESLIGADO);
    expect(por(r, ACAO.ENVIAR_DOCUMENTO).motivo).toBe(MOTIVO.CANAL_DESLIGADO);
  });

  it("⚠ `null` é 'a tela não perguntou' e NÃO bloqueia — ausência não vira recusa", () => {
    const r = acoesDisponiveis({ conversa: fio, janela: ABERTA, canalLigado: null });
    expect(por(r, ACAO.ENVIAR_GUIA).pode).toBe(true);
  });
});

describe("⚠⚠ rascunhoDeAnotacao — texto para EDITAR, nunca anotação gravada", () => {
  const fmt = () => "05/09, 14:32";

  it("compõe quando, quem e o que foi dito — entre aspas", () => {
    const t = rascunhoDeAnotacao({ corpo: "quero parcelar o DAS" }, { pessoa: "Maria Silva", fmtDataHora: fmt });
    expect(t).toBe('05/09, 14:32 · Maria Silva no WhatsApp: "quero parcelar o DAS"');
  });

  it("⚠ sem nome, não se atribui a fala a ninguém", () => {
    expect(rascunhoDeAnotacao({ corpo: "oi" }, { fmtDataHora: fmt })).toBe('05/09, 14:32 · no WhatsApp: "oi"');
  });

  it("⚠ sem data, não se escreve uma data vazia", () => {
    expect(rascunhoDeAnotacao({ corpo: "oi" }, { pessoa: "Ana" })).toBe('Ana no WhatsApp: "oi"');
  });

  it("⚠ mensagem sem texto (a mídia que não abrimos) não vira rascunho nenhum", () => {
    expect(rascunhoDeAnotacao({ corpo: null, tipo: "image" }, { pessoa: "Ana" })).toBeNull();
    expect(rascunhoDeAnotacao(null)).toBeNull();
  });
});
