// As regras de TELA do responsável cuja conta atende várias empresas.
//
// O defeito que elas tornam visível: um login enxergando NOVE empresas (produção, 19/08/2026).
// Aqui só a regra; a LIGAÇÃO (a tela chamando isto de verdade) está em
// `features/companies/form/components/__tests__/responsavelCompartilhadoNaTela.ligacao.test.jsx`.

import {
  CODIGO_CONTA_COMPARTILHADA,
  ONDE_DEFINIR_SENHA,
  avisoDeAcessoNovo,
  avisoDeEmailCompartilhado,
  detalhesDaContaCompartilhada,
  fraseDeConfirmacao,
  outrasEmpresasDoEmail,
} from "../responsavelCompartilhado";

const EMPRESAS = [
  { id: "pc-1", razao: "ALFA CONSTRUTORA LTDA", cnpj: "11222333000181" },
  { id: "pc-2", razao: "BETA OBRAS LTDA", cnpj: "44555666000199" },
  { id: "pc-3", razao: "GAMA ENGENHARIA LTDA", cnpj: "77888999000155" },
];

describe("outrasEmpresasDoEmail", () => {
  test("tira a empresa que está sendo editada", () => {
    expect(outrasEmpresasDoEmail(EMPRESAS, "pc-2").map((e) => e.id)).toEqual(["pc-1", "pc-3"]);
  });

  test("sem empresa atual, devolve todas (é o caso do cadastro de empresa NOVA)", () => {
    expect(outrasEmpresasDoEmail(EMPRESAS, null)).toHaveLength(3);
  });

  test("lista ausente não quebra", () => {
    expect(outrasEmpresasDoEmail(undefined, "pc-1")).toEqual([]);
  });
});

describe("avisoDeEmailCompartilhado", () => {
  test("e-mail que só atende a própria empresa NÃO avisa nada", () => {
    // ⚠ É o que separa aviso de ruído: sem isto TODA edição avisaria sobre si mesma, e o contador
    // aprenderia a ignorar o aviso antes de ele ter algo a dizer.
    expect(avisoDeEmailCompartilhado({
      email: "dono@empresa.com",
      empresas: [EMPRESAS[0]],
      empresaAtualId: "pc-1",
    })).toBeNull();
  });

  test("campo vazio não avisa", () => {
    expect(avisoDeEmailCompartilhado({ email: "", empresas: EMPRESAS })).toBeNull();
  });

  test("e-mail que atende outras avisa, NOMEIA as empresas e conta a consequência", () => {
    const aviso = avisoDeEmailCompartilhado({
      email: "Dono@Empresa.com",
      empresas: EMPRESAS,
      empresaAtualId: "pc-1",
    });
    expect(aviso.quantas).toBe(2);
    expect(aviso.titulo).toContain("outras 2 empresas");
    // ⚠ A frase diz a CONSEQUÊNCIA ("um login só"), não só o fato ("já é usado").
    expect(aviso.consequencia).toContain("um login só");
    expect(aviso.consequencia).toContain("dono@empresa.com");
    // Nomear é o que permite o contador reconhecer o grupo legítimo dele.
    expect(aviso.nomes.join(" | ")).toContain("BETA OBRAS LTDA");
    expect(aviso.nomes.join(" | ")).toContain("44.555.666/0001-99");
  });

  test("⚠ NUNCA BLOQUEIA — grupo de empresas com o mesmo dono é legítimo", () => {
    const aviso = avisoDeEmailCompartilhado({ email: "d@e.com", empresas: EMPRESAS, empresaAtualId: "pc-1" });
    expect(aviso.bloqueia).toBe(false);
  });

  test("singular quando é só uma outra empresa", () => {
    const aviso = avisoDeEmailCompartilhado({
      email: "d@e.com",
      empresas: EMPRESAS.slice(0, 2),
      empresaAtualId: "pc-1",
    });
    expect(aviso.titulo).toBe("Este e-mail já responde por outra empresa");
    expect(aviso.consequencia).toContain("mais 1");
  });
});

describe("detalhesDaContaCompartilhada", () => {
  const erro409 = () => ({
    code: CODIGO_CONTA_COMPARTILHADA,
    status: 409,
    payload: {
      error: CODIGO_CONTA_COMPARTILHADA,
      emailAtual: "dono@empresa.com",
      emailNovo: "novo@empresa.com",
      empresasDaConta: 9,
      outrasEmpresas: 8,
      outras: EMPRESAS,
      contaNovaSemSenha: true,
    },
  });

  test("lê os dados do ato quando o código bate", () => {
    const d = detalhesDaContaCompartilhada(erro409());
    expect(d.empresasDaConta).toBe(9);
    expect(d.outrasEmpresas).toBe(8);
    expect(d.contaNovaSemSenha).toBe(true);
    expect(d.outras).toHaveLength(3);
  });

  test("⚠ SÓ O CÓDIGO DECIDE — mensagem parecida não abre confirmação nenhuma", () => {
    expect(detalhesDaContaCompartilhada({ message: "owner_email_conta_compartilhada" })).toBeNull();
    expect(detalhesDaContaCompartilhada({ code: "owner_email_already_in_use" })).toBeNull();
    expect(detalhesDaContaCompartilhada(null)).toBeNull();
  });
});

describe("fraseDeConfirmacao", () => {
  const detalhes = {
    emailAtual: "dono@empresa.com",
    emailNovo: "novo@empresa.com",
    empresasDaConta: 9,
    outrasEmpresas: 8,
    contaNovaSemSenha: true,
  };

  test("repete os DADOS do ato e diz o que acontece com CADA lado", () => {
    const frase = fraseDeConfirmacao({ detalhes, razaoSocial: "ALFA CONSTRUTORA LTDA" });
    expect(frase).toContain("dono@empresa.com é a conta de 9 empresas");
    expect(frase).toContain("ALFA CONSTRUTORA LTDA passa a ter acesso próprio");
    expect(frase).toContain("novo@empresa.com");
    // O lado que o defeito estragava: as outras têm de ficar onde estão, e isso é dito.
    expect(frase).toContain("As outras 8 empresas continuam com dono@empresa.com");
  });

  test("⚠ DIZ QUE A CONTA NOVA NASCE SEM SENHA, e onde definir uma", () => {
    // Sem esta linha o contador troca o e-mail, avisa o cliente, e o cliente não entra —
    // sem ninguém saber por quê.
    const frase = fraseDeConfirmacao({ detalhes, razaoSocial: "ALFA" });
    expect(frase).toContain("nasce SEM SENHA");
    expect(frase).toContain(ONDE_DEFINIR_SENHA);
  });

  test("⚠ NÃO é 'tem certeza?' — nenhuma pergunta genérica", () => {
    const frase = fraseDeConfirmacao({ detalhes, razaoSocial: "ALFA" }).toLowerCase();
    expect(frase).not.toMatch(/tem certeza|deseja continuar|confirma\?/);
  });

  test("singular quando é só uma outra empresa", () => {
    const frase = fraseDeConfirmacao({
      detalhes: { ...detalhes, empresasDaConta: 2, outrasEmpresas: 1 },
      razaoSocial: "ALFA",
    });
    expect(frase).toContain("A outra empresa continua com dono@empresa.com");
  });

  test("sem detalhes, texto vazio (a tela não renderiza)", () => {
    expect(fraseDeConfirmacao({ detalhes: null })).toBe("");
  });
});

describe("avisoDeAcessoNovo", () => {
  test("aponta para a ação que JÁ existe, não inventa outra", () => {
    const a = avisoDeAcessoNovo({ userId: "u-9", email: "novo@empresa.com", semSenha: true });
    expect(a.texto).toContain("ainda NÃO tem senha");
    expect(a.texto).toContain(ONDE_DEFINIR_SENHA);
  });

  test("sem acesso novo, nada a mostrar", () => {
    expect(avisoDeAcessoNovo(null)).toBeNull();
    expect(avisoDeAcessoNovo({})).toBeNull();
  });
});
