// Orientações genéricas revisadas em 14/09/2026. Dados do escritório são privados
// e vêm da configuração institucional aprovada, nunca de um CNPJ fixo no código.
export const FONTES_MENSAGENS = {
  autorizacao: "https://www.gov.br/pt-br/servicos/cadastrar-ou-cancelar-procuracao-para-acesso-ao-e-cac",
  manualAutorizacao: "https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/passo-a-passo/autorizacoes-de-acesso-guia-do-usuario",
  assinatura: "https://www.gov.br/governodigital/pt-br/identidade/assinatura-eletronica",
};

export const MENSAGENS_PADRAO = [
  {
    chave: "cnpj", titulo: "Pedir CNPJ para consulta pública",
    dados: { descricao: "Solicitar o CNPJ e explicar a primeira análise cadastral." },
    texto: "Pode me informar o CNPJ da empresa? Vamos conferir a razão social, a atividade e a situação cadastral nos dados públicos. Depois explicamos o próximo passo. Essa primeira consulta não mostra todas as pendências fiscais.",
  },
  {
    chave: "abertura", titulo: "Abertura avulsa ou com contabilidade",
    dados: { descricao: "Apresentar as duas opções de abertura e pedir os dados iniciais." },
    texto: "Podemos cuidar somente da abertura ou da abertura junto com a contabilidade mensal. Em qual cidade será a empresa e que atividade você pretende exercer? Com isso, analisamos o endereço e preparamos as opções, separando nossos honorários das taxas dos órgãos públicos.",
  },
  {
    chave: "transferencia", titulo: "Transferência de contabilidade",
    dados: { descricao: "Entender a troca de contador antes da análise e da proposta." },
    texto: "Podemos ajudar com a troca de contabilidade. Qual é o CNPJ da empresa e o que motivou a mudança? Primeiro conferimos os dados públicos; depois orientamos a autorização para analisar as pendências fiscais e organizar a transição.",
  },
  {
    chave: "empresa-parada", titulo: "Empresa parada — por onde começar",
    dados: { descricao: "Acolher quem não sabe se precisa regularizar, retomar ou encerrar a empresa." },
    texto: "Podemos ajudar, sim. Pode me passar o CNPJ e dizer há quanto tempo a empresa está sem atividade? Você pretende voltar a usar a empresa ou encerrá-la? Se ainda não souber, tudo bem: fazemos a análise e explicamos as opções antes de você decidir.",
  },
  {
    chave: "autorizacao", titulo: "Procuração — explicar a necessidade",
    dados: { descricao: "Explicar por que a análise fiscal precisa de autorização do cliente." },
    texto: "Para consultar as pendências fiscais, precisamos que você autorize o escritório {{escritorio}}, CNPJ {{procuradorCnpj}}, no Portal de Serviços da Receita Federal. A procuração digital agora aparece como Autorização de Acesso. Ela permite usar apenas os serviços autorizados por você. Vou orientar o cadastro; não precisamos da sua senha nem de códigos de acesso.",
  },
  {
    chave: "autorizacao-acesso", titulo: "Guia de procuração — passo a passo",
    dados: { descricao: "Ensinar a autorizar o escritório na Receita para consultar a situação fiscal.", fontes: [FONTES_MENSAGENS.autorizacao, FONTES_MENSAGENS.manualAutorizacao] },
    texto: `Para analisarmos o CNPJ {{cnpj}}, autorize o escritório {{escritorio}}:

1. Abra o serviço oficial abaixo, clique em Iniciar e entre com sua conta gov.br prata ou ouro. Selecione o perfil da empresa e confira o CNPJ.
2. Procure Minhas Autorizações de Acesso e escolha Nova Autorização.
3. Informe o CNPJ do escritório: {{procuradorCnpj}}.
4. Escolha a validade e os serviços combinados conosco. Para esta análise, inclua Situação Fiscal do Contribuinte. Não é necessário liberar todos os serviços.
5. Confira o resumo e assine a autorização no próprio portal.
6. Avise aqui quando concluir. Vamos confirmar o recebimento no portal para que a autorização passe a valer; enquanto isso, ela pode aparecer Em Análise.

Não envie senha nem códigos. Se sua conta não for prata/ouro ou aparecer uma tela diferente, diga em qual etapa parou para orientarmos.

Serviço oficial: ${FONTES_MENSAGENS.autorizacao}
Manual ilustrado da Receita: {{linkAutorizacao}}`,
  },
  {
    chave: "ajuda-autorizacao", titulo: "Ajuda com a procuração",
    dados: { descricao: "Identificar a dificuldade no portal sem pedir credenciais." },
    texto: "Em qual etapa você parou: entrar no gov.br, escolher a empresa, cadastrar o CNPJ do escritório ou assinar a autorização? Pode descrever a mensagem que apareceu. Se preferir enviar uma imagem, esconda senhas, códigos e dados que não sejam necessários. Vamos orientar o próximo passo por aqui.",
  },
  {
    chave: "documentos", titulo: "Como enviar documentos pelo chat",
    dados: { descricao: "Orientar o envio legível de documentos solicitados durante o atendimento." },
    texto: "Pode enviar os documentos que combinamos aqui na conversa. Se já tiver o PDF, envie como documento. Para fotos, confira se todas as informações e páginas estão legíveis. Vamos conferir o material e avisar se faltar algo. Não envie senhas nem códigos de acesso.",
  },
  {
    chave: "proposta", titulo: "Próximo passo — proposta de serviços",
    dados: { descricao: "Explicar a conferência do escopo, dos avulsos e da mensalidade antes da contratação." },
    texto: "Vamos conferir a análise e preparar a proposta com o que precisa ser feito, os prazos e os valores. Os serviços avulsos, como regularizações, ficam separados da contabilidade mensal. Você poderá conferir tudo e tirar dúvidas antes de aceitar; depois seguimos para o contrato.",
  },
  {
    chave: "assinatura-govbr", titulo: "Assinar contrato com gov.br",
    dados: { descricao: "Ensinar a assinar o PDF e devolver o arquivo original para conferência.", fontes: [FONTES_MENSAGENS.assinatura] },
    texto: `Para assinar o contrato gratuitamente com sua conta gov.br prata ou ouro:

1. Acesse https://assinador.iti.br e entre na sua própria conta.
2. Escolha o PDF do contrato que enviamos e confira o conteúdo.
3. Marque o local da assinatura e clique em Assinar digitalmente.
4. Autorize a assinatura seguindo as instruções do gov.br. Se solicitar um código, confira as notificações no aplicativo gov.br.
5. Baixe o PDF assinado pelo botão de download e envie esse arquivo aqui como documento.

Não use Imprimir/Salvar como PDF, foto ou digitalização: isso não preserva a assinatura digital original. Não altere o arquivo depois de assinar. Não envie sua senha nem códigos.

Vamos conferir o PDF recebido. Você também pode verificar a assinatura em https://validar.iti.gov.br.
Tutorial oficial: ${FONTES_MENSAGENS.assinatura}`,
  },
].map(item => ({ tipo: "ORIENTACAO", ...item }));

export const RECURSOS_INICIAIS = [
  ...MENSAGENS_PADRAO,
  { tipo: "INSTITUCIONAL", chave: "escritorio", titulo: "Dados institucionais para orientações", dados: { escritorio: "ALTAN", procuradorCnpj: "", linkAutorizacao: "" } },
];
