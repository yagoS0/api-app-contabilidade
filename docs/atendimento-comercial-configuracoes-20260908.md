# Atendimento comercial, WhatsApp e configurações — 08/09/2026

Implementação na branch `codex/atendimento-comercial-configuracoes`, a partir de `165e0ec`. Esta entrega não publica na main nem altera a produção.

## Fluxo do escritório

1. Na conversa de um interessado, use o cadastro de onboarding existente e escolha a origem do atendimento. Nome e telefone vêm da conversa, com conferência pelo operador.
2. A ficha de pré-cadastro agora contém **Atendimento comercial** mesmo em rascunho. Salve o CNPJ e consulte os dados públicos sem criar uma empresa na carteira.
3. A consulta fiscal verifica a procuração por CNPJ, sua vigência e a autorização para SITFIS. O relatório é armazenado cifrado. A situação cadastral pública não equivale à regularidade fiscal.
4. Registre etapa, proposta e honorários. A análise não elabora automaticamente uma conclusão tributária ou proposta comercial: o contador revisa o relatório.
5. Gere um link pessoal para o cliente preencher o cadastro por etapas. O link padrão vale 7 dias, pode ser revogado, permite retomar o preenchimento e é consumido no envio final. Gerar outro revoga o anterior.
6. Confira os dados enviados e use a conversão já existente para criar ou vincular a empresa. O formulário público não provisiona uma empresa nem concede acesso a documentos fiscais.

O botão de consulta é uma ação do operador. Nenhuma consulta paga, mensagem real ou emissão de nota foi executada nesta validação. A criação de ficha a partir do chat continua assistida pelo operador; não presume a origem do lead nem cria empresas automaticamente.

## Navegação

- Engrenagem da carteira: `/configuracoes`, com integrações SERPRO/certificados, plano global, obrigações, rotinas e política WhatsApp/IA.
- Engrenagem da empresa: `/companies/:id/ajustes`, com busca e seções por assunto.
- **Contatos, acessos e envios** reúne usuários do portal, contatos WhatsApp, destinatários de guias e permissões do assistente.
- **Senhas e acessos externos** mantém o cofre; **Certificado A1** tem sua seção própria.
- Configuração de emissão e perfis continuam usando seus formulários e APIs. O botão da aba Guias leva à mesma configuração de comunicação.
- As rotas anteriores continuam válidas. O plano de contas passa a carregar também por link direto e ao trocar de empresa.
- Edições fiscais não salvas recebem confirmação de saída pelos links e pelo botão Voltar da central. O formulário público avisa ao recarregar com dados pendentes. Isso não é uma proteção universal para todos os formulários antigos do app ou para o histórico do navegador.

A seção geral de WhatsApp/IA explica a política vigente e o local de edição dos contatos. Credenciais, modelo e ativação das integrações continuam administrados na Railway; esta entrega não oferece editor de segredos nem de templates Meta dentro do portal.

## Segurança e revisão

- IDs de botões/listas são tratados deterministicamente antes da IA; títulos de mensagens não concedem permissões.
- As leituras usam o executor existente e revalidam contato, vínculo, papel e permissões.
- Atos fiscais continuam exigindo confirmação e autorização próprias.
- Procuração com status negativo não se torna ativa por ter validade futura.
- Links usam token aleatório com hash no banco, enviado no cabeçalho de autorização; o link da página usa fragmento, não query string.
- Formulário público possui limite de requisições e de corpo, expiração, revogação, versão otimista e consumo transacional.
- Índices parciais impedem dois links ativos e duas análises simultâneas do mesmo tipo para a mesma ficha.
- Resultados e histórico permanecem associados à ficha. A autorização do escritório segue o modelo existente; não foi criado um novo modelo de escritórios independentes.

Três agentes participaram da implementação e revisão cruzada: frontend/contratos, comercial/migração e WhatsApp. Os achados incluíram procuração revogada, concorrência de links, ordem do parser público, escopo na recuperação de conversão, perda de rascunho comercial e carregamento por link direto.

## Publicação posterior

Antes de liberar, ensaiar a migration `20260908090000_onboarding_comercial` em PostgreSQL e gerar o Prisma Client no build. A migração é aditiva e foi validada estaticamente; não foi aplicada neste trabalho porque não há PostgreSQL local nem daemon Docker disponível.

Na Railway, manter as configurações de autenticação, CORS, criptografia e SERPRO já utilizadas pelo sistema. A origem do formulário precisa constar no CORS permitido da API. A ativação dos menus deve começar pelo piloto configurado, com os acessos do contato conferidos no portal.

| Variável | Uso |
| --- | --- |
| `INTEGRACAO_WHATSAPP_MENU=1` | Liga os menus determinísticos. Por padrão ficam desligados. |
| `WHATSAPP_MENU_TELEFONES_PILOTO` | Lista separada por vírgulas de números E.164 autorizados ao piloto, inclusive para testar o funil de lead. Vazia não autoriza nenhum telefone. |
| `IA_EMPRESAS_PILOTO` | Preserva a lista existente de empresas permitidas; não dispensa as permissões do contato. |
| `WHATSAPP_MENU_LEADS` | Manter desligada no piloto. `1` permite futuramente o menu público de interessados, sem conceder dados ou ações financeiras. |

Ativar menus não ativa o modelo Anthropic; a IA continua com sua configuração própria. Os botões apenas consultam dados autorizados ou orientam o pedido. Nenhuma emissão, cancelamento ou recálculo é executado pelo simples clique no menu.

Após aprovação de publicação, validar em ambiente integrado: menu e texto livre; contato sem acesso; encaminhamento humano; dados públicos; procuração inválida; relatório autorizado; expiração/revogação/retomada do formulário; conversão após revisão. As telas foram inspecionadas em modo demonstração local; os testes de serviços usam dependências simuladas e não substituem o ensaio integrado da migração.

## Evidências locais

- Frontend: 39 suítes / 405 testes passaram nos módulos de configurações, navegação, emissão, planejamento, onboarding, contabilidade e WhatsApp.
- Backend: 39 suítes / 678 testes passaram no conjunto WhatsApp, assistente, onboarding e procurações antes do encerramento das últimas correções dos menus. A rodada final do menu é registrada no resumo da entrega.
- Encerramento WhatsApp/assistente: 27 suítes / 530 testes passaram após as correções de escopo, vencimento, reabertura do menu e ativação por telefone. Recorte direcionado final: 4 suítes / 109 testes. Esses recortes se sobrepõem; não devem ser somados.
- Testes posteriores de interface: 4 suítes / 39 testes passaram após os ajustes de navegação e proteção de edição.
- Build Vite aprovado; permanecem os avisos de tamanho de bundle e imports estáticos/dinâmicos já presentes no projeto.
- Prisma schema válido. Migration ainda não ensaiada em PostgreSQL.
- Inspeção local: engrenagens, busca, central da empresa, contatos, certificado, configuração fiscal, abertura de atendimento comercial ainda em rascunho. Confirmação de saída testada no navegador: **Continuar editando** preservou o valor digitado; **Descartar e sair** navegou para a seção escolhida.
