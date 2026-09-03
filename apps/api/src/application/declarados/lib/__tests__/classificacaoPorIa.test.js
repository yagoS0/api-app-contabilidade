// ⚠⚠ A CLASSIFICAÇÃO POR IA — a regra PURA (02/09/2026).
//
// O que este arquivo protege são as QUATRO travas do cabeçalho de `classificacaoPorIa.js`:
// quem vai (só onde ninguém sabe), o que ela pode escolher (o plano da empresa), o que ela
// respondeu (conferido contra o plano), e que o que sai é PROPOSTA. Os testes que mais importam
// são os de RECUSA: conta inventada, sintética, ambígua e crédito que não é caixa/banco não podem
// virar proposta — e o motivo tem de sair nomeado.

import {
  FINALIDADE,
  LOTE_MAXIMO,
  MOTIVO_RECUSA,
  FRASE_DA_RECUSA,
  SYSTEM_ESTAVEL,
  catalogoDeContas,
  emLotes,
  exemplosDaMemoria,
  lerResposta,
  linhasParaIa,
  montarPedido,
} from "../classificacaoPorIa.js";
import { ESTADO } from "../../lib/estadosDeclarado.js";
import { PROCEDENCIA, SEM_SUGESTAO } from "../../lib/motorDeSugestao.js";

// Um plano pequeno com todos os casos: despesa analítica, despesa sintética, caixa, banco,
// fornecedores (passivo, não disponibilidade) e um par AMBÍGUO (dois reduzidos, um completo).
const PLANO = [
  { codigo: "403", codigoCompleto: "411020008", nome: "Serviços de terceiros", analitica: true },
  { codigo: "410", codigoCompleto: "411030012", nome: "Software e nuvem", analitica: true },
  { codigo: "400", codigoCompleto: "411000000", nome: "DESPESAS OPERACIONAIS", analitica: false },
  { codigo: "5", codigoCompleto: "111010001", nome: "CAIXA - MATRIZ", analitica: true },
  { codigo: "12", codigoCompleto: "111020001", nome: "BANCO ITAU", analitica: true },
  { codigo: "300", codigoCompleto: "211010001", nome: "Fornecedores", analitica: true },
  { codigo: "701", codigoCompleto: "411040001", nome: "Viagens", analitica: true },
  { codigo: "702", codigoCompleto: "411040001", nome: "Viagens (duplicada)", analitica: true },
];

const linha = (extra = {}) => ({
  id: "d-1",
  estado: ESTADO.AGUARDANDO_PAGAMENTO,
  descricaoOriginal: "GOOGLE CLOUD BRASIL",
  cnpjFornecedor: "06990590000123",
  valor: "890.00",
  valorAjustado: null,
  competencia: "2026-07",
  sugestao: null,
  ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ quem vai para a IA — só onde NINGUÉM sabe", () => {
  it("linha sem sugestão nenhuma (`null`) vai", () => {
    expect(linhasParaIa([linha({ sugestao: null })])).toHaveLength(1);
  });

  it("linha com `NADA_CONHECIDO` explícito vai", () => {
    const l = linha({ sugestao: { conta: null, motivo: SEM_SUGESTAO.NADA_CONHECIDO } });
    expect(linhasParaIa([l])).toHaveLength(1);
  });

  it("⚠⚠ linha com sugestão de REGRA fica de fora — regra > IA", () => {
    const l = linha({ sugestao: { conta: "411020008", procedencia: PROCEDENCIA.REGRA_CNPJ } });
    expect(linhasParaIa([l])).toEqual([]);
  });

  it("⚠⚠ linha com sugestão do HISTÓRICO fica de fora — o contador já disse", () => {
    const l = linha({ sugestao: { conta: "411030012", procedencia: PROCEDENCIA.HISTORICO } });
    expect(linhasParaIa([l])).toEqual([]);
  });

  it("⚠⚠ `DIVIDIDO` fica de FORA — duas regras brigando é conflito humano, não lacuna", () => {
    const l = linha({ sugestao: { conta: null, motivo: SEM_SUGESTAO.DIVIDIDO } });
    expect(linhasParaIa([l])).toEqual([]);
  });

  it("⚠⚠ `FORA_DA_FAIXA` fica de FORA — a regra casou e recusou por motivo", () => {
    const l = linha({ sugestao: { conta: null, motivo: SEM_SUGESTAO.FORA_DA_FAIXA, regraId: "r-1" } });
    expect(linhasParaIa([l])).toEqual([]);
  });

  it("os outros motivos nomeados (conta torta na regra) também ficam de fora", () => {
    for (const motivo of [SEM_SUGESTAO.CONTA_FORA_DO_PLANO, SEM_SUGESTAO.CONTA_AMBIGUA, SEM_SUGESTAO.CONTA_SINTETICA]) {
      expect(linhasParaIa([linha({ sugestao: { conta: null, motivo } })])).toEqual([]);
    }
  });

  it("só estados LANÇÁVEIS entram — contabilizado, recusado e fundido não têm conta a propor", () => {
    const itens = [
      linha({ id: "a", estado: ESTADO.AGUARDANDO_PAGAMENTO }),
      linha({ id: "b", estado: ESTADO.A_CONFERIR }),
      linha({ id: "c", estado: ESTADO.CONTABILIZADO }),
      linha({ id: "d", estado: ESTADO.RECUSADO }),
      linha({ id: "e", estado: ESTADO.FUNDIDO }),
    ];
    expect(linhasParaIa(itens).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("entrada torta não derruba", () => {
    expect(linhasParaIa(null)).toEqual([]);
    expect(linhasParaIa([null, undefined, 3])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("os lotes", () => {
  it("parte em lotes de LOTE_MAXIMO, na ordem", () => {
    const linhas = Array.from({ length: LOTE_MAXIMO * 2 + 3 }, (_, i) => linha({ id: `d-${i}` }));
    const lotes = emLotes(linhas);
    expect(lotes).toHaveLength(3);
    expect(lotes[0]).toHaveLength(LOTE_MAXIMO);
    expect(lotes[2]).toHaveLength(3);
    expect(lotes[0][0].id).toBe("d-0");
    expect(lotes[2][2].id).toBe(`d-${LOTE_MAXIMO * 2 + 2}`);
  });

  it("zero linhas ⇒ zero lotes (nenhuma chamada)", () => {
    expect(emLotes([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o catálogo — o que a IA pode escolher", () => {
  it("só conta ANALÍTICA entra no débito; a sintética fica fora", () => {
    const { debitos } = catalogoDeContas(PLANO);
    const codigos = debitos.map((d) => d.codigoCompleto);
    expect(codigos).toContain("411020008");
    expect(codigos).not.toContain("411000000");
  });

  it("⚠⚠ o crédito é SÓ disponibilidade — fornecedores e despesa ficam fora", () => {
    const { creditos } = catalogoDeContas(PLANO);
    const codigos = creditos.map((c) => c.codigoCompleto);
    expect(codigos).toEqual(expect.arrayContaining(["111010001", "111020001"]));
    expect(codigos).not.toContain("211010001");
    expect(codigos).not.toContain("411020008");
  });

  it("o catálogo é NOMEADO — código sem nome não ensina nada ao modelo", () => {
    const { debitos } = catalogoDeContas(PLANO);
    const caixa = debitos.find((d) => d.codigoCompleto === "111010001");
    expect(caixa).toMatchObject({ codigo: "5", nome: "CAIXA - MATRIZ" });
  });

  it("conta sem codigoCompleto não entra (não pode receber lançamento por aqui)", () => {
    const { debitos } = catalogoDeContas([{ codigo: "9", codigoCompleto: null, nome: "X", analitica: true }]);
    expect(debitos).toEqual([]);
  });

  it("o par ambíguo aparece UMA vez no catálogo (o completo é a chave)", () => {
    const { debitos } = catalogoDeContas(PLANO);
    expect(debitos.filter((d) => d.codigoCompleto === "411040001")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("os exemplos da memória — o 'treino'", () => {
  it("traduz o REDUZIDO da memória para o completo pelo plano", () => {
    const ex = exemplosDaMemoria([{ text: "GOOGLE CLOUD", contaDebito: "410", contaCredito: "12", usageCount: 3 }], PLANO);
    expect(ex).toEqual([{ descricao: "GOOGLE CLOUD", debito: "411030012", credito: "111020001" }]);
  });

  it("⚠ exemplo cujo débito não traduz fica de FORA — ensinaria o modelo a inventar", () => {
    const ex = exemplosDaMemoria([{ text: "X", contaDebito: "999", contaCredito: null, usageCount: 9 }], PLANO);
    expect(ex).toEqual([]);
  });

  it("crédito que não traduz vira null, e o exemplo fica", () => {
    const ex = exemplosDaMemoria([{ text: "X", contaDebito: "403", contaCredito: "999", usageCount: 1 }], PLANO);
    expect(ex).toEqual([{ descricao: "X", debito: "411020008", credito: null }]);
  });

  it("ordena por uso e respeita o máximo", () => {
    const hist = [
      { text: "pouco", contaDebito: "403", usageCount: 1 },
      { text: "muito", contaDebito: "410", usageCount: 50 },
      { text: "medio", contaDebito: "403", usageCount: 5 },
    ];
    expect(exemplosDaMemoria(hist, PLANO, { maximo: 2 }).map((e) => e.descricao)).toEqual(["muito", "medio"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o pedido — o bloco estável é idêntico entre chamadas", () => {
  it("duas montagens com dados diferentes têm o MESMO `system` (cache do modelo)", () => {
    const a = montarPedido({ linhas: [linha({ id: "a" })], plano: PLANO, historico: [] });
    const b = montarPedido({ linhas: [linha({ id: "b", descricaoOriginal: "OUTRA" })], plano: PLANO.slice(0, 2), historico: [{ text: "X", contaDebito: "403" }] });
    expect(a.system).toBe(b.system);
    expect(a.system).toBe(SYSTEM_ESTAVEL);
  });

  it("⚠ o bloco estável NÃO carrega data, hora nem nome de empresa", () => {
    expect(SYSTEM_ESTAVEL).not.toMatch(/\b20\d{2}\b/);
    expect(SYSTEM_ESTAVEL).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
    // nenhum nome de empresa da carteira, nenhum CNPJ, nenhum "Empresa: X"
    expect(SYSTEM_ESTAVEL).not.toMatch(/\bLENTE\b|\bSINTROPIA\b|\d{2}\.\d{3}\.\d{3}\/|Empresa:\s*\S/);
  });

  it("o bloco estável manda usar SÓ o catálogo, deixa o crédito null por padrão e proíbe porcentagem", () => {
    expect(SYSTEM_ESTAVEL).toMatch(/SOMENTE dentro do catálogo/i);
    expect(SYSTEM_ESTAVEL).toMatch(/Nunca invente/i);
    expect(SYSTEM_ESTAVEL).toMatch(/crédito como null/i);
    expect(SYSTEM_ESTAVEL).toMatch(/sem porcentagens/i);
  });

  it("a mensagem carrega catálogo, exemplos e as linhas enxutas — e os ids esperados", () => {
    const pedido = montarPedido({
      linhas: [linha({ id: "d-9", valorAjustado: "900.00" })],
      plano: PLANO,
      historico: [{ text: "GOOGLE CLOUD", contaDebito: "410", usageCount: 2 }],
    });
    expect(pedido.messages).toHaveLength(1);
    expect(pedido.messages[0].role).toBe("user");
    const c = pedido.messages[0].content;
    expect(c).toContain("411020008");
    expect(c).toContain("GOOGLE CLOUD");
    expect(c).toContain('"id":"d-9"');
    // ⚠ o valor AJUSTADO vence o original — é o que vai ser lançado
    expect(c).toContain('"valor":"900.00"');
    expect(pedido.idsEsperados).toEqual(["d-9"]);
  });

  it("sem histórico, diz que não há exemplos — em vez de mandar lista vazia muda", () => {
    const pedido = montarPedido({ linhas: [linha()], plano: PLANO, historico: [] });
    expect(pedido.messages[0].content).toMatch(/nenhum ainda/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠⚠ a resposta — cada conta CONFERIDA contra o plano", () => {
  const ctx = { plano: PLANO, idsEsperados: ["d-1", "d-2"] };
  const resposta = (propostas) => JSON.stringify({ propostas });

  it("proposta boa vira proposta, com débito, crédito e justificativa", () => {
    const r = lerResposta(resposta([{ id: "d-1", debito: "411030012", credito: "111020001", justificativa: "nuvem = software" }]), ctx);
    expect(r.ilegivel).toBe(false);
    expect(r.recusadas).toEqual([]);
    expect(r.propostas).toEqual([{ id: "d-1", debito: "411030012", credito: "111020001", justificativa: "nuvem = software" }]);
  });

  it("crédito `null` (ou ausente, ou a string 'null') é aceito — vale o caixa", () => {
    const r = lerResposta(resposta([
      { id: "d-1", debito: "411030012", credito: null },
      { id: "d-2", debito: "411030012", credito: "null" },
    ]), ctx);
    expect(r.propostas.map((p) => p.credito)).toEqual([null, null]);
  });

  it("⚠⚠⚠ conta que o modelo INVENTOU é recusada com motivo — nunca vira proposta", () => {
    const r = lerResposta(resposta([{ id: "d-1", debito: "499999999", credito: null }]), ctx);
    expect(r.propostas).toEqual([]);
    expect(r.recusadas).toEqual([{ id: "d-1", motivo: MOTIVO_RECUSA.CONTA_FORA_DO_PLANO, frase: FRASE_DA_RECUSA[MOTIVO_RECUSA.CONTA_FORA_DO_PLANO] }]);
  });

  it("⚠⚠ conta SINTÉTICA é recusada — `montarLancamento` recusaria depois", () => {
    const r = lerResposta(resposta([{ id: "d-1", debito: "411000000" }]), ctx);
    expect(r.propostas).toEqual([]);
    expect(r.recusadas[0].motivo).toBe(MOTIVO_RECUSA.CONTA_SINTETICA);
  });

  it("⚠⚠ conta AMBÍGUA (dois reduzidos, um completo) é recusada — o sistema não escolhe", () => {
    const r = lerResposta(resposta([{ id: "d-1", debito: "411040001" }]), ctx);
    expect(r.propostas).toEqual([]);
    expect(r.recusadas[0].motivo).toBe(MOTIVO_RECUSA.CONTA_AMBIGUA);
  });

  it("⚠⚠⚠ crédito que NÃO é disponibilidade (fornecedores) é recusado — a invariante do caixa", () => {
    const r = lerResposta(resposta([{ id: "d-1", debito: "411030012", credito: "211010001" }]), ctx);
    expect(r.propostas).toEqual([]);
    expect(r.recusadas[0].motivo).toBe(MOTIVO_RECUSA.CREDITO_NAO_E_DISPONIBILIDADE);
  });

  it("crédito inventado também é CONTA_FORA_DO_PLANO, e a linha inteira cai", () => {
    const r = lerResposta(resposta([{ id: "d-1", debito: "411030012", credito: "199999999" }]), ctx);
    expect(r.propostas).toEqual([]);
    expect(r.recusadas[0].motivo).toBe(MOTIVO_RECUSA.CONTA_FORA_DO_PLANO);
  });

  it("sem débito ⇒ SEM_DEBITO", () => {
    const r = lerResposta(resposta([{ id: "d-1", credito: "111010001" }]), ctx);
    expect(r.recusadas[0].motivo).toBe(MOTIVO_RECUSA.SEM_DEBITO);
  });

  it("⚠ id que não estava no lote é LINHA_DESCONHECIDA — a IA não escolhe sobre o que não viu", () => {
    const r = lerResposta(resposta([{ id: "d-outro", debito: "411030012" }]), ctx);
    expect(r.propostas).toEqual([]);
    expect(r.recusadas[0]).toMatchObject({ id: "d-outro", motivo: MOTIVO_RECUSA.LINHA_DESCONHECIDA });
  });

  it("⚠ id repetido: a primeira vale, a segunda é recusada", () => {
    const r = lerResposta(resposta([
      { id: "d-1", debito: "411030012" },
      { id: "d-1", debito: "411020008" },
    ]), ctx);
    expect(r.propostas).toHaveLength(1);
    expect(r.propostas[0].debito).toBe("411030012");
    expect(r.recusadas[0].motivo).toBe(MOTIVO_RECUSA.LINHA_DESCONHECIDA);
  });

  it("uma recusa não derruba as outras propostas do lote", () => {
    const r = lerResposta(resposta([
      { id: "d-1", debito: "499999999" },
      { id: "d-2", debito: "411020008", credito: "111010001", justificativa: "ok" },
    ]), ctx);
    expect(r.propostas.map((p) => p.id)).toEqual(["d-2"]);
    expect(r.recusadas.map((p) => p.id)).toEqual(["d-1"]);
  });

  it("a justificativa é cortada no máximo — é uma frase, não um laudo", () => {
    const r = lerResposta(resposta([{ id: "d-1", debito: "411030012", justificativa: "x".repeat(1000) }]), ctx);
    expect(r.propostas[0].justificativa).toHaveLength(300);
  });

  it("tolera cerca de markdown em volta do JSON", () => {
    const texto = "```json\n" + resposta([{ id: "d-1", debito: "411030012" }]) + "\n```";
    const r = lerResposta(texto, ctx);
    expect(r.ilegivel).toBe(false);
    expect(r.propostas).toHaveLength(1);
  });

  it("⚠ JSON malformado ⇒ `ilegivel: true`, zero propostas, zero recusadas — é OUTRA resposta que 'nenhuma linha'", () => {
    for (const texto of ["não sei", "{propostas: [", "", null, '{"outra":[]}']) {
      const r = lerResposta(texto, ctx);
      expect(r).toEqual({ propostas: [], recusadas: [], ilegivel: true });
    }
  });

  it("espaços em volta dos códigos são tolerados", () => {
    const r = lerResposta(resposta([{ id: " d-1 ", debito: " 411030012 ", credito: " 111010001 " }]), ctx);
    expect(r.propostas).toEqual([{ id: "d-1", debito: "411030012", credito: "111010001", justificativa: null }]);
  });
});

describe("as constantes", () => {
  it("a finalidade é a que a guarda registra", () => {
    expect(FINALIDADE).toBe("classificacao_lancamentos");
  });
  it("toda recusa tem frase", () => {
    for (const m of Object.values(MOTIVO_RECUSA)) expect(typeof FRASE_DA_RECUSA[m]).toBe("string");
  });
});
