// AS VALIDAÇÕES DA DEFIS.
//
// O que estes testes protegem é a separação entre ERRO e ALERTA. Erro é o que o portal recusa —
// transcrever e descobrir lá, sem o espelho do lado, é o pior momento. Alerta é divergência com o
// que NÓS temos, e o manual manda conferir, não corrigir: quem declarou ao PGDAS-D foi a empresa,
// e o espelho pode estar certo com o nosso número errado.

import {
  validarParticipacaoSocios, validarTotalEntradas, validarAquisicoes,
  validarListasComValor, alertarExportacaoVsPgdas, conferirEspelho,
} from "../defisValidacoes";
import { espelhoVazio, estabelecimentoVazio } from "../defisSpec";

describe("7.3 — participação dos sócios fecha 100%", () => {
  it("fechando 100% não acusa", () => {
    expect(validarParticipacaoSocios([{ percentual: "60" }, { percentual: "40" }])).toBeNull();
  });

  it("não fechando, a mensagem traz o NÚMERO", () => {
    // "não fecha 100%" obrigaria a somar de cabeça para saber quanto falta.
    const r = validarParticipacaoSocios([{ percentual: "60" }, { percentual: "30" }]);
    expect(r.tipo).toBe("erro");
    expect(r.mensagem).toMatch(/90/);
  });

  it("aceita vírgula decimal — é como o contador digita", () => {
    expect(validarParticipacaoSocios([{ percentual: "33,33" }, { percentual: "33,33" }, { percentual: "33,34" }])).toBeNull();
  });

  it("sem sócio nenhum NÃO acusa — espelho em branco não é espelho errado", () => {
    expect(validarParticipacaoSocios([])).toBeNull();
    expect(validarParticipacaoSocios(null)).toBeNull();
  });
});

describe("9 — total de entradas engloba 5, 6 e 8", () => {
  const est = (v) => ({ ...estabelecimentoVazio(), ...v });

  it("menor que a soma das parcelas é ERRO", () => {
    const r = validarTotalEntradas(est({ aquisicoes: "1000", entradasTransferencia: "500", devolucoesVendas: "0", totalEntradas: "1200" }));
    expect(r.tipo).toBe("erro");
    expect(r.campo).toBe("9");
  });

  it("⚠ MAIOR é normal e não acusa", () => {
    // O 9 inclui uso e consumo, ativo imobilizado, remessas e fretes — acusar aqui seria um falso
    // positivo em toda empresa que compra qualquer coisa fora de revenda.
    expect(validarTotalEntradas(est({ aquisicoes: "1000", totalEntradas: "2500" }))).toBeNull();
  });

  it("tudo em branco não é erro", () => {
    expect(validarTotalEntradas(est({}))).toBeNull();
  });
});

describe("5 — total de aquisições bate com 5.1 + 5.2", () => {
  it("divergindo é erro", () => {
    const r = validarAquisicoes({ aquisicoes: "1000", aquisicoesInterno: "600", aquisicoesImportacao: "300" });
    expect(r.campo).toBe("5");
  });

  it("batendo não acusa", () => {
    expect(validarAquisicoes({ aquisicoes: "900", aquisicoesInterno: "600", aquisicoesImportacao: "300" })).toBeNull();
  });

  it("só o total preenchido não acusa — o desdobramento pode vir depois", () => {
    expect(validarAquisicoes({ aquisicoes: "900", aquisicoesInterno: "", aquisicoesImportacao: "" })).toBeNull();
  });
});

describe("12 a 15 — linha de lista com valor zero", () => {
  it("acusa por lista, com a contagem", () => {
    const r = validarListasComValor({
      entradasInterestaduais: [{ uf: "SP", valor: "0" }, { uf: "MG", valor: "100" }],
      saidasInterestaduais: [],
      issRetido: [{ uf: "SP", municipio: "Santos", valor: "" }],
      servicosComunicacao: [],
    });
    expect(r).toHaveLength(2);
    expect(r[0].campo).toBe("12");
    expect(r[1].campo).toBe("14");
  });

  it("listas vazias não acusam", () => {
    expect(validarListasComValor(estabelecimentoVazio())).toEqual([]);
  });
});

describe("5/6 × PGDAS-D — ALERTA, nunca correção", () => {
  it("divergindo, avisa e diz que não corrige sozinho", () => {
    const r = alertarExportacaoVsPgdas({ receitaExportacaoDireta: "1000", exportadoras: [] }, 2500);
    expect(r.tipo).toBe("alerta");
    expect(r.mensagem).toMatch(/não corrige sozinho/);
  });

  it("soma a exportação direta com a via comercial exportadora", () => {
    const meEpp = { receitaExportacaoDireta: "1000", exportadoras: [{ cnpj: "x", valor: "1500" }] };
    expect(alertarExportacaoVsPgdas(meEpp, 2500)).toBeNull();
  });

  it("⚠ sem número do PGDAS-D NÃO acusa nada", () => {
    // Ausência de dado não é prova de divergência — e é o caso comum, porque a maioria não exporta.
    expect(alertarExportacaoVsPgdas({ receitaExportacaoDireta: "1000" }, null)).toBeNull();
  });
});

describe("conferirEspelho", () => {
  it("separa erros de alertas", () => {
    const e = espelhoVazio(2025);
    e.meEpp.socios = [{ percentual: "50" }];
    e.meEpp.receitaExportacaoDireta = "100";
    const r = conferirEspelho(e, { exportacaoDoPgdas: 500 });
    expect(r.erros).toHaveLength(1);
    expect(r.alertas).toHaveLength(1);
  });

  it("prefixa o erro com o estabelecimento — senão não se sabe em qual CNPJ corrigir", () => {
    const e = espelhoVazio(2025);
    e.estabelecimentos = [{ ...estabelecimentoVazio("11.222.333/0001-81"), aquisicoes: "1000", totalEntradas: "500" }];
    expect(conferirEspelho(e).erros[0].mensagem).toMatch(/^11\.222\.333\/0001-81:/);
  });

  it("⚠ INATIVA não confere nada — pula direto para transmissão", () => {
    // Seção 0, passo 3 do manual: declarada a inatividade, não há ficha para preencher.
    const e = espelhoVazio(2025);
    e.inativa = true;
    e.meEpp.socios = [{ percentual: "10" }]; // erraria, se fosse conferido
    expect(conferirEspelho(e)).toEqual({ erros: [], alertas: [] });
  });
});
