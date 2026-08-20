// BENEFÍCIO MUNICIPAL DO ISSQN — a REGRA, sozinha (a ligação com a tela está em
// `features/companies/form/components/__tests__/camposEmissaoNfse.test.jsx`).
//
// ⚠⚠ POR QUE ESTE ARQUIVO É MAIS DURO QUE OS DEMAIS DESTA PASTA: benefício fiscal REDUZ IMPOSTO.
// Um cadastro incoerente que passe daqui é, assim que o envio ao XML existir, uma nota com imposto
// a MENOS — e ninguém confere um imposto menor. Cada asserção abaixo espelha uma recusa nomeada do
// backend (`normalizeCamposEmissaoNfse`, em `apps/api/src/application/company/companyProfile.js`).
//
// FONTE de cada regra, versionada em `docs/leiaute-nfse/documentacao-tecnica/`:
//   • `TSNumBeneficioMunicipal` = `[0-9]{14}` (`tiposSimples_v1.01.xsd:957`), com a formação
//     7 IBGE + 2 tipo + 5 sequencial na documentação do próprio tipo;
//   • `TCBeneficioMunicipal` (`tiposComplexos_v1.01.xsd:1931`): `nBM` 1-1 e um `xs:choice` entre
//     `vRedBCBM` e `pRedBCBM` com os DOIS filhos `minOccurs="0"`;
//   • ANEXO_I, aba `RN DPS_NFS-e`: `E0565`/`E0577` (cada redução só vale para o TIPO
//     correspondente do benefício) e `E0541` (o número tem de existir para o município).

import {
  TAMANHO_NBM,
  TIPOS_REDUCAO_BM,
  PROBLEMA_NBM,
  PROBLEMA_P_RED_BC,
  BENEFICIO_NAO_VAI_NO_XML,
  lerNumeroBeneficioMunicipal,
  lerPercentualReducaoBM,
  decomporNumeroBeneficioMunicipal,
  problemasDoBeneficioMunicipal,
} from "../cadastroEmissaoNfse";

describe("lerNumeroBeneficioMunicipal — valida a FORMA, nunca o conteúdo", () => {
  it("aceita os 14 dígitos e devolve só os dígitos", () => {
    // A máscara do ofício da prefeitura não é recusada — o que vai para a coluna é `[0-9]{14}`.
    expect(lerNumeroBeneficioMunicipal("3304557.02.00123").valor).toBe("33045570200123");
    expect(lerNumeroBeneficioMunicipal("33045570200123").problema).toBeNull();
  });

  it("⚠ vazio NÃO é problema — é ausência, e a maioria das empresas não tem benefício", () => {
    const leitura = lerNumeroBeneficioMunicipal("");
    expect(leitura).toEqual({ preenchido: false, valor: null, problema: null });
  });

  it.each(["3304557020012", "330455702001234", "abc"])(
    "%s não tem a forma oficial e é recusado com o motivo",
    (entrada) => {
      const leitura = lerNumeroBeneficioMunicipal(entrada);
      expect(leitura.valor).toBeNull();
      expect(leitura.problema).toBe(PROBLEMA_NBM);
    }
  );

  it("⚠ a forma é a do XSD e nada além dela — 14, e o número não é conferido", () => {
    expect(TAMANHO_NBM).toBe(14);
    // Um número com a forma certa e conteúdo inventado PASSA aqui de propósito: quem responde
    // "este benefício existe para este município?" é o fisco (`E0541`), não esta tela.
    expect(lerNumeroBeneficioMunicipal("99999999999999").problema).toBeNull();
  });
});

describe("decomporNumeroBeneficioMunicipal — conferência, não validação", () => {
  it("quebra nas três partes que a fonte descreve", () => {
    expect(decomporNumeroBeneficioMunicipal("33045570200123")).toEqual({
      municipioIbge: "3304557",
      tipo: "02",
      tipoRotulo: "regimes especiais",
      sequencial: "00123",
    });
  });

  it("⚠ tipo fora dos quatro documentados NÃO é recusa — só fica sem rótulo", () => {
    // A forma oficial é `[0-9]{14}`; a lista de tipos está na documentação do tipo, e traduzi-la
    // em recusa inventaria uma regra que a fonte não escreveu.
    const partes = decomporNumeroBeneficioMunicipal("33045570900123");
    expect(partes.tipo).toBe("09");
    expect(partes.tipoRotulo).toBeNull();
  });

  it("número fora da forma não produz leitura nenhuma", () => {
    expect(decomporNumeroBeneficioMunicipal("330455702")).toBeNull();
  });
});

describe("lerPercentualReducaoBM", () => {
  it("aceita vírgula E ponto — percentual não tem separador de milhar", () => {
    expect(lerPercentualReducaoBM("40,5").valor).toBe(40.5);
    expect(lerPercentualReducaoBM("40.5").valor).toBe(40.5);
  });

  it("⚠ zero é um valor, não um vazio — quem consumir isto não pode usar `||`", () => {
    const leitura = lerPercentualReducaoBM("0");
    expect(leitura.preenchido).toBe(true);
    expect(leitura.valor).toBe(0);
  });

  it.each(["140", "-1", "1.234,00"])("%s é recusado com o motivo", (entrada) => {
    expect(lerPercentualReducaoBM(entrada).problema).toBe(PROBLEMA_P_RED_BC);
  });
});

describe("problemasDoBeneficioMunicipal — espelho das recusas do servidor", () => {
  it("empresa sem benefício nenhum: nada a dizer", () => {
    expect(problemasDoBeneficioMunicipal({})).toEqual([]);
    expect(problemasDoBeneficioMunicipal({ numero: "", tipoReducao: "", pRedBC: "" })).toEqual([]);
  });

  it("⚠ benefício SEM redução de base é cadastro completo — não é 'faltou preencher'", () => {
    // O `xs:choice` tem os dois filhos opcionais, e o `E0612` cita benefícios de "Isenção" e
    // "Alíquota Diferenciada". Exigir uma redução aqui recusaria um cadastro legítimo.
    expect(problemasDoBeneficioMunicipal({
      numero: "33045570200123",
      tipoReducao: "SEM_REDUCAO",
    })).toEqual([]);
  });

  it("benefício por percentual, completo: nada a dizer", () => {
    expect(problemasDoBeneficioMunicipal({
      numero: "33045570200123",
      tipoReducao: "PERCENTUAL",
      pRedBC: "40",
    })).toEqual([]);
  });

  it("⚠ redução sem o NÚMERO do benefício aponta para concessão nenhuma", () => {
    const p = problemasDoBeneficioMunicipal({ tipoReducao: "PERCENTUAL", pRedBC: "40" });
    expect(p.map((x) => x.erro)).toContain("company_beneficio_municipal_sem_numero");
  });

  it("⚠ percentual com tipo VALOR é recusa (E0565/E0577) — os dois não são intercambiáveis", () => {
    const p = problemasDoBeneficioMunicipal({
      numero: "33045570200123",
      tipoReducao: "VALOR",
      pRedBC: "40",
    });
    expect(p.map((x) => x.erro)).toContain("company_beneficio_municipal_percentual_fora_do_tipo");
  });

  it("tipo PERCENTUAL sem o percentual é cadastro pela metade", () => {
    const p = problemasDoBeneficioMunicipal({ numero: "33045570200123", tipoReducao: "PERCENTUAL" });
    expect(p.map((x) => x.erro)).toContain("company_beneficio_municipal_percentual_ausente");
  });

  it("⚠ número SEM tipo é pendência, não recusa — o servidor grava, mas o cadastro não diz nada", () => {
    const p = problemasDoBeneficioMunicipal({ numero: "33045570200123" });
    expect(p).toHaveLength(1);
    expect(p[0].erro).toBeNull();
    expect(p[0].texto).toMatch(/base de cálculo/i);
  });
});

describe("os textos que a tela precisa dizer", () => {
  it("⚠ o aviso de que o cadastro NÃO chega à nota existe e nomeia o desfecho", () => {
    // Se esta frase sumir, o contador configura a redução e a nota sai com o imposto cheio sem
    // ninguém avisar. É a razão de o cadastro poder existir antes do envio.
    expect(BENEFICIO_NAO_VAI_NO_XML).toMatch(/ISS cheio/);
    expect(BENEFICIO_NAO_VAI_NO_XML).toMatch(/BM/);
  });

  it("os três tipos existem, e `SEM_REDUCAO` é um deles", () => {
    expect(TIPOS_REDUCAO_BM.map((t) => t.valor)).toEqual(["SEM_REDUCAO", "VALOR", "PERCENTUAL"]);
  });
});
