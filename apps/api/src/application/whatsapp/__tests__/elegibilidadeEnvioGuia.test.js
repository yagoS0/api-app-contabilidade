// POSSO MANDAR ESTA GUIA POR WHATSAPP? — a regra, exercida sem banco e sem rede.
//
// As três decisões de produto que este arquivo trava:
//   1. opt-in é exigência para MANDAR (e a empresa NÃO some do lote: cai para e-mail com o motivo);
//   2. template não aprovado na Meta RECUSA — é o estado real de hoje, e recusar dizendo o porquê
//      é o certo (`DECLARADO` não é aprovação);
//   3. flag OFF é recusa DECLARADA, não erro genérico.

import {
  APROVADO,
  CANAIS,
  MOTIVOS,
  avaliarCanal,
  avaliarLinha,
} from "../elegibilidadeEnvioGuia.js";

const templateAprovado = Object.freeze({
  chave: "guia_disponivel",
  nomeMeta: "guia_disponivel",
  statusAprovacao: APROVADO,
  temDocumento: true,
});
const canalOk = avaliarCanal({ integracaoLigada: true, template: templateAprovado });
const guiaProcessada = Object.freeze({ id: "g1", status: "PROCESSED" });
const comContato = Object.freeze({
  contato: { id: "c1", nome: "Maria Silva", telefoneE164: "5521999998888", optInEm: new Date() },
  motivo: null,
});

describe("o canal — uma resposta por lote", () => {
  it("flag OFF: recusa DECLARADA, com o nome da variável e o caminho alternativo", () => {
    const r = avaliarCanal({ integracaoLigada: false, template: templateAprovado });
    expect(r.disponivel).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.INTEGRACAO_DESLIGADA);
    expect(r.mensagem).toMatch(/INTEGRACAO_WHATSAPP/);
    expect(r.mensagem).toMatch(/e-mail/i);
  });

  it("⚠ template DECLARADO (o estado real de hoje) RECUSA — e diz a situação", () => {
    // Nenhum template foi submetido à Meta: `statusAprovacao` nasce `DECLARADO` para as cinco
    // chaves. Tratar isso como aprovado seria inventar aprovação.
    const r = avaliarCanal({ integracaoLigada: true, template: { ...templateAprovado, statusAprovacao: "DECLARADO" } });
    expect(r.disponivel).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.TEMPLATE_NAO_APROVADO);
    expect(r.mensagem).toMatch(/DECLARADO/);
  });

  it("EM_ANALISE e REJEITADO também recusam — só APROVADO passa", () => {
    for (const status of ["EM_ANALISE", "REJEITADO", "", "aprovado_quase"]) {
      expect(avaliarCanal({ integracaoLigada: true, template: { ...templateAprovado, statusAprovacao: status } }).disponivel)
        .toBe(false);
    }
    expect(avaliarCanal({ integracaoLigada: true, template: templateAprovado }).disponivel).toBe(true);
  });

  it("REJEITADO carrega o motivo da Meta junto, quando há", () => {
    const r = avaliarCanal({
      integracaoLigada: true,
      template: { ...templateAprovado, statusAprovacao: "REJEITADO", motivoRejeicao: "conteúdo promocional" },
    });
    expect(r.mensagem).toMatch(/conteúdo promocional/);
  });

  it("template inexistente não vira 'não aprovado': é OUTRA falta, com outro conserto", () => {
    const r = avaliarCanal({ integracaoLigada: true, template: null });
    expect(r.motivo).toBe(MOTIVOS.TEMPLATE_NAO_CADASTRADO);
  });

  it("aprovado SEM header de documento recusa — sem ele o PDF da guia não vai", () => {
    const r = avaliarCanal({ integracaoLigada: true, template: { ...templateAprovado, temDocumento: false } });
    expect(r.motivo).toBe(MOTIVOS.TEMPLATE_SEM_DOCUMENTO);
  });

  it("⚠ aprovado sem `nomeMeta` recusa — a chave interna NÃO vira nome na Meta", () => {
    // Usar `guia_disponivel` como nome aprovado seria supor que a Meta aprovou com o nome que nós
    // escolhemos. O nome exato só existe depois da aprovação.
    const r = avaliarCanal({ integracaoLigada: true, template: { ...templateAprovado, nomeMeta: null } });
    expect(r.motivo).toBe(MOTIVOS.TEMPLATE_SEM_NOME_META);
  });

  it("aprovado e completo devolve o nome que vai para a Meta", () => {
    const r = avaliarCanal({ integracaoLigada: true, template: { ...templateAprovado, nomeMeta: "guia_disponivel_v2" } });
    expect(r).toMatchObject({ disponivel: true, nomeMeta: "guia_disponivel_v2" });
  });
});

describe("a linha — uma resposta por guia", () => {
  it("tudo certo: vai por WhatsApp, com o contato junto", () => {
    const r = avaliarLinha({ canal: canalOk, guide: guiaProcessada, destinatario: comContato, envios: [] });
    expect(r.pode).toBe(true);
    expect(r.canalSugerido).toBe(CANAIS.WHATSAPP);
    expect(r.contato.telefoneE164).toBe("5521999998888");
  });

  it("⚠ SEM OPT-IN: recusa, mas a empresa NÃO some — cai para e-mail com o motivo", () => {
    // "Nunca somem silenciosamente" é o princípio do plano. Uma recusa que apaga a linha faria o
    // contador entregar 19 guias achando que entregou 23.
    const r = avaliarLinha({
      canal: canalOk,
      guide: guiaProcessada,
      destinatario: { contato: null, motivo: "contato sem opt-in registrado" },
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.SEM_OPT_IN);
    expect(r.canalSugerido).toBe(CANAIS.EMAIL);
    expect(r.mensagem).toMatch(/consentimento/i);
  });

  it("SEM CONTATO é motivo DIFERENTE de sem opt-in — os consertos são outros", () => {
    const r = avaliarLinha({
      canal: canalOk,
      guide: guiaProcessada,
      destinatario: { contato: null, motivo: "sem contato de WhatsApp cadastrado" },
    });
    expect(r.motivo).toBe(MOTIVOS.SEM_CONTATO);
    expect(r.canalSugerido).toBe(CANAIS.EMAIL);
  });

  it("canal indisponível: a linha herda o motivo GLOBAL e cai para e-mail", () => {
    const canalOff = avaliarCanal({ integracaoLigada: false, template: templateAprovado });
    const r = avaliarLinha({ canal: canalOff, guide: guiaProcessada, destinatario: comContato });
    expect(r.motivo).toBe(MOTIVOS.INTEGRACAO_DESLIGADA);
    expect(r.canalSugerido).toBe(CANAIS.EMAIL);
  });

  it("⚠ guia JÁ ENVIADA não é redisparada — e não cai para e-mail", () => {
    // Não há canal de queda para trabalho já feito: mandar por outro canal entregaria a mesma guia
    // duas vezes ao cliente.
    const r = avaliarLinha({
      canal: canalOk,
      guide: guiaProcessada,
      destinatario: comContato,
      envios: [{ canal: "EMAIL", status: "enviado" }],
      jaEnviada: true,
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.GUIA_JA_ENVIADA);
    expect(r.canalSugerido).toBeNull();
    expect(r.canalDoEnvioAnterior).toBe("EMAIL");
  });

  it("guia que FALHOU não conta como enviada — ela volta a ser oferecida", () => {
    // É a razão de o dono ter recusado a UNIQUE do esqueleto: reenviar o que falhou tem de caber.
    const r = avaliarLinha({
      canal: canalOk,
      guide: guiaProcessada,
      destinatario: comContato,
      envios: [{ canal: "WHATSAPP", status: "falhou" }],
      jaEnviada: false,
    });
    expect(r.pode).toBe(true);
  });

  it("guia VAZIO/ERROR não tem PDF: recusa própria, sem queda para e-mail", () => {
    for (const status of ["VAZIO", "ERROR", "NEEDS_REVIEW"]) {
      const r = avaliarLinha({ canal: canalOk, guide: { id: "g", status }, destinatario: comContato });
      expect(r.motivo).toBe(MOTIVOS.GUIA_NAO_PROCESSADA);
      expect(r.canalSugerido).toBeNull();
    }
  });

  it("a ordem das recusas: já enviada vence tudo, inclusive canal desligado", () => {
    const canalOff = avaliarCanal({ integracaoLigada: false, template: null });
    const r = avaliarLinha({ canal: canalOff, guide: guiaProcessada, destinatario: comContato, jaEnviada: true });
    expect(r.motivo).toBe(MOTIVOS.GUIA_JA_ENVIADA);
  });
});
