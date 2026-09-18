# Comunicação por interlocutor: implantação e validação

Implementação iniciada em 16/09/2026, branch `feat/comunicacao-identidade-chat-v2`, reconciliada com a main em 17/09/2026. Decisões e backlog: [plano](plano-comunicacao-identidade-leads-20260916.md).

Estado atual em 17/09 após as 19h37 UTC: canal comercial e multicanal ativados, token validado com acesso ao número, WABA e aplicativo já inscrito. API saudável na main `f6fe6a2a`, que contém as PRs [67](https://github.com/yagoS0/api-app-contabilidade/pull/67) e [68](https://github.com/yagoS0/api-app-contabilidade/pull/68). Identidade V2, chat V2, menu e coleta comercial ativos; principal preservado. Entrada real do usuário recebida; a pausa humana antiga do contato impediu resposta automática, conforme a política. Os registros de bloqueio por falta de credencial abaixo documentam as etapas anteriores.

## Ativação e teste do novo número — 17/09/2026

Atualização após teste real às 20h26 UTC: a Meta confirmou entrega, mas “Olá” caiu na coleta de uma transferência anterior, do principal, e recebeu “Não consegui identificar essa informação. Como você se chama?”. A simulação anterior cobria ficha nova e não esse estado. Correção: navegação precede interpretação cadastral; saudações/menu preservam a ficha e mostram as cinco opções. Interações não comerciais vão ao menu pelo ID, sem salvar seu título como nome. “Já sou cliente” não concede acesso e “Falar com a equipe” conserva handoff e expediente. Saudação com pedido concreto continua aproveitando os dados. Nenhuma alteração de produção em fichas, permissões ou atribuições é necessária.

`verify-lead-entry-postgres.js --commercial` agora reproduz uma ficha iniciada no principal com CNPJ salvo e nome pendente: saudações simples/compostas, menu repetido, replay sem duplicação, retomada do mesmo caso e saídas de identificação/humano. São dados sintéticos com transporte simulado e rede/IA bloqueadas. O recibo real da resposta incorreta não comprova entrega da versão corrigida; esta requer nova mensagem após o deploy.

Atualização às 20h12 UTC, após o dono relatar ausência de foto e reiterar falta de resposta: o perfil comercial recebeu exatamente a foto usada no principal. Foi utilizado upload retomável e `profile_picture_handle` da API oficial; GET posterior retornou a foto, baixada e conferida visualmente. Somente a imagem foi alterada. Credenciais/handles e os arquivos de evidência ficam fora do Git.

O contato específico do teste voltou ao automático por `alterarAtendimentoHumano` com lease, preservação integral do histórico e invalidação de ações antigas. Os demais interlocutores mantêm seus responsáveis. Uma nova mensagem precisa chegar após essa devolução; a conferência real da entrega continua pendente desse novo envio. Não repetir os “Olá” anteriores nem retirar a proteção humana global para testar.

- O usuário cadastrou a credencial no servidor. Leitura da Meta confirmou validade, permissões de mensagens/gestão, telefone VERIFIED associado à WABA comercial e o mesmo aplicativo do webhook. Nenhum token foi impresso ou enviado ao Git.
- Cadastro comercial ativado e `WHATSAPP_MULTICANAL=1` aplicado; identidade/menu/coleta já estavam ON. Não houve alteração do número principal nem ampliação de seu piloto. Sem migração adicional.
- Antes da ativação não havia fila pendente. Durante a configuração o usuário enviou um “Olá” de teste; essa entrada específica foi preservada para o retry normal. Nenhum histórico antigo foi reaberto.
- Deploy da API concluído; saúde/prontidão 200, histórico sem autenticação 401 e verificação inválida do webhook 403. A mensagem real chegou pela Meta, foi persistida no canal comercial e concluída pelo worker sem enfileirar modelo.
- O contato do teste já estava assumido por um atendente desde 15/09. A pausa do interlocutor foi corretamente mantida também no comercial; foi solicitada autorização específica para devolvê-lo ao automático. Não confundir esse bloqueio intencional com erro de credencial. A devolução deve usar o serviço do projeto, invalidar ações antigas e exigir nova mensagem, sem apagar o histórico.
- Repetidos os verificadores PostgreSQL: entrada comercial 9, isolamento de canais 7, identidade/jornada comercial 9; todos passaram com rede externa e IA bloqueadas. A PR 68 também teve CI, jornada comercial e confirmação fiscal aprovadas. Isso comprova a simulação; entrega real de uma resposta ainda depende da continuidade do teste do usuário.

## Publicação e auditoria de produção — 17/09/2026

### Segundo número dedicado aos leads (pedido posterior à publicação)

O usuário autorizou configurar o novo número como entrada comercial. Essa audiência passa a ser todo remetente do canal COMERCIAL ativo, sem cadastrar cada lead no piloto. O canal principal mantém as regras anteriores. A decisão exige identidade V2, multicanal, coleta comercial e correspondência exata entre o canal da conversa e os metadados obtidos no servidor. Não muda o relacionamento de cliente existente, não libera funções fiscais e não sobrepõe pausa humana. O modelo comercial cede ao fluxo determinístico, inclusive em jobs previamente enfileirados cuja configuração é recarregada.

Preparação validada localmente: 108 testes de unidade; 9 verificações do webhook até o onboarding no canal comercial e 7 no principal. Meta, IA e consultas externas bloqueadas nos ensaios. O comando `verify-lead-entry-postgres.js <banco-descartavel> --commercial` também está na CI. Cobre novos remetentes sem piloto, saudação, pedido livre, duplicata, transferência, consulta pública sintética, falta de CNPJ, equipe, isolamento do canal principal e canal desativado.

Na conferência de 17/09 às 15h44 UTC, `WHATSAPP_COMERCIAL_TOKEN` não estava configurado. O token principal acessa o telefone, mas a conta nova/assinatura recusam acesso (`100/33`). Não habilitar o canal apenas porque o telefone está VERIFIED. IDs reais e evidências de acesso ficam no workspace privado, nunca neste repositório público.

Para concluir a configuração:

1. Disponibilizar no ambiente da API um token com acesso à WABA comercial e permissões `whatsapp_business_management` e `whatsapp_business_messaging`, por meio de `WHATSAPP_COMERCIAL_TOKEN`. Preservar a credencial principal.
2. Validar via leitura a validade, o aplicativo do token, a associação exata entre telefone e WABA e a inscrição do aplicativo no webhook já utilizado pela API. Se o aplicativo for outro, a assinatura do webhook exige configuração compatível; não liberar sem conferência.
3. Confirmar o registro preparado em `CanalWhatsapp` com finalidade COMERCIAL e referência à credencial. Ativar esse registro e `WHATSAPP_MULTICANAL=1` somente após a publicação aprovada e as verificações externas. Identidade V2, menu e coleta devem estar ON; não alterar o piloto do principal nem reprocessar entradas antigas.
4. Conferir saúde e roteamento em leitura; uma nova mensagem real enviada pelo usuário ao comercial permite validar recebimento e resposta. Não afirmar entrega real com base apenas na simulação offline.

Referência: [coleção oficial da Meta — tokens, permissões e inscrição da WABA](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

- Snapshot do volume PostgreSQL criado e conferido antes da migração. A migration aditiva foi aplicada pelo deploy. O WhatsApp foi temporariamente pausado durante a associação e reativado após auditoria.
- Backfill concluído: 10 interlocutores, 17 segmentos e dois casos comerciais associados; nenhuma ambiguidade. As duas pausas humanas foram preservadas.
- A conferência inicial reverteu a transação ao detectar duas diferenças de classificação. A inspeção identificou um histórico legado e uma conversa excluída, ambos sem contato cadastrado: foram preservados como histórico, sem inventar vínculo de cliente. A auditoria final confirmou zero segmento sem migração e zero divergência ativa. O CLI genérico ainda sinaliza esses dois históricos para conferência; eles não representam contatos ativos pendentes.
- Flags conferidas: `INTEGRACAO_WHATSAPP=1`, `WHATSAPP_IDENTIDADE_V2=1`, `WHATSAPP_CHAT_V2=1`, `WHATSAPP_COLETA_COMERCIAL=1`, `WHATSAPP_MULTICANAL=0`. Menu permanece ativo. A audiência da coleta continua sendo a lista explícita existente; nenhuma ampliação foi presumida.
- API `/healthz` e `/readyz`, aplicação em `https://app.altan.company` e arquivos publicados responderam 200. Bundle/CSS contêm chat V2, identificação, notas internas e lista de 238 px. Histórico exige autenticação e o webhook exige verificação. Isso é conferência técnica de publicação, não homologação visual ou envio real pela Meta.
- [CI completa](https://github.com/yagoS0/api-app-contabilidade/actions/runs/35238347343), [jornada comercial](https://github.com/yagoS0/api-app-contabilidade/actions/runs/35238347283) e [confirmação WhatsApp/PostgreSQL](https://github.com/yagoS0/api-app-contabilidade/actions/runs/35238347420) aprovadas. A CI testou a integração com a alteração de tipografia da main (`259d97e8`). Interface completa: 317 suítes/4.289 testes; portal do cliente: 85/1.552; regressão de comunicação da API: 75/1.649, além das verificações comerciais, fiscais simuladas e de banco.
- Nenhum ensaio consumiu tokens Anthropic, enviou mensagens reais, emitiu notas ou consultou serviços fiscais pagos.

Pendências externas: a Meta permite ler o novo telefone e retorna `VERIFIED`, mas a consulta à WABA fornecida e aos aplicativos inscritos retorna erro `100/33` com a credencial atual. Não trocar a credencial principal por suposição. Liberar o acesso correto e configurar `WHATSAPP_COMERCIAL_TOKEN`, depois conferir conta/aplicativo e só então ativar o canal e multicanal. O telefone originalmente indicado para piloto é o próprio número principal do escritório; foi solicitada confirmação do celular remetente de teste. Identificadores e evidências privadas ficam fora do Git.

A revisão final acrescentou a preservação da pausa humana legada no interlocutor: abrir outro canal não libera a automação. Repetir o backfill não restaura uma atribuição que a equipe já liberou. Verificador PostgreSQL aprovado com 27 verificações, transação revertida e rede bloqueada. As filas de entrada e IA estavam sem itens pendentes na preparação e foram reconferidas na transação de ativação.

## Nome de quem responde e novo número comercial — 17/09/2026

O cliente vê o nome do atendente em negrito na primeira linha da própria mensagem ou legenda. A Cloud API transporta esse texto; isso não troca o nome do contato empresarial nem cria um cabeçalho nativo de usuário. Fonte: [coleção oficial da Meta — mensagens](https://www.postman.com/meta/whatsapp-business-platform/request/0arw2jw/send-text-message-with-preview-url) e [referência Meta de texto e formatação](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/TextObject/).

A assinatura usa o usuário autenticado que executa o envio, inclui mensagens rápidas/anexos/proposta/devolutiva e fica preservada no histórico. Automação e notas internas não passam por esse helper. Texto existente não é truncado para abrir espaço: limite excedido retorna erro antes da reserva/transporte e mantém o rascunho para correção.

Validação da assinatura: 19 suítes/292 testes de API, onboarding e roteamento sem IA aprovados; após a proteção adicional contra nome preenchido com e-mail/ID, 91 testes de assinatura e rotas aprovados novamente. Sem envio à Meta, chamada Anthropic ou migração adicional.

O dono informou o cadastro do novo número comercial na Meta e forneceu os identificadores por imagem. Os dados foram registrados apenas no arquivo privado de preparação do workspace, fora do Git. A consulta somente leitura confirmou acesso ao telefone e seu estado VERIFIED. A conta e a assinatura do aplicativo ainda precisam ser reconciliadas com os dados da Meta antes do cadastro/ativação multicanal. Não substituir o telefone principal nem presumir recepção/saída validada a partir da imagem.

## Entrada de leads antes do segundo número — 17/09/2026

O dono pediu ativar o comportamento de leads no número atual enquanto providencia o comercial. O primeiro lote usa `WHATSAPP_COLETA_COMERCIAL=1` e `INTEGRACAO_WHATSAPP_MENU=1`, limitado à lista explícita `IA_COMERCIAL_TELEFONES_PILOTO`. Apesar do nome histórico dessa lista, a coleta não usa IA. Identidade V2, leitura V2 e multicanal permanecem desligados neste lote; a migração aditiva continua obrigatória, mas a coleta também suporta os segmentos legados existentes, sem backfill global.

Menu e coleta compartilham o piloto comercial: não é necessário duplicar o telefone no piloto operacional do menu. Fora dessa audiência, as regras existentes permanecem. A coleta tem precedência sobre a IA comercial, inclusive para saudações que serão respondidas pelo menu. Não habilitar o modelo para testar. Primeiro pedido como “empresa parada e não sei o que fazer” pede CNPJ; não interpreta o desconhecimento genérico como resposta a uma pergunta ainda não feita.

O novo verificador `verify-lead-entry-postgres.js` passa pelo webhook, registro real, lista nativa, coleta, transporte rastreado e persistência do onboarding, com Meta/consulta pública injetadas e rede externa bloqueada. Sete cenários cobrem saudação, pedido direto, replay, dúvida de preço, abertura avulsa, transferência, empresa parada, equipe e exclusão de telefone fora do piloto. O PostgreSQL é somente local/CI; não executar o verificador em produção.

Validação local após integrar a main: 81 suítes/1.690 testes da API, mais 35 verificações direcionadas após o ajuste que evita reservar atendimento fora do piloto; sete cenários reais no PostgreSQL com zero rede/IA. Das 51 suítes da interface afetada, 49 passaram na primeira rodada e duas foram corrigidas e aprovadas (28 testes): paridade de canais agora isola infraestrutura Node no jsdom, e a mensagem rápida exige a versão da orientação preparada. Build web aprovado. A tentativa local de toda a aplicação web foi interrompida sem resultado; posteriormente a CI remota completou a regressão integral, conforme o registro de publicação acima. A CI também identificou e validou o mesmo isolamento no teste de paridade dos canais de guias.

Antes de ativar, conferir revisão publicada, migração, audiência e fila pendente. Não reprocessar testes antigos nem liberar conversas assumidas por uma pessoa. Depois da ativação, conferir flags e saúde em leitura; recebimento real depende de uma nova mensagem do telefone autorizado. O registro de produção deve distinguir essa conferência de uma conversa efetivamente entregue pela Meta.

## Comportamento implementado

- Cliente vem do contato ativo cadastrado; lead exige solicitação comercial confirmada. A falta de cadastro aparece como **A identificar**. Essa classificação não concede permissão fiscal.
- Histórico e atendimento humano acompanham o interlocutor. Empresa operacional, solicitação comercial e número do escritório permanecem contextos separados.
- Troca de titular encerra a vigência anterior; revisão de identidade, intervenções humanas e trocas de contexto invalidam ações antigas. Associar outro telefone exige conferência explícita e auditada.
- Coleta comercial determinística aceita os caminhos de abertura, transferência e empresa parada. As informações alimentam o onboarding; dúvidas e lacunas vão para o contador. Solicitação comercial não substitui a empresa usada para guias ou notas.
- A jornada exige as evidências correspondentes ao estágio antes de aprovar/enviar proposta ou concluir. Consulta pública não prova regularidade. Serviço avulso tem ficha/documentos próprios, sem provisionar automaticamente portal ou contabilidade recorrente.
- Inbox agrupa antes de paginar, busca no servidor, separa notas internas e confirma leitura por comando próprio. A interface mantém rascunho por pessoa, canal e modo de escrita.
- Saídas, janelas de atendimento, downloads de mídia e recibos respeitam o canal. Envios programados de guias e comunicados existentes continuam no canal principal.

## Ordem de ativação

1. Fazer backup e aplicar `20260917100000_comunicacao_identidade_canais`; gerar Prisma do mesmo schema. Migration é aditiva e semeia somente o canal `principal`.
2. Publicar código compatível com as quatro flags novas em `0`. Não configurar segundo número nem alterar modelos Meta nesta etapa.
3. Pausar workers de comunicação para a associação inicial. Rodar `node scripts/backfill-whatsapp-identidade.js` (inventário) e conferir conflitos. Somente então rodar com `--apply`. Reexecutar é permitido; não refaz identificação de titular encerrado.
4. Rodar `node scripts/auditar-classificacao-whatsapp.js`. A auditoria é somente leitura e retorna IDs internos para revisão. Conferir casos com identidade em revisão, histórico sem migração e vínculo cadastral divergente. Resolver conflitos explicitamente; não unir por nome.
5. Habilitar `WHATSAPP_IDENTIDADE_V2=1`, depois `WHATSAPP_CHAT_V2=1`. Conferir pessoa com várias empresas, histórico, notas internas, leitura e resposta manual antes de reiniciar automações.
6. Habilitar `WHATSAPP_COLETA_COMERCIAL=1` somente com a lista explícita `IA_COMERCIAL_TELEFONES_PILOTO`. A flag é independente da IA. Menu comercial exige também a configuração de menus e seu piloto. Não habilitar Anthropic para essa coleta.
7. Segundo número exige cadastro real em `CanalWhatsapp`: identificador, chave, `phoneNumberId`, `wabaId`, finalidade, ativo e referência à variável de credencial. O segredo permanece no ambiente do servidor. Só depois habilitar `WHATSAPP_MULTICANAL=1`, com identidade V2 já ativa. Não existe cadastro automático na Meta.

Se houver falha, desligar a coleta/multicanal e pausar workers afetados. Depois de registrar tráfego V2, conservar a leitura por vigência e canal; não restaurar uma versão antiga que misture esses históricos. Saídas indeterminadas exigem reconciliação, nunca reenvio automático.

## Verificação reproduzível

Todos os ensaios usam dados fictícios e provedores injetados. Os verificadores PostgreSQL recusam bancos fora dos alvos locais/CI explicitamente permitidos. Nenhum teste usa tokens Anthropic ou envia mensagens a clientes.

- `verify-whatsapp-identidade-postgres.js`: agrupamento, carteira, paginação, notas, leitura, titularidade, associação de número e backfill.
- `verify-whatsapp-canais-postgres.js --url <banco-local-ou-CI>`: roteamento, janela, recibos, handoff entre canais, titularidade, webhook completo e canal desativado.
- `verify-commercial-identity-postgres.js <banco-local-ou-CI>`: cliente com nova solicitação, coleta, regras da jornada, proposta e ficha avulsa.
- Regressões Jest da comunicação, onboarding e interface; validação Prisma, auditoria de migrations e build web.

Resultados locais: regressão ampla da API com 87 suítes/1.785 testes; regressão web com 52 suítes/376 testes, além das rodadas específicas posteriores às correções (incluindo 223 testes de transporte/identidade/rotas e 207 comerciais). Migration completa aplicada em PostgreSQL 15 e schema validado; nenhuma operação real em provedor externo nos ensaios. Execução local com Node 24; a CI de publicação, registrada acima, executou com Node 20.

Medição reproduzível com `benchmark-inbox-postgres.js`: 200 interlocutores, 2.000 mensagens, 8 amostras após aquecimento, tabelas analisadas antes de comparar os dois leitores reais. A quantidade de comandos de leitura V2 ficou constante entre páginas de 10 e 100 pessoas.

| Página | Leitor anterior: p95 local / comandos | Leitor V2: p95 local / comandos |
| --- | --- | --- |
| 10 pessoas | 185,1 ms / 54 | 110,8 ms / 10 |
| 100 pessoas | 429,1 ms / 504 | 166,9 ms / 10 |

O ensaio detectou e levou à remoção da contagem de não lidas repetida por pessoa; ela agora é agregada antes da projeção. A medição é uma comparação sintética nesta máquina, não um SLA nem uma previsão da latência em produção.

Decisão após medição: manter polling da página completa, com paginação por cursor e proteção contra resposta obsoleta. Isso conserva atualizações de entrega e notas mesmo quando nenhuma mensagem nova chega. Delta incremental de transporte e SSE permanecem otimizações posteriores; não foram implementados nesta entrega.

Ensaios reais complementares: 25 verificações de identidade/migração, 7 de canais, 9 do novo fluxo comercial, 37 do fluxo comercial anterior e 11 da abertura até cadastro/documentos. A revisão final inclui destino vigente para pessoa com dois telefones, preservação da escolha explícita no detalhe e bloqueio de rascunho quando seu destino muda. Os testes adicionais executados depois de cada correção estão nos respectivos verificadores e suites.

A validação visual pelo navegador ficou indisponível nesta sessão: a ferramenta de UI não encontrou navegador disponível. A aplicação de desenvolvimento e o build foram verificados, mas isso não substitui inspeção visual interativa nem homologação externa da Meta.

## Itens expressamente adiados

O lote 7 continua apenas planejado: catálogo de templates comerciais, submissão/aprovação na Meta, consentimento por finalidade e iniciação/retomada por esses modelos. As APIs DocuSign/Asaas também permanecem para etapa posterior. O segundo número real depende de cadastro/configuração externa; a estrutura de canais não compra, registra ou ativa um número.
