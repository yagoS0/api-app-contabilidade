// O MODO MOCK RECUSA AS MESMAS COISAS QUE O SERVIDOR — inclusive depois de o não optante emitir.
//
// ⚠ POR QUE ESTE ARQUIVO EXISTE. Enquanto a tela travava o não optante
// (`MOTIVO_NAO_OPTANTE_BLOQUEADO`), nenhuma empresa do Lucro Presumido chegava ao `emitirNfse` do
// mock — e o mock exigia `totTrib.pTotTribSN` de TODA empresa, justificando-se em algo que deixou
// de ser verdade ("o `NfseService` declara toda empresa como `opSimpNac=3`"). Destravada a tela,
// esse mock passaria a recusar OFFLINE exatamente a emissão que o real aceita: a mesma classe de
// defeito de sempre (tela e servidor discordando sobre a mesma empresa), com o sinal trocado.
//
// ⚠ NADA AQUI EMITE COISA NENHUMA. `createMockApi` é memória do processo: não há rede, não há
// banco, não há prefeitura — é justamente por isso que este é o único lugar do projeto onde o
// caminho completo da emissão pode ser percorrido.

const { createMockApi } = require("../mockApi");

describe("emitirNfse no mock — cada regime declara o SEU grupo de tributos", () => {
  const api = createMockApi();
  let simples;
  let naoOptante;

  // ⚠ O estado do mock é de MÓDULO, não da instância, e um dos casos GRAVA a carga tributária. Em
  // vez de recarregar o módulo a cada caso (caro: o mock inteiro, com o faker, por teste), cada um
  // ESCREVE o estado de que precisa — inclusive o vazio, que é o "não configurado".
  //
  // ⚠ E a empresa do Presumido precisa ser CONFIGURADA antes: no mock só a de Mangaratiba (do
  // Simples) nasce com município emissor e códigos de serviço, de propósito. Sem isso a emissão
  // pararia antes, em `nfse_municipio_nao_configurado` / `company_missing_fields`, e este arquivo
  // estaria testando outra recusa.
  const CONFIG_DE_EMISSAO = {
    codigoMunicipioIbge: "3304557",
    inscricaoMunicipal: "1.234.567-8",
    codigoServicoNacional: "171201",
    codigoServicoMunicipal: "001",
    rpsSerie: "1",
  };

  /** Grava a carga tributária da empresa do Presumido. `""` apaga — é o "não configurado". */
  async function configurarCarga({ fed = "", est = "", mun = "" } = {}) {
    await api.updateCompany(naoOptante.companyId, {
      company: { ...CONFIG_DE_EMISSAO, pTotTribFed: fed, pTotTribEst: est, pTotTribMun: mun },
    });
  }

  beforeAll(async () => {
    const companies = await api.listCompanies("2026-07");
    simples = companies.find((c) => c.legacyCompany?.regimeTributario === "SIMPLES"
      && c.legacyCompany?.codigoMunicipioIbge);
    naoOptante = companies.find((c) => c.legacyCompany?.regimeTributario === "LUCRO_PRESUMIDO");
  });

  test("o mock tem uma empresa de cada regime — senão isto seria um teste vazio", () => {
    expect(simples).toBeTruthy();
    expect(naoOptante).toBeTruthy();
  });

  /** A nota mínima que passa por tudo o que vem antes do grupo de tributos. */
  function nota(companyId, totTrib) {
    return {
      companyId,
      tomador: { cnpjCpf: "12345678000199", nome: "ACME LTDA" },
      servico: { descricao: "Consultoria contábil", valorServicos: 1500, issRetido: false },
      ...(totTrib ? { totTrib } : {}),
    };
  }

  it("o Simples continua sendo recusado sem o pTotTribSN", async () => {
    await expect(api.emitirNfse(nota(simples.companyId))).rejects.toThrow("missing_p_tot_trib_sn");
  });

  it("o Simples emite com o pTotTribSN", async () => {
    const r = await api.emitirNfse(nota(simples.companyId, { pTotTribSN: 6 }));
    expect(r.status).toBe("issued");
  });

  // ⚠ O caso que a trava de tela escondia: o não optante NÃO manda `pTotTribSN` (esse número sai do
  // extrato do PGDAS-D, que ele não tem) e o mock não pode cobrá-lo dele.
  it("⚠ o não optante é recusado pela CARGA APROXIMADA, nunca por falta de pTotTribSN", async () => {
    await configurarCarga();
    await expect(api.emitirNfse(nota(naoOptante.companyId))).rejects.toMatchObject({
      message: "missing_tot_trib_nao_simples",
      // ⚠ A recusa NOMEIA o que falta, como o `err.faltando` do backend: "falta a carga
      // tributária" mandaria o contador conferir os três.
      faltando: ["pTotTribFed", "pTotTribEst", "pTotTribMun"],
    });
  });

  it("⚠⚠ só o municipal configurado NÃO emite — era assim que a nota saía com 0,00", async () => {
    await configurarCarga({ mun: "2,5" });
    await expect(api.emitirNfse(nota(naoOptante.companyId))).rejects.toMatchObject({
      faltando: ["pTotTribFed", "pTotTribEst"],
    });
  });

  it("com os três no CADASTRO o não optante emite — e ZERO conta como configurado", async () => {
    // Os números da NFS-e real versionada (`opSimpNac=1`): 11,33 federal e 0,00 nos outros dois.
    await configurarCarga({ fed: "11,33", est: "0", mun: "0" });
    const r = await api.emitirNfse(nota(naoOptante.companyId));
    expect(r.status).toBe("issued");
  });

  it("o percentual do PAYLOAD vence o do cadastro, e fora de 0–100 é recusa", async () => {
    await configurarCarga({ fed: "11,33", est: "0", mun: "0" });
    await expect(
      api.emitirNfse(nota(naoOptante.companyId, { pTotTribFed: 150 }))
    ).rejects.toThrow("invalid_tot_trib_nao_simples");
  });
});
