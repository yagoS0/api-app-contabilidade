# Revisão da comunicação e simulações de leads — 20/09/2026

## O que esta revisão verifica

O teste deve conferir a conversa que a pessoa recebe e o resultado salvo, não apenas se uma função foi chamada. O número comercial recebe pessoas novas e retornantes; ele não transforma clientes conhecidos em leads nem autoriza acesso fiscal. A abertura aceita contratação avulsa, mensal ou comparação. A equipe recebe o atendimento quando precisa analisar documento, definir escopo/preço, separar solicitações ou resolver uma ambiguidade persistente.

Padrões de conversa aplicados por analogia: uma recepção pergunta o motivo da visita antes de coletar a ficha inteira; um orçamento de serviço aproveita os dados já informados; um atendimento de loja entende respostas curtas às alternativas que ele próprio ofereceu. São critérios de desenho, não alegações de integração com negócios externos.

## Lacunas encontradas na cobertura anterior

As cinco suítes de entrada/menu/coleta/política/saída passaram com 109 testes no início desta revisão. Mesmo assim, uma execução isolada do interpretador, com rede bloqueada, mostrou os seguintes casos sem interpretação: `mensal`, `abertura e contabilidade`, `serviço pontual`, `avulso`, `não` para funcionários, `só eu`, `tenho dois funcionários`, `desde 2020`, `janeiro de 2023`, `quero fechar` e `quero voltar`. `Já falei com vocês antes` era gravado como nome. A frase do motivo da troca era confundida com uma nova seleção de intenção.

O verificador PostgreSQL anterior tinha uma jornada completa de abertura avulsa e guardas relevantes, mas transferência parava após a consulta pública e empresa inativa era testada apenas sem CNPJ. Não havia jornada mensal/comparação completa nem reapresentação de dados antes desconhecidos. A correção de saudação com histórico já estava coberta e deve permanecer protegida.

As simulações ampliadas encontraram mais dois defeitos antes da aprovação final: o esclarecimento do mês repetia a pergunta genérica na mesma resposta; e um responsável de duas empresas recebia o menu, mas não conseguia iniciar nova abertura. O segundo caso confundia a escolha fiscal entre empresas com uma identificação de pessoa em revisão. Os testes agora contrastam essas duas situações e preservam o bloqueio de identidade efetivamente em revisão.

A leitura final trouxe uma lacuna adicional: depois de `desde 2020`, o bot perguntava o mês de 2020, mas não aceitava `janeiro` sozinho. A jornada agora reproduz essa resposta natural e exige 2020-01, reaproveitando somente o ano explicitamente informado e ainda pendente. Correções completas de período, desconhecimento e mensagens fora de ordem continuam cobertos na suíte da coleta; não se deve inferir um ano ausente.

## Matriz de conversas e efeitos esperados

| Situação | Mensagens representativas | Resultado que o teste confere | Cobertura |
| --- | --- | --- | --- |
| Primeiro contato | `Olá` | Cinco opções; não cria ficha; zero IA | PostgreSQL de entrada, Jest menu |
| Pedido direto | `Sou médico e quero abrir uma empresa` | Aproveita a atividade e pergunta somente o nome | PostgreSQL de entrada |
| Abertura avulsa | `Quanto custa?` → nome → cidade → `Só abertura` → endereço | Dúvida não vira nome; modalidade avulsa; não exige volume mensal | PostgreSQL de entrada |
| Abertura mensal de comércio | Nome, atividade e cidade na mesma mensagem → `abertura e contabilidade` → `não` → `20` → endereço | Campos preservados, zero funcionários, 20 notas; segue para equipe | PostgreSQL de entrada ampliado |
| Comparação em odontologia | `quero ver as duas opções` → `só eu` → `não sei` → endereço | COMPARAR, zero funcionários, volume desconhecido sem inventar zero | PostgreSQL de entrada ampliado |
| Transferência pontual | CNPJ e nome juntos → motivo em frase → `serviço pontual` | Consulta pública, motivo salvo, avulso sem questionário mensal | PostgreSQL de entrada ampliado |
| Empresa parada com CNPJ | `desde 2020` → `janeiro` → `quero voltar` → `mensal` → `2` → `não sei` | Não inventa mês; aproveita ano explícito e salva 2020-01/reativar; nenhuma consulta fiscal automática | PostgreSQL de entrada ampliado |
| Empresa parada sem CNPJ | Pedido inicial → `Não sei` | Não inventa CNPJ; encaminha para equipe | PostgreSQL de entrada |
| Retorno com ficha ativa | `Voltei` / `Pode continuar` / `Já falei com vocês antes` | Retoma a pergunta; não grava a frase como nome nem acumula incompreensão | PostgreSQL de entrada ampliado |
| Retorno pelo outro canal | Ficha do principal → `Olá` no comercial → mesma intenção → nome | Mesma ficha/CNPJ, sem duplicação; menu não apaga dados | PostgreSQL comercial |
| Reentrega técnica | Mesmo identificador de mensagem chega de novo | Nenhuma ficha, pergunta ou envio duplicado | PostgreSQL de entrada/identidade |
| Nova mensagem com texto repetido | Vários `Olá` com identificadores distintos | Responde ao novo contato e preserva o caso | PostgreSQL comercial |
| Dado desconhecido enviado depois | `não sei` → `quero contabilidade mensal`; volume desconhecido → `recebo 12 notas de compras` | Remove pendência desconhecida dos campos preenchidos, preserva demais dados | PostgreSQL de entrada ampliado |
| Ficha antiga encerrada | Transferência desistida com vínculo legado aberto → nova abertura | Encerra vínculo anterior, preserva ficha antiga e cria outra sem CNPJ herdado | PostgreSQL de entrada ampliado |
| Imagem sem legenda | Aguarda nome → imagem | Registra anexo, não grava marcador como nome, encaminha à equipe sem fingir leitura | PostgreSQL de entrada ampliado |
| Mensagem entregue fora de ordem | Nome atual salvo → nome antigo com timestamp anterior | Instante do provedor impede sobrescrita ou nova pergunta | PostgreSQL de entrada ampliado |
| Clique de menu antigo | Inicia transferência → clica abertura num menu anterior | Orienta usar menu atual; não muda origem/ficha/triagem nem inicia pausa humana | PostgreSQL de entrada ampliado |
| Dois serviços da mesma pessoa | Abertura em coleta → `Também quero transferir outra empresa` | Preserva primeira ficha e chama equipe para separar as solicitações | PostgreSQL de entrada ampliado |
| Pedido explícito de pessoa | `quero falar com uma pessoa` ou botão | Handoff único; novo `Olá` não revoga a pausa | PostgreSQL/Jest menu |
| Diz ser cliente | Botão `Já sou cliente` numa ficha antiga | Encaminha identificação, não concede vínculo/acesso por declaração | PostgreSQL comercial |
| Cliente atual abre outra empresa | Cliente com empresa operacional → pedido de abertura | Ficha nova sem copiar CNPJ; empresa operacional e permissões preservadas | PostgreSQL de identidade comercial |
| Responsável cadastrado sem acesso fiscal | `Olá` com uma empresa → `Olá` com duas → nova abertura | Menu comercial sem seletor fiscal, classificação CLIENTE preservada e nenhum RBAC novo | PostgreSQL de entrada comercial ampliado |
| Responsável passa à revisão de identidade | Estado EM_REVISAO → `Me manda as guias das minhas empresas` | Nenhuma saída ou concessão de acesso; ficha permanece intacta | PostgreSQL de entrada comercial ampliado |
| Cliente pede guia durante coleta | `Me manda as guias enquanto isso` | Não grava pedido como dado cadastral; operação usa suas guardas próprias | PostgreSQL de identidade/Jest coleta |
| Pessoa representa várias empresas | Seleção operacional e pedido da guia | Histórico por pessoa; ato/documento exige empresa autorizada e destinatário vigente | Verificadores de identidade/canais e suítes de responsável/guias |
| Acesso revogado ou ambíguo | Permissão muda antes do envio | Não consulta empresa nem envia conteúdo sob autorização antiga | Jest menu e verificadores de identidade/canais |
| Canal desativado/principal fora do piloto | Pedido de abertura | Não amplia audiência nem usa outro remetente | PostgreSQL de entrada comercial |

## Como executar e revisar as respostas

`apps/api/scripts/verify-lead-entry-postgres.js` recebe somente a URL do banco descartável local/CI reconhecido pelo próprio script. `--commercial` usa identidade V2 e um canal comercial sintético; sem essa opção verifica o principal limitado ao piloto de teste. A execução recusa bancos fora desses endereços, bloqueia `fetch`/HTTP/HTTPS, injeta transporte e consulta pública sintéticos e confere que nenhuma chamada de IA/rede aconteceu. Não usa o banco real, Anthropic, Meta, SERPRO, Asaas ou DocuSign.

Se `WHATSAPP_SIMULATION_REPORT` contiver o caminho de um arquivo Markdown, o verificador salva os diálogos efetivamente produzidos naquela execução, separados por cenário, incluindo opções e ausência de saída. O arquivo também informa falha parcial e número de verificações aprovadas. Use um caminho privado em `outputs` do workspace. Uma simulação aprovada não comprova entrega real no WhatsApp nem qualidade de transcrição/OCR; os anexos são encaminhados sem inferir seu conteúdo.

A revisão humana deve conferir nas transcrições: a resposta corresponde à última mensagem; a pergunta seguinte pede uma lacuna real; nenhuma resposta curta entra num ciclo; nenhum desconhecimento vira dado inventado; existe explicação clara quando a equipe assume. Conferir apenas contagem de testes não atende esses critérios.

## Validação desta revisão

Regressão local final: 86 suítes e 1.907 testes de WhatsApp, assistente, guias e onboarding aprovados após as correções. A revisão cruzada protegeu também os atalhos de faturamento durante ficha comercial ativa e pedidos operacionais mistos. As rodadas menores e repetições estão incluídas nessa cobertura; não somá-las para inflar o total.

Em 20/09/2026, após as correções, o PostgreSQL descartável aprovou 26 verificações no modo comercial e 18 no principal, com zero chamadas de rede externa ou IA, e encerrou ambas as execuções com sucesso. As transcrições geradas foram lidas, incluindo a pergunta única do mês, retomadas, arquivos, clique antigo e responsável de várias empresas. Reentregas técnicas são identificadas no relatório para não parecerem mensagens novas ignoradas. A preparação EM_REVISAO também aparece explicitamente antes da ausência de resposta esperada.

## Limites que permanecem intencionais

- Preço e proposta dependem do escopo e catálogo aprovados; a coleta não promete valor ou regularidade fiscal.
- Consulta pública de CNPJ não substitui autorização/procuração nem SITFIS. A equipe usa as etapas já existentes para prosseguir.
- Áudio, imagem e PDF não são interpretados por IA nesta simulação. O teste comprova encaminhamento e preservação da ficha.
- Handoff não pode ser desfeito automaticamente para fazer um teste responder. Retorno em atendimento humano respeita a pausa até a devolução pelo escritório.
- Correção de motivo e segunda solicitação preservam a ficha anterior; não apagam histórico nem concedem acesso a outra empresa.
- Templates proativos e APIs de assinatura/cobrança permanecem fora desta validação de conversa.
