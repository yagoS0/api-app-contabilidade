// A REGRA DE TELA DA SENHA DO PORTAL — as decisões que não podem mudar sem alguém decidir.

import {
  ORIGENS,
  PAPEL_MINIMO,
  estadoDaLista,
  fraseDeConfirmacao,
  identificarUsuario,
  linhaDeEstado,
  motivoDoBloqueio,
  nomeDoPapel,
} from "../senhaDoPortal";

const MARIA = { userId: "u1", nome: "Maria do Cliente", email: "maria@empresa.com.br", papel: "OWNER" };
const JOAO = { userId: "u2", nome: "João Sócio", email: "joao@empresa.com.br", papel: "CLIENT_ADMIN" };

describe("identificarUsuario — a tela NOMEIA de quem é a senha", () => {
  test("nome E e-mail, não um deles", () => {
    // Dois sócios com o mesmo primeiro nome existem; o e-mail é o que de fato entra no login.
    expect(identificarUsuario(MARIA)).toBe("Maria do Cliente (maria@empresa.com.br)");
  });

  test("sem nome, o e-mail responde sozinho", () => {
    expect(identificarUsuario({ userId: "u1", email: "maria@empresa.com.br" })).toBe("maria@empresa.com.br");
  });

  test("sem e-mail, a falta é DITA — não escondida", () => {
    expect(identificarUsuario({ userId: "u1", nome: "Maria" })).toBe("Maria — sem e-mail cadastrado");
  });

  test("⚠ sem nome e sem e-mail, mostra o ID — nunca um rótulo genérico", () => {
    // "Usuário do portal" faria dois usuários ficarem indistinguíveis na hora de escolher a linha.
    expect(identificarUsuario({ userId: "u9" })).toBe("Usuário u9");
    expect(identificarUsuario({})).toBe("Usuário sem identificação");
  });
});

describe("estadoDaLista — a tela nunca escolhe o usuário em silêncio", () => {
  test("um usuário: sem aviso, e ele é o da linha", () => {
    const r = estadoDaLista({ carregando: false, erro: null, usuarios: [MARIA] });
    expect(r.estado).toBe("UM");
    expect(r.aviso).toBeNull();
  });

  test("⚠ dois usuários: os DOIS aparecem, nenhum pré-selecionado, e o aviso conta quantos", () => {
    // Eleger "o primeiro" ou "o OWNER" seria o sistema decidindo de quem é a senha que vai mudar.
    const r = estadoDaLista({ carregando: false, erro: null, usuarios: [MARIA, JOAO] });
    expect(r.estado).toBe("VARIOS");
    expect(r.usuarios).toHaveLength(2);
    expect(r.aviso).toContain("2 usuários");
  });

  test("⚠ falha de leitura NÃO diz 'esta empresa não tem usuário'", () => {
    // São duas situações com consertos opostos; igualá-las faz "não consegui ler" passar por
    // "não existe ninguém".
    const falhou = estadoDaLista({ carregando: false, erro: { status: 500 }, usuarios: [] });
    const vazio = estadoDaLista({ carregando: false, erro: null, usuarios: [] });
    expect(falhou.aviso).not.toBe(vazio.aviso);
    expect(falhou.aviso).toMatch(/não foi possível ler/i);
    expect(vazio.aviso).toMatch(/não tem nenhum usuário/i);
  });

  test("erro numa RECARGA não apaga a lista que já está na tela", () => {
    const r = estadoDaLista({ carregando: false, erro: { status: 500 }, usuarios: [MARIA] });
    expect(r.estado).toBe("UM");
    expect(r.usuarios).toHaveLength(1);
  });

  test("carregando sem lista ainda não afirma nada sobre a empresa", () => {
    expect(estadoDaLista({ carregando: true, erro: null, usuarios: [] }).estado).toBe("CARREGANDO");
  });
});

describe("linhaDeEstado — o que o portal do contador 'também muda'", () => {
  test("troca pelo escritório nomeia o autor", () => {
    const linha = linhaDeEstado({
      origem: ORIGENS.ESCRITORIO,
      em: "2026-08-19T12:00:00.000Z",
      autorNome: "Contador Fulano",
    });
    expect(linha).toContain("pelo escritório");
    expect(linha).toContain("Contador Fulano");
  });

  test("⚠ troca PELO PRÓPRIO CLIENTE é dita como tal — é uma senha só, com três caminhos", () => {
    expect(linhaDeEstado({ origem: ORIGENS.CLIENTE_PERFIL, em: "2026-08-19T12:00:00.000Z" }))
      .toContain("pelo próprio cliente, no perfil dele");
    expect(linhaDeEstado({ origem: ORIGENS.CLIENTE_RECUPERACAO, em: "2026-08-19T12:00:00.000Z" }))
      .toContain("recuperação de e-mail");
  });

  test("⚠ o autor do escritório NÃO some quando o usuário foi apagado — cai para e-mail, depois id", () => {
    expect(linhaDeEstado({ origem: ORIGENS.ESCRITORIO, em: "2026-08-19T12:00:00.000Z", autorEmail: "c@e.com" }))
      .toContain("c@e.com");
    expect(linhaDeEstado({ origem: ORIGENS.ESCRITORIO, em: "2026-08-19T12:00:00.000Z", autorUserId: "user-7" }))
      .toContain("user-7");
  });

  test("⚠ sem registro, NÃO se afirma 'nunca foi trocada'", () => {
    // A senha pode ter sido definida no provisionamento da empresa, anterior a este registro.
    const linha = linhaDeEstado(null);
    expect(linha).toMatch(/não há registro/i);
    expect(linha).not.toMatch(/nunca/i);
  });

  test("origem desconhecida não ganha frase inventada", () => {
    expect(linhaDeEstado({ origem: "SEI_LA", em: "2026-08-19T12:00:00.000Z" }))
      .toContain("por um caminho não identificado");
  });

  test("data ilegível é dita, não escondida", () => {
    expect(linhaDeEstado({ origem: ORIGENS.ESCRITORIO, em: "não é data" }))
      .toMatch(/sem registro da data/i);
  });
});

describe("fraseDeConfirmacao — repete os dados do ato, nunca 'tem certeza?'", () => {
  const frase = fraseDeConfirmacao({ usuario: MARIA, razaoSocial: "EMPRESA TESTE LTDA" });

  test("diz DE QUEM é a senha", () => {
    expect(frase).toContain("Maria do Cliente");
    expect(frase).toContain("maria@empresa.com.br");
    expect(frase).toContain("EMPRESA TESTE LTDA");
  });

  test("⚠ diz que as SESSÕES ABERTAS caem — é o que a troca serve para fazer", () => {
    expect(frase).toMatch(/sess(ões|oes) abertas/i);
    expect(frase).toMatch(/encerradas/i);
  });

  test("⚠ diz que a senha aparece UMA VEZ e não há como vê-la depois", () => {
    expect(frase).toMatch(/uma única vez/i);
    expect(frase).toMatch(/não há como vê-la depois|não fica guardada/i);
  });

  test("diz que a troca fica registrada com nome e hora", () => {
    expect(frase).toMatch(/registrada com o seu nome/i);
  });

  test("⚠ NÃO é 'tem certeza?'", () => {
    expect(frase).not.toMatch(/tem certeza/i);
  });
});

describe("motivoDoBloqueio — botão desabilitado NOMEIA o motivo", () => {
  test("papel insuficiente cita o papel mínimo", () => {
    const motivo = motivoDoBloqueio({ podeDefinirSenha: false, salvando: false, usuario: MARIA });
    expect(motivo).toContain(PAPEL_MINIMO);
  });

  test("sem usuário, o motivo é a ausência dele", () => {
    expect(motivoDoBloqueio({ podeDefinirSenha: true, salvando: false, usuario: {} }))
      .toMatch(/não há usuário/i);
  });

  test("podendo e parado, não há bloqueio", () => {
    expect(motivoDoBloqueio({ podeDefinirSenha: true, salvando: false, usuario: MARIA })).toBeNull();
  });
});

describe("nomeDoPapel", () => {
  test("traduz os conhecidos e não some com os desconhecidos", () => {
    expect(nomeDoPapel("OWNER")).toBe("Responsável");
    expect(nomeDoPapel("CLIENT_ADMIN")).toBe("Administrador");
    expect(nomeDoPapel("PAPEL_NOVO")).toBe("PAPEL_NOVO");
    expect(nomeDoPapel(null)).toBe("Papel não informado");
  });
});
