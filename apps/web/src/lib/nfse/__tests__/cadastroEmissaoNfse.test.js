// A REGRA dos três campos de emissão de NFS-e — a que o formulário e o assistente compartilham.
//
// O que este arquivo tranca:
//   1. o espelho de `REQUIRED_COMPANY_FIELDS` (`api/application/nfse/NfseService.js`) não pode
//      divergir: se ele divergir, a tela promete um desfecho e o servidor entrega outro;
//   2. a validação é de FORMA e só da forma que uma fonte já versionada no projeto prova — nada de
//      lista de serviços inventada, nada de default, nada derivado do CNAE;
//   3. o corte dos últimos 3 dígitos do código municipal é ANUNCIADO, não silencioso.

import {
  lerCodigoServicoNacional,
  lerCodigoServicoMunicipal,
  lerRpsSerie,
  digitosQueVaoParaDps,
  faltasParaEmitir,
  lerPercentualCarga,
  faltasDaCargaTributaria,
  CAMPOS_EXIGIDOS_PARA_EMITIR,
  CAMPOS_CARGA_TRIBUTARIA,
  SERIE_MIN,
  SERIE_MAX,
} from "../cadastroEmissaoNfse";

const COMPLETA = {
  cnpj: "11222333000181",
  inscricaoMunicipal: "1.234.567-8",
  codigoServicoNacional: "171201",
  codigoServicoMunicipal: "001",
  rpsSerie: "00001",
};

describe("código nacional do serviço (cTribNac)", () => {
  // Fonte: `docs/nfse-preenchimento.md` §5 ("6 dígitos numéricos. Ex.: 171201") e o exemplo do §12,
  // da única emissão que este projeto já produziu com `status:"issued"`.
  it("aceita os 6 dígitos e devolve só os dígitos", () => {
    expect(lerCodigoServicoNacional("171201")).toEqual({ preenchido: true, valor: "171201", problema: null });
  });

  it("aceita a escrita com pontos (17.12.01) — máscara não é erro de forma", () => {
    expect(lerCodigoServicoNacional("17.12.01").valor).toBe("171201");
  });

  it("comprimento diferente de 6 é problema NOMEADO, nunca truncamento", () => {
    const r = lerCodigoServicoNacional("1712");
    expect(r.valor).toBeNull();
    expect(r.problema).toMatch(/6 dígitos/);
  });

  it("vazio NÃO é problema — é ausência, e quem responde por ela é `faltasParaEmitir`", () => {
    expect(lerCodigoServicoNacional("")).toEqual({ preenchido: false, valor: null, problema: null });
    expect(lerCodigoServicoNacional(null).problema).toBeNull();
  });
});

describe("código municipal do serviço (cTribMun)", () => {
  it("aceita 3 dígitos", () => {
    expect(lerCodigoServicoMunicipal("001").valor).toBe("001");
  });

  // ⚠ A fonte prova que o XML leva os ÚLTIMOS 3 dígitos, não que o código publicado pelo município
  // tenha 3. Exigir 3 aqui seria inventar uma máscara e recusar código legítimo mais longo.
  it("aceita código mais longo — o comprimento do código municipal não está provado", () => {
    expect(lerCodigoServicoMunicipal("10203").valor).toBe("10203");
  });

  it("valor sem nenhum dígito é recusado", () => {
    expect(lerCodigoServicoMunicipal("n/a").problema).toMatch(/numérico/);
  });

  describe("o corte dos últimos 3 dígitos é ANUNCIADO", () => {
    it("devolve exatamente o que o backend manda no XML (`.slice(-3)`)", () => {
      expect(digitosQueVaoParaDps("10203")).toBe("203");
    });

    it("quando o código já tem 3 dígitos, o corte não muda nada", () => {
      expect(digitosQueVaoParaDps("001")).toBe("001");
    });

    it("sem valor não há o que anunciar", () => {
      expect(digitosQueVaoParaDps("")).toBeNull();
      expect(digitosQueVaoParaDps("n/a")).toBeNull();
    });
  });
});

describe("série da DPS (RN E0010)", () => {
  it("normaliza para os 5 dígitos do XML — 1 e 00001 são a MESMA série", () => {
    expect(lerRpsSerie("1").valor).toBe("00001");
    expect(lerRpsSerie("00001").valor).toBe("00001");
  });

  it("os dois extremos da faixa do aplicativo próprio passam", () => {
    expect(lerRpsSerie(String(SERIE_MIN)).valor).toBe("00001");
    expect(lerRpsSerie(String(SERIE_MAX)).valor).toBe("49999");
  });

  it("fora da faixa é recusa — as outras faixas são do Emissor Móvel/Web e da transcrição", () => {
    expect(lerRpsSerie("0").problema).toMatch(/E0010/);
    expect(lerRpsSerie(String(SERIE_MAX + 1)).problema).toMatch(/E0010/);
  });

  it('⚠ "UNICA" é RECUSADA, não convertida em 21 pelo "U"', () => {
    // A tradução "letra vira número" existia em `buildDpsId` e foi abandonada de propósito: série é
    // identificação fiscal e não se traduz sozinha. Se algum dia alguém a reintroduzir, isto cai.
    const r = lerRpsSerie("UNICA");
    expect(r.valor).toBeNull();
    expect(r.problema).toMatch(/numérica/);
  });
});

describe("o que falta para a empresa emitir", () => {
  it("⚠ espelha `REQUIRED_COMPANY_FIELDS` do backend, na mesma ordem", () => {
    // Mudou a lista em `api/application/nfse/NfseService.js`? Este teste cai, e é para cair: a tela
    // existe justamente para dizer, ANTES do clique, o que aquela função vai recusar.
    expect(CAMPOS_EXIGIDOS_PARA_EMITIR.map((c) => c.campo)).toEqual([
      "cnpj",
      "inscricaoMunicipal",
      "codigoServicoNacional",
      "codigoServicoMunicipal",
      "rpsSerie",
    ]);
  });

  it("empresa configurada não tem falta nenhuma", () => {
    expect(faltasParaEmitir(COMPLETA)).toEqual([]);
  });

  it("empresa vazia lista os cinco, cada um com rótulo, motivo e ONDE preencher", () => {
    const faltas = faltasParaEmitir({});
    expect(faltas).toHaveLength(5);
    for (const f of faltas) {
      expect(f.rotulo).toBeTruthy();
      expect(f.motivo).toBeTruthy();
      // "Configuração incompleta" mandaria o contador procurar. O lugar viaja junto do campo.
      expect(f.onde).toMatch(/Editar cadastro/);
      expect(f.motivoCurto).toContain(f.onde);
    }
  });

  it("nomeia SÓ o que falta — os três novos, quando o resto está lá", () => {
    const faltas = faltasParaEmitir({ cnpj: COMPLETA.cnpj, inscricaoMunicipal: COMPLETA.inscricaoMunicipal });
    expect(faltas.map((f) => f.campo)).toEqual([
      "codigoServicoNacional",
      "codigoServicoMunicipal",
      "rpsSerie",
    ]);
  });

  it("mede presença como o servidor mede (`!company[campo]`) — string vazia é ausência", () => {
    expect(faltasParaEmitir({ ...COMPLETA, rpsSerie: "" }).map((f) => f.campo)).toEqual(["rpsSerie"]);
    expect(faltasParaEmitir({ ...COMPLETA, codigoServicoMunicipal: null }).map((f) => f.campo))
      .toEqual(["codigoServicoMunicipal"]);
  });

  it("⚠ nada é derivado: CNAE e município no objeto não preenchem código de serviço nenhum", () => {
    // Se algum dia alguém "ajudar" convertendo CNAE em cTribNac, este teste cai — que é o ponto. A
    // lista da LC 116 não está neste repositório e o erro sairia como serviço errado na nota.
    const faltas = faltasParaEmitir({ ...COMPLETA, codigoServicoNacional: null, cnaePrincipal: "6920601" });
    expect(faltas.map((f) => f.campo)).toEqual(["codigoServicoNacional"]);
  });

  it("objeto ausente não explode e não afirma nada além do que falta", () => {
    expect(faltasParaEmitir(null)).toHaveLength(5);
  });
});

// ── CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012) — dono, 18/08/2026 ────────────────────────
//
// > *"as alíquotas efetivas do presumido não precisam ser calculadas a não ser o ISS que varia de
// > município, mas deve ser configurado do lado do contador, no portal do contador."*
describe("lerPercentualCarga — percentual, e nada mais", () => {
  it("aceita vírgula E ponto como decimal — o contador digita 11,33", () => {
    expect(lerPercentualCarga("11,33").valor).toBe(11.33);
    expect(lerPercentualCarga("11.33").valor).toBe(11.33);
  });

  it("⚠ 11.33 NÃO vira 1133 — o ponto aqui é decimal, não milhar", () => {
    // O normalizador de MOEDA do backend (`asNumberOrNull`) faz `.replace(/\./g, "")` porque em
    // real o ponto é separador de milhar. Percentual de 0 a 100 não tem milhar, e reusar aquela
    // regra faria "11.33" virar 1133 — recusado como fora da faixa, ou pior, gravado.
    expect(lerPercentualCarga("11.33").valor).not.toBe(1133);
  });

  it("⚠ ZERO é um valor, não ausência — e é o caso comum do estadual", () => {
    const leitura = lerPercentualCarga("0");
    expect(leitura.preenchido).toBe(true);
    expect(leitura.valor).toBe(0);
    expect(leitura.problema).toBeNull();
  });

  it("vazio é AUSÊNCIA, não problema — a maioria da carteira ainda não configurou", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(lerPercentualCarga(v)).toEqual({ preenchido: false, valor: null, problema: null });
    }
  });

  it("fora de 0–100 é problema — é outra unidade, não um número grande", () => {
    expect(lerPercentualCarga("101").problema).toBeTruthy();
    expect(lerPercentualCarga("1133").problema).toBeTruthy();
  });

  it("mais de duas casas é problema — o XML leva duas", () => {
    expect(lerPercentualCarga("11,333").problema).toBeTruthy();
  });

  it("texto e sinal são recusados, nunca convertidos", () => {
    for (const v of ["cinco", "-1", "5%", "1e2"]) {
      expect(lerPercentualCarga(v).problema).toBeTruthy();
      expect(lerPercentualCarga(v).valor).toBeNull();
    }
  });
});

describe("faltasDaCargaTributaria — o espelho do portão que exige os TRÊS", () => {
  it("nenhum preenchido: faltam os três", () => {
    expect(faltasDaCargaTributaria({}).map((c) => c.campo)).toEqual(
      CAMPOS_CARGA_TRIBUTARIA.map((c) => c.campo)
    );
  });

  it("⚠⚠ só o municipal: faltam federal e estadual — era assim que a nota saía com 0,00", () => {
    const faltas = faltasDaCargaTributaria({ pTotTribMun: "2,5" });
    expect(faltas.map((c) => c.campo)).toEqual(["pTotTribFed", "pTotTribEst"]);
  });

  it("⚠ ZERO CONTA COMO PREENCHIDO — é a diferença entre declarado e esquecido", () => {
    expect(faltasDaCargaTributaria({ pTotTribFed: "11,33", pTotTribEst: "0", pTotTribMun: "0" }))
      .toHaveLength(0);
  });

  it("objeto ausente não explode", () => {
    expect(faltasDaCargaTributaria(null)).toHaveLength(3);
  });

  it("⚠ a ordem é a do XML: Fed · Est · Mun (a da NFS-e real versionada)", () => {
    expect(CAMPOS_CARGA_TRIBUTARIA.map((c) => c.campo)).toEqual([
      "pTotTribFed",
      "pTotTribEst",
      "pTotTribMun",
    ]);
  });
});
