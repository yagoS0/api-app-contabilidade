// A regra da consulta do tomador no SERVIDOR — e o AMARRE com as duas cópias dos portais.
//
// ⚠ O amarre é o teste que importa: sem ele, "terceiro leitor da mesma regra" é intenção. Cada
// função de decisão é rodada pela implementação do servidor E pela do `apps/web`, sobre os MESMOS
// casos, e os vereditos têm de ser iguais.

import {
  ORIGEM,
  NAO_CONSULTA,
  decidirConsulta,
  nomeDaReceita,
  codigoMunicipioVerificado,
  enderecoDaReceita,
  emailDaReceita,
  situacaoCadastral,
  avisoSituacao,
  tomadorDaReceita,
  normalizarParaBusca,
} from "../consultaTomador.js";
import * as web from "../../../../../web/src/features/notas/lib/consultaTomador.js";
import { normalizarParaBusca as normalizarNoWeb } from "../../../../../web/src/lib/municipios/municipioIbge.js";

const MUNICIPIOS = [
  ["3304557", "Rio de Janeiro", "RJ"],
  ["3550308", "São Paulo", "SP"],
  ["2903201", "Bom Jesus da Lapa", "BA"],
  ["4302105", "Bom Jesus", "RS"],
];

const BRUTO_OK = {
  razao_social: "  ACME SERVIÇOS LTDA ",
  email: "Financeiro@Acme.com.br",
  descricao_situacao_cadastral: "ATIVA",
  codigo_municipio_ibge: 3304557,
  municipio: "RIO DE JANEIRO",
  uf: "rj",
  cep: "20.040-020",
  descricao_tipo_de_logradouro: "AVENIDA",
  logradouro: "RIO BRANCO",
  numero: "1",
  complemento: "SALA 100",
  bairro: "CENTRO",
};

describe("⚠ o amarre com o apps/web — o mesmo veredito nos mesmos casos", () => {
  it("decidirConsulta", () => {
    for (const caso of ["12.345.678/0001-90", "123.456.789-09", "1234", "", null]) {
      for (const ultimo of [null, "12345678000190"]) {
        expect(decidirConsulta(caso, { ultimoConsultado: ultimo })).toEqual(web.decidirConsulta(caso, { ultimoConsultado: ultimo }));
      }
    }
    expect(ORIGEM).toEqual(web.ORIGEM);
    expect(NAO_CONSULTA).toEqual(web.NAO_CONSULTA);
  });

  it("nomeDaReceita, normalizarParaBusca", () => {
    for (const b of [BRUTO_OK, {}, { razao_social: null }]) expect(nomeDaReceita(b)).toBe(web.nomeDaReceita(b));
    for (const t of ["São Gonçalo", "SÃO   PAULO ", "", null, "Açaí-Ú"]) expect(normalizarParaBusca(t)).toBe(normalizarNoWeb(t));
  });

  it("codigoMunicipioVerificado — a prova tripla, nos mesmos casos", () => {
    const casos = [
      BRUTO_OK,
      { ...BRUTO_OK, codigo_municipio_ibge: "330455" },
      { ...BRUTO_OK, codigo_municipio_ibge: "9999999" },
      { ...BRUTO_OK, municipio: "São Paulo" },
      { ...BRUTO_OK, uf: "SP" },
      { ...BRUTO_OK, codigo_municipio_ibge: undefined, codigo_municipio: "3550308", municipio: "São Paulo", uf: "SP" },
      { ...BRUTO_OK, municipio: "" },
    ];
    for (const b of casos) {
      expect(codigoMunicipioVerificado(b, MUNICIPIOS)).toEqual(web.codigoMunicipioVerificado(b, MUNICIPIOS));
    }
    expect(codigoMunicipioVerificado(BRUTO_OK, null)).toEqual(web.codigoMunicipioVerificado(BRUTO_OK, null));
    expect(codigoMunicipioVerificado(BRUTO_OK, [])).toEqual(web.codigoMunicipioVerificado(BRUTO_OK, []));
  });

  it("enderecoDaReceita — tudo ou nada, e 'RUA' sozinho não é rua", () => {
    const casos = [
      BRUTO_OK,
      { ...BRUTO_OK, logradouro: "", descricao_tipo_de_logradouro: "RUA" },
      { ...BRUTO_OK, numero: "" },
      { ...BRUTO_OK, cep: null },
      { ...BRUTO_OK, codigo_municipio_ibge: "9999999" },
      { ...BRUTO_OK, complemento: "" },
    ];
    for (const b of casos) {
      expect(enderecoDaReceita(b, { municipios: MUNICIPIOS })).toEqual(web.enderecoDaReceita(b, { municipios: MUNICIPIOS }));
    }
  });

  it("situação cadastral e o aviso", () => {
    for (const b of [BRUTO_OK, { descricao_situacao_cadastral: "BAIXADA", motivo_situacao_cadastral: "EXTINÇÃO" }, {}]) {
      expect(avisoSituacao(situacaoCadastral(b))).toBe(web.avisoSituacao(situacaoCadastral(b)));
    }
  });
});

describe("o que só o servidor tem", () => {
  it("emailDaReceita: em caixa baixa, forma de e-mail ou null", () => {
    expect(emailDaReceita(BRUTO_OK)).toBe("financeiro@acme.com.br");
    expect(emailDaReceita({ email: "sem-arroba" })).toBeNull();
    expect(emailDaReceita({})).toBeNull();
  });

  it("tomadorDaReceita monta o tomador inteiro — endereço só quando completo e provado", () => {
    const t = tomadorDaReceita(BRUTO_OK, { municipios: MUNICIPIOS });
    expect(t.nome).toBe("ACME SERVIÇOS LTDA");
    expect(t.email).toBe("financeiro@acme.com.br");
    expect(t.endereco).toEqual({ cMun: "3304557", CEP: "20040020", xLgr: "AVENIDA RIO BRANCO", nro: "1", xCpl: "SALA 100", xBairro: "CENTRO" });
    expect(t.avisoSituacao).toBeNull();
    expect(t.uf).toBe("RJ");
  });

  it("⚠ sem a lista do IBGE o endereço NÃO é oferecido — nome e e-mail continuam", () => {
    const t = tomadorDaReceita(BRUTO_OK, { municipios: null });
    expect(t.nome).toBe("ACME SERVIÇOS LTDA");
    expect(t.endereco).toBeNull();
    expect(t.enderecoFaltantes).toContain("o código IBGE do município");
    expect(t.motivoMunicipio).toMatch(/lista oficial do IBGE não foi carregada/);
  });

  it("⚠ código de OUTRO município (homônimo) é recusado — nunca derivado do nome", () => {
    const t = tomadorDaReceita({ ...BRUTO_OK, codigo_municipio_ibge: "4302105", municipio: "Bom Jesus da Lapa", uf: "BA" }, { municipios: MUNICIPIOS });
    expect(t.endereco).toBeNull();
    expect(t.motivoMunicipio).toMatch(/é de Bom Jesus\/RS e a consulta diz Bom Jesus da Lapa\/BA/);
  });

  it("situação BAIXADA vira aviso, nunca bloqueio — o tomador continua vindo", () => {
    const t = tomadorDaReceita({ ...BRUTO_OK, descricao_situacao_cadastral: "BAIXADA", motivo_situacao_cadastral: "EXTINÇÃO" }, { municipios: MUNICIPIOS });
    expect(t.avisoSituacao).toMatch(/BAIXADA \(EXTINÇÃO\)/);
    expect(t.nome).toBe("ACME SERVIÇOS LTDA");
    expect(t.endereco).not.toBeNull();
  });
});
