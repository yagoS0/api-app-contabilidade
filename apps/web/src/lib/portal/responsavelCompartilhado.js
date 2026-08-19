// O RESPONSÁVEL CUJA CONTA ATENDE VÁRIAS EMPRESAS — as regras de TELA, puras.
//
// ⚠⚠ O DEFEITO QUE ISTO EXISTE PARA TORNAR VISÍVEL (produção, 19/08/2026): o dono entrou no
// portal do cliente com UM login e enxergou NOVE empresas. O mesmo e-mail havia sido cadastrado em
// várias empresas, todas apontando para UMA conta — e trocar o e-mail de uma delas renomeava a
// conta compartilhada, levando os nove vínculos junto.
//
// O servidor já não faz mais isso (`application/companies/acessoDoResponsavel.js`). O que este
// arquivo resolve é a outra metade: **a consequência tem de estar na tela ANTES do clique**, nas
// duas horas em que ela existe —
//
//   1. AO DIGITAR o e-mail, se ele já responde por outra empresa  → `avisoDeEmailCompartilhado`
//   2. AO SALVAR uma troca que vai criar acesso novo              → `fraseDeConfirmacao`
//
// ⚠ AVISAR, NÃO PROIBIR (1). Grupo de empresas com o mesmo dono é legítimo e existe na base
// medida. O aviso conta o que é invisível — um login, todas aquelas empresas —, e o contador
// decide. Não há caminho aqui que bloqueie o salvar.
//
// ⚠ A CONFIRMAÇÃO REPETE OS DADOS DO ATO (2), nunca "tem certeza?". Mesma disciplina de
// `lib/portal/senhaDoPortal.js` e `lib/nfse/liberacaoEmissaoCliente.js`: aprende-se a clicar sem
// ler numa pergunta genérica, e o clique na linha errada recebe a mesma pergunta que o certo.
//
// ⚠ NADA AQUI CHAMA API, e nenhuma decisão de negócio mora aqui. Quem decide renomear × criar é o
// SERVIDOR, dentro da transação — a tela não pode ser a autoridade sobre uma contagem de vínculos
// que ela leu segundos antes.

/** Onde a senha da conta nova se define. A ação JÁ EXISTE — não se constrói outra. */
export const ONDE_DEFINIR_SENHA = "Credenciais → Acesso ao portal do cliente";

export const TITULO_CONFIRMACAO = "Este e-mail responde por mais de uma empresa";

/** O código que o servidor devolve (409) quando a conta do responsável é compartilhada. */
export const CODIGO_CONTA_COMPARTILHADA = "owner_email_conta_compartilhada";

function limpar(valor) {
  return String(valor || "").trim();
}

function formatarCnpj(valor) {
  const d = String(valor || "").replace(/\D+/g, "");
  if (d.length !== 14) return String(valor || "");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Lê a recusa do servidor. Devolve os detalhes do ato, ou `null` se o erro for outro.
 *
 * ⚠ SÓ O CÓDIGO DECIDE, nunca a mensagem: texto de erro muda, e casar por substring faria uma
 * recusa qualquer abrir a confirmação de um ato que ninguém pediu.
 */
export function detalhesDaContaCompartilhada(err) {
  const codigo = err?.code || err?.payload?.error;
  if (codigo !== CODIGO_CONTA_COMPARTILHADA) return null;
  const p = err?.payload || {};
  return {
    emailAtual: p.emailAtual || null,
    nomeAtual: p.nomeAtual || null,
    emailNovo: p.emailNovo || null,
    empresasDaConta: Number(p.empresasDaConta) || 0,
    outrasEmpresas: Number(p.outrasEmpresas) || 0,
    outras: Array.isArray(p.outras) ? p.outras : [],
    contaNovaSemSenha: p.contaNovaSemSenha === true,
  };
}

/**
 * As empresas que este e-mail JÁ atende, tirando a que está sendo editada.
 *
 * ⚠ Tirar a empresa atual é o que separa "aviso" de "ruído": sem isso toda edição avisaria que o
 * e-mail responde por esta empresa — que é justamente o esperado, e o contador aprenderia a
 * ignorar o aviso antes de ele ter algo a dizer.
 */
export function outrasEmpresasDoEmail(empresas, empresaAtualId) {
  const lista = Array.isArray(empresas) ? empresas : [];
  const atual = limpar(empresaAtualId);
  return lista.filter((e) => e && e.id && String(e.id) !== atual);
}

/**
 * O aviso de digitação. `null` = não há o que dizer (a tela não renderiza nada).
 */
export function avisoDeEmailCompartilhado({ email, empresas, empresaAtualId } = {}) {
  const alvo = limpar(email).toLowerCase();
  if (!alvo) return null;
  const outras = outrasEmpresasDoEmail(empresas, empresaAtualId);
  if (!outras.length) return null;

  const nomes = outras.map((e) => `${limpar(e.razao) || "(sem razão social)"} — ${formatarCnpj(e.cnpj)}`);
  const quantas = outras.length;
  return {
    quantas,
    empresas: outras,
    nomes,
    titulo:
      quantas === 1
        ? "Este e-mail já responde por outra empresa"
        : `Este e-mail já responde por outras ${quantas} empresas`,
    // ⚠ A frase diz a CONSEQUÊNCIA, não só o fato. "Já é usado" não informa nada a quem não sabe
    // que o e-mail é a conta; "um login, todas estas empresas" é o que o contador precisa pesar.
    consequencia:
      quantas === 1
        ? `${alvo} é um login só: quem entrar com ele verá esta empresa e mais 1.`
        : `${alvo} é um login só: quem entrar com ele verá esta empresa e mais ${quantas}.`,
    // ⚠ NÃO BLOQUEIA. Grupo de empresas com o mesmo dono é legítimo.
    bloqueia: false,
  };
}

/**
 * O texto da confirmação, montado a partir do que o SERVIDOR devolveu — não do que a tela achava.
 *
 * ⚠ Ele diz o que acontece com CADA LADO. Só "vamos criar um acesso novo" deixaria o contador sem
 * saber o que acontece com as outras empresas, que é exatamente a pergunta que o defeito criou.
 */
export function fraseDeConfirmacao({ detalhes, razaoSocial } = {}) {
  if (!detalhes) return "";
  const empresa = limpar(razaoSocial) || "esta empresa";
  const atual = limpar(detalhes.emailAtual) || "o e-mail atual";
  const novo = limpar(detalhes.emailNovo) || "o e-mail novo";
  const outras = Number(detalhes.outrasEmpresas) || 0;
  const total = Number(detalhes.empresasDaConta) || outras + 1;

  const linhas = [
    `${atual} é a conta de ${total} empresas.`,
    "",
    `${empresa} passa a ter acesso próprio, com o login ${novo}.`,
    outras === 1
      ? `A outra empresa continua com ${atual}, exatamente como está.`
      : `As outras ${outras} empresas continuam com ${atual}, exatamente como estão.`,
    "",
    // ⚠ ESTA LINHA NÃO PODE SAIR. Sem ela o contador troca o e-mail, avisa o cliente, e o cliente
    // não consegue entrar — sem ninguém saber por quê.
    `${novo} nasce SEM SENHA: defina uma em ${ONDE_DEFINIR_SENHA} antes de avisar o cliente.`,
  ];
  return linhas.join("\n");
}

/** O aviso que fica DEPOIS do salvar, quando um acesso novo foi mesmo criado. */
export function avisoDeAcessoNovo(acessoNovo) {
  if (!acessoNovo?.email) return null;
  return {
    userId: acessoNovo.userId || null,
    email: acessoNovo.email,
    texto:
      `Acesso próprio criado para ${acessoNovo.email}. Ele ainda NÃO tem senha — `
      + `defina uma em ${ONDE_DEFINIR_SENHA} antes de avisar o cliente.`,
  };
}
