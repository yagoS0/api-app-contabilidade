// Linha digitável de arrecadação — a validação que decide se o número pode virar meio de pagamento.
//
// Os casos DOURADOS não foram inventados: são os exemplos do documento oficial da FEBRABAN
// ("Layout Padrão de Arrecadação/Recebimento com Utilização do Código de Barras", VERSÃO 07,
// vigência 01.03.2023) e uma guia de DAS REAL do projeto (`retornoleiturapdf.txt`, DAS do Simples
// de 01/2026, CNPJ 48.684.291/0001-00, valor 1.367,70).
//
// ⚠ O teste que mais importa aqui é o que RECUSA. Um dígito trocado tem de derrubar a leitura
// inteira — é isso que separa "ler o documento" de "montar um código de pagamento".

import {
  dacModulo10,
  dacModulo11,
  validarLinhaDigitavel,
  extrairLinhaDigitavelDoTexto,
  conferirContraDocumento,
  lerVencimentoDoCampoLivre,
  formatarLinhaDigitavel,
  MOTIVOS,
} from "../linhaDigitavelArrecadacao.js";

// DAS real (retornoleiturapdf.txt): "85850000013 4 67700328260 7 51072026040 9 41808167202 9"
const DAS_REAL = "858500000134677003282607510720260409418081672029";
const DAS_REAL_TEXTO = [
  "Documento de Arrecadação",
  "do Simples Nacional",
  "CNPJ Razão Social",
  "48.684.291/0001-00 ERISANGELA LACERDA PEREIRA",
  "Janeiro/2026 20/02/2026 07.20.26040.4180816-7",
  "Valor Total do Documento",
  "1.367,70",
  "Totais 1.367,70 1.367,70",
  "85850000013 4 67700328260 7 51072026040 9 41808167202 9 AUTENTICAÇÃO MECÂNICA",
  "Documento de Arrecadação do Simples Nacional Pague com o PIX",
  "85850000013 4 67700328260 7 51072026040 9 41808167202 9 CNPJ: 48.684.291/0001-00",
  "Número: 07.20.26040.4180816-7",
  "Pagar até: 20/02/2026",
  "Valor: 1.367,70",
].join("\n");

describe("DAC — fórmulas do documento oficial FEBRABAN", () => {
  test("§07 módulo 10: DAC de 01230067896 é 3", () => {
    expect(dacModulo10("01230067896")).toBe(3);
  });

  test("§09 módulo 11: DAC de 01230067896 é 0", () => {
    expect(dacModulo11("01230067896")).toBe(0);
  });

  // §08 e §10 usam o MESMO corpo, mudando só a 4ª posição (o próprio DV) e o módulo.
  const CORPO = "0000215048" + "2009741232" + "2015409829" + "0108605940";

  test("§08 DV geral módulo 10 do exemplo oficial é 1 (área auxiliar de 43 posições)", () => {
    const barra = "8221" + CORPO;
    expect(dacModulo10(barra.slice(0, 3) + barra.slice(4))).toBe(1);
  });

  test("§10 DV geral módulo 11 do exemplo oficial é 0 (resto 1 → DV 0)", () => {
    const barra = "8220" + CORPO;
    expect(dacModulo11(barra.slice(0, 3) + barra.slice(4))).toBe(0);
  });

  test("módulo 11: resto 10 → DV 1; resto 0 ou 1 → DV 0 (§09, observação)", () => {
    // Varre números até achar um de cada resto — a regra de borda é a que mais erra na prática.
    const restos = new Map();
    for (let i = 0; i < 400; i++) {
      const s = String(10000000000 + i);
      let soma = 0;
      let peso = 2;
      for (let k = s.length - 1; k >= 0; k--) {
        soma += Number(s[k]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
      }
      const r = soma % 11;
      if (!restos.has(r)) restos.set(r, s);
    }
    if (restos.has(0)) expect(dacModulo11(restos.get(0))).toBe(0);
    if (restos.has(1)) expect(dacModulo11(restos.get(1))).toBe(0);
    if (restos.has(10)) expect(dacModulo11(restos.get(10))).toBe(1);
    expect(dacModulo11(restos.get(5))).toBe(6);
  });
});

describe("Guia de DAS REAL — o que a linha contém", () => {
  const r = validarLinhaDigitavel(DAS_REAL);

  test("os cinco dígitos verificadores fecham", () => {
    expect(r.ok).toBe(true);
  });

  test("produto 8 (arrecadação), segmento 5 (órgãos governamentais), identificador 8 → módulo 11", () => {
    expect(r.codigoBarras[0]).toBe("8");
    expect(r.segmento).toBe(5);
    expect(r.identificadorValor).toBe(8);
    expect(r.modulo).toBe(11);
  });

  test("o valor codificado (posições 05–15) é o total impresso: R$ 1.367,70", () => {
    expect(r.valorCentavos).toBe(136770);
  });

  test("o código de barras tem 44 dígitos e NÃO carrega os DVs dos blocos", () => {
    expect(r.codigoBarras).toHaveLength(44);
    expect(r.linhaDigitavel).toHaveLength(48);
  });

  // ⚠ Este é o achado que impede uma promessa falsa na tela: o DAS do Simples NÃO codifica o
  // vencimento. §03-G da FEBRABAN torna a data facultativa ("no caso de ser utilizada") e o campo
  // livre real deste DAS começa em "26051072…", que não é AAAAMMDD.
  test("o vencimento NÃO está codificado no campo livre deste DAS", () => {
    expect(r.vencimentoCodificado).toBeNull();
    expect(r.campoLivre.startsWith("26051072")).toBe(true);
  });

  test("o número do documento impresso aparece dentro do campo livre", () => {
    // Observação medida (não é regra do layout): 07.20.26040.4180816-7 → 07202604041808167.
    expect(r.campoLivre).toContain("07202604041808167");
  });
});

describe("Recusa — ausência é resposta, número errado não é", () => {
  test("um dígito trocado no meio derruba a leitura", () => {
    const adulterada = DAS_REAL.slice(0, 20) + (DAS_REAL[20] === "9" ? "8" : "9") + DAS_REAL.slice(21);
    const r = validarLinhaDigitavel(adulterada);
    expect(r.ok).toBe(false);
    expect([MOTIVOS.DV_BLOCO, MOTIVOS.DV_GERAL]).toContain(r.motivo);
  });

  test("cada uma das 48 posições é coberta por algum dígito verificador", () => {
    for (let i = 0; i < 48; i++) {
      const d = Number(DAS_REAL[i]);
      const outro = String((d + 1) % 10);
      const adulterada = DAS_REAL.slice(0, i) + outro + DAS_REAL.slice(i + 1);
      expect(validarLinhaDigitavel(adulterada).ok).toBe(false);
    }
  });

  test("tamanho diferente de 48 é recusado", () => {
    expect(validarLinhaDigitavel(DAS_REAL.slice(0, 47)).motivo).toBe(MOTIVOS.TAMANHO);
    expect(validarLinhaDigitavel("").motivo).toBe(MOTIVOS.TAMANHO);
  });

  test("chave de acesso de NF-e (44 dígitos) não vira linha digitável", () => {
    const chave = "35200114200166000187550010000000015123456789";
    expect(validarLinhaDigitavel(chave).ok).toBe(false);
    expect(extrairLinhaDigitavelDoTexto(`Chave de acesso ${chave}`).ok).toBe(false);
  });

  test("número que não começa com 8 não é arrecadação", () => {
    const naoArrecadacao = "1" + DAS_REAL.slice(1);
    expect(validarLinhaDigitavel(naoArrecadacao).motivo).toBe(MOTIVOS.NAO_E_ARRECADACAO);
  });
});

describe("Extração do texto do PDF", () => {
  test("acha a linha no texto real do DAS, mesmo impressa duas vezes", () => {
    const r = extrairLinhaDigitavelDoTexto(DAS_REAL_TEXTO);
    expect(r.ok).toBe(true);
    expect(r.linhaDigitavel).toBe(DAS_REAL);
  });

  test("texto sem linha digitável devolve 'não encontrada', não um palpite", () => {
    const r = extrairLinhaDigitavelDoTexto("Documento de Arrecadação\nValor Total 1.367,70\n");
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.NAO_ENCONTRADA);
  });

  test("duas linhas VÁLIDAS e DIFERENTES no mesmo texto → recusa, não escolhe uma", () => {
    // A segunda também é real: DAS do Simples de 05/2026, CNPJ 44.742.042/0001-73, R$ 790,79
    // (guia 80858b4f no banco). Duas linhas discordantes não são dado, são ambiguidade — e
    // escolher uma delas seria exatamente o que este módulo existe para não fazer.
    const OUTRO_DAS_REAL = "858000000070907903282610730720261739887528743003";
    expect(validarLinhaDigitavel(OUTRO_DAS_REAL).valorCentavos).toBe(79079);

    const r = extrairLinhaDigitavelDoTexto(`${DAS_REAL}\ntexto no meio\n${OUTRO_DAS_REAL}`);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("linhas_digitaveis_divergentes_no_documento");
  });

  test("a MESMA linha impressa duas vezes é o caso normal, e não vira ambiguidade", () => {
    const r = extrairLinhaDigitavelDoTexto(`${DAS_REAL_TEXTO}\n${DAS_REAL}\n`);
    expect(r.ok).toBe(true);
    expect(r.linhaDigitavel).toBe(DAS_REAL);
  });
});

describe("Conferência contra o que já sabemos da guia", () => {
  const lida = validarLinhaDigitavel(DAS_REAL);

  test("valor batendo → passa, e diz o que foi conferido", () => {
    const r = conferirContraDocumento(lida, { valorTotal: 1367.7, vencimento: "2026-02-20" });
    expect(r.ok).toBe(true);
    expect(r.conferido.valor).toBe(true);
    // Não é divergência: este DAS não codifica a data (§03-G facultativo).
    expect(r.conferido.vencimento).toBe(false);
  });

  test("valor divergente → NÃO devolve nada, com motivo nomeado", () => {
    const r = conferirContraDocumento(lida, { valorTotal: 1367.71 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.VALOR_DIVERGENTE);
    expect(r.detalhe).toEqual({ naLinha: 136770, noDocumento: 136771 });
  });

  test("centavo de diferença é divergência — não há tolerância", () => {
    expect(conferirContraDocumento(lida, { valorTotal: 1367.69 }).ok).toBe(false);
  });

  test("sem valor conhecido, a linha passa mas `conferido.valor` é false", () => {
    const r = conferirContraDocumento(lida, {});
    expect(r.ok).toBe(true);
    expect(r.conferido.valor).toBe(false);
  });
});

describe("Vencimento no campo livre (§03-G, facultativo)", () => {
  test("AAAAMMDD válido é lido", () => {
    expect(lerVencimentoDoCampoLivre("20260220" + "0".repeat(17))).toBe("2026-02-20");
  });

  test("campo livre que não é data devolve null (não é erro)", () => {
    expect(lerVencimentoDoCampoLivre("2605107202604041808167202")).toBeNull();
    expect(lerVencimentoDoCampoLivre("20261332" + "0".repeat(17))).toBeNull();
  });
});

describe("Formatação", () => {
  test("sai em 4 grupos de 11+DV, como o documento imprime", () => {
    expect(formatarLinhaDigitavel(DAS_REAL)).toBe(
      "85850000013-4 67700328260-7 51072026040-9 41808167202-9"
    );
  });

  test("número de tamanho errado não é formatado", () => {
    expect(formatarLinhaDigitavel("123")).toBeNull();
  });
});
