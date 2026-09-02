// ⚠ ZERO CONTRA ZERO NÃO É CONFERÊNCIA — e as duas caixas não podem se contradizer.
//
// O defeito: `folhaConfere = derivadaDisponivel && Math.abs(totalDigitado - totalDerivado) <= 0.01`.
// Com folha digitada 0 e derivada 0, `|0 − 0| ≤ 0.01` é VERDADEIRO. Resultado na tela, no mesmo
// scroll, numa tela que transmite ato fiscal:
//
//   ┌ caixa de cima, VERDE ─────────────────────────────────────────┐
//   │ ✓ Confere com os lançamentos de folha (R$ 0,00).              │
//   └───────────────────────────────────────────────────────────────┘
//   ┌ caixa de baixo, ÂMBAR ────────────────────────────────────────┐
//   │ ⚠ … a RFB aplica o Anexo V — mas há folha lançada no período. │
//   └───────────────────────────────────────────────────────────────┘
//
// Duas afirmações incompatíveis: nada foi conferido (não havia o que conferir) e não há folha
// lançada nenhuma. Um ✓ verde ali CONCLUI O QUE NÃO FOI FEITO — a mesma forma de erro que o
// projeto já julgou e escreveu por extenso em `apuracao-v2/pages/renderApuracaoV2Tab.jsx`.
//
// ⚠ O aviso de Anexo V FICA: o risco de Fator-R zero é real com ou sem lançamento. O que saiu é
// só a oração final, que a tela não tinha como saber.

import { render, screen } from "@testing-library/react";
import { FechamentoModal } from "../FechamentoModal.jsx";

const ATIVIDADE_FATOR_R = [{
  idAtividade: 11, descricao: "Serviços sujeitos ao Fator R", anexoImplicito: "III",
  mercado: "INTERNO", sujeitoFatorR: true, valorInterno: 8000, valorExterno: 0,
}];

function dadosBase(over = {}) {
  return {
    razao: "IOHANNA FERREIRA TERAPIA OCUPACIONAL", cnpj: "11.222.333/0001-44",
    regimeApuracao: "COMPETENCIA", cadastroCompleto: true,
    faturamento: { interno: 8000, externo: 0, total: 8000 },
    semMovimentoDisponivel: false, empresaZerada: false, semFaturamento: false,
    entregaPgdas: {}, disparidades: [], rbt12: 96000, estado: "aberta",
    atividades: ATIVIDADE_FATOR_R,
    ...over,
  };
}

function montar(over = {}) {
  const api = {
    getFechamento: jest.fn(async () => ({ ok: true, dados: dadosBase(over) })),
    listAtividadesPgdasd: jest.fn(async () => ({ ok: true, atividades: [] })),
    calcularFechamento: jest.fn(async () => ({ ok: true, result: { dasValor: 0 } })),
  };
  render(
    <FechamentoModal
      api={api} feedback={{}} portalClientId="p1" competencia="2026-08"
      razao="IOHANNA FERREIRA TERAPIA OCUPACIONAL" onClose={() => {}} onChanged={() => {}}
    />,
  );
  return { api };
}

/**
 * A caixa de `Aviso` inteira, achada pelo título — que é justamente o que ela ganhou nesta
 * correção. Ler pelo `textContent` do bloco é o único jeito honesto: a frase é quebrada por
 * `<strong>`, e `getByText` casa elemento a elemento.
 */
async function caixa(titulo) {
  const rotulo = await screen.findByText(titulo);
  return rotulo.parentElement;
}

/** Folha derivada DISPONÍVEL e ZERADA — o caso que produzia a contradição. */
const DERIVADA_ZERO = { disponivel: true, total: 0, porMes: [], mesesComLancamento: 0, contasConsideradas: ["4.1.1.01"] };
/** Folha derivada disponível COM valor — aqui há mesmo o que conferir. */
const DERIVADA_COM_VALOR = { disponivel: true, total: 4000, porMes: [{ competencia: "2026-06", valor: 4000 }], mesesComLancamento: 2, contasConsideradas: ["4.1.1.01"] };

/**
 * ⚠⚠ TETO DE TEMPO DESTE ARQUIVO — 20 s, e ele é DAQUI, nunca do `jest.config` (02/09/2026).
 *
 * ⚠⚠ **O PADRÃO DE 5 s NÃO SOBE NA CONFIGURAÇÃO**, e a razão é concreta: foi ele que expôs, em
 * 01/09/2026, uma rota que PENDURAVA (a varredura de notas consultando o banco sem dublê). Um teto
 * global maior teria transformado aquele defeito em *"a suíte está lenta hoje"* — que é exatamente
 * como esta flutuação vinha sendo lida.
 *
 * ⚠⚠ **A MEDIÇÃO QUE JUSTIFICA O NÚMERO** (`jest --json`, 3.350 casos deste app): **11 casos** levam
 * 3 s ou mais, concentrados em **5 arquivos** — este é um deles. O caso mais pesado marcou 18,5 s.
 * Quem estoura não é o teste errado: é o que estava rodando quando a máquina engasgou, e por isso
 * subir caso a caso seria correr atrás de um alvo que muda a cada execução.
 *
 * ⚠ O custo é jsdom montando tela de verdade (modal cheio, tabela, várias renderizações por caso).
 * Não há espera, relógio nem rede aqui. Os outros ~3.339 casos deste app continuam com 5 s.
 * ⚠ O precedente é da casa: `api: nfse/danfse/__tests__/danfse.test.js` já faz `jest.setTimeout(30000)`.
 */
jest.setTimeout(20000);

describe("folha 0 digitada × 0 derivada — não houve conferência", () => {
  it("⚠ NÃO existe caixa verde de conferência: não havia o que conferir", async () => {
    montar({ folhaDerivada: DERIVADA_ZERO });
    await screen.findByText(/Serviços sujeitos ao Fator R/);
    expect(screen.queryByText(/Confere com os lançamentos de folha/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Conferência da folha/i)).not.toBeInTheDocument();
  });

  it("⚠ o aviso de Anexo V CONTINUA aparecendo — o risco de Fator-R zero é real", async () => {
    montar({ folhaDerivada: DERIVADA_ZERO });
    expect(await caixa("Risco de Anexo V")).toHaveTextContent(/a RFB aplica o\s*Anexo V/i);
  });

  it("⚠ e ele NÃO afirma que há folha lançada — não há", async () => {
    montar({ folhaDerivada: DERIVADA_ZERO });
    const aviso = await caixa("Risco de Anexo V");
    expect(aviso).not.toHaveTextContent(/folha lançada no período/i);
    // Diz o que sabe: a segunda fonte também está zerada.
    expect(aviso).toHaveTextContent(/não há segunda fonte para conferir/i);
  });
});

describe("folha digitada 0 × derivada COM valor — aí sim há divergência a mostrar", () => {
  it("a caixa de conferência aparece, ÂMBAR, com os dois números", async () => {
    montar({ folhaDerivada: DERIVADA_COM_VALOR });
    expect(await screen.findByText(/Conferência da folha/i)).toBeInTheDocument();
    expect(screen.getByText(/lançamentos somam/i)).toBeInTheDocument();
  });

  it("⚠ e o aviso de Anexo V PODE afirmar que há folha lançada, porque agora há", async () => {
    montar({ folhaDerivada: DERIVADA_COM_VALOR });
    const aviso = await caixa("Risco de Anexo V");
    expect(aviso).toHaveTextContent(/de folha lançada no período/i);
    // ⚠ E diz QUANTO. A frase antiga afirmava a existência sem nunca mostrar o número.
    expect(aviso).toHaveTextContent(/R\$\s*4\.000,00/);
  });

  it("⚠ as duas caixas se distinguem pelo TÍTULO — era exatamente isso que faltava", async () => {
    // As duas nasciam com os MESMOS rgba/hex/tamanho, sem título nenhum: âmbar colado em âmbar.
    montar({ folhaDerivada: DERIVADA_COM_VALOR });
    expect(await screen.findByText(/Conferência da folha/i)).toBeInTheDocument();
    expect(screen.getByText(/Risco de Anexo V/i)).toBeInTheDocument();
  });
});

describe("sem folha derivada — o comportamento NÃO mudou", () => {
  it("nenhuma das duas caixas aparece (ampliar o gatilho é decisão do dono, não desta correção)", async () => {
    montar({ folhaDerivada: { disponivel: false } });
    await screen.findByText(/Serviços sujeitos ao Fator R/);
    expect(screen.queryByText(/Conferência da folha/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Risco de Anexo V/i)).not.toBeInTheDocument();
  });
});
