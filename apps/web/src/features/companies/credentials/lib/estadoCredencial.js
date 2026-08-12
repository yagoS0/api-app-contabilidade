// A REGRA DE TELA do cofre, num lugar só e com teste próprio.
//
// Ela responde duas perguntas que a listagem faz por linha:
//   1. o que aparece no lugar da senha?
//   2. o botão de ver está disponível — e, se não estiver, POR QUÊ?
//
// A segunda é a que justifica o arquivo. O princípio do projeto é que **desabilitado nomeia o
// motivo** e **ausência nunca é resposta**: um botão cinza e mudo faz o contador achar que o
// sistema está quebrado, quando o que houve foi uma decisão de permissão. Escrita dentro do JSX,
// essa cascata de "por quê" vira três ternários aninhados que ninguém consegue testar.

/** O que a linha mostra no lugar do valor. NUNCA é o valor, salvo em `revelada`. */
export const ESTADOS = {
  SEM_SENHA: "sem_senha",
  OCULTA: "oculta",
  REVELADA: "revelada",
};

// ⚠ Comprimento FIXO, deliberadamente. Um mascaramento que acompanhasse o tamanho da senha
// entregaria o tamanho dela a quem olhasse a tela por cima do ombro — que é informação de graça
// para quem for tentar adivinhar. E o tamanho nem chega ao front: a listagem não traz a coluna.
export const MASCARA = "••••••••";

/**
 * @param {{temSenha?: boolean}} credencial  a linha como a listagem devolve (SEM a senha)
 * @param {boolean} revelada                 esta linha está com o valor à mostra agora?
 */
export function estadoDaCredencial(credencial, revelada = false) {
  if (!credencial?.temSenha) return ESTADOS.SEM_SENHA;
  return revelada ? ESTADOS.REVELADA : ESTADOS.OCULTA;
}

/**
 * O botão "Ver senha": disponível ou não, e a frase do motivo.
 *
 * ⚠ A ordem das recusas importa e é do mais específico para o mais geral. "Esta credencial não tem
 * senha" antes de "seu perfil não permite": dizer ao STAFF que ele não tem permissão para ver uma
 * senha que não existe manda-o pedir um acesso que não resolveria nada.
 */
export function podeVerSenha({ credencial, podeRevelar, papelMinimoRevelar }) {
  if (!credencial?.temSenha) {
    return {
      pode: false,
      motivo: "Esta credencial foi cadastrada sem senha — não há valor para mostrar.",
    };
  }
  if (!podeRevelar) {
    const papel = ROTULO_PAPEL[papelMinimoRevelar] || "um perfil com permissão";
    return {
      pode: false,
      // Nomeia o papel que resolveria — "sem permissão" sozinho não diz a quem pedir.
      motivo: `Ver senha exige ${papel}. Peça a quem tem esse perfil no escritório.`,
    };
  }
  return { pode: true, motivo: "" };
}

const ROTULO_PAPEL = {
  FIRM_ADMIN: "perfil de administrador do escritório",
  ACCOUNTANT: "perfil de contador",
  STAFF: "perfil de equipe",
};

/**
 * O QUE A LISTA VAZIA QUER DIZER — e são TRÊS coisas diferentes, não uma.
 *
 * ⚠ Lista de tamanho zero é o mesmo pixel em três situações que exigem reações opostas:
 *
 *   VAZIA        · a chamada voltou, e não há credencial guardada    → cadastre a primeira
 *   RECUSADA     · o servidor respondeu, e a resposta foi NÃO        → é permissão/erro dele, não seu
 *   SEM_RESPOSTA · a chamada não chegou a lugar nenhum               → rede/servidor fora; tente de novo
 *
 * Desenhar as três como "Nenhuma credencial guardada" faria o contador cadastrar de novo uma senha
 * que já existe (e que ele não está conseguindo ver), ou concluir que a empresa não tem acesso
 * nenhum cadastrado quando o que houve foi um 403. Ausência nunca é resposta.
 *
 * ⚠ O QUE SEPARA `RECUSADA` DE `SEM_RESPOSTA` É O `status`. `request()` (realApi) só carimba
 * `err.status` quando houve resposta HTTP; falha de rede sobe o `TypeError` cru do `fetch`, sem
 * status nenhum. Por isso a distinção se lê no erro e não se adivinha pelo texto da mensagem.
 */
export const CARGA = {
  CARREGANDO: "carregando",
  VAZIA: "vazia",
  RECUSADA: "recusada",
  SEM_RESPOSTA: "sem_resposta",
  OK: "ok",
};

const TERMOS = {
  credenciais: { plural: "credenciais", vazio: "Nenhuma credencial guardada para esta empresa." },
  informacoes: { plural: "informações", vazio: "Nenhuma informação registrada." },
};

export function estadoDaCarga({ carregando, erro, quantidade = 0, assunto = "credenciais" } = {}) {
  const termo = TERMOS[assunto] || TERMOS.credenciais;

  if (carregando) return { estado: CARGA.CARREGANDO, titulo: "Carregando…", texto: "", podeTentarDeNovo: false };

  if (erro) {
    // Sem `status` não houve resposta: pode ser rede, DNS, servidor fora ou a aba offline. Dizer
    // "não foi possível carregar" aqui soa como recusa do sistema, e manda procurar permissão.
    if (!erro.status) {
      return {
        estado: CARGA.SEM_RESPOSTA,
        titulo: "Sem resposta do servidor",
        texto: `Não houve resposta ao buscar as ${termo.plural} — verifique a conexão e tente de novo. `
          + "O que está guardado continua no lugar.",
        podeTentarDeNovo: true,
      };
    }
    return {
      estado: CARGA.RECUSADA,
      titulo: "Não foi possível carregar",
      // A mensagem do servidor viaja junto: 403 de papel e 500 de erro interno pedem coisas
      // diferentes de quem está olhando.
      texto: erro.mensagem
        ? `O servidor recusou a leitura das ${termo.plural}: ${erro.mensagem}`
        : `O servidor recusou a leitura das ${termo.plural}.`,
      podeTentarDeNovo: true,
    };
  }

  if (!quantidade) {
    return { estado: CARGA.VAZIA, titulo: termo.vazio, texto: "", podeTentarDeNovo: false };
  }

  return { estado: CARGA.OK, titulo: "", texto: "", podeTentarDeNovo: false };
}

/**
 * O aviso de proteção que fica no topo da seção de credenciais.
 *
 * ⚠ NÃO é decoração. Sem KMS a chave-mestra do cofre é uma variável de ambiente do servidor: quem
 * tem o painel de deploy tem todas as senhas. Com KMS ela vive no HSM da AWS. São dois níveis de
 * proteção reais e diferentes, e quem vai digitar a primeira senha precisa saber qual está valendo
 * ANTES — não depois. Por isso o texto muda, e o tom junto.
 *
 * ⚠ `cofre` ausente (chamada ainda não voltou, ou versão antiga do backend) NÃO vira "está tudo
 * bem": vira `desconhecido`. Ausência nunca é resposta — ainda mais esta.
 */
export function avisoDeProtecao(cofre) {
  if (!cofre) {
    return {
      nivel: "desconhecido",
      texto: "Não foi possível confirmar como as senhas estão protegidas neste ambiente.",
    };
  }
  if (cofre.kms) {
    return {
      nivel: "forte",
      texto: `Senhas cifradas com ${cofre.algoritmo}, com chave-mestra no cofre da AWS (KMS). `
        + "O valor nunca aparece em listagens e cada leitura fica registrada.",
    };
  }
  return {
    nivel: "atencao",
    texto: `Senhas cifradas com ${cofre.algoritmo}, mas a chave-mestra é uma variável de ambiente `
      + "do servidor (CERT_SECRET_KEY) — quem tem acesso ao painel de deploy consegue decifrá-las. "
      + "Ligar o AWS KMS move essa chave para um cofre de hardware.",
  };
}
