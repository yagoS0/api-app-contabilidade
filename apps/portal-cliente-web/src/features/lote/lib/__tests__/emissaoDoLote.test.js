// AS REGRAS DE TELA DA EMISSÃO EM LOTE.
//
// ⚠ NADA AQUI EMITE — são funções puras sobre o relatório que o servidor devolve.

import fs from "node:fs";
import path from "node:path";
import {
  DESFECHO,
  DESFECHOS_RETENTAVEIS,
  STATUS_LOTE,
  avisoDaLinhaIndeterminada,
  confirmacaoDaEmissao,
  conviteParaRetentar,
  conviteParaRetomar,
  podeRetentar,
  resumoDaEmissao,
  somarValorDasProntas,
  textoDoDesfecho,
  textoDoReconhecimento,
} from "../emissaoDoLote";
// ⚠⚠ A AUTORIDADE, importada de verdade — o mesmo arranjo de `codigoServicoDaNota.test.js`. É isto
// que transforma "espelho" de intenção em fato: a regra do servidor é rodada nos MESMOS casos, e
// exige o MESMO veredito.
import {
  podeRetentar as podeRetentarNoServidor,
  DESFECHOS_RETENTAVEIS as RETENTAVEIS_DO_SERVIDOR,
} from "../../../../../../api/src/application/nfse/lote/emissaoLote.js";

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
  //
  // ⚠⚠ E A LISTA É LIDA DO CSS, não copiada à mão (23/08/2026). Copiada, ela tem exatamente o
  // problema que existe para resolver: alguém renomeia a regra no `app.css` e a cópia continua
  // verde. É como `guias/__tests__/chipDaGuiaTemCor.test.js` já faz.
  const VALIDOS = [
    ...new Set(
      [...fs.readFileSync(path.join(__dirname, "../../../../styles/app.css"), "utf8")
        .matchAll(/\.chip\[data-status="([^"]+)"\]/g)].map((m) => m[1]),
    ),
  ];

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A RETENTATIVA — E O AMARRE COM O BACKEND
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Caso real, 21/08/2026: lote de 3 notas recusado por erro de esquema (`E1235`), consertado, e a
// > tela dizendo *"já havia sido emitida"* com **0 emitidas**.
//
// ⚠⚠ A AUTORIDADE É O BACKEND, e o teste IMPORTA A FUNÇÃO DE LÁ para exigir o mesmo veredito nos
// mesmos casos. Sem isso, "espelho" é intenção — e a divergência apareceria como *"a tela ofereceu
// e o servidor recusou"*, na tela que emite nota fiscal em série.

describe("⚠⚠ a regra de retentabilidade — espelho do backend, amarrado a ele", () => {
  const CASOS = [
    { desfecho: DESFECHO.EMITIDA, pode: false },
    { desfecho: DESFECHO.INDETERMINADA, pode: false },
    { desfecho: DESFECHO.ENVIANDO, pode: false },
    { desfecho: DESFECHO.RECUSADA_RECEITA, pode: true },
    { desfecho: DESFECHO.RECUSADA_NOSSA, pode: true },
    { desfecho: DESFECHO.NAO_TENTADA, pode: true },
    { desfecho: "estado_que_ainda_nao_existe", pode: false },
  ];

  it.each(CASOS)("`$desfecho` ⇒ retentável: $pode", ({ desfecho, pode }) => {
    expect(podeRetentar({ numeroLinha: 2, desfecho })).toBe(pode);
  });

  // ⚠⚠ O AMARRE. Muda lá, cai aqui.
  it.each(CASOS)("⚠⚠ o BACKEND concorda sobre `$desfecho`", ({ desfecho, pode }) => {
    expect(podeRetentarNoServidor({ numeroLinha: 2, desfecho })).toBe(pode);
  });

  it("⚠⚠ a lista de retentáveis é IDÊNTICA à do backend", () => {
    expect([...DESFECHOS_RETENTAVEIS].sort()).toEqual([...RETENTAVEIS_DO_SERVIDOR].sort());
  });

  it("⚠ a linha NOMEADA em `linhaIndeterminada` fica fora, nos dois lados", () => {
    const lote = { linhaIndeterminada: 4 };
    const linha = { numeroLinha: 4, desfecho: DESFECHO.RECUSADA_RECEITA };
    expect(podeRetentar(linha, lote)).toBe(false);
    expect(podeRetentarNoServidor(linha, lote)).toBe(false);
  });
});

describe("⚠⚠ o convite para retentar", () => {
  it("⚠⚠ O CASO PARCIAL: 2 emitidas + 1 recusada oferece UMA, e a ressalva nomeia as outras", () => {
    const convite = conviteParaRetentar({
      linhas: [
        linha(2, DESFECHO.EMITIDA),
        linha(3, DESFECHO.EMITIDA),
        linha(4, DESFECHO.RECUSADA_RECEITA),
      ],
    });
    expect(convite.quantas).toBe(1);
    expect(convite.emitidas).toBe(2);
    expect(convite.naoSeraoTentadas).toBe(2);
    expect(convite.rotuloDoBotao).toMatch(/1 nota/);
    // ⚠ A frase que impede alguém de achar que retentar reemite TUDO.
    expect(convite.ressalva).toMatch(/já viraram nota fiscal e NÃO serão emitidas/);
  });

  it("⚠⚠ lote inteiramente EMITIDO não oferece nada — a idempotência de sempre", () => {
    expect(conviteParaRetentar({ linhas: [linha(2, DESFECHO.EMITIDA), linha(3, DESFECHO.EMITIDA)] })).toBeNull();
  });

  it("o lote do caso real — 3 recusadas — oferece as três, SEM ressalva", () => {
    const convite = conviteParaRetentar({
      linhas: [2, 3, 4].map((n) => linha(n, DESFECHO.RECUSADA_RECEITA)),
    });
    expect(convite.quantas).toBe(3);
    // ⚠ Nada bloqueado ⇒ nenhuma frase: não há mal-entendido a desfazer, e o dono corta a legenda
    // que só descreve uma ausência já visível.
    expect(convite.ressalva).toBeNull();
  });

  it("⚠ a linha indeterminada entra na ressalva com o motivo dela, nunca como 'emitida'", () => {
    const convite = conviteParaRetentar({
      linhaIndeterminada: 3,
      linhas: [linha(2, DESFECHO.RECUSADA_RECEITA), linha(3, DESFECHO.INDETERMINADA)],
    });
    expect(convite.quantas).toBe(1);
    expect(convite.indeterminadas).toBe(1);
    expect(convite.ressalva).toMatch(/desfecho desconhecido/i);
    expect(convite.ressalva).not.toMatch(/já virou nota fiscal/);
  });

  it("⚠⚠ estado que esta tela NÃO conhece não some da contagem — nem vira retentável", () => {
    const convite = conviteParaRetentar({
      linhas: [linha(2, DESFECHO.RECUSADA_RECEITA), linha(3, "estado_novo_do_backend")],
    });
    expect(convite.quantas).toBe(1);
    expect(convite.naoSeraoTentadas).toBe(1);
    // O bloqueio existe e é contado, mesmo sem nome próprio.
    expect(convite.ressalva).toMatch(/1 não pôde ser tentada/);
  });
});

describe("⚠⚠ `textoDoReconhecimento` — a frase que substituiu a mentira", () => {
  it("⚠⚠ ZERO EMITIDAS não diz 'já havia sido emitida'", () => {
    const t = textoDoReconhecimento({ linhas: [2, 3, 4].map((n) => linha(n, DESFECHO.RECUSADA_RECEITA)) });
    expect(t).not.toMatch(/já havia sido emitida/i);
    expect(t).toMatch(/NENHUMA nota foi emitida/);
  });

  it("tudo emitido diz que as notas foram emitidas", () => {
    const t = textoDoReconhecimento({ linhas: [linha(2, DESFECHO.EMITIDA), linha(3, DESFECHO.EMITIDA)] });
    expect(t).toMatch(/as 2 notas foram emitidas/);
  });

  it("parcial diz QUANTAS de quantas — nunca 'a planilha foi emitida'", () => {
    const t = textoDoReconhecimento({
      linhas: [linha(2, DESFECHO.EMITIDA), linha(3, DESFECHO.RECUSADA_RECEITA), linha(4, DESFECHO.EMITIDA)],
    });
    expect(t).toMatch(/2 de 3/);
  });

  it("⚠ em todos os casos ela afirma que NADA foi emitido agora", () => {
    const casos = [
      [linha(2, DESFECHO.RECUSADA_RECEITA)],
      [linha(2, DESFECHO.EMITIDA)],
      [linha(2, DESFECHO.EMITIDA), linha(3, DESFECHO.RECUSADA_NOSSA)],
    ];
    for (const linhas of casos) {
      expect(textoDoReconhecimento({ linhas })).toMatch(/nada foi emitido agora|nenhuma nota nova foi emitida agora/i);
    }
  });
});
