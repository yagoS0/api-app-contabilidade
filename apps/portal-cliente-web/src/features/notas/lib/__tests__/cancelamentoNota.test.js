// A REGRA DO CANCELAMENTO NA TELA DO CLIENTE.
//
// ⚠⚠ O caso mais caro deste arquivo é `podeTentarDeNovo`. Ele é o que DESABILITA o botão depois de
// um desfecho de TRANSPORTE — em que o pedido saiu, a resposta não voltou, e a nota **pode** estar
// cancelada. Errar para o lado permissivo produz um segundo pedido que o sistema nacional recusa,
// e quem lê conclui que o cancelamento falhou quando ele tinha dado certo.

import {
  JUSTIFICATIVA,
  MOTIVOS_CANCELAMENTO,
  MOTIVO_NAO_CANCELAVEL,
  conferirFormulario,
  lerRecusaCancelamento,
  podeCancelar,
} from "../cancelamentoNota";

function nota(patch = {}) {
  return { invoiceId: "inv-1", type: "NFSE", status: "EMITIDA", confirmadaPeloAdn: true, ...patch };
}

/** O erro como `realApi` o lança. */
function erro(code, corpo = {}, message = "") {
  const e = new Error(message);
  e.code = code;
  e.corpo = { error: code, message, ...corpo };
  return e;
}

describe("⚠ a lista é do LEIAUTE, não escolha de produto", () => {
  it("é `1`/`2`/`9` — a `TSCodJustCanc`, de UM caractere", () => {
    expect(MOTIVOS_CANCELAMENTO.map((m) => m.codigo)).toEqual(["1", "2", "9"]);
  });

  it("⚠ NÃO é a lista da SUBSTITUIÇÃO", () => {
    const codigos = MOTIVOS_CANCELAMENTO.map((m) => m.codigo);
    for (const daSubstituicao of ["01", "02", "03", "04", "05", "99"]) {
      expect(codigos).not.toContain(daSubstituicao);
    }
  });

  it("o mínimo/máximo de `xMotivo` bate com o `TSMotivo`", () => {
    expect(JUSTIFICATIVA).toEqual({ MIN: 15, MAX: 255 });
  });
});

describe("podeCancelar", () => {
  it("NFS-e emitida e confirmada: pode", () => {
    expect(podeCancelar(nota())).toMatchObject({ pode: true });
  });

  it.each([["CANCELADA"], ["SUBSTITUIDA"]])("nota %s: não pode", (status) => {
    expect(podeCancelar(nota({ status })).motivo).toBe(MOTIVO_NAO_CANCELAVEL.JA_CANCELADA);
  });

  it("NF-e: não pode — este portal não cancela nota de venda", () => {
    expect(podeCancelar(nota({ type: "NFE" })).motivo).toBe(MOTIVO_NAO_CANCELAVEL.NAO_E_NFSE);
  });

  it("⚠ emitida por nós e ainda não confirmada: não pode (o cancelamento é pela CHAVE)", () => {
    expect(podeCancelar(nota({ confirmadaPeloAdn: false })).motivo).toBe(
      MOTIVO_NAO_CANCELAVEL.NAO_CONFIRMADA
    );
  });

  it("⚠ `undefined` (contrato antigo) é lido como CONFIRMADA", () => {
    const { confirmadaPeloAdn, ...semOCampo } = nota();
    expect(podeCancelar(semOCampo).pode).toBe(true);
  });

  it("todo impedimento tem `resumo` curto — é o que fica ao lado do botão desabilitado", () => {
    for (const patch of [{ status: "CANCELADA" }, { type: "NFE" }, { confirmadaPeloAdn: false }]) {
      const r = podeCancelar(nota(patch));
      expect(r.pode).toBe(false);
      expect(String(r.resumo).length).toBeGreaterThan(0);
      expect(String(r.resumo).length).toBeLessThan(30);
    }
  });
});

// ⚠⚠ NOTA RECEBIDA NÃO SE CANCELA — pedido do dono (20/08/2026):
// *"as notas recebidas não devem ter opção de emitir elas, nem cancelar. Nota recebida foi emitida
// PARA NÓS — não temos controle sobre esse tipo de nota."*
//
// ⚠ A GARANTIA É O SERVIDOR (`routes/client/__tests__/cancelamentoCliente.test.js` chama a rota
// direto). Isto aqui é a conveniência de não oferecer um botão cuja única saída é a recusa.
describe("⚠⚠ nota RECEBIDA", () => {
  const CNPJ = "11222333000181";

  it("`papel: DEST` ⇒ não pode, com motivo próprio", () => {
    const r = podeCancelar(nota({ papel: "DEST" }));
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe(MOTIVO_NAO_CANCELAVEL.RECEBIDA);
    expect(r.texto).toMatch(/emitida PARA a sua empresa/i);
  });

  it("⚠ sem `papel`, a DEDUÇÃO pelo CNPJ pega — a mesma fonte dupla de `podeReaproveitar`", () => {
    const r = podeCancelar(
      nota({
        papel: null,
        tomador: { cnpjCpf: CNPJ },
        emitente: { cnpj: "44555666000177" },
      }),
      { cnpjDaEmpresa: CNPJ }
    );
    expect(r.motivo).toBe(MOTIVO_NAO_CANCELAVEL.RECEBIDA);
  });

  it("⚠⚠ AUSÊNCIA NÃO CASA COM AUSÊNCIA: sem o CNPJ da empresa, nada vira recebida", () => {
    // Comparar "" com "" daria `true` e acusaria TODA nota — travando o cancelamento inteiro.
    const r = podeCancelar(nota({ papel: null, tomador: {}, emitente: {} }), { cnpjDaEmpresa: "" });
    expect(r.pode).toBe(true);
  });

  it("⚠ nota EMITIDA pela empresa (tomador é outro) continua podendo", () => {
    const r = podeCancelar(
      nota({ papel: "EMIT", tomador: { cnpjCpf: "44555666000177" }, emitente: { cnpj: CNPJ } }),
      { cnpjDaEmpresa: CNPJ }
    );
    expect(r.pode).toBe(true);
  });

  it("⚠ o impedimento é da NOTA — a linha já o carrega, e cada botão não repete a frase", () => {
    expect(podeCancelar(nota({ papel: "DEST" })).escopo).toBe("nota");
  });
});

describe("conferirFormulario", () => {
  const bom = { cMotivo: "2", justificativa: "a".repeat(15) };

  it("motivo da lista + 15 caracteres: pronto", () => {
    expect(conferirFormulario(bom).ok).toBe(true);
  });

  it("sem motivo não passa — nem com justificativa boa", () => {
    const r = conferirFormulario({ ...bom, cMotivo: "" });
    expect(r.ok).toBe(false);
    expect(r.erros.map((e) => e.campo)).toContain("cMotivo");
  });

  it("⚠ motivo da lista da SUBSTITUIÇÃO não passa", () => {
    expect(conferirFormulario({ ...bom, cMotivo: "01" }).ok).toBe(false);
  });

  it("14 caracteres não passa, e o erro CONTA quantos há", () => {
    const r = conferirFormulario({ ...bom, justificativa: "a".repeat(14) });
    expect(r.ok).toBe(false);
    expect(r.erros.find((e) => e.campo === "justificativa").texto).toMatch(/14 até agora/);
  });

  it("256 caracteres não passa", () => {
    expect(conferirFormulario({ ...bom, justificativa: "a".repeat(256) }).ok).toBe(false);
  });

  it("⚠ só espaço não é justificativa", () => {
    expect(conferirFormulario({ ...bom, justificativa: " ".repeat(30) }).ok).toBe(false);
  });
});

describe("⚠⚠ lerRecusaCancelamento — `podeTentarDeNovo` é o que desabilita o botão", () => {
  it("TRANSPORTE ⇒ `false`, com o título dizendo que NÃO SE SABE", () => {
    const r = lerRecusaCancelamento(
      erro("nfse_cancelamento_transporte", { camada: "TRANSPORTE", podeTentarDeNovo: false })
    );
    expect(r.podeTentarDeNovo).toBe(false);
    expect(r.titulo).toMatch(/Não sabemos/i);
    expect(r.porQue).toMatch(/N[ÃA]O envie o cancelamento de novo/i);
  });

  it("⚠ TRANSPORTE trava mesmo se o corpo esquecer o booleano — a CAMADA basta", () => {
    const r = lerRecusaCancelamento(erro("qualquer", { camada: "TRANSPORTE" }));
    expect(r.podeTentarDeNovo).toBe(false);
  });

  it("RECEITA ⇒ pode tentar de novo (a nota certamente NÃO foi cancelada)", () => {
    const r = lerRecusaCancelamento(
      erro("nfse_cancelamento_rejeitado", { camada: "RECEITA", podeTentarDeNovo: true }, "E0046")
    );
    expect(r.podeTentarDeNovo).toBe(true);
    expect(r.texto).toBe("E0046");
  });

  it("⚠ AUSÊNCIA do campo NÃO trava — só o `false` explícito trava", () => {
    // Um erro de rede sem corpo não pode desabilitar o botão para sempre; mas `false` tem de valer.
    expect(lerRecusaCancelamento(new Error("network_error")).podeTentarDeNovo).toBe(true);
    expect(lerRecusaCancelamento(erro("x", {})).podeTentarDeNovo).toBe(true);
    expect(lerRecusaCancelamento(erro("x", { podeTentarDeNovo: false })).podeTentarDeNovo).toBe(false);
  });

  it("motivo recusado traz a LISTA ACEITA do servidor", () => {
    const r = lerRecusaCancelamento(
      erro("c_motivo_invalido", { motivosAceitos: [{ codigo: "1", rotulo: "Erro na emissão" }] })
    );
    expect(r.motivosAceitos).toHaveLength(1);
  });

  it("justificativa recusada DIZ de quem é a regra", () => {
    const r = lerRecusaCancelamento(erro("justificativa_curta", {}, "faltam caracteres"));
    expect(r.porQue).toMatch(/leiaute nacional/i);
  });

  it("já cancelada / sem chave ⇒ não adianta tentar de novo", () => {
    expect(lerRecusaCancelamento(erro("nota_ja_cancelada")).podeTentarDeNovo).toBe(false);
    expect(lerRecusaCancelamento(erro("nota_sem_chave")).podeTentarDeNovo).toBe(false);
  });

  it("⚠ código DESCONHECIDO não ganha procedimento inventado", () => {
    const r = lerRecusaCancelamento(erro("algo_que_esta_tela_nao_conhece"));
    expect(r.porQue).toBeNull();
    expect(`${r.titulo} ${r.texto}`).not.toMatch(/tente de novo|aguarde|recarregue/i);
  });
});
