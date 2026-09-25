# Atendimento no celular e correções da auditoria — 25/09/2026

Escopo autorizado: implementar o plano de PWA do atendimento e os ajustes da auditoria do chat, integrar na main e publicar API e escritório. A pré-triagem comercial continua curta; esta mudança não cria automação de contratação nem muda consultas fiscais. Testes não usam Anthropic, Meta, SERPRO ou destinatários reais.

## Comportamento e rastreabilidade

| Auditoria | Implementação / critério |
| --- | --- |
| 01–02 | Guia mostra empresa, tributo, período e tentativa; PDF e parâmetros congelados antes do transporte. Reserva do balão e reconciliação local sem reenviar. |
| 03 | Texto, anexo e retomada usam intenção persistida por operador/chave/destino/conteúdo. Repetir uma chave consulta resultado; aceite incerto não autoriza segundo transporte. |
| 04–05 | GET não marca leitura; tela confirma entrada realmente exibida. Inbox V2 ordena atividade visível, preservando privacidade do contexto. |
| 06 | Envio humano assume atendimento com controle de concorrência e interrompe automação, mantendo escopo fiscal validado em documentos. |
| 07–08 | Arquivos são abertos/baixados com autenticação. Janela fechada oferece prévia contextual de modelo aprovado; enviar modelo não abre a janela de mensagens livres. |
| 09–11 | Busca de conteúdo paginada no servidor com contexto autorizado; ações compartilhadas entre central e ficha. Mock possui contratos de intenção, rascunho, arquivos e retomada. |
| 12 / PWA | Conversas em tela própria no celular; volta à lista, pesquisa, anexos, login que retorna à conversa, instalação e notificações opcionais. |

Detalhes: [histórico e PDFs](chat-historico-arquivos-20260925.md) e [contratos da API](atendimento-pwa-api.md).

## Persistência e segurança

- Migração aditiva `20260925120000_atendimento_pwa_auditoria`; gerar Prisma antes de iniciar os processos novos. Nenhuma alteração de cadastro de clientes, agenda fiscal ou backfill de identidade.
- Rascunhos autenticados e versionados, separados por usuário/pessoa/canal/conversa/modo. Conteúdo expira em sete dias; exclusão/expiração mantém marcador e versão para impedir sobrescrita por aba antiga.
- Manifesto `/atendimento.webmanifest`, entrada `/whatsapp?app=atendimento`, service worker `/atendimento-sw.js`. Não há cache de API, login, histórico, anexos ou tokens. Textos ainda não sincronizados permanecem em memória; offline não promete envio nem retenção após fechar o navegador.
- PDF histórico usa chave própria `whatsapp/historico/guias/<tentativa>/<sha256>.pdf`, armazenamento persistente existente e conferência SHA-256 no download. Não confundir PDF atual com original de envio antigo.
- Push guarda inscrição por conta/aparelho e vínculo opaco renovável. Payload genérico sem nome, telefone, empresa ou texto; o service worker confere vínculo antes de mostrar. Saída limpa vínculo local antes de revogar no servidor.
- Evento push nasce na transação da entrada; workers reservam a entrega no banco e reavaliam papel, atribuição, leitura, contexto e inscrição. Evento vence em duas horas; no máximo três tentativas de push; 404/410 revoga inscrição. Aceite pelo serviço de push não é prova de exibição no aparelho.
- Manutenção a cada 15 s: fila push, expiração de conteúdo dos rascunhos e reconciliação de histórico. Limpeza horária de eventos encerrados após 30 dias, preservando entregas pendentes/em processamento. Falha de uma tarefa não impede as outras.

## Configuração e publicação

Somente API: `WHATSAPP_ATENDIMENTO_PUSH=1`, `ATENDIMENTO_PUSH_VAPID_PUBLIC_KEY`, `ATENDIMENTO_PUSH_VAPID_PRIVATE_KEY`, `ATENDIMENTO_PUSH_VAPID_SUBJECT=https://altan.company`. Chave privada nunca vai ao bundle, Git, logs ou resposta HTTP. Configuração pública é retornada após autenticação. Ausência de configuração deixa notificações indisponíveis sem impedir chat.

Não criar inscrições para usuários automaticamente. A pessoa instala/abre o aplicativo e escolhe ativar notificações no próprio aparelho. No iPhone/iPad, Web Push exige aplicativo adicionado à tela inicial e versão compatível; conferir por recurso disponível, não por promessa universal. Referência oficial: [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Atualização do service worker é explícita quando não há edição/envio pendente; [ciclo oficial](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Ordem: conferir backup/armazenamento e main atual → testes locais/CI → integração → migração/API → escritório → conferir saúde e revisão implantada de ambos. Desligar a flag suspende push; não reverter migração aditiva durante rollback. Não apagar intenções, rascunhos ou histórico para contornar resultado incerto.

## Evidências e limites

- PostgreSQL descartável: histórico completo de migrações aplicado; simulação `verify-atendimento-pwa-postgres.js` cobre concorrência de intenção, timeout sem reenvio, recuperação de aceite, rascunhos/anti-ABA/expiração, outbox transacional, disputa de workers, revogação/leitura e retenção. Rede externa bloqueada no script.
- Testes unitários/HTTP cobrem papéis, propriedade da inscrição, destinos de push permitidos, vínculos encerrados, canal desativado, revogação durante processamento e conteúdo genérico.
- Os clientes antigos que omitem `clientRequestId` mantêm compatibilidade, sem garantia nova de deduplicação; interface atual envia a chave. V2 deve permanecer ativo para a nova inbox.
- Retomada inicial exige modelo estático aprovado no canal, sem parâmetros/mídia/botões. Configuração pendente é exibida; não criar modelo ou enviar mensagem em teste.
- O catálogo atual não armazena corpo/versão Meta dos modelos de guia; o histórico conserva nome, idioma, parâmetros e hash e declara ausência da renderização exata. Legados não recebem conteúdo inventado.
- Teste de navegador em tamanho de celular não substitui homologação em iPhone/Android físicos, teclado virtual e entrega real de push. Esses resultados devem ser registrados separadamente.
