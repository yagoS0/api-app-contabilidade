// ⚠ O NOME que a caixa de entrada mostra (30/08/2026)
//
// > Dono: *"o email aparece na caixa de entrada como: envio, conseguimos mudar isso?"*
//
// O `From` saía como endereço puro, então o Gmail mostrava `envio` — a parte antes do `@`. A troca
// é de CONFIGURAÇÃO (`SMTP_FROM="Altan Contabilidade <envio@altan.company>"`); o que esta suíte
// protege é o cabeçalho, que não é texto livre.
//
// ⚠⚠ Os dois modos de quebrar são SILENCIOSOS — o e-mail sai, e sai errado. Não há erro para ler.

// ⚠ `config.js` valida ambiente inteiro ao ser importado; aqui só interessa a função pura.
jest.mock("../../../config.js", () => ({
  USE_GMAIL_API: false,
  FROM: "",
  SMTP_HOST: "",
  SMTP_PORT: 587,
  SMTP_USER: "",
  SMTP_PASS: "",
  GMAIL_DELEGATED_USER: "",
  MAIL_REPLY_TO: "",
  GOOGLE_APPLICATION_CREDENTIALS: "",
  GOOGLE_APPLICATION_CREDENTIALS_JSON: "",
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { montarRemetente } from "../EmailService.js";

describe("o nome de exibição do remetente", () => {
  it("o formato de hoje — endereço puro — segue intocado", () => {
    // É o caminho de quem não configurou nome nenhum. Ele não pode mudar de forma.
    expect(montarRemetente("envio@altan.company")).toBe("envio@altan.company");
  });

  it("o nome pedido passa como está", () => {
    expect(montarRemetente("Altan Contabilidade <envio@altan.company>")).toBe(
      "Altan Contabilidade <envio@altan.company>"
    );
  });

  it("⚠⚠ VÍRGULA é separador de endereço — sem aspas, o From vira DOIS remetentes", () => {
    const cabecalho = montarRemetente("Altan Contabilidade, Ltda <envio@altan.company>");
    expect(cabecalho).toBe('"Altan Contabilidade, Ltda" <envio@altan.company>');
  });

  it("⚠ ponto também é `special` do RFC 5322 e também é citado", () => {
    expect(montarRemetente("Altan Cont. <envio@altan.company>")).toBe(
      '"Altan Cont." <envio@altan.company>'
    );
  });

  it("⚠⚠ acento é codificado, e o encoded-word NUNCA vai entre aspas", () => {
    // Entre aspas ele deixa de ser decodificado e o cliente mostra a base64 literal na tela.
    const cabecalho = montarRemetente("Contabilidade Endereço <envio@altan.company>");
    expect(cabecalho).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <envio@altan\.company>$/);
    expect(Buffer.from(cabecalho.split("?")[3], "base64").toString("utf8")).toBe(
      "Contabilidade Endereço"
    );
  });

  it("aspas que o dono digitar no painel não são duplicadas", () => {
    expect(montarRemetente('"Altan Contabilidade" <envio@altan.company>')).toBe(
      "Altan Contabilidade <envio@altan.company>"
    );
  });

  it("⚠ nome vazio cai no endereço puro — nunca num `<>` órfão", () => {
    expect(montarRemetente("  <envio@altan.company>")).toBe("envio@altan.company");
  });

  it("⚠⚠ o ENDEREÇO sobrevive a todos os ramos — é ele que a delegação exige que bata", () => {
    // O Gmail API impersona `GMAIL_DELEGATED_USER`; um From cujo endereço não bata é recusado.
    for (const nome of ["Altan", "Altan, Ltda", "Endereço", '"Altan"', ""]) {
      const saida = montarRemetente(`${nome} <envio@altan.company>`);
      const endereco = (saida.match(/<([^>]+)>/) || [, saida])[1];
      expect(endereco).toBe("envio@altan.company");
    }
  });
});
