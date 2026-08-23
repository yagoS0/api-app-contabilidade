// AS DUAS LEITURAS DO SITFIS — quem vence, e o que NUNCA pode acontecer quando elas discordam.
//
// ⚠ O CNPJ desta fixture é ANONIMIZADO (`91.888.222/0001-63`): formato, pontuação e comprimento
// idênticos aos reais, dígitos FABRICADOS, e escolhido para não colidir com nenhum dos que já
// representam outra empresa em `parseSitfisRelatorio.test.js` — reusar um deles já aconteceu e
// teve de ser corrigido. Fixture entra no histórico do git para sempre. NÃO traga o real.
//
// ⚠ O texto abaixo é um EXCERTO NO FORMATO do relatório real (uma célula por linha, o CNPJ colado
// na primeira coluna do cabeçalho, a régua no título), não uma transcrição de relatório de
// cliente. Valores, datas e códigos de receita são estrutura — o código `8109-02 - PIS` é tabela
// pública da Receita.

import {
  lerLeituraPosicionalGravada,
  montarRawPayloadComLeitura,
  montarRelatorioSitfis,
} from "../lerRelatorioSitfis.js";

const TEXTO = `_____________________________________ Diagnóstico Fiscal na Receita Federal _____________________________________Pendência - Débito (SIEF) _______________________________________________________________________________________CNPJ: 91.888.222/0001-63Receita
PA/Exerc.
Dt. Vcto
Vl. Original
Sdo. Devedor
Situação
8109-02 - PIS
05/2026
25/06/2026
117,00
117,00
DEVEDOR
_____________________________________ Diagnóstico Fiscal na Procuradoria-Geral da Fazenda Nacional _____________________________________Pendência - Inscrição (SIDA) ____________________________________________________________________________CNPJ: 91.888.222/0001-63Inscrição
Receita
Inscrito em
Ajuizado em
Processo
Tipo de Devedor
70.2.26.028625-81
3551-IRPJ
20/07/2026
14966.621.428/2026-34
DEVEDOR PRINCIPAL
Situação:
ATIVA A SER COBRADA`;

/** O bloco do SIDA como a leitura POSICIONAL o devolve: TABELA de 6 colunas. */
const SIDA_TABULADO = {
  titulo: "Pendência - Inscrição (SIDA)",
  descricao: [],
  colunas: ["Inscrição", "Receita", "Inscrito em", "Ajuizado em", "Processo", "Tipo de Devedor"],
  registros: [{
    "Inscrição": "70.2.26.028625-81",
    "Receita": "3551-IRPJ",
    "Inscrito em": "20/07/2026",
    "Ajuizado em": "",
    "Processo": "14966.621.428/2026-34",
    "Tipo de Devedor": "DEVEDOR PRINCIPAL",
  }],
  anotacoes: ["ATIVA A SER COBRADA"],
  anotacoesPorRegistro: [{ "Situação": "ATIVA A SER COBRADA" }],
  naoInterpretado: [],
};

/** Quantos blocos o parser de TEXTO enxerga em cada órgão — a fixture existe para isto. */
function blocosDoTexto() {
  const { relatorio } = montarRelatorioSitfis({ texto: TEXTO, posicional: null });
  return Object.fromEntries(relatorio.diagnosticos.map((d) => [d.chave, d.blocos.length]));
}

/** Uma leitura posicional com o MESMO número de blocos que o texto, por órgão. */
function posicionalQueBate(blocoPgfn = SIDA_TABULADO) {
  const contagem = blocosDoTexto();
  const vazio = (i) => ({
    titulo: `bloco ${i}`, descricao: [], colunas: [], registros: [],
    anotacoes: [], anotacoesPorRegistro: [], naoInterpretado: [],
  });
  return {
    leitura: "posicional",
    diagnosticos: [
      { orgao: "Receita Federal", chave: "RFB", semPendencia: false, blocos: Array.from({ length: contagem.RFB }, (_, i) => vazio(i)) },
      { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: false, blocos: Array.from({ length: contagem.PGFN }, (_, i) => (i === 0 ? blocoPgfn : vazio(i))) },
    ],
  };
}

describe("a fixture representa os dois órgãos", () => {
  it("o texto produz RFB e PGFN, com ao menos um bloco em cada", () => {
    const contagem = blocosDoTexto();
    expect(contagem.RFB).toBeGreaterThan(0);
    expect(contagem.PGFN).toBeGreaterThan(0);
  });
});

describe("sem leitura posicional, a produção continua exatamente como estava", () => {
  it("ausente: a leitura é a do TEXTO, com o motivo dito", () => {
    const { relatorio, leitura, motivo } = montarRelatorioSitfis({ texto: TEXTO, posicional: null });
    expect(leitura).toBe("texto");
    expect(motivo).toMatch(/ausente/i);
    expect(relatorio.diagnosticos.map((d) => d.chave)).toEqual(["RFB", "PGFN"]);
  });

  it("⚠ FORMA INESPERADA CAI PARA O TEXTO — nunca vira tabela indefinida na tela", () => {
    const torto = posicionalQueBate();
    torto.diagnosticos[1].blocos[0] = { ...SIDA_TABULADO, colunas: "Inscrição" }; // string, não array
    const { leitura, motivo, relatorio } = montarRelatorioSitfis({ texto: TEXTO, posicional: torto });
    expect(leitura).toBe("texto");
    expect(motivo).toMatch(/forma inesperada/i);
    // e o relatório continua sendo um relatório de verdade
    expect(relatorio.diagnosticos).toHaveLength(2);
  });

  it("⚠ registro que não é objeto também recusa o relatório inteiro", () => {
    const torto = posicionalQueBate();
    torto.diagnosticos[1].blocos[0] = { ...SIDA_TABULADO, registros: ["70.2.26.028625-81"] };
    expect(montarRelatorioSitfis({ texto: TEXTO, posicional: torto }).leitura).toBe("texto");
  });
});

describe("a leitura posicional vence quando fecha", () => {
  it("o bloco SIDA chega à tela como TABELA, com as seis colunas do relatório", () => {
    const { relatorio, leitura, motivo } = montarRelatorioSitfis({
      texto: TEXTO, posicional: posicionalQueBate(),
    });
    expect(leitura).toBe("posicional");
    expect(motivo).toBeNull();
    const pgfn = relatorio.diagnosticos.find((d) => d.chave === "PGFN");
    expect(pgfn.blocos[0].colunas).toEqual([
      "Inscrição", "Receita", "Inscrito em", "Ajuizado em", "Processo", "Tipo de Devedor",
    ]);
    expect(pgfn.blocos[0].registros[0]["Processo"]).toBe("14966.621.428/2026-34");
  });

  it("⚠ a célula vazia é INFORMAÇÃO e chega vazia, não some nem vira traço no dado", () => {
    const { relatorio } = montarRelatorioSitfis({ texto: TEXTO, posicional: posicionalQueBate() });
    const pgfn = relatorio.diagnosticos.find((d) => d.chave === "PGFN");
    expect(pgfn.blocos[0].registros[0]).toHaveProperty("Ajuizado em", "");
  });

  it("⚠ O ENVELOPE CONTINUA VINDO DO TEXTO — a posicional não lê a capa do relatório", () => {
    const so = montarRelatorioSitfis({ texto: TEXTO, posicional: null }).relatorio;
    const com = montarRelatorioSitfis({ texto: TEXTO, posicional: posicionalQueBate() }).relatorio;
    expect(com.contribuinte).toEqual(so.contribuinte);
    expect(com.emitidoEm).toEqual(so.emitidoEm);
    expect(com.temTexto).toBe(true);
  });

  it("a anotação viaja amarrada ao registro, com o rótulo que o PDF imprime", () => {
    const { relatorio } = montarRelatorioSitfis({ texto: TEXTO, posicional: posicionalQueBate() });
    const bloco = relatorio.diagnosticos.find((d) => d.chave === "PGFN").blocos[0];
    expect(bloco.anotacoesPorRegistro).toEqual([{ "Situação": "ATIVA A SER COBRADA" }]);
  });
});

describe("⚠⚠ A TABELA NUNCA SOME", () => {
  it("órgão em que as duas leituras discordam no NÚMERO de blocos fica com o texto", () => {
    const menos = posicionalQueBate();
    menos.diagnosticos[1].blocos = []; // a posicional "perdeu" o bloco do PGFN
    const { relatorio, leitura, motivo } = montarRelatorioSitfis({ texto: TEXTO, posicional: menos });

    expect(leitura).toBe("mista");
    expect(motivo).toMatch(/PGFN: \d+ bloco\(s\) no texto × 0 na posição/);
    const pgfn = relatorio.diagnosticos.find((d) => d.chave === "PGFN");
    expect(pgfn.blocos.length).toBeGreaterThan(0); // o bloco do texto continua na tela
  });

  it("órgão que a posicional não encontrou fica com o texto, nomeando o motivo", () => {
    const semPgfn = posicionalQueBate();
    semPgfn.diagnosticos = semPgfn.diagnosticos.filter((d) => d.chave !== "PGFN");
    const { relatorio, leitura, motivo } = montarRelatorioSitfis({ texto: TEXTO, posicional: semPgfn });

    expect(leitura).toBe("mista");
    expect(motivo).toMatch(/PGFN: a leitura posicional não encontrou este órgão/);
    expect(relatorio.diagnosticos.find((d) => d.chave === "PGFN").blocos.length).toBeGreaterThan(0);
  });

  it("⚠ BLOCO RECUSADO PELA GEOMETRIA chega com as linhas cruas E o motivo — não vira tabela torta", () => {
    const recusado = {
      titulo: "Pendência - Inscrição (SIDA)",
      descricao: [],
      colunas: [],
      registros: [],
      anotacoes: [],
      anotacoesPorRegistro: [],
      naoInterpretado: ["70.2.26.028625-81 3551-IRPJ 20/07/2026", "Situação: ATIVA A SER COBRADA"],
      aviso: "bloco não conferido pela geometria: '3551-IRPJ' não é valor monetário na coluna 'Valor'",
    };
    const { relatorio } = montarRelatorioSitfis({ texto: TEXTO, posicional: posicionalQueBate(recusado) });
    const bloco = relatorio.diagnosticos.find((d) => d.chave === "PGFN").blocos[0];

    expect(bloco.colunas).toEqual([]);
    expect(bloco.registros).toEqual([]);
    expect(bloco.naoInterpretado).toHaveLength(2);
    expect(bloco.aviso).toMatch(/não conferido pela geometria/);
  });
});

describe("relatório antigo, sem texto salvo", () => {
  it("a posicional entra INTEIRA — melhor uma tabela lida pela geometria que tela nenhuma", () => {
    const { relatorio, leitura, motivo } = montarRelatorioSitfis({
      texto: null, posicional: posicionalQueBate(),
    });
    expect(leitura).toBe("posicional");
    expect(motivo).toMatch(/sem texto salvo/i);
    expect(relatorio.temTexto).toBe(false);
    expect(relatorio.diagnosticos.find((d) => d.chave === "PGFN").blocos[0].colunas).toHaveLength(6);
  });

  it("sem texto E sem posicional, a resposta continua sendo `null` (a tela cai no PDF)", () => {
    expect(montarRelatorioSitfis({ texto: null, posicional: null }).relatorio).toBeNull();
  });
});

describe("onde a leitura é guardada — dentro do rawPayload, sem DDL", () => {
  it("⚠ o envelope do SERPRO fica INTACTO ao lado da chave nova", () => {
    const envelope = { dados: { pdf: "JVBERi0=" }, mensagens: [{ codigo: "Sucesso" }] };
    const gravado = montarRawPayloadComLeitura(envelope, posicionalQueBate());
    expect(gravado.dados).toEqual(envelope.dados);
    expect(gravado.mensagens).toEqual(envelope.mensagens);
    expect(gravado.leituraPosicional.lidoEm).toEqual(expect.any(String));
  });

  it("sem leitura posicional, o rawPayload volta como estava — nada é acrescentado", () => {
    const envelope = { dados: { pdf: "JVBERi0=" } };
    expect(montarRawPayloadComLeitura(envelope, null)).toBe(envelope);
  });

  it("a volta lê o que foi gravado, e recusa o que estiver fora da forma", () => {
    const bom = montarRawPayloadComLeitura({}, posicionalQueBate());
    expect(lerLeituraPosicionalGravada(bom).diagnosticos).toHaveLength(2);
    expect(lerLeituraPosicionalGravada({ leituraPosicional: { relatorio: { diagnosticos: "x" } } })).toBeNull();
    expect(lerLeituraPosicionalGravada(null)).toBeNull();
  });
});
