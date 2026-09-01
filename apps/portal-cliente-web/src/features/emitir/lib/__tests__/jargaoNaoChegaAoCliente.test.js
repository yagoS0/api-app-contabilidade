// ⚠⚠ O JARGÃO DO SERVIDOR NÃO CHEGA AO CLIENTE — achado em teste de usabilidade (31/08/2026).
//
// A tela renderiza `message`/`correcao` **cruas** do servidor, e as recusas da camada NOSSA são
// escritas para o CONTADOR: nomeiam campo de XML (`pTotTribSN`, `pTotTribFed`), citam o código da
// DPS (`opSimpNac=3`) e mandam a pessoa a uma tela que **só existe no portal do escritório**
// (*"Editar cadastro → Emissão de NFS-e"*). O cliente lia um caminho que não tem como percorrer.
//
// ⚠⚠ ISSO FURAVA UMA REGRA JÁ ESCRITA DESTE APP — `lib/mensagens.js` resolve por CÓDIGO e não lê
// `err.message`, *"de propósito: ela nunca devolve texto cru do servidor"*. O desfecho da emissão
// era a porta por onde o texto entrava assim mesmo.
//
// ⚠⚠ E O LIMITE É O QUE MAIS IMPORTA AQUI: a recusa da **RECEITA** continua CITADA, palavra por
// palavra. Ali a fonte oficial vence, e traduzi-la apagaria a única prova do que o sistema
// nacional respondeu.

import { TIPO, lerErroEmissao } from "../desfechoEmissao";

/** A forma EXATA do corpo que `nfseEmissaoHttp.js` devolve — copiada de lá, não inventada aqui. */
function recusa({ camada, codigo, message, correcao, status }) {
  return Object.assign(new Error("recusa"), {
    status,
    code: camada === "TRANSPORTE" ? "nfse_falha_transporte" : "nfse_falha_local",
    corpo: { camada, codigo, message, correcao },
  });
}

// As frases REAIS do `NfseService.js`, com o jargão que o cliente estava lendo.
const DO_SERVIDOR = {
  pTotTribSN: {
    codigo: "MISSING_P_TOT_TRIB_SN",
    message:
      "A alíquota efetiva do Simples Nacional (pTotTribSN) é exigida quando opSimpNac=3 e não foi informada.",
    correcao: "Informe o percentual total de tributos do Simples (pTotTribSN) no assistente de emissão.",
  },
  cargaTributaria: {
    codigo: "MISSING_TOT_TRIB_NAO_SIMPLES",
    message: "A carga tributária aproximada federal (pTotTribFed) não está configurada.",
    correcao:
      "Informe pTotTribFed no cadastro da empresa (Editar cadastro → Emissão de NFS-e → Carga tributária aproximada).",
  },
};

describe("⚠⚠ a recusa NOSSA é reescrita para quem lê esta tela", () => {
  it("o `pTotTribSN` vira frase de cliente — sem `pTotTribSN`, sem `opSimpNac`", () => {
    const lido = lerErroEmissao(recusa({ camada: "NOSSA", status: 400, ...DO_SERVIDOR.pTotTribSN }));
    expect(lido.tipo).toBe(TIPO.NOSSA);
    const tudo = `${lido.message} ${lido.correcao}`;
    expect(tudo).not.toMatch(/pTotTribSN|opSimpNac/);
    expect(lido.message).toMatch(/al[íi]quota efetiva do Simples/i);
  });

  it("⚠⚠ a carga tributária deixa de mandar o cliente a uma tela do CONTADOR", () => {
    // Era o pior dos dois: o caminho existe, mas no outro portal. Quem lê seguiria e não acharia.
    const lido = lerErroEmissao(recusa({ camada: "NOSSA", status: 400, ...DO_SERVIDOR.cargaTributaria }));
    const tudo = `${lido.message} ${lido.correcao}`;
    expect(tudo).not.toMatch(/pTotTribFed/);
    expect(tudo).not.toMatch(/Editar cadastro/i);
    // E diz quem resolve, que é o ponto de a frase existir.
    expect(tudo).toMatch(/contador/i);
  });

  it("⚠ o PAR inteiro é trocado, nunca só a mensagem", () => {
    // Trocar só a mensagem deixaria a correção do contador embaixo de um texto de cliente.
    const lido = lerErroEmissao(recusa({ camada: "NOSSA", status: 400, ...DO_SERVIDOR.cargaTributaria }));
    expect(lido.correcao).not.toBe(DO_SERVIDOR.cargaTributaria.correcao);
    expect(lido.message).not.toBe(DO_SERVIDOR.cargaTributaria.message);
  });

  it("⚠ código NOSSO sem frase própria passa como está — o mapa é de INCLUSÃO", () => {
    // Reescrever tudo exigiria uma frase para cada código do servidor, e a que faltasse sairia
    // vazia. O texto do servidor é o pior caso aceitável; frase inventada, não.
    const lido = lerErroEmissao(
      recusa({
        camada: "NOSSA",
        status: 400,
        codigo: "NFSE_ISS_RETIDO_SEM_ALIQUOTA",
        message: "A alíquota de ISS é exigida quando o imposto é retido.",
        correcao: "Informe a alíquota.",
      })
    );
    expect(lido.message).toBe("A alíquota de ISS é exigida quando o imposto é retido.");
  });
});

describe("⚠⚠ A RECUSA DA RECEITA É CITADA, NUNCA REESCRITA", () => {
  it("a frase do sistema nacional chega intacta, mesmo com o mesmo código", () => {
    // ⚠ Este é o caso que separa o conserto de um estrago: se a tradução valesse aqui, a única
    // evidência do que o sistema nacional respondeu seria substituída por um texto nosso.
    const doNacional = "E0221 — A alíquota efetiva (pTotTribSN) informada é inválida.";
    const lido = lerErroEmissao(
      recusa({
        camada: "RECEITA",
        status: 422,
        codigo: "MISSING_P_TOT_TRIB_SN",
        message: doNacional,
        correcao: "Corrija e emita de novo.",
      })
    );
    expect(lido.tipo).toBe(TIPO.RECEITA);
    expect(lido.message).toBe(doNacional);
    expect(lido.correcao).toBe("Corrija e emita de novo.");
  });
});
