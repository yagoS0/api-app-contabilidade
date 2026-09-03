// O TEMPLATE APROVADO — a conferência do corpo ANTES de registrar `APROVADO` no banco.
//
// O que este arquivo trava:
//   1. a prova MECÂNICA (quantidade, numeração contígua, sem nomeada, sem repetição) recusa com
//      motivo próprio — e o motivo diz que é o CÓDIGO que muda, não o template;
//   2. a prova HUMANA (a ordem: {{1}}=nome … {{5}}=vencimento) é exigida SEMPRE, mesmo com o corpo
//      mecanicamente perfeito — o código não tem como ler o significado de um `{{n}}`;
//   3. a ordem das cinco variáveis é a MESMA de `variaveisDaGuia` — duas listas divergiriam na
//      primeira correção, e a Meta aceitaria a mensagem errada em silêncio.

import {
  VARIAVEIS_GUIA,
  MOTIVOS,
  FORMA_NOME_META,
  lerVariaveisDoCorpo,
  conferirCorpoAprovado,
  decidirRegistroDeAprovacao,
} from "../templateAprovado.js";
import { variaveisDaGuia } from "../WhatsappCloudClient.js";

const CORPO_OK =
  "Olá {{1}}, a guia de {{2}} da competência {{3}} está disponível: R$ {{4}}, vencimento em {{5}}. O PDF segue anexo.";

const templateGuia = Object.freeze({
  chave: "guia_disponivel",
  nomeMeta: null,
  temDocumento: true,
  statusAprovacao: "DECLARADO",
});

describe("⚠ a ordem das variáveis é UMA só — a da lista e a do cliente HTTP", () => {
  it("VARIAVEIS_GUIA tem cinco nomes, e `variaveisDaGuia` os envia nessa ordem", () => {
    expect(VARIAVEIS_GUIA).toEqual(["nomeContato", "tipoGuia", "competencia", "valorFormatado", "vencimentoFormatado"]);
    const entrada = Object.fromEntries(VARIAVEIS_GUIA.map((v, i) => [v, `v${i + 1}`]));
    // `variaveisDaGuia` recebe o objeto por NOME e devolve o array POSICIONAL: se a ordem lá mudar
    // sem mudar aqui, este teste cai — e é isso que amarra as duas listas.
    expect(variaveisDaGuia(entrada)).toEqual(["v1", "v2", "v3", "v4", "v5"]);
  });
});

describe("lerVariaveisDoCorpo", () => {
  it("lê posicionais NA ORDEM DE APARIÇÃO e separa as nomeadas", () => {
    expect(lerVariaveisDoCorpo("a {{2}} b {{ 1 }} c {{nome}} d")).toEqual({ posicionais: [2, 1], nomeadas: ["nome"] });
  });
  it("corpo sem variável devolve listas vazias — nunca lança", () => {
    expect(lerVariaveisDoCorpo("")).toEqual({ posicionais: [], nomeadas: [] });
    expect(lerVariaveisDoCorpo(null)).toEqual({ posicionais: [], nomeadas: [] });
  });
});

describe("conferirCorpoAprovado — a prova mecânica", () => {
  it("cinco posicionais, {{1}} a {{5}}, sem repetição: OK", () => {
    const r = conferirCorpoAprovado(CORPO_OK);
    expect(r.ok).toBe(true);
    expect(r.posicionais).toEqual([1, 2, 3, 4, 5]);
    expect(r.esperadas).toBe(5);
  });

  it("a ordem de APARIÇÃO no texto não importa — a Meta casa por índice", () => {
    expect(conferirCorpoAprovado("{{5}} {{4}} {{3}} {{2}} {{1}}").ok).toBe(true);
  });

  it("corpo vazio", () => {
    expect(conferirCorpoAprovado("   ").motivo).toBe(MOTIVOS.CORPO_VAZIO);
  });

  it("⚠ QUATRO variáveis recusa e diz que é o CÓDIGO que muda", () => {
    const r = conferirCorpoAprovado("Olá {{1}}, guia {{2}} de {{3}}: R$ {{4}}.");
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.QUANTIDADE_DIVERGE);
    expect(r.mensagem).toMatch(/132000/);
    expect(r.mensagem).toMatch(/CÓDIGO que muda/);
    expect(r.mensagem).not.toMatch(/mude o template/i);
  });

  it("seis variáveis também recusa", () => {
    expect(conferirCorpoAprovado(`${CORPO_OK} {{6}}`).motivo).toBe(MOTIVOS.QUANTIDADE_DIVERGE);
  });

  it("numeração com buraco ({{1}},{{2}},{{3}},{{4}},{{6}}) recusa mesmo com cinco", () => {
    const r = conferirCorpoAprovado("{{1}} {{2}} {{3}} {{4}} {{6}}");
    expect(r.motivo).toBe(MOTIVOS.NUMERACAO_COM_BURACO);
    expect(r.mensagem).toMatch(/\{\{6\}\}/);
  });

  it("variável repetida recusa", () => {
    expect(conferirCorpoAprovado("{{1}} {{2}} {{3}} {{4}} {{4}}").motivo).toBe(MOTIVOS.VARIAVEL_REPETIDA);
  });

  it("variável NOMEADA recusa — o código envia posicional", () => {
    const r = conferirCorpoAprovado("Olá {{nome}}, {{2}} {{3}} {{4}} {{5}}");
    expect(r.motivo).toBe(MOTIVOS.VARIAVEL_NOMEADA);
    expect(r.nomeadas).toEqual(["nome"]);
  });

  it("sem nenhuma variável recusa nomeando", () => {
    expect(conferirCorpoAprovado("Sua guia está disponível.").motivo).toBe(MOTIVOS.SEM_VARIAVEIS);
  });
});

describe("decidirRegistroDeAprovacao — a decisão que o script executa", () => {
  const agora = new Date("2026-09-02T15:00:00Z");

  it("chave inexistente", () => {
    const r = decidirRegistroDeAprovacao({ template: null, nomeMeta: "guia_disponivel", conferidoPorPessoa: true });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.TEMPLATE_INEXISTENTE);
  });

  it("nome da Meta ausente ou fora da forma", () => {
    expect(decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: "", conferidoPorPessoa: true }).motivo)
      .toBe(MOTIVOS.NOME_META_AUSENTE);
    for (const ruim of ["Guia Disponivel", "guia-disponivel", "guia_disponível"]) {
      expect(decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: ruim, conferidoPorPessoa: true }).motivo)
        .toBe(MOTIVOS.NOME_META_FORA_DA_FORMA);
    }
    expect(FORMA_NOME_META.test("guia_disponivel_v2")).toBe(true);
  });

  it("guia_disponivel sem header de documento recusa — o envio É o PDF", () => {
    const r = decidirRegistroDeAprovacao({ template: { ...templateGuia, temDocumento: false }, nomeMeta: "guia_disponivel", conferidoPorPessoa: true });
    expect(r.motivo).toBe(MOTIVOS.SEM_DOCUMENTO_NO_TEMPLATE_DE_GUIA);
  });

  it("corpo que não confere recusa ANTES de olhar a confirmação humana", () => {
    const r = decidirRegistroDeAprovacao({
      template: templateGuia, nomeMeta: "guia_disponivel", corpoAprovado: "{{1}} {{2}} {{3}} {{4}}", conferidoPorPessoa: true,
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.CORPO_NAO_CONFERE);
    expect(r.conferencia.motivo).toBe(MOTIVOS.QUANTIDADE_DIVERGE);
    expect(r.dados).toBeNull();
  });

  it("⚠⚠ corpo mecanicamente perfeito SEM a confirmação humana NÃO registra", () => {
    // O código prova quantidade e numeração; o SIGNIFICADO de cada {{n}} só uma pessoa lê.
    const r = decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: "guia_disponivel", corpoAprovado: CORPO_OK, conferidoPorPessoa: false });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.NAO_CONFERIDO_POR_PESSOA);
    expect(r.mensagem).toMatch(/\{\{1\}\}=nomeContato/);
    expect(r.mensagem).toMatch(/\{\{5\}\}=vencimentoFormatado/);
    expect(r.dados).toBeNull();
  });

  it("corpo OK + confirmação humana: registra APROVADO, com nome, data e sem motivo de rejeição", () => {
    const r = decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: "guia_disponivel", corpoAprovado: CORPO_OK, conferidoPorPessoa: true, agora });
    expect(r.ok).toBe(true);
    expect(r.dados).toEqual({
      nomeMeta: "guia_disponivel",
      statusAprovacao: "APROVADO",
      motivoRejeicao: null,
      conferidoNaMetaEm: agora,
    });
    expect(r.avisos).toEqual([]);
  });

  it("sem o corpo, registra só com a confirmação humana — e AVISA que a prova mecânica não rodou", () => {
    const r = decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: "guia_disponivel", conferidoPorPessoa: true, agora });
    expect(r.ok).toBe(true);
    expect(r.conferencia).toBeNull();
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/NÃO foram conferidas pelo código/);
  });

  it("idioma só entra quando informado — ausente não mexe", () => {
    const sem = decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: "guia_disponivel", conferidoPorPessoa: true, agora });
    expect(sem.dados).not.toHaveProperty("idioma");
    const com = decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: "guia_disponivel", conferidoPorPessoa: true, idioma: "pt_BR", agora });
    expect(com.dados.idioma).toBe("pt_BR");
  });

  it("nome com espaços nas pontas é aparado, não recusado", () => {
    const r = decidirRegistroDeAprovacao({ template: templateGuia, nomeMeta: "  guia_disponivel  ", conferidoPorPessoa: true, agora });
    expect(r.dados.nomeMeta).toBe("guia_disponivel");
  });
});
