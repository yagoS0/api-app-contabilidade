// REJEIÇÃO FISCAL E QUEDA DE REDE NÃO PODEM SER O MESMO REGISTRO.
//
// ⚠ POR QUE ESTE TESTE EXISTE
// Timeout, DNS, 500 do provedor e recusa da Receita viravam TODOS `status:"rejected"`, e
// `ServiceInvoice` não tinha coluna de motivo: a razão só existia no `log.error` de
// `NfseService.js:1148-1165`. Pior, as validações NOSSAS (`MISSING_P_TOT_TRIB_SN`,
// `MISSING_TOMADOR_ADDRESS`) são lançadas de dentro do mesmo `try` — uma nota que nunca saiu da
// nossa máquina ficava gravada como recusada pela Receita.
//
// ⚠ A CAMADA DO MEIO É A RAZÃO DE HAVER TRÊS E NÃO DUAS. `TRANSPORTE` significa desfecho
// DESCONHECIDO. Como **não existe inutilização na NFS-e**, pular o número é buraco permanente e
// reusar às cegas arrisca E0014: as duas saídas são ruins, e a resposta honesta é reter o número.

import {
  classificarFalha,
  extrairCodigoReceita,
  camposDeFalha,
  CAMADA,
  STATUS,
} from "../desfechoEmissao.js";

function erroDoProvedor(status, data) {
  const err = new Error("Request failed");
  err.response = { status, data };
  return err;
}

function erroNosso(code, message = "falha local") {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe("camada NOSSA — nada saiu da máquina", () => {
  it.each([
    "MISSING_P_TOT_TRIB_SN",
    "MISSING_TOMADOR_ADDRESS",
    "NFSE_MUNICIPIO_NAO_CONFIGURADO",
    "NFSE_REGIME_INDEFINIDO",
    "NO_COMPANY_CERT",
    "SERIE_FORA_DA_FAIXA",
  ])("%s é NOSSA, vira falha_envio e LIBERA o número", (code) => {
    const d = classificarFalha(erroNosso(code));
    expect(d.camada).toBe(CAMADA.NOSSA);
    expect(d.status).toBe(STATUS.FALHA_ENVIO);
    // ⚠ Não é `rejected`: a Receita não recusou nada — ela nem viu o documento.
    expect(d.status).not.toBe(STATUS.REJECTED);
    expect(d.numeroReutilizavel).toBe(true);
    expect(d.codigo).toBe(code);
    expect(d.providerData).toBeNull();
  });

  it("carrega a `correcao` que o erro trouxe (é o que separa 'deu erro' de 'faça isto')", () => {
    const err = erroNosso("NFSE_MUNICIPIO_NAO_CONFIGURADO");
    err.correcao = "Cadastre o código IBGE de 7 dígitos.";
    expect(classificarFalha(err).correcao).toMatch(/IBGE/);
  });
});

describe("camada RECEITA — o sistema nacional analisou e recusou", () => {
  it("4xx é recusa fiscal: status `rejected` e número LIBERADO", () => {
    const d = classificarFalha(
      erroDoProvedor(400, {
        message:
          "Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe",
        codigo: "E0014",
      })
    );
    expect(d.camada).toBe(CAMADA.RECEITA);
    expect(d.status).toBe(STATUS.REJECTED);
    expect(d.codigo).toBe("E0014");
    // Ela analisou e recusou: não existe NFS-e com esse número, então ele volta a valer.
    expect(d.numeroReutilizavel).toBe(true);
  });

  it("acha o E#### em qualquer canto do payload, sem supor a forma da resposta", () => {
    // ⚠ A forma da resposta de erro do sistema nacional NÃO está documentada neste projeto —
    // nenhuma emissão jamais saiu. O que se sabe é o FORMATO do código.
    expect(extrairCodigoReceita({ erros: [{ codigo: "E0718", mensagem: "assinatura" }] })).toBe("E0718");
    expect(extrairCodigoReceita("Erro E1260: versão expirada")).toBe("E1260");
    expect(extrairCodigoReceita({ a: { b: { c: "E0010" } } })).toBe("E0010");
  });

  it("⚠ não achando o código, devolve null — NUNCA um código fabricado", () => {
    expect(extrairCodigoReceita({ message: "erro genérico" })).toBeNull();
    expect(extrairCodigoReceita(null)).toBeNull();
    expect(extrairCodigoReceita("E012")).toBeNull(); // 3 dígitos não é o formato
    const d = classificarFalha(erroDoProvedor(422, { message: "documento inválido" }));
    expect(d.camada).toBe(CAMADA.RECEITA);
    expect(d.codigo).toBeNull();
  });
});

describe("camada TRANSPORTE — desfecho DESCONHECIDO", () => {
  it.each(["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "ECONNABORTED"])(
    "%s NÃO libera o número",
    (code) => {
      const d = classificarFalha(erroNosso(code, "socket hang up"));
      expect(d.camada).toBe(CAMADA.TRANSPORTE);
      expect(d.status).toBe(STATUS.FALHA_ENVIO);
      // ⚠ A única das três em que o número fica retido.
      expect(d.numeroReutilizavel).toBe(false);
      expect(d.correcao).toMatch(/inutiliza|consulte/i);
    }
  );

  it("⚠ 5xx é TRANSPORTE, não recusa fiscal", () => {
    // Erro de servidor não é análise do documento: pode ocorrer DEPOIS de a DPS ter sido aceita e
    // antes de a resposta voltar. Tratá-lo como recusa liberaria o número de uma nota que talvez
    // exista — e, se ela existir, a reemissão bate em E0014.
    const d = classificarFalha(erroDoProvedor(502, "<html>Bad Gateway</html>"));
    expect(d.camada).toBe(CAMADA.TRANSPORTE);
    expect(d.status).not.toBe(STATUS.REJECTED);
    expect(d.numeroReutilizavel).toBe(false);
    expect(d.codigo).toBe("HTTP_502");
  });

  it("erro sem código nem resposta cai em TRANSPORTE (o balde conservador)", () => {
    // Na dúvida, RETER o número. O erro caro é liberar um número cuja nota talvez exista.
    const d = classificarFalha(new Error("algo inesperado"));
    expect(d.camada).toBe(CAMADA.TRANSPORTE);
    expect(d.numeroReutilizavel).toBe(false);
  });
});

describe("as três camadas produzem registros distinguíveis", () => {
  it("cada uma grava camada, código, mensagem, correção e data", () => {
    const campos = camposDeFalha(classificarFalha(erroDoProvedor(400, { codigo: "E0014" })));
    expect(campos).toMatchObject({ status: STATUS.REJECTED, falhaCamada: "RECEITA", falhaCodigo: "E0014" });
    expect(campos.falhaEm).toBeInstanceOf(Date);
  });

  it("⚠ o mesmo sintoma na tela deixa de ser o mesmo dado no banco", () => {
    const nosso = classificarFalha(erroNosso("MISSING_P_TOT_TRIB_SN"));
    const rede = classificarFalha(erroNosso("ETIMEDOUT"));
    const receita = classificarFalha(erroDoProvedor(400, { codigo: "E0014" }));

    const camadas = [nosso.camada, rede.camada, receita.camada];
    expect(new Set(camadas).size).toBe(3);
    // E o que se pode FAZER com o número difere entre elas — que é o ponto prático da separação.
    expect([nosso.numeroReutilizavel, rede.numeroReutilizavel, receita.numeroReutilizavel]).toEqual([
      true,
      false,
      true,
    ]);
  });
});
