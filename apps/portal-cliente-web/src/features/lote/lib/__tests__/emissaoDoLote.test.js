// AS REGRAS DE TELA DA EMISSÃO EM LOTE.
//
// ⚠ NADA AQUI EMITE — são funções puras sobre o relatório que o servidor devolve.

import {
  DESFECHO,
  STATUS_LOTE,
  avisoDaLinhaIndeterminada,
  confirmacaoDaEmissao,
  conviteParaRetomar,
  resumoDaEmissao,
  somarValorDasProntas,
  textoDoDesfecho,
} from "../emissaoDoLote";

const linha = (numeroLinha, desfecho, extra = {}) => ({
  numeroLinha,
  tomadorNome: `TOMADOR ${numeroLinha}`,
  valorServicos: 100,
  desfecho,
  rpsSerie: null,
  rpsNumero: null,
  ...extra,
});

describe("textoDoDesfecho", () => {
  // ⚠ O `status` do chip tem de estar na lista de `data-status` do CSS — valor fora dela renderiza
  // SEM COR NENHUMA, em silêncio. Foi o defeito da primeira escrita deste módulo.
  const VALIDOS = ["emitida", "processando", "rejeitada", "cancelada", "rascunho", "substituida"];

  it.each(Object.values(DESFECHO))("%s usa um `status` que o CSS conhece", (d) => {
    expect(VALIDOS).toContain(textoDoDesfecho(d).chip);
  });

  // ⚠⚠ A DISTINÇÃO QUE PROTEGE CONTRA DUPLICAR NOTA: "desfecho desconhecido" não pode ser lido como
  // "falhou". Falhou convida a tentar de novo.
  it("⚠⚠ `indeterminada` NÃO é vermelho e NÃO diz 'falhou'", () => {
    const t = textoDoDesfecho(DESFECHO.INDETERMINADA);
    expect(t.chip).not.toBe("rejeitada");
    expect(t.rotulo.toLowerCase()).not.toContain("falh");
    expect(t.rotulo.toLowerCase()).toContain("desconhecido");
  });

  it("⚠ `nao_tentada` não é erro — ninguém encostou naquela linha", () => {
    expect(textoDoDesfecho(DESFECHO.NAO_TENTADA).chip).not.toBe("rejeitada");
  });

  it("⚠ desfecho que a tela NÃO conhece sai nomeado, nunca como sucesso", () => {
    const t = textoDoDesfecho("estado_novo_do_backend");
    expect(t.chip).toBe("rejeitada");
    expect(t.rotulo).toContain("estado_novo_do_backend");
  });
});

describe("⚠⚠ a linha indeterminada", () => {
  const lote = {
    status: STATUS_LOTE.PARADO_INDETERMINADO,
    linhaIndeterminada: 3,
    paradoMotivo: "A resposta do sistema nacional não voltou.",
    linhas: [
      linha(2, DESFECHO.EMITIDA, { rpsSerie: "00001", rpsNumero: "1" }),
      linha(3, DESFECHO.INDETERMINADA, {
        rpsSerie: "00001",
        rpsNumero: "2",
        correcao: "Consulte o Id da DPS antes de decidir.",
      }),
      linha(4, DESFECHO.NAO_TENTADA),
      linha(5, DESFECHO.NAO_TENTADA),
    ],
  };

  it("é nomeada, com o tomador e o NÚMERO RESERVADO", () => {
    const a = avisoDaLinhaIndeterminada(lote);
    expect(a.numeroLinha).toBe(3);
    expect(a.tomadorNome).toBe("TOMADOR 3");
    // ⚠ Não existe inutilização na NFS-e: número reservado que não virou nota é buraco permanente.
    expect(a.rpsNumero).toBe("2");
    expect(a.correcao).toContain("Id da DPS");
  });

  it("lote sem linha indeterminada não inventa aviso", () => {
    expect(avisoDaLinhaIndeterminada({ status: STATUS_LOTE.CONCLUIDO, linhas: [] })).toBeNull();
  });

  // ⚠⚠ O TESTE MAIS IMPORTANTE DESTE ARQUIVO.
  it("⚠⚠ o convite para retomar cobre só as linhas DEPOIS dela, e DIZ isso", () => {
    const c = conviteParaRetomar(lote);
    expect(c.quantas).toBe(2);
    expect(c.primeiraLinha).toBe(4); // nunca a 3
    expect(c.ressalva).toContain("3");
    expect(c.ressalva).toContain("NÃO será tentada de novo");
    expect(c.ressalva.toLowerCase()).toContain("duplicada");
  });

  it("⚠ lote concluído não oferece retomada", () => {
    expect(conviteParaRetomar({ ...lote, status: STATUS_LOTE.CONCLUIDO })).toBeNull();
  });

  it("⚠ sem linhas restantes depois dela, não há o que retomar", () => {
    const semRestantes = { ...lote, linhas: lote.linhas.slice(0, 2) };
    expect(conviteParaRetomar(semRestantes)).toBeNull();
  });
});

describe("resumoDaEmissao", () => {
  it("conta a partir das LINHAS, e estado novo cai em `outras` em vez de sumir", () => {
    const r = resumoDaEmissao({
      linhas: [
        linha(2, DESFECHO.EMITIDA),
        linha(3, DESFECHO.RECUSADA_RECEITA),
        linha(4, DESFECHO.RECUSADA_NOSSA),
        linha(5, DESFECHO.INDETERMINADA),
        linha(6, DESFECHO.NAO_TENTADA),
        linha(7, "estado_que_ninguem_conhece"),
      ],
    });
    expect(r.total).toBe(6);
    expect(r.emitidas).toBe(1);
    expect(r.recusadas).toBe(2);
    expect(r.indeterminadas).toBe(1);
    expect(r.naoTentadas).toBe(1);
    expect(r.outras).toBe(1);
  });
});

describe("a confirmação", () => {
  it("traz quantas e diz que é definitivo", () => {
    const c = confirmacaoDaEmissao({ prontas: 12, valorTotal: 1800 });
    expect(c.titulo).toContain("12");
    expect(c.aviso.toLowerCase()).toContain("definitiva");
    expect(c.aviso.toLowerCase()).toContain("cancela");
  });

  it("singular e plural", () => {
    expect(confirmacaoDaEmissao({ prontas: 1, valorTotal: 1 }).titulo).toContain("1 nota?");
    expect(confirmacaoDaEmissao({ prontas: 2, valorTotal: 1 }).titulo).toContain("2 notas?");
  });

  it("⚠ soma só as PRONTAS — o total confirmado não pode incluir linha que não vai sair", () => {
    const total = somarValorDasProntas([
      { estado: "pronta", dados: { servico: { valorServicos: 1000 } } },
      { estado: "conferir", dados: { servico: { valorServicos: 5000 } } },
      { estado: "pronta", dados: { servico: { valorServicos: 500 } } },
      { estado: "pendente", dados: null },
    ]);
    expect(total).toBe(1500);
  });
});
