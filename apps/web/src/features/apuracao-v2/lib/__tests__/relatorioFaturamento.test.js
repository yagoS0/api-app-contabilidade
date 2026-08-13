// AS TRÊS COISAS QUE ESTA TELA NÃO PODE AFIRMAR.
//
// 1. Que o número do nosso motor é o da Receita.
// 2. Que uma dimensão que não medimos ("segregação", "qualificação") não existe.
// 3. Que zero pendências quer dizer competência classificada.
//
// Cada uma já produziu, ou produz hoje, uma tela que mente com confiança — e as três se resolvem
// com a mesma forma: o terceiro estado, "não sabemos", que não é verde nem vermelho.

import {
  procedenciaDoDas,
  recusaDoPreApurado,
  avisosDoRelatorio,
  rotuloSegregacao,
  rotuloQualificacoes,
  estadoDaClassificacao,
  kpiDasApurado,
  TOM,
} from "../relatorioFaturamento";

// ─────────────────────────────────────────────────────────────────────────────
describe("procedenciaDoDas — de quem é o número", () => {
  it("motor local sozinho: o rótulo diz que NÃO é o da Receita", () => {
    const r = procedenciaDoDas({ origem: "MOTOR_LOCAL", ok: true, das: 1234.56, oficial: {} });
    expect(r.nosso.valor).toBe(1234.56);
    expect(r.nosso.rotulo).toMatch(/não é o da Receita/i);
    expect(r.oficial.disponivel).toBe(false);
    // ⚠ Sem o segundo número não há diferença — subtrair de `null` inventaria uma divergência.
    expect(r.diferenca).toBeNull();
    expect(r.comparavel).toBe(false);
  });

  it("com o oficial do SERPRO: os dois lado a lado, com a diferença", () => {
    const r = procedenciaDoDas({
      ok: true, das: 1000, oficial: { dasRetornadoSerpro: 1100 },
    });
    expect(r.oficial.valor).toBe(1100);
    expect(r.oficial.ambiguo).toBe(false);
    expect(r.diferenca).toBe(-100);
    expect(r.comparavel).toBe(true);
  });

  it("⚠ o SIMULADO tem rótulo PRÓPRIO — 'a Receita calculou' ≠ 'a declaração foi entregue'", () => {
    // Depois da separação das colunas, este é o estado normal de uma competência calculada e não
    // transmitida. Um rótulo só para os dois faria a obrigação parecer cumprida por um clique em
    // Calcular.
    const r = procedenciaDoDas({
      ok: true, das: 1000,
      oficial: { dasRetornadoSerpro: null, dasSimuladoSerpro: 1100, dasCalculadoLocalNoSnapshot: null },
    });
    expect(r.oficial.valor).toBe(1100);
    expect(r.oficial.rotulo).toMatch(/simulação, nada transmitido/i);
    expect(r.oficial.ambiguo).toBe(false);
    // ⚠ Com os dois lados de dono conhecido, o double-check volta a ser calculável.
    expect(r.diferenca).toBe(-100);
    expect(r.comparavel).toBe(true);
  });

  it("o TRANSMITIDO vence o simulado quando os dois existem", () => {
    const r = procedenciaDoDas({
      ok: true, das: 1000,
      oficial: { dasRetornadoSerpro: 1200, dasSimuladoSerpro: 1100 },
    });
    expect(r.oficial.valor).toBe(1200);
    expect(r.oficial.rotulo).toMatch(/transmitida/i);
  });

  it("⚠ coluna de PROCEDÊNCIA AMBÍGUA: não se afirma de quem é, e não se calcula diferença", () => {
    // Snapshot ANTERIOR à separação: `dasCalculadoLocal` era gravada tanto pelo motor quanto pela
    // simulação da RFB. Subtrair um do outro afirmaria que são coisas diferentes — podem ser o
    // mesmo número duas vezes. ⚠ Este estado NÃO foi removido pelo conserto: os snapshots velhos
    // continuam no banco e continuam sem prova de procedência.
    const r = procedenciaDoDas({
      ok: true, das: 900,
      oficial: {
        dasRetornadoSerpro: null,
        dasCalculadoLocalNoSnapshot: { valor: 900, procedenciaAmbigua: true, aviso: "Coluna gravada por dois caminhos." },
      },
    });
    expect(r.oficial.valor).toBe(900);
    expect(r.oficial.ambiguo).toBe(true);
    expect(r.oficial.rotulo).toMatch(/ambígua/i);
    expect(r.diferenca).toBeNull();
    expect(r.comparavel).toBe(false);
  });

  it("o SERPRO vence a coluna ambígua quando os dois existem", () => {
    const r = procedenciaDoDas({
      ok: true, das: 500,
      oficial: {
        dasRetornadoSerpro: 700,
        dasCalculadoLocalNoSnapshot: { valor: 690, procedenciaAmbigua: true },
      },
    });
    expect(r.oficial.valor).toBe(700);
    expect(r.oficial.ambiguo).toBe(false);
  });

  it("motor bloqueado: o nosso valor é null, nunca zero", () => {
    // Zero seria a afirmação "o DAS deste mês é zero" — a mesma mentira que a remoção das colunas
    // vazias de IPI/ST evita.
    const r = procedenciaDoDas({ ok: false, das: null, oficial: {} });
    expect(r.nosso.valor).toBeNull();
    expect(r.nosso.disponivel).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("recusaDoPreApurado — ok:false não é erro", () => {
  it("bloqueio por classificação: motivo nomeado + TAMANHO do buraco, em âmbar", () => {
    const r = recusaDoPreApurado({
      ok: false,
      estado: "bloqueada_pendencias",
      motivo: { code: "RECEITA_NAO_CLASSIFICADA", mensagem: "A receita da competência não está classificada" },
      semClassificacao: { valorContabil: 18500.75, itens: 12, fracaoDoTotal: 1, totalDaCompetencia: 18500.75 },
      comoResolver: "Aba Apuração → Sugestão → Classificar competência",
    });
    expect(r.bloqueado).toBe(true);
    // ⚠ Âmbar: é o estado normal de 100% da carteira hoje. Vermelho aqui viraria paisagem.
    expect(r.tom).toBe(TOM.warn);
    expect(r.detalhe).toMatch(/não está classificada/);
    expect(r.buraco).toEqual({ valor: 18500.75, itens: 12, fracaoRotulo: "100%" });
    expect(r.comoResolver).toMatch(/Classificar competência/);
  });

  it("erro de cálculo é outra coisa — vermelho", () => {
    const r = recusaDoPreApurado({ ok: false, estado: "erro_calculo", motivo: { code: "ERRO", mensagem: "boom" } });
    expect(r.tom).toBe(TOM.danger);
  });

  it("calculado: não bloqueado", () => {
    expect(recusaDoPreApurado({ ok: true, das: 10 }).bloqueado).toBe(false);
  });

  it("⚠ competência SEM receita: sem motivo e sem buraco, o tom é neutro — não há o que classificar", () => {
    // "R$ 0,00 em 0 itens" não é tamanho de buraco, e âmbar onde nada foi pedido do contador é o
    // âmbar permanente que treina o olho a ignorar a cor de "falta fazer".
    const r = recusaDoPreApurado({
      ok: false, estado: null, motivo: null, blockers: [],
      semClassificacao: { valorContabil: 0, itens: 0, fracaoDoTotal: 0, totalDaCompetencia: 0 },
    });
    expect(r.bloqueado).toBe(true);
    expect(r.tom).toBe(TOM.neutral);
    expect(r.buraco).toBeNull();
    expect(r.detalhe).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("avisosDoRelatorio — o que não pode virar silêncio", () => {
  const base = {
    conferencia: { confere: true, totalRelatorio: 100, faturamentoEmit: 100, diferenca: 0 },
    naoClassificado: { valorContabil: 0, itens: 0, fracaoDoTotal: 0 },
    semDetalheCapturado: { valorContabil: 0, notas: 0, fracaoDoTotal: 0 },
    ausenciaDeNotas: { aplicavel: false },
    totalMes: { valorContabil: 100, itens: 1 },
  };

  it("tudo conferido: nenhum aviso", () => {
    expect(avisosDoRelatorio(base)).toEqual([]);
  });

  it("⚠ a conferência que não fecha vem PRIMEIRO — é o relatório acusando a si mesmo", () => {
    const av = avisosDoRelatorio({
      ...base,
      conferencia: { confere: false, totalRelatorio: 100, faturamentoEmit: 90, diferenca: 10 },
      naoClassificado: { valorContabil: 50, itens: 3, fracaoDoTotal: 0.5 },
    });
    expect(av[0].codigo).toBe("CONFERENCIA_NAO_FECHA");
    expect(av[0].tom).toBe(TOM.danger);
    expect(av[1].codigo).toBe("NAO_CLASSIFICADO");
  });

  it("não classificado: valor, itens e FRAÇÃO — e nunca em verde", () => {
    const [av] = avisosDoRelatorio({ ...base, naoClassificado: { valorContabil: 18500.75, itens: 12, fracaoDoTotal: 1, comoResolver: "Classificar competência" } });
    expect(av.codigo).toBe("NAO_CLASSIFICADO");
    expect(av.tom).toBe(TOM.warn);
    expect(av.numeros).toEqual({ valor: 18500.75, itens: 12, fracaoRotulo: "100%" });
  });

  it("⚠ SEM DETALHE é aviso PRÓPRIO, com outro tom — falta de dado, não falta de trabalho", () => {
    const av = avisosDoRelatorio({
      ...base,
      naoClassificado: { valorContabil: 10, itens: 1, fracaoDoTotal: 0.1 },
      semDetalheCapturado: { valorContabil: 40, notas: 2, fracaoDoTotal: 0.4, comoResolver: "Manifestar/baixar a NF-e completa" },
    });
    const codigos = av.map((a) => a.codigo);
    expect(codigos).toContain("SEM_DETALHE_CAPTURADO");
    expect(codigos).toContain("NAO_CLASSIFICADO");
    const sd = av.find((a) => a.codigo === "SEM_DETALHE_CAPTURADO");
    // Neutro: quem resolve é outra pessoa, com outra ação (manifestar a NF-e).
    expect(sd.tom).toBe(TOM.neutral);
    expect(sd.detalhe).toMatch(/Manifestar/);
  });

  it("⚠ zero sem confirmação NÃO prova ausência de receita, e usa o texto do backend", () => {
    const backendMsg = "Nenhuma nota encontrada — isto NÃO é o mesmo que ausência de receita. …";
    const [av] = avisosDoRelatorio({
      ...base,
      totalMes: { valorContabil: 0, itens: 0 },
      ausenciaDeNotas: { aplicavel: true, podeAfirmarAusencia: false, mensagem: backendMsg },
    });
    expect(av.codigo).toBe("AUSENCIA_DE_NOTAS");
    expect(av.tom).toBe(TOM.neutral);
    expect(av.tom).not.toBe(TOM.ok);
    expect(av.detalhe).toBe(backendMsg); // não reescrito
  });

  it("zero COM confirmação: aí sim é concluído", () => {
    const [av] = avisosDoRelatorio({
      ...base,
      totalMes: { valorContabil: 0, itens: 0 },
      ausenciaDeNotas: { aplicavel: true, podeAfirmarAusencia: true, mensagem: "há confirmação" },
    });
    expect(av.tom).toBe(TOM.ok);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("dimensões não apuradas — 'não medimos' ≠ 'não tem'", () => {
  it("⚠ INDETERMINADA nunca renderiza como 'Sem substituição tributária'", () => {
    const r = rotuloSegregacao({
      codigo: "INDETERMINADA", rotuloOficial: null,
      rotuloCurto: "Segregação não apurada", motivo: "O portal não extrai ST do XML.",
    });
    expect(r.apurado).toBe(false);
    expect(r.texto).toBe("Segregação não apurada");
    expect(r.texto).not.toMatch(/^Sem /);
    expect(r.titulo).toMatch(/não extrai ST/);
  });

  it("segregação apurada mostra o rótulo curto e o oficial no title", () => {
    const r = rotuloSegregacao({ codigo: "COM", rotuloCurto: "Com ST/monofásica/antecipação", rotuloOficial: "Com substituição tributária/…" });
    expect(r.apurado).toBe(true);
    expect(r.titulo).toMatch(/Com substituição tributária/);
  });

  it("tipo de receita sem a pergunta do 6.5: traço, não 'Sem'", () => {
    expect(rotuloSegregacao(null).texto).toBe("—");
    expect(rotuloSegregacao(null).apurado).toBeNull();
  });

  it("⚠ qualificações NAO_APURADO ≠ nenhuma qualificação", () => {
    const naoApurado = rotuloQualificacoes({ estado: "NAO_APURADO", codigos: [], rotulos: [], motivo: "falta de leitura" });
    expect(naoApurado.texto).toBe("Não apurado");
    expect(naoApurado.apurado).toBe(false);

    const nenhuma = rotuloQualificacoes({ estado: "NENHUMA", codigos: [], rotulos: [] });
    expect(nenhuma.texto).toBe("Nenhuma");
    expect(nenhuma.apurado).toBe(true);
  });

  it("qualificação apurada lista os rótulos oficiais", () => {
    const r = rotuloQualificacoes({ estado: "APURADO", codigos: ["SUBSTITUICAO_TRIBUTARIA"], rotulos: ["substituição tributária"] });
    expect(r.texto).toBe("substituição tributária");
    expect(r.apurado).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("estadoDaClassificacao — o ✓ verde que concluía o que não foi feito", () => {
  it("com pendência: âmbar, com a contagem", () => {
    const r = estadoDaClassificacao({ pendencias: [{ id: 1 }, { id: 2 }] });
    expect(r.chave).toBe("com_pendencia");
    expect(r.tom).toBe(TOM.warn);
    expect(r.rotulo).toMatch(/2 pendências/);
  });

  it("⚠ zero pendências SEM relatório: não sabemos — nunca verde", () => {
    const r = estadoDaClassificacao({ pendencias: [], relatorio: null });
    expect(r.chave).toBe("indeterminado");
    expect(r.tom).toBe(TOM.neutral);
    expect(r.tom).not.toBe(TOM.ok);
    expect(r.verificavel).toBe(false);
  });

  it("⚠ zero pendências COM receita não classificada: é 'ninguém classificou', não 'tudo certo'", () => {
    // É o estado de 100% das empresas hoje: `tipoReceita` nulo em 16.153/16.153 itens.
    const r = estadoDaClassificacao({
      pendencias: [],
      relatorio: { dados: { naoClassificado: { valorContabil: 18500.75, fracaoDoTotal: 1 }, totalMes: { valorContabil: 18500.75 } } },
    });
    expect(r.chave).toBe("nunca_classificada");
    expect(r.tom).toBe(TOM.warn);
    expect(r.detalhe).toMatch(/Classificar/);
  });

  it("zero pendências e nada sem tipo: AÍ é concluído", () => {
    const r = estadoDaClassificacao({
      pendencias: [],
      relatorio: { dados: { naoClassificado: { valorContabil: 0, fracaoDoTotal: 0 }, totalMes: { valorContabil: 9000 } } },
    });
    expect(r.chave).toBe("sem_pendencia");
    expect(r.tom).toBe(TOM.ok);
  });

  it("competência sem receita: neutro — não há trabalho concluído a celebrar", () => {
    const r = estadoDaClassificacao({
      pendencias: [],
      relatorio: { dados: { naoClassificado: { valorContabil: 0 }, totalMes: { valorContabil: 0 } } },
    });
    expect(r.chave).toBe("sem_receita");
    expect(r.tom).toBe(TOM.neutral);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("kpiDasApurado — o rótulo único que confundia as duas origens", () => {
  it("com valor do SERPRO: rótulo diz oficial", () => {
    const r = kpiDasApurado({ dasRetornadoSerpro: 26670.52, dasCalculadoLocal: 26000 });
    expect(r.valor).toBe(26670.52);
    expect(r.label).toMatch(/oficial/i);
    expect(r.procedencia).toBe("rfb");
  });

  it("simulado sem transmissão: rótulo diz SIMULADO — não é declaração entregue", () => {
    const r = kpiDasApurado({ dasRetornadoSerpro: null, dasSimuladoSerpro: 26670.52, dasCalculadoLocal: null });
    expect(r.valor).toBe(26670.52);
    expect(r.label).toMatch(/simulado/i);
    expect(r.procedencia).toBe("rfb_simulado");
  });

  it("o TRANSMITIDO vence o simulado", () => {
    const r = kpiDasApurado({ dasRetornadoSerpro: 26670.52, dasSimuladoSerpro: 26000 });
    expect(r.procedencia).toBe("rfb");
    expect(r.titulo).toMatch(/TRANSMISSÃO/);
  });

  it("valor marcado MOTOR_LOCAL: é nosso, e o rótulo diz isso — sem ambiguidade", () => {
    const r = kpiDasApurado({ dasRetornadoSerpro: null, dasSimuladoSerpro: null, dasCalculadoLocal: 26000, dasCalculadoLocalProcedencia: "MOTOR_LOCAL" });
    expect(r.valor).toBe(26000);
    expect(r.procedencia).toBe("motor_local");
    expect(r.label).toMatch(/portal/i);
  });

  it("⚠ só `dasCalculadoLocal` SEM MARCA: procedência AMBÍGUA, nunca 'DAS apurado' seco", () => {
    // ⚠ O estado ambíguo continua valendo para o snapshot antigo — a ausência de marca NÃO é
    // tratada como "é nosso porque a coluna se chama local". Era assim que a mentira nascia.
    const r = kpiDasApurado({ dasRetornadoSerpro: null, dasCalculadoLocal: 26000 });
    expect(r.valor).toBe(26000);
    expect(r.label).toMatch(/ambígua/i);
    expect(r.procedencia).toBe("ambigua");
    expect(r.titulo).toMatch(/simulação oficial/);
  });

  it("sem snapshot: sem valor e com o motivo no title", () => {
    const r = kpiDasApurado(null);
    expect(r.valor).toBeNull();
    expect(r.procedencia).toBe("nenhuma");
    expect(r.titulo).toMatch(/Nenhuma apuração gravada/);
  });
});
