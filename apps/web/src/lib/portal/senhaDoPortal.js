// A REGRA DE TELA DA SENHA DO PORTAL DO CLIENTE.
//
// Pedido do dono (19/08/2026): *"o contador deve poder mudar a senha via cadastro da empresa, como
// o cliente também pode via recuperação ou o próprio cadastro; mas quando mudar, o portal do
// contador também muda."*
//
// ⚠⚠ É UMA SENHA SÓ. Não existe "senha do contador" e "senha do cliente": existe a credencial do
// usuário do portal daquela empresa, e três caminhos para trocá-la. Por isso não há sincronização
// nenhuma nesta tela — o que ela mostra é o ESTADO (quando foi a última troca e por qual caminho).
//
// ⚠⚠ A SENHA ATUAL NÃO PODE SER MOSTRADA, e isso não é limitação a contornar: `User.passwordHash`
// é bcrypt e não tem volta. Não existe "ver a senha do cliente" em lugar nenhum — o contador
// DEFINE uma nova, exibida UMA VEZ. Nada aqui pode guardá-la.
//
// Aqui mora só o que a TELA decide: de quem é a senha, com que palavras confirmar, e como dizer o
// estado. Quem autoriza continua no servidor (`ACCOUNTANT`+, `requireFirmCompanyAccess`).

/** Papel mínimo do escritório para definir a senha. Espelho de `PAPEL_MINIMO_DEFINIR_SENHA`. */
export const PAPEL_MINIMO = "ACCOUNTANT";

export const TITULO = "Acesso do cliente ao portal";

/**
 * As três origens que o backend grava em `senhas_portal_trocas.origem`, traduzidas.
 *
 * ⚠ É a lista FECHADA do CHECK do banco. Origem fora dela não ganha frase e cai no rótulo
 * desconhecido — de propósito: inventar uma tradução para um valor novo faria a tela afirmar um
 * caminho que ninguém escreveu.
 */
export const ORIGENS = Object.freeze({
  ESCRITORIO: "ESCRITORIO",
  CLIENTE_PERFIL: "CLIENTE_PERFIL",
  CLIENTE_RECUPERACAO: "CLIENTE_RECUPERACAO",
});

const FRASE_DA_ORIGEM = {
  [ORIGENS.ESCRITORIO]: "pelo escritório",
  [ORIGENS.CLIENTE_PERFIL]: "pelo próprio cliente, no perfil dele",
  [ORIGENS.CLIENTE_RECUPERACAO]: "pelo próprio cliente, por recuperação de e-mail",
};

/** Como a tela chama cada usuário do portal. `undefined` vira o próprio código, nunca sumiço. */
const NOME_DO_PAPEL = {
  OWNER: "Responsável",
  CLIENT_ADMIN: "Administrador",
  FINANCEIRO: "Financeiro",
  CLIENT_USER: "Usuário (legado)",
};

export function nomeDoPapel(papel) {
  const chave = String(papel || "").toUpperCase();
  return NOME_DO_PAPEL[chave] || chave || "Papel não informado";
}

function formatarData(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * ⚠ A TELA PRECISA NOMEAR DE QUEM É A SENHA — nunca "a senha do portal".
 *
 * Hoje há um usuário por empresa (medido em produção, 19/08/2026: 33 empresas, 33 usuários ativos,
 * todos `OWNER`), mas o schema PERMITE dois (`CompanyClientUser` é `@@unique([companyId, userId])`).
 * No dia do segundo, uma tela que não nomeia troca a senha de alguém por engano — e ninguém
 * descobre até o outro não conseguir entrar.
 *
 * O identificador é NOME **e** e-mail, não um deles: dois sócios com o mesmo primeiro nome existem,
 * e o e-mail é o que de fato entra no login.
 */
export function identificarUsuario(usuario) {
  const nome = String(usuario?.nome || "").trim();
  const email = String(usuario?.email || "").trim();
  if (nome && email) return `${nome} (${email})`;
  if (email) return email;
  // ⚠ Sem nome E sem e-mail a tela NÃO inventa um rótulo amigável: mostra o id, que é o único
  // identificador que sobrou. "Usuário do portal" faria dois usuários ficarem indistinguíveis.
  if (nome) return `${nome} — sem e-mail cadastrado`;
  return `Usuário ${String(usuario?.userId || "").trim() || "sem identificação"}`;
}

/**
 * O que a seção faz com a lista de usuários. **Nunca escolhe em silêncio.**
 *
 * @returns {{estado: "CARREGANDO"|"SEM_USUARIO"|"UM"|"VARIOS", usuarios: Array, aviso: string|null}}
 */
export function estadoDaLista({ carregando, erro, usuarios }) {
  const lista = Array.isArray(usuarios) ? usuarios : [];
  if (carregando && !lista.length) return { estado: "CARREGANDO", usuarios: [], aviso: null };
  if (erro && !lista.length) {
    return {
      estado: "SEM_USUARIO",
      usuarios: [],
      // ⚠ Falha de leitura NÃO é "esta empresa não tem usuário". São duas situações com consertos
      // opostos, e igualá-las faria "não consegui ler" passar por "não existe ninguém".
      aviso: "Não foi possível ler os usuários do portal desta empresa. Tente de novo.",
    };
  }
  if (!lista.length) {
    return {
      estado: "SEM_USUARIO",
      usuarios: [],
      aviso: "Esta empresa não tem nenhum usuário ativo no portal do cliente.",
    };
  }
  if (lista.length === 1) return { estado: "UM", usuarios: lista, aviso: null };
  return {
    estado: "VARIOS",
    usuarios: lista,
    // ⚠ COM DOIS OU MAIS, A TELA MOSTRA TODOS E NÃO PRÉ-SELECIONA NINGUÉM. A troca é por usuário, e
    // eleger "o primeiro" ou "o OWNER" seria o sistema decidindo de quem é a senha que vai mudar.
    aviso: `Esta empresa tem ${lista.length} usuários no portal. A senha é de UM deles — escolha na linha certa.`,
  };
}

/**
 * A linha de estado: quando a senha foi trocada pela última vez, e por quem.
 *
 * ⚠ AUSÊNCIA É DITA, NUNCA ESCONDIDA E NUNCA INVENTADA. Sem registro não se afirma "nunca foi
 * trocada": a senha pode ter sido definida no provisionamento da empresa, que é anterior a este
 * registro existir. A frase separa as duas coisas.
 */
export function linhaDeEstado(ultimaTroca) {
  if (!ultimaTroca || typeof ultimaTroca !== "object") {
    return "Não há registro de troca de senha para este usuário.";
  }
  const quando = formatarData(ultimaTroca.em);
  const caminho = FRASE_DA_ORIGEM[ultimaTroca.origem] || "por um caminho não identificado";
  // ⚠ O nome quando existe, o e-mail depois, o id por último: contador desligado e apagado não vira
  // "ninguém". Sumir com o autor faria a troca parecer ter acontecido sozinha.
  const quem =
    ultimaTroca.origem === ORIGENS.ESCRITORIO
      ? String(ultimaTroca.autorNome || ultimaTroca.autorEmail || ultimaTroca.autorUserId || "").trim()
      : "";

  const porQuem = quem ? `${caminho} (${quem})` : caminho;
  if (!quando) return `Senha trocada ${porQuem} — sem registro da data.`;
  return `Senha trocada em ${quando}, ${porQuem}.`;
}

/**
 * ⚠ A CONFIRMAÇÃO REPETE OS DADOS DO ATO, nunca "tem certeza?".
 *
 * Definir a senha do cliente é TRANSFERÊNCIA DE AUTORIDADE: quem a define pode entrar como ele e
 * emitir NFS-e em nome da empresa dele. Os quatro fatos que a frase precisa dizer são:
 *   1. DE QUEM é a senha (nome e e-mail — o clique na linha errada troca a de outra pessoa);
 *   2. que a senha ATUAL para de funcionar na hora;
 *   3. que TODAS as sessões abertas daquele usuário caem (é o que a troca serve para fazer);
 *   4. que a senha nova aparece UMA VEZ e não há como vê-la de novo.
 */
export function fraseDeConfirmacao({ usuario, razaoSocial }) {
  const empresa = String(razaoSocial || "").trim();
  return [
    `Uma senha NOVA será definida para ${identificarUsuario(usuario)}${empresa ? `, da ${empresa}` : ""}.`,
    "",
    "A senha atual dele deixa de funcionar imediatamente, e TODAS as sessões abertas dele no portal do cliente são encerradas.",
    "",
    "A senha nova aparece UMA ÚNICA VEZ, agora. Ela não fica guardada em lugar nenhum e não há como vê-la depois — só definir outra.",
    "",
    "Esta troca fica registrada com o seu nome, a data e a hora.",
  ].join("\n");
}

/**
 * O motivo pelo qual o botão está desabilitado — ou `null` quando ele pode ser clicado.
 * ⚠ Botão desabilitado NOMEIA o motivo, sempre. É a disciplina da aba inteira.
 */
export function motivoDoBloqueio({ podeDefinirSenha, salvando, usuario }) {
  if (!usuario?.userId) return "Não há usuário do portal para trocar a senha.";
  if (!podeDefinirSenha) {
    return `Trocar a senha do cliente exige o papel ${PAPEL_MINIMO} ou superior no escritório.`;
  }
  if (salvando) return "Definindo a senha…";
  return null;
}
