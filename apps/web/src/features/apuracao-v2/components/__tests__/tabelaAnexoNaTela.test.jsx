// A TABELA DO ANEXO NA TELA — e a aba sem o terceiro nível de abas.
//
// ⚠ A REGRA já é testada isolada em `lib/__tests__/anexoDaEmpresa.test.js` (23 casos). Aqui se prova
// a LIGAÇÃO: que a tela renderiza o que a regra decide, que ela não afirma o que a regra recusa, e
// que o botão de classificação — a única porta que sobrou para as pendências — aparece SEMPRE.

import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import fs from "node:fs";
import path from "node:path";
import { TabelaAnexoReferencia } from "../TabelaAnexoReferencia";
import { ANEXOS, VIGENCIA_ATUAL } from "../../../planejamento/lib/tabelasFiscais";

const comercio = [{ anexoImplicito: "I", sujeitoFatorR: false }];
/** ⚠ A forma REAL do catálogo do PGDAS-D: atividade de Fator R grava `anexoImplicito: "III"`. */
const fatorR = [{ anexoImplicito: "III", sujeitoFatorR: true }];

describe("a tabela do anexo aparece na aba", () => {
  it("desenha as 6 faixas do anexo da empresa e marca a dela", () => {
    render(<TabelaAnexoReferencia atividades={comercio} rbt12={500_000} folha12m={null} />);
    expect(screen.getByText(ANEXOS.I.nome)).toBeInTheDocument();
    // 6 faixas + a linha de cabeçalho
    expect(document.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(screen.getByText(/esta empresa/)).toBeInTheDocument();
  });

  // ⚠ A VIGÊNCIA VAI IMPRESSA. Tabela fiscal sem data não é conferível — quem lê não sabe se está
  // olhando a regra do ano dele. Mesma disciplina do Planejamento Tributário.
  it("imprime a vigência da tabela usada", () => {
    render(<TabelaAnexoReferencia atividades={comercio} rbt12={500_000} folha12m={null} />);
    expect(screen.getByText(new RegExp(`vigência ${VIGENCIA_ATUAL}`))).toBeInTheDocument();
  });

  // ⚠⚠ A frase que separa REFERÊNCIA de APURAÇÃO. Sem ela, uma tabela ao lado do DAS se lê como a
  // memória de cálculo do imposto — e quem calcula o DAS é a Receita, não esta tela.
  it("diz, na tela, que NÃO é a apuração", () => {
    render(<TabelaAnexoReferencia atividades={comercio} rbt12={500_000} folha12m={null} />);
    expect(screen.getByText(/Não é a/)).toBeInTheDocument();
  });
});

describe("⚠⚠ Fator R sem folha: mostra as DUAS tabelas e não escolhe", () => {
  it("renderiza Anexo III e Anexo V, com o aviso de que a folha decide", () => {
    render(<TabelaAnexoReferencia atividades={fatorR} rbt12={1_000_000} folha12m={null} />);
    expect(screen.getByText(ANEXOS.III.nome)).toBeInTheDocument();
    expect(screen.getByText(ANEXOS.V.nome)).toBeInTheDocument();
    expect(screen.getByText(/a folha que decide/)).toBeInTheDocument();
  });

  it("com folha informada, mostra UM anexo só e o Fator R em %", () => {
    render(<TabelaAnexoReferencia atividades={fatorR} rbt12={1_000_000} folha12m={100_000} />);
    expect(screen.queryByText(ANEXOS.III.nome)).not.toBeInTheDocument();
    expect(screen.getByText(ANEXOS.V.nome)).toBeInTheDocument();
    // O Fator R nunca era exibido nesta aba antes desta entrega.
    expect(screen.getByText(/Fator R desta competência/)).toBeInTheDocument();
  });
});

describe("⚠ RBT12 desconhecido: tabela inteira, nenhuma linha marcada", () => {
  it.each([["null", null], ["string vazia", ""], ["zero", 0]])("%s", (_r, valor) => {
    render(<TabelaAnexoReferencia atividades={comercio} rbt12={valor} folha12m={null} />);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(screen.queryByText(/esta empresa/)).not.toBeInTheDocument();
    expect(screen.getByText(/ainda não é conhecida/)).toBeInTheDocument();
  });
});

describe("o que a tabela avisa além dos números", () => {
  it("⚠ Anexo IV: a CPP fica FORA do DAS", () => {
    render(<TabelaAnexoReferencia atividades={[{ anexoImplicito: "IV" }]} rbt12={500_000} folha12m={null} />);
    expect(screen.getByText(/não/).closest("div")).toBeTruthy();
    expect(screen.getByText(/CPP/)).toBeInTheDocument();
  });

  it("sem atividade nenhuma, não desenha tabela de anexo", () => {
    render(<TabelaAnexoReferencia atividades={[]} rbt12={500_000} folha12m={null} />);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(screen.getByText(/Nenhuma atividade escolhida/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// VARREDURA DE FONTE — o que uma asserção de comportamento não pega
// ─────────────────────────────────────────────────────────────────────────────────────────────

function lerDoRepo(...partes) {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const tentativa = path.join(dir, ...partes);
    if (fs.existsSync(tentativa)) return fs.readFileSync(tentativa, "utf8");
    dir = path.dirname(dir);
  }
  throw new Error(`Arquivo não encontrado a partir de ${process.cwd()}: ${partes.join("/")}`);
}

describe("⚠⚠ o terceiro nível de abas não volta, e ninguém aponta para ele", () => {
  const ABA = ["apps", "web", "src", "features", "apuracao-v2", "pages", "renderApuracaoV2Tab.jsx"];

  it("a aba não tem mais uma barra de seções (`SecaoTabs`)", () => {
    const fonte = lerDoRepo(...ABA);
    // O comentário-lápide cita o nome; o que não pode voltar é o COMPONENTE.
    expect(fonte).not.toMatch(/function SecaoTabs/);
    expect(fonte).not.toMatch(/<SecaoTabs/);
  });

  // ⚠⚠ A FRASE DO SERVIDOR VENCE O TEXTO LOCAL. `RelatorioFaturamentoService` manda um
  // `comoResolver` que a tela imprime; enquanto ele dissesse "sub-aba Sugestão", o contador seria
  // mandado para uma seção que não existe mais. É o defeito que o `ONDE_CONFIGURA_EMISSAO` já
  // registra — e por isso a varredura cobre backend, mock e tela, não só a tela.
  it.each([
    ["a aba", ABA],
    ["o serviço do backend", ["apps", "api", "src", "application", "notas", "apuracao", "v2", "RelatorioFaturamentoService.js"]],
    ["o mock", ["apps", "web", "src", "api", "mock", "mockApi.js"]],
  ])("%s não manda ninguém para a sub-aba Sugestão", (_rotulo, partes) => {
    expect(lerDoRepo(...partes)).not.toMatch(/sub-aba Sugest/);
  });

  // ⚠ O botão de classificação é a ÚNICA porta que sobrou para as pendências. Com a condição
  // `pendencias.length > 0` de volta, a resposta "nenhuma pendência aberta — e isso ainda NÃO quer
  // dizer classificada" ficaria sem lugar na tela, e lista vazia se leria como trabalho concluído.
  // ⚠ A varredura é de TEXTO, então o comentário-lápide da aba NÃO pode escrever a condição antiga
  // em código literal — ela acusaria a própria explicação. Aconteceu: este teste nasceu vermelho
  // apontando para o comentário que o justificava, e quem mudou foi o comentário. O filtro de
  // linhas `//` fica como rede para o caso de alguém citá-la de novo numa linha de comentário
  // comum; um comentário JSX (`{/* … */}`) escapa dele, que foi exatamente o caso original.
  it("o botão de classificação não é condicionado à existência de pendências", () => {
    const codigo = lerDoRepo(...ABA)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(codigo).not.toMatch(/pendencias\.length > 0 &&/);
  });
});
