# Comunicação por interlocutor: implantação e validação

Implementação iniciada em 16/09/2026, branch `feat/comunicacao-identidade-chat-v2`, reconciliada com a main em 17/09/2026. Decisões e backlog: [plano](plano-comunicacao-identidade-leads-20260916.md).

Estado em 17/09: implementação validada localmente; publicação e ativação ainda pendentes. Nenhuma flag, conversa ou dado de produção foi alterado nesta rodada.

## Nome de quem responde e novo número comercial — 17/09/2026

O cliente vê o nome do atendente em negrito na primeira linha da própria mensagem ou legenda. A Cloud API transporta esse texto; isso não troca o nome do contato empresarial nem cria um cabeçalho nativo de usuário. Fonte: [coleção oficial da Meta — mensagens](https://www.postman.com/meta/whatsapp-business-platform/request/0arw2jw/send-text-message-with-preview-url) e [referência Meta de texto e formatação](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/TextObject/).

A assinatura usa o usuário autenticado que executa o envio, inclui mensagens rápidas/anexos/proposta/devolutiva e fica preservada no histórico. Automação e notas internas não passam por esse helper. Texto existente não é truncado para abrir espaço: limite excedido retorna erro antes da reserva/transporte e mantém o rascunho para correção.

Validação da assinatura: 19 suítes/292 testes de API, onboarding e roteamento sem IA aprovados; após a proteção adicional contra nome preenchido com e-mail/ID, 91 testes de assinatura e rotas aprovados novamente. Sem envio à Meta, chamada Anthropic ou migração adicional.

O dono informou o cadastro do novo número comercial na Meta e forneceu os identificadores por imagem. Os dados foram registrados apenas no arquivo privado de preparação do workspace, fora do Git. Continuam pendentes a publicação autorizada, conferência da credencial, cadastro do canal e sequência de identidade/backfill para ativar multicanal. Não substituir o telefone principal por esse número nem presumir recepção/saída validada a partir da imagem.

## Entrada de leads antes do segundo número — 17/09/2026

O dono pediu ativar o comportamento de leads no número atual enquanto providencia o comercial. O primeiro lote usa `WHATSAPP_COLETA_COMERCIAL=1` e `INTEGRACAO_WHATSAPP_MENU=1`, limitado à lista explícita `IA_COMERCIAL_TELEFONES_PILOTO`. Apesar do nome histórico dessa lista, a coleta não usa IA. Identidade V2, leitura V2 e multicanal permanecem desligados neste lote; a migração aditiva continua obrigatória, mas a coleta também suporta os segmentos legados existentes, sem backfill global.

Menu e coleta compartilham o piloto comercial: não é necessário duplicar o telefone no piloto operacional do menu. Fora dessa audiência, as regras existentes permanecem. A coleta tem precedência sobre a IA comercial, inclusive para saudações que serão respondidas pelo menu. Não habilitar o modelo para testar. Primeiro pedido como “empresa parada e não sei o que fazer” pede CNPJ; não interpreta o desconhecimento genérico como resposta a uma pergunta ainda não feita.

O novo verificador `verify-lead-entry-postgres.js` passa pelo webhook, registro real, lista nativa, coleta, transporte rastreado e persistência do onboarding, com Meta/consulta pública injetadas e rede externa bloqueada. Sete cenários cobrem saudação, pedido direto, replay, dúvida de preço, abertura avulsa, transferência, empresa parada, equipe e exclusão de telefone fora do piloto. O PostgreSQL é somente local/CI; não executar o verificador em produção.

Validação após integrar a main: 81 suítes/1.690 testes da API, mais 35 verificações direcionadas após o ajuste que evita reservar atendimento fora do piloto; sete cenários reais no PostgreSQL com zero rede/IA. Das 51 suítes da interface afetada, 49 passaram na primeira rodada e duas foram corrigidas e aprovadas (28 testes): paridade de canais agora isola infraestrutura Node no jsdom, e a mensagem rápida exige a versão da orientação preparada. Build web aprovado. A tentativa de regressão de toda a aplicação web foi interrompida sem resultado; a validação concluída cobre comunicação, onboarding, contatos e navegação afetada. CI remoto ainda não executado.

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

Resultados locais: regressão ampla da API com 87 suítes/1.785 testes; regressão web com 52 suítes/376 testes, além das rodadas específicas posteriores às correções (incluindo 223 testes de transporte/identidade/rotas e 207 comerciais). Migration completa aplicada em PostgreSQL 15 e schema validado; nenhuma operação real em provedor externo. Execução local com Node 24; os workflows mantêm Node 20 e não foram executados remotamente nesta rodada.

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
