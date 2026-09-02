// O PERFIL DE EMISSÃO NA TELA DO CONTADOR — e o amarre com a autoridade.
//
// ⚠⚠ O CASO QUE MAIS VALE NESTE ARQUIVO é o do fim: ele importa a lista de campos DO BACKEND e
// exige que a espelho daqui tenha os mesmos ids, na mesma ordem, com as mesmas enumerações. Sem
// isso "espelho" é intenção, não fato — e a divergência apareceria como *"a tela ofereceu e o
// servidor recusou"*, que é exatamente o que `codigoServicoDaNota` já pagou uma vez.

import {
  CAMPOS_PERFIL_EMISSAO,
  DESCRICAO_DO_VALOR,
  ESTADO,
  FONTE,
  TEXTO_DA_FONTE,
  fraseDoEfeito,
  lerPainelDaProximaDps,
  textoDoValor,
} from "../perfilEmissao.js";

// ⚠ A autoridade. Importar do backend num teste do front é o que amarra as duas listas.
import { CAMPOS as CAMPOS_DO_BACKEND } from "../../../../../api/src/application/nfse/perfilEmissao/campos.js";

const campo = (over = {}) => ({
  valor: "1", valorHoje: "1", fonte: FONTE.CRAVADO, mudariaComPerfil: false, cravadoHoje: true, ...over,
});

function resposta({ temPerfil = false, campos = {}, avisos = [], integracaoLigada = false } = {}) {
  const base = {
    codigoServicoNacional: campo({ valor: "171901", valorHoje: "171901", fonte: FONTE.COMPANY, cravadoHoje: false }),
    codigoServicoMunicipal: campo({ valor: "001", valorHoje: "001", fonte: FONTE.COMPANY, cravadoHoje: false }),
    cLocPrestacao: campo({ valor: null, valorHoje: null, fonte: FONTE.INDEFINIDO, cravadoHoje: false }),
    regEspTrib: campo({ valor: "0", valorHoje: "0", fonte: FONTE.CRAVADO, cravadoHoje: false }),
    regApTribSN: campo(),
    tribISSQN: campo(),
  };
  return {
    ok: true,
    integracaoLigada,
    proximaDps: { temPerfil, perfisAtivos: temPerfil ? 1 : 0, campos: { ...base, ...campos }, avisos },
  };
}

describe("⚠⚠ três estados, e o terceiro é sobre a RESPOSTA", () => {
  it("resposta ausente é NAO_RECEBIDA — não é 'esta empresa não tem perfil'", () => {
    // Distinguir é o que impede a tela de afirmar coisa sobre o cadastro quando o problema é a
    // chamada. Mesma disciplina de `cargaTributaria.js` no portal do cliente.
    for (const r of [null, undefined, {}, { ok: true }]) {
      expect(lerPainelDaProximaDps(r).estado).toBe(ESTADO.NAO_RECEBIDA);
    }
  });

  it("sem perfil, o painel mostra o comportamento de HOJE", () => {
    const p = lerPainelDaProximaDps(resposta());
    expect(p.estado).toBe(ESTADO.SEM_PERFIL);
    expect(p.linhas).toHaveLength(6);
  });

  it("com perfil, o estado muda", () => {
    expect(lerPainelDaProximaDps(resposta({ temPerfil: true })).estado).toBe(ESTADO.COM_PERFIL);
  });
});

describe("⚠⚠ o CRAVADO é a razão de o painel existir", () => {
  it("os dois campos fixos no gerador chegam marcados, com a frase certa", () => {
    // O contador precisa saber que aquele valor NÃO veio de decisão nenhuma — e que por isso não
    // adianta procurá-lo no cadastro.
    const p = lerPainelDaProximaDps(resposta());
    const porId = Object.fromEntries(p.linhas.map((l) => [l.id, l]));
    expect(porId.regApTribSN.cravadoHoje).toBe(true);
    expect(porId.tribISSQN.cravadoHoje).toBe(true);
    expect(porId.regApTribSN.textoDaFonte).toMatch(/não vem de cadastro nenhum/);
  });

  it("cada linha carrega a TAG e o caminho no XML", () => {
    const p = lerPainelDaProximaDps(resposta());
    const iss = p.linhas.find((l) => l.id === "tribISSQN");
    expect(iss).toMatchObject({ tag: "tribISSQN", caminhoNoXml: "infDPS/valores/trib/tribMun/tribISSQN" });
  });
});

describe("⚠ o valor não sai cru quando ele decide tributação", () => {
  it("código com enumeração vira 'valor — descrição'", () => {
    expect(textoDoValor("tribISSQN", "3")).toBe("3 — Exportação de serviço");
    expect(textoDoValor("regApTribSN", "2")).toMatch(/ISSQN pela NFS-e/);
  });

  it("código sem enumeração sai como está", () => {
    expect(textoDoValor("codigoServicoNacional", "171901")).toBe("171901");
  });

  it("⚠⚠ ausência vira TRAVESSÃO — nunca '0', nunca vazio", () => {
    // Um zero fabricado aqui afirmaria tributação. É a família do `?? 0` que já declarou carga
    // tributária zero ao tomador.
    for (const v of [null, undefined, "", "   "]) {
      expect(textoDoValor("tribISSQN", v)).toBe("—");
    }
  });

  it("as descrições cobrem toda a enumeração dos campos que a têm", () => {
    for (const c of CAMPOS_PERFIL_EMISSAO) {
      if (!c.valores) continue;
      for (const v of c.valores) {
        expect({ campo: c.id, v, tem: Boolean(DESCRICAO_DO_VALOR[c.id]?.[v]) })
          .toEqual({ campo: c.id, v, tem: true });
      }
    }
  });
});

describe("⚠ o que MUDARIA é o que o painel existe para responder", () => {
  it("conta só os campos que sairiam diferentes", () => {
    const p = lerPainelDaProximaDps(resposta({
      temPerfil: true,
      campos: {
        tribISSQN: campo({ valor: "3", valorHoje: "1", fonte: FONTE.PERFIL, mudariaComPerfil: true }),
        regApTribSN: campo({ valor: "1", valorHoje: "1", fonte: FONTE.PERFIL, mudariaComPerfil: false }),
      },
    }));
    expect(p.mudariam).toBe(1);
    expect(p.linhas.find((l) => l.id === "tribISSQN").textoHoje).toBe("1 — Operação tributável");
  });
});

describe("⚠⚠ a tela NÃO promete efeito que não existe", () => {
  it("com a integração desligada, a frase é condicional", () => {
    const f = fraseDoEfeito({ integracaoLigada: false, mudariam: 2 });
    expect(f).toMatch(/ainda NÃO manda no XML/);
    expect(f).toMatch(/sairiam diferentes/);
  });

  it("desligada e sem diferença, ela diz isso — sem sugerir que algo vai mudar", () => {
    expect(fraseDoEfeito({ integracaoLigada: false, mudariam: 0 })).toMatch(/nada sairia diferente/);
  });

  it("ligada, a frase passa ao presente", () => {
    expect(fraseDoEfeito({ integracaoLigada: true, mudariam: 2 })).toMatch(/manda no XML: 2 campo/);
  });

  it("⚠⚠ a flag é lida com `=== true` — `Boolean(\"false\")` é `true`", () => {
    // A armadilha que `portaoEmissao.js` já documenta. Contrato sem a flag NÃO pode ser lido como
    // ligado: seria a tela afirmando que a configuração já manda no documento fiscal.
    for (const v of ["false", "true", 1, 0, undefined, null, "sim"]) {
      const r = resposta();
      r.integracaoLigada = v;
      expect({ v: String(v), lida: lerPainelDaProximaDps(r).integracaoLigada })
        .toEqual({ v: String(v), lida: v === true });
    }
    const ligada = resposta({ integracaoLigada: true });
    expect(lerPainelDaProximaDps(ligada).integracaoLigada).toBe(true);
  });
});

describe("⚠ os avisos do servidor chegam inteiros", () => {
  it("a ambiguidade de perfis é repassada, não reescrita", () => {
    const p = lerPainelDaProximaDps(resposta({ avisos: ["Esta empresa tem 2 perfis ativos…"] }));
    expect(p.avisos).toEqual(["Esta empresa tem 2 perfis ativos…"]);
  });

  it("sem avisos, a lista é vazia — nunca `undefined`", () => {
    const r = resposta();
    delete r.proximaDps.avisos;
    expect(lerPainelDaProximaDps(r).avisos).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("⚠⚠ O AMARRE COM A AUTORIDADE — a lista daqui é espelho, e tem de provar que é", () => {
  it("os mesmos ids, na MESMA ORDEM", () => {
    // A ordem importa: é a ordem em que a tela desenha, e é a ordem da lista do servidor.
    expect(CAMPOS_PERFIL_EMISSAO.map((c) => c.id)).toEqual(CAMPOS_DO_BACKEND.map((c) => c.id));
  });

  it("as mesmas tags e os mesmos caminhos no XML", () => {
    const backend = Object.fromEntries(CAMPOS_DO_BACKEND.map((c) => [c.id, c]));
    for (const c of CAMPOS_PERFIL_EMISSAO) {
      expect({ id: c.id, tag: c.tag, caminho: c.caminhoNoXml })
        .toEqual({ id: c.id, tag: backend[c.id].tag, caminho: backend[c.id].caminhoNoXml });
    }
  });

  it("⚠ as mesmas ENUMERAÇÕES — valor que a tela oferece e o servidor recusa é o defeito", () => {
    const backend = Object.fromEntries(CAMPOS_DO_BACKEND.map((c) => [c.id, c]));
    for (const c of CAMPOS_PERFIL_EMISSAO) {
      expect({ id: c.id, v: c.valores ? [...c.valores] : null })
        .toEqual({ id: c.id, v: backend[c.id].valores ? [...backend[c.id].valores] : null });
    }
  });

  it("⚠ e o mesmo `cravadoHoje` — é ele que o painel usa para explicar a procedência", () => {
    const backend = Object.fromEntries(CAMPOS_DO_BACKEND.map((c) => [c.id, c]));
    for (const c of CAMPOS_PERFIL_EMISSAO) {
      expect({ id: c.id, cravado: c.cravadoHoje })
        .toEqual({ id: c.id, cravado: backend[c.id].cravadoHoje === true });
    }
  });

  it("as quatro procedências têm frase — nenhuma sai como código cru", () => {
    for (const f of Object.values(FONTE)) expect(TEXTO_DA_FONTE[f]).toBeTruthy();
  });
});
