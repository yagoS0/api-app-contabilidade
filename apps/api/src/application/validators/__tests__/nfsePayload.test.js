// O VALIDADOR NÃO PODE ENGOLIR UM ZERO LEGÍTIMO.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// `parseNumber(totTrib.pTotTribSN || body.pTotTribSN)` usava `||`. Em JavaScript `0 || undefined`
// é `undefined`, então um `pTotTribSN` informado como **0,00** chegava ao serviço como AUSENTE — e
// `buildDpsXml` recusava a emissão com `MISSING_P_TOT_TRIB_SN`, isto é, "você não informou" para
// quem tinha informado. O `??` só cai para a segunda fonte quando a primeira é nula/ausente, que é
// o que a expressão sempre quis dizer.
//
// O outro campo novo é o `cLocPrestacao`: antes não existia, e `buildDpsXml` cravava
// `cLocPrestacao = cLocEmi` com um comentário "por enquanto assume igual". É o campo que decide
// para QUAL MUNICÍPIO o ISSQN é devido.

import { validateNfsePayload } from "../nfsePayload.js";

const BASE = {
  companyId: "portal-1",
  tomador: {
    cnpjCpf: "12219079724",
    nome: "yago silva",
    endereco: { cMun: "3304557", cep: "20000000", logradouro: "RUA X", numero: "1", bairro: "CENTRO" },
  },
  servico: { descricao: "serviços contabeis", valorServicos: 100, aliquota: 5 },
  competencia: "2026-01-23",
};

describe("pTotTribSN", () => {
  it("⚠ ZERO informado sobrevive à validação (o `||` o transformava em ausente)", () => {
    const r = validateNfsePayload({ ...BASE, totTrib: { pTotTribSN: 0 } });
    expect(r.ok).toBe(true);
    expect(r.data.totTrib.pTotTribSN).toBe(0);
    expect(r.data.totTrib.pTotTribSN).not.toBeNull();
  });

  it("valor normal passa; ausência continua sendo ausência (null)", () => {
    expect(validateNfsePayload({ ...BASE, totTrib: { pTotTribSN: 6.5 } }).data.totTrib.pTotTribSN).toBe(6.5);
    expect(validateNfsePayload(BASE).data.totTrib.pTotTribSN).toBeNull();
  });

  it("recusa fora de 0–100 — é PERCENTUAL, não valor em reais", () => {
    // O erro que isto pega é o valor do serviço digitado no campo da alíquota efetiva.
    expect(validateNfsePayload({ ...BASE, totTrib: { pTotTribSN: 1500 } })).toEqual({
      ok: false,
      error: "p_tot_trib_sn_invalido",
    });
    expect(validateNfsePayload({ ...BASE, totTrib: { pTotTribSN: -1 } }).ok).toBe(false);
  });

  it("aceita os percentuais do NÃO optante (Lei 12.741/2012)", () => {
    const r = validateNfsePayload({
      ...BASE,
      totTrib: { pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 5 },
    });
    expect(r.ok).toBe(true);
    expect(r.data.totTrib).toMatchObject({ pTotTribFed: 11.33, pTotTribEst: 0, pTotTribMun: 5 });
  });

  it("recusa percentual do não optante fora da faixa, nomeando o campo", () => {
    expect(validateNfsePayload({ ...BASE, totTrib: { pTotTribFed: 101 } }).error).toBe(
      "pTotTribFed_invalido"
    );
  });
});

describe("cLocPrestacao — local da prestação", () => {
  it("ausente é null: o serviço aplica a regra geral EXPLICITAMENTE", () => {
    expect(validateNfsePayload(BASE).data.servico.cLocPrestacao).toBeNull();
  });

  it("7 dígitos passam", () => {
    const r = validateNfsePayload({
      ...BASE,
      servico: { ...BASE.servico, cLocPrestacao: "3106200" },
    });
    expect(r.data.servico.cLocPrestacao).toBe("3106200");
  });

  it("⚠ código incompleto RECUSA — antes o padStart o completaria com zeros", () => {
    // `"3304"` viraria `"0003304"`, um município plausível e errado.
    expect(validateNfsePayload({ ...BASE, servico: { ...BASE.servico, cLocPrestacao: "3304" } })).toEqual({
      ok: false,
      error: "servico_local_prestacao_invalido",
    });
  });
});

// ── O CÓDIGO DE SERVIÇO DA NOTA (`cTribNac`) ───────────────────────────────────────────────────
//
// ⚠ AQUI SÓ SE CONFERE A FORMA. A pergunta "este código vale para ESTA empresa?" depende do
// CADASTRO, que o validador não lê — quem responde é `escolherCodigoServicoNacional`, no pré-voo
// de `NfseService.issue` (testes em `nfse/__tests__/codigoServicoDaNota.test.js` e a prova sobre o
// XML em `emissaoDps.test.js`).
describe("servico.codigoServicoNacional", () => {
  it("ausente é null — 'ninguém escolheu', e o cadastro continua mandando", () => {
    expect(validateNfsePayload(BASE).data.servico.codigoServicoNacional).toBeNull();
  });

  it("6 dígitos passam e viajam normalizados", () => {
    const r = validateNfsePayload({
      ...BASE,
      servico: { ...BASE.servico, codigoServicoNacional: "31.01.04" },
    });
    expect(r.ok).toBe(true);
    expect(r.data.servico.codigoServicoNacional).toBe("310104");
  });

  it("aceita o apelido `cTribNac` (é o nome da tag no XML)", () => {
    const r = validateNfsePayload({ ...BASE, servico: { ...BASE.servico, cTribNac: "171201" } });
    expect(r.data.servico.codigoServicoNacional).toBe("171201");
  });

  it("⚠ forma errada RECUSA — não se completa com zero à esquerda", () => {
    // `\"10101\"` é o que a planilha oficial devolve quando a coluna é lida como número; virar
    // `\"010101\"` aqui seria o padStart escolhendo um serviço que ninguém digitou.
    expect(validateNfsePayload({ ...BASE, servico: { ...BASE.servico, codigoServicoNacional: "10101" } })).toEqual({
      ok: false,
      error: "servico_codigo_nacional_invalido",
    });
  });
});

// ── O DÍGITO VERIFICADOR DO CPF DO TOMADOR — pedido do dono, 18/08/2026 ────────────────────────
//
// ⚠ Antes disto, 11 dígitos QUAISQUER entravam: o projeto não tinha nenhuma validação de DV. Com o
// caminho apontado para produção, um dígito trocado emite nota contra outra pessoa.
// ⚠ **Validação LOCAL, e só** — nada é consultado (ver `utils/cpf.js`).
describe("documento do tomador", () => {
  const comDoc = (cnpjCpf) => validateNfsePayload({ ...BASE, tomador: { ...BASE.tomador, cnpjCpf } });

  it("CPF com DV válido passa", () => {
    expect(comDoc("11144477735").ok).toBe(true);
    expect(comDoc("111.444.777-35").data.tomador.doc).toBe("11144477735");
  });

  it("⚠ CPF com DV inválido recusa com código PRÓPRIO, distinto de documento ausente", () => {
    // Conserto diferente: "não preenchi o campo" × "digitei o número errado".
    expect(comDoc("11144477734")).toEqual({ ok: false, error: "tomador_cpf_digito_invalido" });
    expect(comDoc("").error).toBe("tomador_documento_invalido");
    expect(validateNfsePayload({ ...BASE, tomador: { nome: "x" } }).error).toBe("tomador_documento_invalido");
  });

  it("⚠ sequência repetida recusa — é o preenchimento para o formulário deixar seguir", () => {
    expect(comDoc("11111111111").error).toBe("tomador_cpf_digito_invalido");
  });

  it("⚠ O CNPJ SEGUE COMO ESTAVA — nenhuma validação de DV foi acrescentada a ele", () => {
    // Validar o DV do CNPJ não foi pedido; inventá-lo passaria a recusar tomador legítimo com
    // cadastro velho, sem que ninguém tivesse decidido isso.
    expect(comDoc("11222333000181").ok).toBe(true);
    expect(comDoc("00000000000000").ok).toBe(true);
  });

  it("comprimento fora de 11/14 continua sendo 'documento inválido'", () => {
    expect(comDoc("1114447773").error).toBe("tomador_documento_invalido");
  });
});
