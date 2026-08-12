// AS REGRAS DE TELA DO COFRE — as que, erradas, mentem sobre um segredo.
//
// Quatro decisões vivem aqui e nenhuma delas pode escorregar: a senha nunca aparece fora do estado
// REVELADA, a máscara não entrega o tamanho do valor, um botão desabilitado sempre nomeia o motivo
// (e o motivo mais específico vem primeiro), e a tela diz a VERDADE sobre o nível de proteção do
// ambiente — inclusive quando não sabe qual é.
//
// A quinta é a que a lista vazia esconde: "não há credencial" e "não consegui ler" são o mesmo
// pixel e exigem reações opostas.

import {
  ESTADOS,
  MASCARA,
  CARGA,
  estadoDaCredencial,
  podeVerSenha,
  avisoDeProtecao,
  estadoDaCarga,
} from "../estadoCredencial";

describe("estadoDaCredencial — o que ocupa o lugar da senha", () => {
  it("sem senha cadastrada não é 'oculta': é SEM_SENHA", () => {
    // Mostrar máscara aqui prometeria um valor que não existe, e o contador ficaria pedindo
    // permissão para ver o que ninguém guardou.
    expect(estadoDaCredencial({ temSenha: false })).toBe(ESTADOS.SEM_SENHA);
  });

  it("⚠ sem senha continua SEM_SENHA mesmo com a linha marcada como revelada", () => {
    expect(estadoDaCredencial({ temSenha: false }, true)).toBe(ESTADOS.SEM_SENHA);
  });

  it("com senha: OCULTA por padrão, REVELADA só quando esta linha está à mostra", () => {
    expect(estadoDaCredencial({ temSenha: true })).toBe(ESTADOS.OCULTA);
    expect(estadoDaCredencial({ temSenha: true }, true)).toBe(ESTADOS.REVELADA);
  });

  it("credencial ausente (linha ainda não carregada) não vira 'oculta'", () => {
    expect(estadoDaCredencial(undefined)).toBe(ESTADOS.SEM_SENHA);
    expect(estadoDaCredencial(null, true)).toBe(ESTADOS.SEM_SENHA);
  });
});

describe("MASCARA — comprimento fixo é a regra, não o acaso", () => {
  it("é uma constante: não acompanha o tamanho de senha nenhuma", () => {
    // Máscara proporcional entrega o comprimento do segredo a quem olha a tela por cima do ombro —
    // e o comprimento nem chega ao front, porque a listagem não traz a coluna.
    expect(MASCARA).toBe("••••••••");
    expect(MASCARA).toHaveLength(8);
  });
});

describe("podeVerSenha — desabilitado NOMEIA o motivo, do mais específico para o mais geral", () => {
  it("⚠ 'não tem senha' vence 'você não tem permissão'", () => {
    // Dizer ao STAFF que falta permissão para ver uma senha que não existe manda-o pedir um acesso
    // que não resolveria nada.
    const r = podeVerSenha({
      credencial: { temSenha: false },
      podeRevelar: false,
      papelMinimoRevelar: "FIRM_ADMIN",
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/cadastrada sem senha/);
    expect(r.motivo).not.toMatch(/permiss|perfil/i);
  });

  it("sem permissão: o motivo NOMEIA o papel que resolveria", () => {
    // "Sem permissão" sozinho não diz a quem pedir.
    const r = podeVerSenha({
      credencial: { temSenha: true },
      podeRevelar: false,
      papelMinimoRevelar: "FIRM_ADMIN",
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/administrador do escritório/);
  });

  it("papel desconhecido não produz motivo vazio — cai num texto genérico que ainda instrui", () => {
    const r = podeVerSenha({
      credencial: { temSenha: true },
      podeRevelar: false,
      papelMinimoRevelar: "PAPEL_QUE_NAO_EXISTE",
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/um perfil com permissão/);
  });

  it("com senha e com permissão: liberado e sem motivo a exibir", () => {
    const r = podeVerSenha({
      credencial: { temSenha: true },
      podeRevelar: true,
      papelMinimoRevelar: "FIRM_ADMIN",
    });
    expect(r).toEqual({ pode: true, motivo: "" });
  });
});

describe("avisoDeProtecao — o nível de proteção é dito ANTES de digitar a primeira senha", () => {
  it("⚠ cofre desconhecido NÃO vira 'está tudo bem'", () => {
    // Ausência nunca é resposta, e ainda menos esta: sem saber como o ambiente protege, quem digita
    // não pode supor o nível mais alto.
    const r = avisoDeProtecao(null);
    expect(r.nivel).toBe("desconhecido");
    expect(r.texto).toMatch(/[Nn]ão foi possível confirmar/);
  });

  it("com KMS: nível forte, e o texto cita o algoritmo que veio do servidor", () => {
    const r = avisoDeProtecao({ kms: true, algoritmo: "AES-256-GCM" });
    expect(r.nivel).toBe("forte");
    expect(r.texto).toMatch(/AES-256-GCM/);
    expect(r.texto).toMatch(/KMS/);
  });

  it("sem KMS: ATENÇÃO, e o texto diz onde a chave-mestra realmente está", () => {
    // A diferença entre HSM e variável de ambiente é quem consegue decifrar tudo: quem tem o painel
    // de deploy. Isso precisa estar escrito, não subentendido.
    const r = avisoDeProtecao({ kms: false, algoritmo: "AES-256-GCM" });
    expect(r.nivel).toBe("atencao");
    expect(r.texto).toMatch(/CERT_SECRET_KEY/);
    expect(r.texto).toMatch(/variável de ambiente/);
  });

  it("sem KMS não é 'erro' — as senhas ESTÃO cifradas", () => {
    // Se este nível virar o mesmo de uma falha, a tela passa a dizer "não use isto", que é falso.
    expect(avisoDeProtecao({ kms: false, algoritmo: "AES-256-GCM" }).nivel)
      .not.toBe(avisoDeProtecao(null).nivel);
  });
});

describe("estadoDaCarga — lista vazia diz TRÊS coisas diferentes", () => {
  it("carregando não afirma nada sobre o conteúdo", () => {
    expect(estadoDaCarga({ carregando: true, quantidade: 0 }).estado).toBe(CARGA.CARREGANDO);
  });

  it("voltou e não há nada: VAZIA — e o texto fala da empresa, não do sistema", () => {
    const r = estadoDaCarga({ carregando: false, erro: null, quantidade: 0 });
    expect(r.estado).toBe(CARGA.VAZIA);
    expect(r.titulo).toMatch(/Nenhuma credencial guardada/);
    expect(r.podeTentarDeNovo).toBe(false);
  });

  it("⚠ o servidor respondeu NÃO: RECUSADA, com a mensagem dele à vista", () => {
    // 403 de papel e 500 de erro interno pedem coisas diferentes de quem está olhando; engolir a
    // mensagem transformaria as duas em "nenhuma credencial guardada".
    const r = estadoDaCarga({
      carregando: false,
      erro: { mensagem: "Acesso negado à empresa.", status: 403 },
      quantidade: 0,
    });
    expect(r.estado).toBe(CARGA.RECUSADA);
    expect(r.texto).toMatch(/Acesso negado à empresa\./);
    expect(r.podeTentarDeNovo).toBe(true);
  });

  it("⚠ SEM status não houve resposta: SEM_RESPOSTA, e não se fala em recusa", () => {
    // `request()` só carimba `status` quando houve resposta HTTP; falha de rede sobe o TypeError
    // cru do fetch. Chamar isso de recusa mandaria o contador procurar permissão que ele já tem.
    const r = estadoDaCarga({ carregando: false, erro: { mensagem: "Failed to fetch" }, quantidade: 0 });
    expect(r.estado).toBe(CARGA.SEM_RESPOSTA);
    expect(r.texto).toMatch(/conexão/);
    expect(r.texto).not.toMatch(/recusou/);
    expect(r.podeTentarDeNovo).toBe(true);
  });

  it("recusa sem mensagem ainda diz o que aconteceu", () => {
    const r = estadoDaCarga({ carregando: false, erro: { status: 500 }, quantidade: 0 });
    expect(r.estado).toBe(CARGA.RECUSADA);
    expect(r.texto).toMatch(/recusou a leitura/);
  });

  it("⚠ erro com lista JÁ CARREGADA continua sendo erro — o que está na tela pode estar velho", () => {
    // A recarga que falha não apaga a lista (o hook preserva), então o aviso é a única coisa que
    // separa "esta é a lista atual" de "esta é a lista de antes da falha".
    const r = estadoDaCarga({ carregando: false, erro: { status: 500 }, quantidade: 4 });
    expect(r.estado).toBe(CARGA.RECUSADA);
  });

  it("tudo certo e com conteúdo: OK, e a tela não desenha estado nenhum", () => {
    const r = estadoDaCarga({ carregando: false, erro: null, quantidade: 2 });
    expect(r.estado).toBe(CARGA.OK);
    expect(r.titulo).toBe("");
  });

  it("o assunto muda as palavras: informação não é credencial", () => {
    // As duas seções da aba são coisas diferentes (uma é cifrada, a outra não). Um texto só faria
    // a seção de baixo dizer "credencial" para um dado que nunca foi um segredo.
    const vazia = estadoDaCarga({ carregando: false, quantidade: 0, assunto: "informacoes" });
    expect(vazia.titulo).toMatch(/Nenhuma informação registrada/);
    const erro = estadoDaCarga({
      carregando: false, erro: { status: 500 }, quantidade: 0, assunto: "informacoes",
    });
    expect(erro.texto).toMatch(/informações/);
  });

  it("chamada sem argumento nenhum não explode nem afirma conteúdo", () => {
    expect(estadoDaCarga().estado).toBe(CARGA.VAZIA);
  });
});
