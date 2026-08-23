// A LIGAÇÃO DA ABA AUDITORIA — a regra já está travada em `lib/__tests__/auditoriaTela.test.js`;
// aqui trava-se que a TELA a consome, e que nada é escrito.
//
// ⚠ O QUE ESTE ARQUIVO PROTEGE:
//   1. `NAO_CONFERIVEL` não é desenhado como "nada a apontar" — é o defeito que apagaria o cadastro
//      vazio de 33 de 33 empresas da produção;
//   2. a nota que a pergunta não conseguiu avaliar continua NA TELA, com o motivo;
//   3. a frase "isto é pergunta, não veredito" está visível, não num comentário de código;
//   4. a aba não oferece nenhuma ação que escreva.
//
// ⚠ E, DESDE O CORTE DE 21/08/2026:
//   5. o desvio de UM mês vira contagem visível, nunca silêncio;
//   6. a nota sem competência aparece — ela sumia antes de a regra existir;
//   7. a pendência pós-fechamento é renderizada (o componente existia sem nenhum consumidor);
//   8. nenhum bloco de numeração da DPS volta à tela.

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AuditoriaTab } from "../renderAuditoriaTab";

const perguntaBase = (over) => ({
  achado: "há um ponto a conferir nesta nota",
  situacao: "CONFERIDA", motivo: null, avaliadas: 10, achados: [], naoAvaliadas: [], ...over,
});

const AUDITORIA = {
  competencia: "2026-07",
  totalNotas: 13,
  totalNotasApuradas: 12,
  totalAchados: 1,
  perguntas: [
    perguntaBase({
      id: "ATIVIDADE_FORA_DO_CADASTRO", titulo: "Atividade fora do cadastro",
      pergunta: "Alguma nota saiu num código de serviço que não está cadastrado na empresa?",
      situacao: "NAO_CONFERIVEL", motivo: "EMPRESA_SEM_CODIGOS_CADASTRADOS", avaliadas: 0,
    }),
    perguntaBase({
      id: "EMISSAO_FORA_DA_COMPETENCIA", titulo: "Emissão em mês distante da competência",
      pergunta: "Alguma nota está sendo contada num mês DOIS ou mais meses distante do da emissão?",
      achado: "esta nota está contada numa competência distante do mês da data de emissão",
      viradaDeMes: 1727, mesesDeDesvioMinimo: 2,
      achados: [{
        pergunta: "EMISSAO_FORA_DA_COMPETENCIA", notaId: "n1", numero: "13000",
        chaveAcesso: "CH1", emissao: "2026-09-02", competencia: "2026-07", valor: 1250,
        dados: { mesDaCompetencia: "2026-07", mesDaEmissao: "2026-09", mesesDeDesvio: -2 },
      }],
    }),
    perguntaBase({
      id: "ISS_ZERADO_ONDE_TRIBUTA", titulo: "ISS zerado onde a atividade tributa",
      pergunta: "Alguma nota tem base ou alíquota de ISSQN e mesmo assim saiu com imposto zero?",
      naoAvaliadas: [{ notaId: "n2", numero: "13001", motivo: "SEM_ISSQN_NO_XML" }],
    }),
  ],
  manutencao: {
    notasNaoLidas: 1,
    leitura: {
      id: "NOTA_NAO_LIDA", titulo: "Nota que não pôde ser lida", manutencao: true,
      situacao: "CONFERIDA", motivo: null, avaliadas: 13, naoAvaliadas: [],
      achados: [{ pergunta: "NOTA_NAO_LIDA", notaId: "n9", numero: "13009", dados: { especie: "NUNCA_EXTRAIDA", motivo: null } }],
    },
  },
  foraDaConferencia: {
    motivo: "SEM_COMPETENCIA_GRAVADA", total: 2, listadas: 2, truncada: false,
    notas: [
      { notaId: "n7", numero: "13007", emissao: "2026-07-19" },
      { notaId: "n8", numero: "13008", emissao: "2026-07-22" },
    ],
  },
  empresa: { temCadastroDeServicos: false, codigosServicoNacional: [] },
};

const PENDENCIAS = [{
  id: "p1", competencia: "2026-05", notaId: "n6", motivo: "nota_retroativa",
  observacoes: "NFS-e CH6 chegou para 2026-05 (competência já fechada).",
  resolvida: false, createdAt: "2026-08-14T11:20:00.000Z",
}];

const apiCom = (auditoria, pendencias = PENDENCIAS) => ({
  getAuditoriaNotas: jest.fn(async () => ({ ok: true, auditoria })),
  listPendenciasPosFechamento: jest.fn(async () => pendencias),
});

describe("a aba Auditoria", () => {
  it("pede a auditoria da empresa e da competência que recebeu", async () => {
    const api = apiCom(AUDITORIA);
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={api} />);
    await waitFor(() => expect(api.getAuditoriaNotas).toHaveBeenCalledWith("emp-1", "2026-07"));
  });

  it("⚠ NÃO CONFERÍVEL não vira 'nada a apontar' — a tela manda cadastrar os códigos", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText(/a empresa não tem código de serviço cadastrado/i)).toBeInTheDocument();
    // ⚠ 19/08/2026: o "onde se resolve" passou a sair de `ONDE_CONFIGURA_EMISSAO` — a configuração
    // saiu da ficha e a entrada virou a engrenagem da aba Notas Fiscais (pedido do dono).
    expect(screen.getByText(/Cadastre os códigos em Notas Fiscais → ⚙ Configuração de emissão/i)).toBeInTheDocument();
  });

  it("a pergunta conferida SEM achado diz quantas notas foram olhadas", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findAllByText(/Nada a apontar em 10 nota\(s\) conferida\(s\)/)).not.toHaveLength(0);
  });

  it("⚠ a frase 'pergunta, não veredito' está NA TELA", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText(/Cada ponto é uma pergunta, não um veredito/)).toBeInTheDocument();
    expect(screen.getByText(/Quem decide se a nota está correta é você/)).toBeInTheDocument();
  });

  it("o achado sai com a frase da regra e o desvio em meses", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText("Competência 2026-07 · emitida em 2026-09")).toBeInTheDocument();
    expect(screen.getByText(/2 meses de diferença/)).toBeInTheDocument();
  });

  // ⚠⚠ ESTE É O TESTE QUE IMPEDE O CORTE DE VIRAR OMISSÃO. As 1.727 notas de um mês deixaram de ser
  // linha; se também deixassem de ser NÚMERO, a pergunta passaria a esconder o que conferiu — e a
  // frase "nada some em silêncio" viraria mentira.
  it("⚠ a virada de mês aparece como CONTAGEM, com a explicação", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText(/1727 nota\(s\) com um mês de diferença não estão listadas/)).toBeInTheDocument();
    expect(screen.getByText(/virada normal de mês/)).toBeInTheDocument();
  });

  it("⚠ a nota SEM COMPETÊNCIA aparece — ela sumia antes de a regra existir", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText(/Notas fora de qualquer conferência mensal/)).toBeInTheDocument();
    expect(screen.getByText(/2 nota\(s\) desta empresa não têm competência gravada/)).toBeInTheDocument();
    expect(screen.getByText(/Nota 13007 — emitida em 2026-07-19/)).toBeInTheDocument();
  });

  // ⚠ A peça existia e NENHUMA tela a chamava (model + rota + método de API prontos). Era a resposta
  // para "entrou nota depois que eu fechei o mês?", invisível.
  it("⚠ a pendência pós-fechamento é renderizada, com o motivo em português", async () => {
    const api = apiCom(AUDITORIA);
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={api} />);
    await waitFor(() => expect(api.listPendenciasPosFechamento).toHaveBeenCalledWith("emp-1", { onlyOpen: true }));
    expect(await screen.findByText(/Pendências pós-fechamento \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("2026-05")).toBeInTheDocument();
    expect(screen.getByText(/chegou uma nota para uma competência que já estava fechada/)).toBeInTheDocument();
  });

  // ⚠ A pendência é da EMPRESA, não do mês na tela: filtrar pela competência aberta esconderia
  // exatamente a nota que chegou atrasada.
  it("a pendência não é filtrada pela competência da tela", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText("2026-05")).toBeInTheDocument();
  });

  it("⚠ falha ao ler as pendências NÃO vira 'nenhuma pendência' — a tela avisa", async () => {
    const api = {
      getAuditoriaNotas: jest.fn(async () => ({ ok: true, auditoria: AUDITORIA })),
      listPendenciasPosFechamento: jest.fn(async () => { throw new Error("fora do ar"); }),
    };
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={api} />);
    expect(await screen.findByText(/Não foi possível conferir se entrou nota depois de a competência ser fechada/))
      .toBeInTheDocument();
    // …e a auditoria em si continua na tela: são perguntas independentes.
    expect(screen.getByText(/Cada ponto é uma pergunta, não um veredito/)).toBeInTheDocument();
  });

  it("⚠ a nota fora da conferência NÃO some — aparece com o motivo", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    const botao = await screen.findByText(/1 nota\(s\) fora desta conferência/);
    fireEvent.click(botao);
    expect(await screen.findByText(/Nota 13001 — o XML não traz ISSQN/)).toBeInTheDocument();
  });

  // ⚠ O CADEADO DO CORTE, do lado da tela: nem numeração da DPS (sem norma) nem "nota não lida"
  // (manutenção do sistema) voltam a ser bloco, mesmo com o dado subindo em `manutencao`.
  it("⚠ nenhum bloco de numeração da DPS nem de nota não lida", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    await screen.findByText(/Auditoria pré-apuração/);
    expect(screen.queryByText(/Numeração da DPS/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Numeração conferida/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nota que não pôde ser lida/i)).not.toBeInTheDocument();
  });

  it("⚠ nenhuma ação de escrita é oferecida — a aba é leitura", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    await screen.findByText(/Auditoria pré-apuração/);
    const rotulos = screen.getAllByRole("button").map((b) => b.textContent || "");
    for (const r of rotulos) {
      expect(r).not.toMatch(/salvar|marcar|corrigir|ignorar|aplicar|confirmar|transmitir|excluir|reabrir/i);
    }
    expect(screen.getByText(/Esta tela apenas lê/)).toBeInTheDocument();
  });

  it("⚠ falha NÃO vira 'nada a apontar' — o erro aparece", async () => {
    const api = {
      getAuditoriaNotas: jest.fn(async () => { throw new Error("servidor fora do ar"); }),
      listPendenciasPosFechamento: jest.fn(async () => []),
    };
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={api} />);
    expect(await screen.findByText(/servidor fora do ar/)).toBeInTheDocument();
    expect(screen.queryByText(/Nada a apontar/)).not.toBeInTheDocument();
  });

  it("sem competência não chama a auditoria — e não afirma nada sobre o mês", async () => {
    const api = apiCom(AUDITORIA);
    render(<AuditoriaTab companyId="emp-1" competencia="" api={api} />);
    expect(api.getAuditoriaNotas).not.toHaveBeenCalled();
    expect(await screen.findByText(/Escolha uma competência no topo/)).toBeInTheDocument();
  });

  it("com achado, o cabeçalho conta os pontos E lembra o que não deu para conferir", async () => {
    render(<AuditoriaTab companyId="emp-1" competencia="2026-07" api={apiCom(AUDITORIA)} />);
    expect(await screen.findByText("1 ponto a conferir")).toBeInTheDocument();
    expect(screen.getByText(/1 sem como conferir/)).toBeInTheDocument();
  });
});
