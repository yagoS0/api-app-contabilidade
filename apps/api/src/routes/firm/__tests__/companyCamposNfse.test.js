// OS TRÊS CAMPOS CHEGAM AO BANCO? — `PATCH /firm/companies/:id` e a configuração de emissão de NFS-e.
//
// ⚠ POR QUE ESTE TESTE EXISTE. `buildMissingFields` (`application/nfse/NfseService.js`) recusa a
// emissão quando faltar `cnpj`, `inscricaoMunicipal`, `codigoServicoNacional`,
// `codigoServicoMunicipal` ou `rpsSerie`. Os três últimos existiam na coluna e já voltavam pelo
// `legacyCompanySelect` — mas **não havia caminho de escrita nenhum** a partir do portal: o valor
// vinha no corpo, passava pelo Zod de topo (`.passthrough()`) e morria na lista de colunas do
// `tx.company.update`. Resposta 200, campo jogado fora, e o sintoma só apareceria semanas depois
// como recusa na emissão. É a mesma classe do defeito que `companyMunicipioIbge.test.js` tranca.
//
// Por isso o teste olha o ARGUMENTO do `update`, não a resposta HTTP: é o único lugar onde o
// descarte silencioso fica visível.
//
// Medido com esta suíte: removendo QUALQUER uma das três linhas do `tx.company.update` (ou o campo
// correspondente do retorno de `validateAndNormalizeCompanyProfile`), o teste do trio cai com
// `undefined` no lugar do valor — que é exatamente o que o contador veria como "salvei e voltou
// vazio".

import request from "supertest";
import express from "express";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (prop === "$connect" || prop === "$disconnect") {
        if (!alvo[prop]) alvo[prop] = jest.fn(async () => {});
        return alvo[prop];
      }
      if (!models[prop]) {
        const metodos = {};
        models[prop] = new Proxy(metodos, {
          get(m, metodo) {
            if (typeof metodo === "symbol") return m[metodo];
            if (!m[metodo]) m[metodo] = jest.fn();
            return m[metodo];
          },
        });
      }
      return models[prop];
    },
  });
  raiz.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(proxy);
    return Promise.all(arg);
  });
  return { prisma: proxy };
});

jest.mock("../../../application/guides/guideCompliance.js", () => {
  const real = jest.requireActual("../../../application/guides/guideCompliance.js");
  return {
    ...real,
    computeGuideComplianceMap: jest.fn(async () => new Map()),
  };
});

import { createFirmPortalRouter } from "../index.js";
import { prisma as prismaMock } from "../../../infrastructure/db/prisma.js";
import { SERIE_MIN, SERIE_MAX } from "../../../application/nfse/nfseNumeracao.js";

const PORTAL_ID = "portal-1";
const COMPANY_LEGACY_ID = "company-legacy-1";
const CNPJ = "11222333000181";

const USUARIO_LOGADO = { id: "user-firm-1", role: "admin", accountType: "FIRM", email: "admin@escritorio.com" };

function montarApp() {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...USUARIO_LOGADO } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

function payload(companyExtra = {}) {
  return {
    company: {
      razaoSocial: "EMPRESA TESTE LTDA",
      cnpj: CNPJ,
      regimeTributario: "SIMPLES",
      cnaePrincipal: "6201501",
      endereco: {
        rua: "Rua das Flores",
        numero: "100",
        bairro: "Centro",
        cidade: "Rio de Janeiro",
        uf: "RJ",
        cep: "20000-000",
      },
      ...companyExtra,
    },
  };
}

function bancoNoCaminhoFeliz() {
  prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_ID, companyId: COMPANY_LEGACY_ID, cnpj: CNPJ });
  prismaMock.portalClient.update.mockImplementation(async ({ data }) => ({
    id: PORTAL_ID, companyId: COMPANY_LEGACY_ID, cnpj: CNPJ, ...data,
  }));
  prismaMock.company.update.mockImplementation(async ({ data }) => ({ id: COMPANY_LEGACY_ID, ...data }));
  prismaMock.company.findUnique.mockResolvedValue({ id: COMPANY_LEGACY_ID });
  prismaMock.companyClientUser.findFirst.mockResolvedValue(null);
  prismaMock.guide.findMany.mockResolvedValue([]);
}

function dadosDoUpdateDaCompany() {
  expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
  return prismaMock.company.update.mock.calls[0][0];
}

describe("PATCH /firm/companies/:id — configuração de emissão de NFS-e", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    bancoNoCaminhoFeliz();
  });

  test("os três CHEGAM ao update da Company — não são descartados pela lista de campos", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({
        codigoServicoNacional: "171201",
        codigoServicoMunicipal: "001",
        rpsSerie: "1",
      }));

    expect(res.status).toBe(200);
    const { data } = dadosDoUpdateDaCompany();
    expect(data.codigoServicoNacional).toBe("171201");
    expect(data.codigoServicoMunicipal).toBe("001");
    // Série gravada na MESMA forma que o XML usa (`normalizarSerie` → 5 dígitos): "1" e "00001" são
    // a mesma série, e guardar as duas escritas faria a empresa parecer ter duas.
    expect(data.rpsSerie).toBe("00001");
  });

  test("voltam na resposta — o `select` da rota precisa trazer as colunas, senão a tela reabre vazia", async () => {
    await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload({
      codigoServicoNacional: "171201", codigoServicoMunicipal: "001", rpsSerie: "1",
    }));
    const { select } = dadosDoUpdateDaCompany();
    expect(select.codigoServicoNacional).toBe(true);
    expect(select.codigoServicoMunicipal).toBe(true);
    expect(select.rpsSerie).toBe(true);
  });

  test("vazio grava NULL nos três — desfazer uma configuração errada precisa ser possível", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ codigoServicoNacional: "", codigoServicoMunicipal: "", rpsSerie: "" }));

    expect(res.status).toBe(200);
    const { data } = dadosDoUpdateDaCompany();
    expect(data.codigoServicoNacional).toBeNull();
    expect(data.codigoServicoMunicipal).toBeNull();
    expect(data.rpsSerie).toBeNull();
  });

  // ── cTribNac ────────────────────────────────────────────────────────────────────────────────
  // 6 dígitos numéricos: `docs/nfse-preenchimento.md` §5 e §11, e o exemplo §12 (`171201`) da
  // única emissão que este projeto já produziu com `status:"issued"`.
  describe("código de serviço NACIONAL (`cTribNac`)", () => {
    test("máscara não atrapalha: pontuação é limpa e sobram os 6 dígitos", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigoServicoNacional: "17.12.01" }));

      expect(res.status).toBe(200);
      expect(dadosDoUpdateDaCompany().data.codigoServicoNacional).toBe("171201");
    });

    test("comprimento errado → 400 nomeado, e NADA é escrito", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigoServicoNacional: "1712" }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_codigo_servico_nacional_invalid");
      expect(prismaMock.company.update).not.toHaveBeenCalled();
    });

    test("texto sem nenhum dígito também é recusado — não vira NULL em silêncio", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigoServicoNacional: "serviços contábeis" }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_codigo_servico_nacional_invalid");
    });
  });

  // ── A LISTA de códigos (decisão do dono, 16/08/2026) ─────────────────────────────────────────
  //
  // > *"ao cadastrar podemos ter mais de um código, a empresa pode usar mais de uma atividade e na
  // > hora da emissão ela deve escolher."*
  //
  // ⚠ MESMA CLASSE DE DEFEITO QUE O TRIO ACIMA: coluna nova que não entre no `tx.company.update`
  // (ou no Zod, ou no normalizador) responde 200 e joga o valor fora.
  describe("⚠ códigos de serviço da empresa — a LISTA", () => {
    test("a lista CHEGA ao update da Company, normalizada e sem repetição", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({
          codigosServicoNacional: ["17.12.01", "010101", "171201"],
          codigoServicoNacional: "171201",
        }));

      expect(res.status).toBe(200);
      const { data, select } = dadosDoUpdateDaCompany();
      // Máscara limpa, duplicata fora, ORDEM da escolha preservada.
      expect(data.codigosServicoNacional).toEqual(["171201", "010101"]);
      // E volta para a tela — sem isto o formulário reabre vazio e o contador reescolhe tudo.
      expect(select.codigosServicoNacional).toBe(true);
    });

    test("⚠ lista com UM código define sozinha o que a DPS leva — não há escolha a fazer", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigosServicoNacional: ["171201"] }));

      expect(res.status).toBe(200);
      expect(dadosDoUpdateDaCompany().data.codigoServicoNacional).toBe("171201");
    });

    test("⚠ lista com VÁRIOS e nenhum marcado → 400 nomeado; o sistema NÃO elege o primeiro", async () => {
      // Eleger "o primeiro da lista" seria o sistema decidindo qual serviço a empresa declara ao
      // fisco. Serviço errado na nota é silencioso: aparece só no DANFSe, com a descrição de outra
      // atividade.
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigosServicoNacional: ["171201", "010101"] }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_codigo_servico_nacional_fora_da_lista");
      expect(prismaMock.company.update).not.toHaveBeenCalled();
    });

    test("lista com VÁRIOS e o marcado FORA dela também é recusa", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({
          codigosServicoNacional: ["171201", "010101"],
          codigoServicoNacional: "310104",
        }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_codigo_servico_nacional_fora_da_lista");
    });

    test("lista com VÁRIOS e o marcado DENTRO dela passa, e o marcado é o que fica", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({
          codigosServicoNacional: ["171201", "010101"],
          codigoServicoNacional: "010101",
        }));

      expect(res.status).toBe(200);
      const { data } = dadosDoUpdateDaCompany();
      expect(data.codigoServicoNacional).toBe("010101");
      expect(data.codigosServicoNacional).toEqual(["171201", "010101"]);
    });

    test("item com comprimento errado → 400 nomeado, e NADA é escrito", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigosServicoNacional: ["171201", "1712"] }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_codigo_servico_nacional_invalid");
      expect(prismaMock.company.update).not.toHaveBeenCalled();
    });

    test("⚠ NÃO enviar a lista significa NÃO MEXER nela — não apagar", async () => {
      // Toda tela que salva a empresa sem este bloco (certificado, sócios, ficha) passaria por
      // aqui. Se o campo virasse `[]` por omissão, o cadastro de serviços seria apagado por elas.
      const res = await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload({}));

      expect(res.status).toBe(200);
      expect(dadosDoUpdateDaCompany().data).not.toHaveProperty("codigosServicoNacional");
    });

    test("lista VAZIA explícita apaga — desfazer uma configuração errada precisa ser possível", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigosServicoNacional: [] }));

      expect(res.status).toBe(200);
      expect(dadosDoUpdateDaCompany().data.codigosServicoNacional).toEqual([]);
    });
  });

  // ── cTribMun ────────────────────────────────────────────────────────────────────────────────
  describe("código de serviço MUNICIPAL (`cTribMun`)", () => {
    test("aceita comprimento qualquer — a fonte prova o corte no XML, não o tamanho do código", async () => {
      // ⚠ `docs/nfse-preenchimento.md` §5 diz "código municipal (últimos 3 dígitos)", e
      // `buildDpsXml` faz `.slice(-3)`. Isso descreve o XML. Exigir exatamente 3 no cadastro seria
      // inventar uma máscara e recusar um código municipal legítimo mais longo.
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigoServicoMunicipal: "10203" }));

      expect(res.status).toBe(200);
      expect(dadosDoUpdateDaCompany().data.codigoServicoMunicipal).toBe("10203");
    });

    test("valor sem nenhum dígito é recusado — não vira NULL em silêncio", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ codigoServicoMunicipal: "n/a" }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_codigo_servico_municipal_invalid");
      expect(prismaMock.company.update).not.toHaveBeenCalled();
    });
  });

  // ── série da DPS ────────────────────────────────────────────────────────────────────────────
  describe("série da DPS (`rpsSerie`) — RN E0010", () => {
    test("⚠ a faixa do cadastro é a MESMA de `nfseNumeracao` — se um lado mudar, este teste cai", () => {
      // A regra vive em `application/nfse/nfseNumeracao.js`; o normalizador do cadastro repete os
      // dois inteiros porque aquele módulo carrega o Prisma no topo e este é um validador puro.
      // Esta asserção é o que impede a duplicação de virar divergência.
      expect([SERIE_MIN, SERIE_MAX]).toEqual([1, 49999]);
    });

    test("série no limite superior da faixa passa", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ rpsSerie: String(SERIE_MAX) }));

      expect(res.status).toBe(200);
      expect(dadosDoUpdateDaCompany().data.rpsSerie).toBe("49999");
    });

    test("acima da faixa → 400 nomeado (as outras faixas são do Emissor Móvel/Web e da transcrição)", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ rpsSerie: String(SERIE_MAX + 1) }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_rps_serie_invalid");
      expect(prismaMock.company.update).not.toHaveBeenCalled();
    });

    test("zero é recusado — a faixa começa em 1", async () => {
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ rpsSerie: "0" }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_rps_serie_invalid");
    });

    test('⚠ série não-numérica ("UNICA") é RECUSADA, e não convertida', async () => {
      // A conversão "letra vira número" (`U`→21) foi abandonada em `normalizarSerie` de propósito:
      // série é identificação fiscal e não se traduz sozinha. O cadastro recusa pelo mesmo motivo —
      // aceitar aqui só adiaria a recusa para o instante da emissão.
      const res = await request(app)
        .patch(`/firm/companies/${PORTAL_ID}`)
        .send(payload({ rpsSerie: "UNICA" }));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("company_rps_serie_invalid");
      expect(prismaMock.company.update).not.toHaveBeenCalled();
    });
  });

  test("⚠ nada é derivado: sem os campos no corpo, os três gravam NULL", async () => {
    // O payload tem CNAE e endereço. Se algum dia alguém "ajudar" derivando o código de serviço do
    // CNAE (ou uma série default "1"), este teste cai — que é o ponto. A lista da LC 116 e a do
    // município NÃO existem neste repositório, e um default embutido mentiria sobre uma empresa
    // que ninguém configurou.
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload());

    expect(res.status).toBe(200);
    const { data } = dadosDoUpdateDaCompany();
    expect(data.codigoServicoNacional).toBeNull();
    expect(data.codigoServicoMunicipal).toBeNull();
    expect(data.rpsSerie).toBeNull();
  });
});
