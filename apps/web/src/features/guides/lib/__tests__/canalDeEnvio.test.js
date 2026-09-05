// Por onde a guia sai — a regra da tela, e o AMARRE com o vocabulário do servidor.

import {
  CANAL,
  decidirCanaisAoLiberar,
  resumirDesfechoDosCanais,
  ofertaDeRetentativa,
  ROTULO_MOTIVO,
  rotuloDoMotivo,
  agruparPrevia,
  conferenciaDaPrevia,
  podeAbrirLoteWhatsapp,
  perguntaDeReenvio,
} from "../canalDeEnvio";
import { MOTIVOS } from "../../../../../../api/src/application/whatsapp/elegibilidadeEnvioGuia.js";
import { CANAL_PADRAO } from "../../../../../../api/src/application/whatsapp/ContatoWhatsappService.js";

describe("⚠ o amarre", () => {
  it("todo MOTIVO da elegibilidade tem rótulo na tela — motivo novo no servidor cai aqui", () => {
    for (const m of Object.values(MOTIVOS)) expect(ROTULO_MOTIVO[m]).toBeTruthy();
  });
  it("os três canais são os três do servidor", () => {
    expect(Object.values(CANAL).sort()).toEqual([...CANAL_PADRAO].sort());
  });
});

describe("decidirCanaisAoLiberar — o e-mail nunca muda; o WhatsApp é o terceiro passo", () => {
  it("EMAIL: só e-mail; WHATSAPP: também WhatsApp; PERGUNTAR: pergunta; ausente cai em EMAIL", () => {
    expect(decidirCanaisAoLiberar({ canalPadraoEnvio: "EMAIL" })).toEqual({ email: true, whatsapp: false, perguntar: false });
    expect(decidirCanaisAoLiberar({ canalPadraoEnvio: "whatsapp" })).toEqual({ email: true, whatsapp: true, perguntar: false });
    expect(decidirCanaisAoLiberar({ canalPadraoEnvio: "PERGUNTAR" })).toEqual({ email: true, whatsapp: false, perguntar: true });
    expect(decidirCanaisAoLiberar({})).toEqual({ email: true, whatsapp: false, perguntar: false });
  });
});

describe("resumirDesfechoDosCanais — verde só quando tudo que se tentou saiu", () => {
  it("e-mail ok, WhatsApp não tentado → ok", () => {
    expect(resumirDesfechoDosCanais({ email: { feito: true } })).toEqual({ tom: "ok", texto: "Guia liberada ao cliente: e-mail enviado." });
  });
  it("e-mail ok + WhatsApp ok → ok, os dois nomeados", () => {
    const r = resumirDesfechoDosCanais({ email: { feito: true }, whatsapp: { tentado: true, ok: true } });
    expect(r.tom).toBe("ok");
    expect(r.texto).toMatch(/e-mail enviado · WhatsApp enviado/);
  });
  it("⚠ e-mail ok + WhatsApp falhou → ERRO, com o motivo do WhatsApp", () => {
    const r = resumirDesfechoDosCanais({ email: { feito: true }, whatsapp: { tentado: true, ok: false, message: "contato sem opt-in" } });
    expect(r.tom).toBe("erro");
    expect(r.texto).toMatch(/WhatsApp não saiu \(contato sem opt-in\)/);
  });
  it("e-mail falhou → ERRO com a mensagem do servidor, mesmo com WhatsApp ok", () => {
    const r = resumirDesfechoDosCanais({ email: { feito: false, message: "o e-mail NÃO foi enviado: lock" }, whatsapp: { tentado: true, ok: true } });
    expect(r.tom).toBe("erro");
    expect(r.texto).toMatch(/o e-mail NÃO foi enviado: lock/);
  });
});

describe("ofertaDeRetentativa — três respostas, três desenhos", () => {
  it("true: habilitado, 'reenviar é o caminho'", () => {
    const o = ofertaDeRetentativa({ envioPodeTentarDeNovo: true });
    expect(o.habilitado).toBe(true);
    expect(o.frase).toMatch(/passageiro/);
  });
  it("false: DESABILITADO com o conserto em outro lugar", () => {
    const o = ofertaDeRetentativa({ envioPodeTentarDeNovo: false });
    expect(o.habilitado).toBe(false);
    expect(o.frase).toMatch(/Reenviar igual falha igual/);
  });
  it("⚠ null NÃO vira false: habilitado, e a frase diz que a decisão é do contador", () => {
    for (const v of [null, undefined]) {
      const o = ofertaDeRetentativa({ envioPodeTentarDeNovo: v });
      expect(o.habilitado).toBe(true);
      expect(o.frase).toMatch(/A Meta não diz/);
      expect(o.frase).toMatch(/confira antes/);
    }
  });
});

describe("agruparPrevia e conferenciaDaPrevia", () => {
  const previa = {
    competencia: "2026-08",
    canal: { disponivel: true },
    resumo: { total: 4, porWhatsapp: 2, porEmail: 2, jaEnviadas: 1 },
    linhas: [
      { guideId: "g1", empresa: "A", canalSugerido: "WHATSAPP", motivo: null },
      { guideId: "g2", empresa: "B", canalSugerido: "WHATSAPP", motivo: null },
      { guideId: "g3", empresa: "C", canalSugerido: "EMAIL", motivo: "SEM_OPT_IN" },
      { guideId: "g4", empresa: "D", canalSugerido: "EMAIL", motivo: "SEM_CONTATO" },
    ],
  };
  it("separa quem vai por WhatsApp de quem cai para e-mail, POR MOTIVO, com rótulo", () => {
    const g = agruparPrevia(previa);
    expect(g.porWhatsapp.map((l) => l.guideId)).toEqual(["g1", "g2"]);
    expect(g.caemParaEmail.map((x) => [x.rotulo, x.linhas.length])).toEqual([["contato sem opt-in", 1], ["sem contato de WhatsApp cadastrado", 1]]);
  });
  it("⚠ o resumo sai INTACTO — é ele que a confirmação repete", () => {
    expect(agruparPrevia(previa).resumo).toBe(previa.resumo);
    expect(conferenciaDaPrevia(previa)).toEqual({ total: 4, porWhatsapp: 2, porEmail: 2 });
  });
  it("prévia vazia/ausente não lança", () => {
    expect(agruparPrevia(null).porWhatsapp).toEqual([]);
    expect(conferenciaDaPrevia(null)).toEqual({ total: 0, porWhatsapp: 0, porEmail: 0 });
    expect(rotuloDoMotivo(undefined)).toBe("motivo não informado");
  });
});

describe("podeAbrirLoteWhatsapp — o botão desabilita com o motivo, nunca some", () => {
  it("'Todas pendentes' (competência vazia) recusa nomeando", () => {
    const r = podeAbrirLoteWhatsapp({ competencia: "", selecionadas: 3 });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/UMA competência/);
  });
  it("sem seleção recusa; canal indisponível recusa com a mensagem do servidor", () => {
    expect(podeAbrirLoteWhatsapp({ competencia: "2026-08", selecionadas: 0 }).motivo).toMatch(/Selecione/);
    const r = podeAbrirLoteWhatsapp({ competencia: "2026-08", selecionadas: 2, canal: { disponivel: false, motivo: "TEMPLATE_NAO_APROVADO", mensagem: "ainda não aprovado" } });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe("ainda não aprovado");
  });
  it("competência + seleção + canal disponível: pode", () => {
    expect(podeAbrirLoteWhatsapp({ competencia: "2026-08", selecionadas: 2, canal: { disponivel: true } })).toEqual({ pode: true, motivo: null });
  });
});

// ── O REENVIO (05/09/2026) ──────────────────────────────────────────────────────────────────────
describe("perguntaDeReenvio — a tela AVISA que já foi, e o contador decide", () => {
  it("carrega o motivo do servidor e termina perguntando", () => {
    const f = perguntaDeReenvio("Esta guia já foi enviada ao cliente por WhatsApp.");
    expect(f).toMatch(/já foi enviada ao cliente por WhatsApp/);
    expect(f).toMatch(/Enviar de novo mesmo assim\?/);
  });
  it("⚠ sem motivo do servidor NÃO inventa história — diz o mínimo verdadeiro", () => {
    expect(perguntaDeReenvio(null)).toMatch(/já foi enviada ao cliente/);
    expect(perguntaDeReenvio("")).toMatch(/Enviar de novo mesmo assim\?/);
  });
});
