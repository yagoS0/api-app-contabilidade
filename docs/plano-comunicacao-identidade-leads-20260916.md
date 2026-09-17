# Plano de comunicação: identificação, leads e chat

Data: 16/09/2026. Situação: **execução autorizada**, com design aprovado pelo dono. A implementação local dos lotes 0–6 e suas evidências estão registradas no [guia de implantação](comunicacao-identidade-implantacao.md). O lote 7 permanece planejado e adiado. Não houve publicação em produção nesta rodada.

Base examinada: checkout `work/comunicacao-atendimento`, commit `0ecdf35774750e1b7a853a623dc3f24d0d29b8a5`. Auditorias independentes de identificação/permissões, jornada comercial e interface; revisão principal de canais, migração e integração. Valores de flags em produção não foram consultados nesta análise.

## 1. Resultado esperado e decisões

O escritório deve enxergar uma conversa por interlocutor, reconhecer clientes cadastrados, acompanhar solicitações comerciais e executar cada operação na empresa correta. A identificação usa evidências do cadastro e decisões auditadas. Ausência ou conflito de evidência exige identificação humana; não será resolvido por palpite da IA.

Separar quatro dimensões:

| Dimensão | Exemplo | Origem da decisão |
| --- | --- | --- |
| Relacionamento | Cliente, Lead, A identificar | Cadastro e solicitação comercial válida |
| Solicitação | Abertura avulsa, abertura com contabilidade, transferência, regularização | Pedido confirmado do contato |
| Canal | Principal/Atendimento ou Comercial | Número empresarial informado pelo provedor |
| Contexto da operação | Empresa selecionada para guia, documento ou nota | Vínculo autorizado e seleção válida |

Uma cliente que representa três empresas e pede outra abertura aparece como **Cliente · Nova abertura**. A abertura tem ficha própria, sem apagar o histórico e sem usar os tributos de uma empresa existente. Entrar pelo número comercial não transforma cliente em lead. CNPJ do tomador de uma nota não muda a empresa emissora.

Decisões de implementação:

- Identificação e autorização no servidor; cor e filtros apenas apresentam o resultado.
- Desconhecido não vira lead automaticamente. Lead significa interesse comercial confirmado, sem vínculo atual reconhecido como cliente; não significa identidade civil validada.
- Cadastro de telefone/e-mail continua sendo a origem dos destinatários de comunicação. Conta do portal não passa a ser requisito para receber guia ou conversar com o escritório.
- Permissão de consulta ou ato fiscal continua independente: contato cadastrado, representação e RBAC não são provas intercambiáveis.
- Um caso comercial ativo por interlocutor; abertura e transferência simultâneas viram solicitações separadas, atendidas uma de cada vez. Atendimento operacional do cliente continua possível, sem sobrescrever o caso comercial.
- O segundo número fica preparado na arquitetura, mas só será ativado depois dos controles de canal. O número atual continua utilizável para clientes e leads.
- DocuSign e criação automática de cobrança Asaas permanecem fora desta implementação.

## 2. O que o código já faz e o que precisa mudar

| Área | Encontrado no código | Trabalho necessário |
| --- | --- | --- |
| Vínculo | `vinculoTelefone.js` retorna VINCULADO, AMBIGUO, DESCONHECIDO ou TELEFONE_INVALIDO; comparação estrita | Projetar relacionamento e motivo da identificação sem confundir ambiguidade com lead |
| Comunicação e autorização | `empresasParaComunicacao` permite agrupar contatos cadastrados; `empresasAutorizadas` verifica permissões próprias | Preservar ambos os caminhos; não usar autorização fiscal como requisito universal de comunicação |
| Histórico | `ConversaWhatsapp` conserva segmentos por empresa; `AtendimentoResponsavelWhatsapp` reúne o telefone | Acrescentar identidade com vigência e canal, mantendo segmentos e recibos |
| Comercial | `AtendimentoLead`, `Onboarding`, propostas, biblioteca e documentos já existem | Desacoplar solicitação comercial da exigência `portalClientId:null` |
| Coleta | Menu de desconhecidos pede CNPJ, mas a coleta conversacional completa depende hoje do assistente comercial | Motor de coleta determinístico reutilizando validações e gravação do onboarding |
| Etapas | Há conferências/eventos no servidor; `montarJornada` dirige a navegação no frontend | Servidor deve também decidir todas as transições e comandos permitidos; esconder botão não é guarda |
| Proposta | PDF, catálogo, versões, aceite e contrato já existem | Exigir evidências aplicáveis antes de aprovar/enviar proposta definitiva; permitir rascunho identificado |
| Tela | Agrupa conversas, mas mistura situação operacional, vínculo e onboarding | Novo resumo explícito por interlocutor e layout aprovado |
| Lista | Há agrupamento após limite de segmentos, consultas por linha e busca parcial no frontend | Agrupar/filtrar antes de paginar e buscar no servidor |
| Dois números | Um `WHATSAPP_PHONE_NUMBER_ID`; eventos de outro número são recusados | Cadastro de canais e transporte escolhido por canal em todos os caminhos |

Pontos concretos a revisar: `LeadService.iniciarAtendimento`, `routes/firm/fluxoComercial.js`, `politicaComercialWhatsapp`, `AssistenteComercialService`, `TurnoIaWhatsappService`, `EnvioPropostaService`, `JornadaLeadService`, `FormOnboarding` e formulários rápidos. Remover a restrição de cliente nesses pontos exige substituí-la por autorização do caso, não simplesmente apagar verificações.

## 3. Identificação confiável

### Ordem de decisão

1. Validar assinatura/origem do webhook e resolver o número empresarial contra canais cadastrados. Evento desconhecido permanece registrado para análise e não provoca resposta por um canal padrão.
2. Deduplicar pelo identificador do provedor. Identificar o telefone exato e aliases realmente observados no provedor conforme o contrato atual; normalizar formatação não inclui inserir ou remover dígitos para forçar correspondência. Colisão de alias exige revisão.
3. Resolver o vínculo vigente do número com o interlocutor. Um número é um endereço de comunicação, não prova de quem está segurando o aparelho.
4. Consultar contatos ativos desse vínculo e as empresas existentes. Consultar também conflitos, contatos desativados e histórico encerrado para detectar necessidade de revisão.
5. Calcular o relacionamento. Evidência de cliente prevalece sobre oportunidade comercial. Histórico conflitante ou identidade contestada prevalece sobre automação.
6. Resolver o pedido atual: serviço operacional ou caso comercial. Se a frase for ambígua, fazer uma pergunta curta. Não cadastrar uma abertura só porque alguém escreveu um CNPJ.
7. Para cada função sensível, revalidar empresa, permissões, versão, identidade e canal imediatamente antes de executar e antes de enviar resultado.

O DTO deve devolver `relacionamento`, `motivo`, `origemDaEvidencia`, `revisaoIdentidade`, `versaoIdentidade`, `solicitacaoComercial`, `contextoOperacional`, `modoAtendimento` e capacidades específicas. Não criar um `isLead` editável que se torne a fonte universal de autorização.

### Matriz de identificação

| Caso | Exibição e atendimento | Regra de proteção |
| --- | --- | --- |
| Telefone exato ativo em uma empresa | Cliente; menu compatível com as permissões | Nome de perfil não substitui cadastro |
| Telefone exato em três empresas | Cliente; conversa única e empresas disponíveis | Pedido fiscal escolhe empresa; histórico não é repartido na tela |
| Contato ativo sem usuário do portal | Cliente cadastrado para comunicação | Recebimento/manual permitidos pelas regras existentes; fiscal não recebe RBAC inventado |
| Mesmo telefone associado a usuários diferentes | Contato de clientes, com aviso de identidade a conferir | Agrupamento de comunicação pode existir; funções fiscais ambíguas permanecem bloqueadas |
| Número novo diz “já sou cliente” | A identificar; encaminhar para confirmar cadastro | Não mostrar empresas/documentos de alguém só pelo nome ou CNPJ informado |
| Número desconhecido diz “quero abrir empresa” | Lead, identidade ainda não verificada | Pode coletar dados declarados e preparar proposta; representação será conferida quando necessária |
| Desconhecido manda somente “oi” | A identificar | Pergunta breve sobre o objetivo; sem oferta ou criação automática de ficha |
| CNPJ informado já consta na carteira | A identificar ou Cliente já reconhecido | Consulta pública não revela vínculo privado, guias, faturamento ou documentos |
| Cliente pede nova abertura | Cliente · Abertura | Caso comercial separado; conserva operação e permissões das empresas anteriores |
| Cliente chega pelo número comercial | Cliente, canal Comercial | Não duplicar pessoa nem reiniciar onboarding |
| Lead chega pelo número principal | Lead após confirmar interesse | Canal não determina relacionamento |
| Só existem contatos antigos/inativos | A identificar, motivo “cadastro anterior” | Não interpretar DESCONHECIDO do resolver como lead novo |
| Empresa está SUSPENSA | Cliente/cadastro conhecido com restrição operacional | Suspensão de processamento não significa cancelamento de contrato ou lead |
| Troca de telefone conferida pelo escritório | Mesmo interlocutor, novo vínculo de número | Histórico pode ser reunido após conferência; permissões/opt-in não são transferidos por inferência |
| Número reciclado ou titularidade contestada | Suspender automação; novo vínculo após revisão | Encerrar vigência anterior; histórico e documentos antigos não passam ao novo titular |
| Telefone compartilhado por equipe/família | Interlocutor compartilhado | Não afirmar identidade individual; autorização fiscal exige resolução própria |
| Perfil, áudio, imagem ou mensagem encaminhada diz quem é | Informação declarada, sujeita a confirmação | Não usar como prova automática de identidade ou mandato |
| Contato revogado durante um pedido | Mensagem preservada; operação interrompida | Invalidar contexto/códigos e revalidar antes da saída |
| Botão antigo ou resposta “2” depois de trocar empresa | Reapresentar escolha válida | Resolver só contra opções realmente oferecidas e vigentes |

Correção humana terá ação **Conferir identificação**, com motivo, responsável, evidência e prévia das consequências. Não oferecer um botão “tornar cliente” que conceda acesso. Mudança de vínculo incrementa versão, cancela confirmações antigas e deixa trilha de auditoria. Verificação de novo telefone usa procedimento já confiável, como sessão autenticada do portal ou confirmação por um contato previamente cadastrado; não basta repetir dados públicos. Código enviado somente ao número novo comprova posse daquele número, não representação da empresa. Mensagem atrasada após troca de titular deve respeitar a vigência original comprovável; se não puder ser determinada, fica para revisão sem automação.

### Modelo mínimo de dados

Adicionar três entidades pequenas, sem substituir o cadastro de empresas/usuários:

| Entidade | Conteúdo e invariantes |
| --- | --- |
| `InterlocutorComunicacao` | Identificador interno, tipo PESSOA/COMPARTILHADO/NAO_VERIFICADO, nome conferido opcional, versão e estado de atendimento humano. Não equivale a `User` |
| `VinculoNumeroInterlocutor` | Interlocutor, telefone exato, início/fim de vigência, geração, origem e conferência. Índice parcial impede dois vínculos vigentes do mesmo número nesta instalação |
| `CanalWhatsapp` | Identificador, chave estável, finalidade PRINCIPAL/COMERCIAL, `phoneNumberId`, `wabaId`, estado e referência à credencial. Segredos ficam na configuração segura, não no DTO ou em JSON exportado |

Relacionar `ContatoWhatsapp` ao vínculo vigente do número; alterações de telefone passam pelo serviço de cadastro. Isso impede que contatos antigos voltem a identificar automaticamente o novo titular de um número reciclado. O backfill cria evidência “cadastro legado”, nunca “identidade humana verificada”.

`AtendimentoResponsavelWhatsapp` permanece a sessão operacional, passando a ser único por canal + vínculo do número. `ConversaWhatsapp` continua segmento imutável, acrescentando canal/vínculo; novas chaves usam canal + geração do vínculo + empresa ou sem empresa. Mensagens preservam o segmento original. Mudança de identidade cria contexto novo, não reescreve mensagens antigas.

`AtendimentoLead` ganha interlocutor, versão e contexto comercial explícito; conserva `conversaId` como origem e `onboardingId` como ficha. Índice parcial assegura um caso ativo por interlocutor. `portalClientId` operacional nunca será usado como CNPJ da oportunidade. Quando aplicável, uma referência separada à empresa alvo do caso deve ser validada, sem transferir autorização.

Relacionamento será uma projeção calculada de contatos/casos/evidências, inicialmente por consultas agregadas e em lote. Se futuramente persistida para desempenho, precisará de invalidação transacional e reconstrução; permissões nunca dependerão somente dessa cópia.

## 4. Atendimento de lead, passo a passo

### Entrada e coleta

1. Reconhecer cadastro e intenção. Para contato novo com intenção indefinida, apresentar Abertura, Transferência, Empresa parada e Falar com a equipe. Se já explicou o objetivo, seguir sem obrigá-lo a repetir pelo menu.
2. Criar/retomar um `AtendimentoLead` pela intenção confirmada. Cliente atual recebe oportunidade no mesmo interlocutor; não perde o menu operacional.
3. Coletar poucos dados de cada vez e aceitar resposta com vários campos. Salvar cada campo validado na mesma ficha do onboarding, com origem, mensagem e versão. Pedir somente o que falta.
4. “Não sei” vira pendência declarada para o contador; nunca zero de faturamento, ausência de funcionário ou resposta negativa inventada.
5. Formulário público continua como alternativa para coleta maior, preenchendo a mesma ficha. Não criar um segundo onboarding porque o cliente saiu do WhatsApp e abriu o link. Documentos recebidos no chat são vinculados explicitamente ao dossiê, com destinatário/caso conferidos; upload pelo escritório reutiliza a rota autenticada de documentos. Não presumir que o formulário público já recebe arquivos.

**Abertura:** nome, atividade em linguagem comum, cidade, endereço pretendido quando disponível, sócios e informações necessárias para o orçamento. Oferecer **só abertura** e **abertura com contabilidade**, podendo comparar as duas. Não pedir CNPJ inexistente nem procuração fiscal dessa empresa futura.

**Transferência/empresa parada:** pedir CNPJ, validar e consultar a fonte pública existente. Mostrar razão social, atividade e endereço, com fonte/data. Informações públicas pré-preenchem a ficha sem substituir declarações divergentes silenciosamente. A consulta pública não certifica regularidade fiscal nem representação.

### Autorização e diagnóstico

6. Em empresa existente, conferir o representante. Se já houver procuração válida e suficiente para a operação, verificá-la e seguir. Não obrigar a reenviar a orientação ou cadastrar outra procuração para destravar a etapa.
7. Se faltar autorização, **Preparar orientação → Prévia → Enviar** usa a biblioteca aprovada. Depois **Registrar conferência → OK → Verificar autorização**. O envio da orientação não conclui a procuração.
8. Com prova aplicável, contador solicita a análise fiscal pela fila existente. Consulta tem comando explícito e controle de custo; polling só lê. Falha de provedor não equivale a ausência de pendências.
9. Resultado salvo em tabela/PDF é revisado pelo contador. Ele registra diagnóstico, serviços e pendências, separando regularização avulsa de contabilidade mensal. Abertura segue conferência de atividade/viabilidade/escopo, sem SITFIS obrigatório.
10. Preparar devolutiva, conferir e enviar. Reaproveitar os recibos por parte já existentes: texto/PDF entregue ao transporte não é repetido se só a outra parte falhou; resultado incerto requer reconciliação.

### Valores, proposta e contratação

11. Reutilizar o catálogo aprovado e `PropostasComerciaisService`: mensalidade, abertura, regularização, demais avulsos e taxas em linhas separadas. Serviço ausente do catálogo ou desconto fora das regras fica para aprovação humana. IA não calcula preço livremente.
12. Gerar PDF simples com dados do interessado, necessidade identificada, entregas, exclusões relevantes, valores, condições e validade. Snapshot fixa ficha/preço/modelo; não expor piso, margem, regras privadas ou catálogo inteiro.
13. Rascunho/estimativa pode ser preparado antes do diagnóstico e deve ser identificado como tal. **Aprovar e enviar proposta definitiva** exige evidências aplicáveis à modalidade no servidor. Para abertura, não exigir análise fiscal de um CNPJ que ainda não existe. Se um escopo limitado dispensar consulta privada, o contador registra a limitação e o motivo na proposta; não fabricar uma conferência. Devolutiva feita em reunião ou outro meio pode ter evidência manual com meio/data/ator, sem obrigar envio duplicado no WhatsApp.
14. Aceite fica ligado à versão/opção exata. Alteração material antes do aceite invalida a aprovação do rascunho/proposta anterior e pede nova revisão. Depois de aceite ou assinatura, preservar o compromisso e snapshot originais; mudança exige nova versão/contratação ou ajuste formal conferido, nunca reescrita automática do que foi aceito. Preparar contrato pelo modelo aprovado; contador confere antes do envio.
15. Assinatura por arquivo e instrução gov.br da biblioteca. Receber PDF não confirma assinatura; registrar conferência. Cobrança/link criado fora do sistema pode ser enviado pelo chat, com pagamento manual conferido para o contrato correto. APIs Asaas/DocuSign virão depois.
16. A conclusão comercial encaminha para executar o serviço. Na abertura com contabilidade, concluir o onboarding e converter somente após os dados/documentos e conferências exigidos; preservar arquivos, proposta aceita, contrato e ficha no cadastro. Isso não significa abertura legal concluída só por clicar em converter.
17. Na abertura avulsa, preservar dossiê e ficha da empresa aberta quando os dados finais estiverem disponíveis, mas sem ativar contabilidade recorrente, portal ou funções fiscais automaticamente. Corrigir a diferença entre conclusão avulsa atual e o destino cadastral esperado; modelo da ficha avulsa e ativação de serviços descritos no lote de conversão abaixo.

### Exemplo de conversa esperada

| Mensagem recebida | Comportamento esperado |
| --- | --- |
| “Sou médico, quero abrir uma empresa e não entendo disso” | Confirmar abertura; perguntar cidade e se terá consultório/endereço; salvar atividade já informada |
| “No Rio. Quero só abrir por enquanto” | Registrar avulso; não forçar mensalidade; coletar lacunas necessárias ao orçamento |
| “Minha empresa está parada, não sei o que falta” | Pedir CNPJ e iniciar caso de análise; não afirmar que está fiscalmente inativa |
| “Já tenho procuração com vocês” | Consultar prova aplicável e oferecer verificar; não repetir manual como pré-requisito |
| Cliente conhecido: “Quero abrir outra também” | Manter selo Cliente; iniciar abertura separada, sem CNPJ/tributos copiados da empresa atual |
| “Me manda a guia enquanto isso” | Usar atendimento operacional autorizado; preservar etapa comercial e retomar depois |
| “Era transferência, falei errado” | Prévia de recomeço; encerrar vínculo do caso anterior e criar o correto, preservando tudo |
| “Quero abrir uma e transferir outra” | Registrar intenção da próxima; tratar fichas separadas, uma ativa por vez |

### Quando entram automação, IA e contador

| Responsável | Pode fazer | Deve encaminhar |
| --- | --- | --- |
| Automação sem IA | Identificar cadastro, menus, sinônimos conhecidos, validar campos, consultar cadastro público autorizado, salvar ficha, localizar materiais aprovados, mostrar etapa e preparar rascunhos | Conflito de identidade, intenção ambígua persistente, diagnóstico, exceção de preço |
| IA opcional | Interpretar frase livre complexa, sugerir campos estruturados e responder com material aprovado dentro do caso | Identidade, autorização, decisão fiscal, preço fora do catálogo, afirmação não sustentada |
| Equipe/contador | Conferir representante, diagnóstico/viabilidade, serviços/preços, proposta, contrato, assinatura/pagamento e conclusão | Especialista quando necessário, mantendo responsável e próximo passo explícitos |

O contador recebe o caso já resumido assim que a coleta mínima termina; assume antes de diagnóstico e compromisso comercial. Pedido “quero falar com alguém”, contradição, reclamação ou falha repetida também encaminha. Assumir pausa respostas automáticas da pessoa; devolver exige uma nova interação válida, sem responder mensagens antigas. Não chamar toda automação de “IA” na tela.

Implementar `ColetaComercialWhatsappService` usando `LeadService.registrarCampos`/`proximaPergunta`, validadores e fontes de dados existentes. Texto incompreensível admite uma pergunta de esclarecimento antes de encaminhar; não manter loop de formulário. IA será um adaptador opcional, com saída validada e sem acesso direto à identidade/permissões. Todos os testes funcionam com esse adaptador desligado ou substituído.

## 5. Servidor como dono das etapas e comandos

Criar projeção compartilhada de jornada no backend, consumida pela tela e pelo bot. Retornar `etapaAtual`, `pendencias`, `evidencias`, `comandosPermitidos` e versão. Reutilizar eventos de `JornadaLeadService`, sem inventar provas para fichas antigas.

Cada escrita terá versão esperada, idempotência e transação/reserva compatíveis com o serviço existente. Mudanças em CNPJ, atividade/endereço relevante, análise fiscal, modalidade ou proposta exigem reavaliação das dependências. Abrir painel, polling e download nunca fazem etapa avançar.

Guardas obrigatórias: proposta definitiva ligada ao diagnóstico válido quando aplicável; autorização fiscal válida para o CNPJ/serviço; proposta ACEITA vigente da versão/opção correta; assinatura conferida; pagamento conferido do contrato exato; execução/entrega documentada para concluir avulso. Essas provas são conferidas no servidor, inclusive por chamada direta. Uma exceção de pagamento exigiria modelo e política próprios e fica fora deste plano; não criar um bypass genérico. Não bloquear rascunhos por exigências que só se aplicam à proposta final.

Ações sensíveis recebem contexto explícito `{interlocutorId, vinculoNumeroId, canalId, atendimentoLeadId?, portalClientId?, versao}`. São verificadas no servidor, nunca aceitas por confiança no corpo enviado pelo frontend ou na saída do modelo.

## 6. Dois números de WhatsApp

A coleção oficial da Meta identifica o número empresarial em `metadata.phone_number_id` e o envio usa `/{Phone-Number-ID}/messages`. Esses identificadores permitem roteamento por canal. [Referência oficial de payload](https://www.postman.com/meta/whatsapp-business-platform/folder/tduohwq/webhook-payload-reference) e [envio de mensagens](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-93917ea7-098d-45cc-85cc-f5d3500dd1f8).

O número comercial é útil para separar origem/fila e divulgação, mas não substitui a identificação. A conversa do escritório permanece reunida por interlocutor; cada mensagem mostra seu canal. O cliente pode continuar sendo atendido pelo número em que escreveu, sem ser obrigado a mandar tudo novamente ao outro.

Mudanças obrigatórias antes de ativar o segundo número:

- `eventoWebhookMeta.js`: conservar canal também em statuses, mídia e eventos processados; validar conta/número cadastrado.
- `ProcessarEventoWhatsappService.js`: resolver canal permitido, substituindo comparação com um único número. Canal desconhecido ou metadado ausente não escolhe silenciosamente o principal.
- `ConversaWhatsappService`: chaves por canal/vínculo/empresa e janela por canal + vínculo vigente do número (geração). Hoje `ultimaRecebida` agrega só telefone; isso não pode continuar com dois números. Mensagem do titular anterior não abre janela para o novo interlocutor após reciclagem/contestação do número; callbacks e recibos antigos permanecem na vigência original.
- `AtendimentoResponsavelWhatsappService`: sessão/contexto de operação por canal e identidade vigente; não reutilizar código/seleção do outro canal. Dono humano pode continuar no nível do interlocutor para evitar respostas concorrentes.
- Criar fábrica `whatsappPorCanal(canalId)`; eliminar clientes globais nos caminhos de menu, guias, responsável, IA, envio manual, proposta/devolutiva, anexos, comunicados e retomada.
- `ArquivoWhatsappService`: download/upload usa credencial da conta/canal de origem; não copiar ID de mídia entre contas como se fosse portável.
- Reservas/recibos/jobs guardam remetente escolhido antes da rede. Callbacks conferem canal e mensagem de saída; não atualizar uma saída de outro canal.
- Templates são verificados na conta e finalidade corretas. Aprovação na biblioteca interna não significa aprovação da Meta.
- Compositor fixa o canal ao preparar a mensagem. Troca exige recalcular janela/capacidade e revisar a prévia. Um envio que falhou no canal A não é repetido automaticamente pelo B.
- Guia agendada mantém canal de comunicação configurado; envio eventual pelo comercial não muda destino dos próximos envios. Deduplicação de entrega considera guia + destinatário + operação: canal adicional não autoriza duplicar liberação já confirmada.

Aplicar a regra de janela de atendimento independentemente em cada canal. Fora da janela, usar o fluxo de template elegível e aprovado; não liberar texto por existir mensagem recente no outro número. A Meta distingue a janela de atendimento de outros conceitos de conversa; não derivar disponibilidade de um booleano permanente. [Referência oficial da janela](https://www.postman.com/meta/whatsapp-business-platform/folder/fuaee8l/statuses-object).

Homologação do número real, credenciais, conta e templates será uma atividade operacional separada, sem disparo a clientes durante testes de código. Mensagens de provedor sem identificador suportado ficam visíveis para revisão; não converter identificadores novos em telefone por suposição.

### 6.1. Criação de templates e contato ativo — etapa futura solicitada

Inclusão solicitada pelo dono após fornecer uma referência sobre segundo número, consentimento, retomada e funcionamento de plataformas como Octadesk. **Planejar agora; não implementar, cadastrar modelos na Meta ou disparar mensagens nesta etapa.** Esta extensão poderá funcionar no número principal e posteriormente no comercial; não depende de comprar ou ativar outro número.

A Meta exige consentimento para os contatos posteriores, uso do modelo aprovado para sua finalidade e template fora da janela de atendimento. A última mensagem do cliente é a referência da janela; enviar ou entregar template não a renova por si só. Consentimento, disponibilidade do modelo e janela serão controles separados. [Política oficial consultada](https://business.whatsapp.com/policy).

O padrão de interface proposto é **escolher contato → escolher número de origem → escolher modelo → conferir → enviar → aguardar resposta**. A documentação da Octadesk descreve essa experiência para o WhatsApp Oficial; usá-la como referência de operação, sem copiar preços, regras de infraestrutura ou contratar dependência dessa plataforma. [Referência da Octadesk](https://help.octadesk.com/a/como-inicio-uma-conversa-no-chat-da-octadesk/).

#### Catálogo a preparar

Nomes abaixo são chaves propostas, não modelos já cadastrados/aprovados. Categoria é sugestão para revisão e submissão; a categoria efetiva será a retornada pela Meta. Idioma inicial: `pt_BR`. Criar um modelo por finalidade real, sem um corpo inteiro em variável livre.

| Chave proposta | Uso e condição | Categoria proposta |
| --- | --- | --- |
| `altan_primeiro_contato_comercial_v1` | Interessado solicitou contato em site, formulário, anúncio ou outro canal, com evidência de autorização compatível | MARKETING |
| `altan_retomada_comercial_v1` | Retomar uma solicitação comercial identificada e ainda pertinente | MARKETING |
| `altan_acompanhamento_proposta_v1` | Acompanhar proposta realmente enviada, válida e não revogada; não afirmar aceite ou contratação | MARKETING |
| `altan_convite_reuniao_v1` | Oferecer horário para conversar sobre serviço, mediante autorização comercial | MARKETING |
| `altan_lembrete_reuniao_v1` | Lembrar reunião efetivamente confirmada, com data/hora e referência; sem oferta adicional | UTILITY, sujeita à revisão |
| `altan_atualizacao_atendimento_v1` | Comunicar atualização concreta de atendimento solicitado ou serviço contratado; não usar uma frase genérica para qualquer assunto | UTILITY, sujeita à revisão |
| `altan_documento_pendente_v1` | Solicitar documento necessário a um atendimento/serviço identificado, sem inserir promoção | UTILITY, sujeita à revisão |
| `altan_contrato_disponivel_v1` | Informar contrato efetivamente preparado após aceite, com acesso ao documento correto; não pressupõe integração DocuSign | UTILITY, sujeita à revisão |

Utilidade se destina a notificações pertinentes à transação/serviço; convites comerciais e retomada de negociação serão tratados inicialmente como marketing. O rótulo “cliente” não determina a categoria da mensagem. [Referência de Utilidade](https://business.whatsapp.com/products/conversation-categories/utility).

Guias e comunicados já têm caminhos próprios: inventariar os modelos existentes antes de criar novos. `reabrir_conversa` aparece como referência no tratamento de janela expirada do código, mas isso não prova aprovação nem disponibilidade na conta real. Substituir ou mapear essa referência por finalidade só depois do inventário. Modelos de cobrança poderão ser adicionados depois, vinculados a uma cobrança real; criar templates não implementa a API do Asaas. Campanhas comerciais ficam em lote futuro próprio, sem reutilizar o botão individual para disparos em massa.

Textos iniciais para revisão interna, ainda sem aprovação:

| Modelo | Rascunho do corpo | Campos permitidos e prova |
| --- | --- | --- |
| Primeiro contato | “Olá, {{1}}! Aqui é a equipe da Altan Contabilidade. Recebemos sua solicitação de informações sobre {{2}}. Podemos conversar por aqui?” | Nome e serviço solicitado; usar somente quando houver solicitação correspondente registrada |
| Acompanhamento da proposta | “Olá, {{1}}! Aqui é a Altan Contabilidade. Gostaria de conversar com nossa equipe sobre a proposta {{2}} que enviamos?” | Nome e referência pública da proposta do mesmo caso; sem valores internos ou identificadores sensíveis |
| Lembrete de reunião | “Olá, {{1}}! A Altan Contabilidade lembra que sua reunião está confirmada para {{2}}, às {{3}}. Se precisar ajustar o horário, responda a esta mensagem.” | Nome, data e horário da reunião confirmada; exibir fuso no cadastro/prévia |

Demais corpos serão redigidos conforme a finalidade da tabela. Exemplos de variáveis usarão dados fictícios. Botões propostos: “Continuar atendimento” quando aplicável e “Parar mensagens” para descadastro; payload de resposta identifica finalidade/caso/canal/versão. Clicar em continuar não aceita proposta, concede procuração nem confirma ato fiscal. Alterar horário de reunião requer confirmação própria.

#### Cadastro de consentimento, sem criar empresa fictícia

Criar `ConsentimentoComunicacao` ligado ao vínculo vigente do número e ao interlocutor, pois um lead pode ainda não ter `ContatoWhatsapp` ou `PortalClient`. Campos propostos: finalidade (COMERCIAL/ATENDIMENTO), situação, data, origem, texto/versão apresentados, referência da evidência e revogação com motivo/ator/data. A origem do lead e a origem da autorização são campos diferentes. Guardar somente evidências necessárias, com acesso restrito.

No site/formulário, apresentar opção clara de contato pela Altan no WhatsApp, sem pré-seleção; o recebimento do formulário registra o evento, sem inventar concordância. Uma mensagem recebida permite atender aquele pedido dentro das regras da janela, mas não vira automaticamente autorização permanente para campanhas. Indicação, importação ou telefone público não marcam consentimento por inferência.

Reaproveitar `ContatoWhatsapp.optInEm`/`optInOrigem` como evidência legada no escopo comprovado. Preservar o funcionamento da comunicação já autorizada e não converter consentimento de atendimento em permissão comercial. Número novo/titular novo exige evidência própria. Uma revogação vale para a finalidade na comunicação da Altan, inclusive pelos dois números: não tentar pelo comercial depois de descadastro no principal. Pedido amplo para parar bloqueia contato ativo em ambas as finalidades; nova solicitação de suporte não reativa marketing silenciosamente.

#### Criação, revisão e sincronização

1. Em **Biblioteca → Modelos WhatsApp (Meta)**, cadastrar finalidade, corpo, idioma, variáveis, exemplos fictícios e botões; usar a nova aba da biblioteca já prevista. Separar de mensagens rápidas internas.
2. Revisão interna por responsável autorizado: conferir texto e condições de uso. Salvar versão não submete nem aprova na Meta.
3. Ação explícita **Enviar para análise da Meta**, com conta WABA escolhida, permissão de gestão e reserva persistente antes da rede. Guardar nome, ID retornado, versão, conteúdo exato/hash e categoria solicitada.
4. Consultar/sincronizar status e categoria efetiva. Tratar rejeição, pausa, desativação, exclusão e status desconhecido sem disponibilidade para envio. Não prometer prazo ou aprovação. Mudança material cria versão revisada; alteração de categoria exige nova conferência operacional.
5. Disponibilizar apenas versão aprovada e conferida na conta correta, com finalidade e variáveis compatíveis. Estado interno de revisão e estado do provedor são campos distintos.
6. Se a submissão perder a resposta, reconciliar por nome/conta antes de repetir; nenhuma tentativa automática cega de criação. Mudanças de aprovação/categoria invalidam prévias pendentes.

Modelos são geridos no escopo da WABA, enquanto a mensagem sai por um `phoneNumberId`. Se os dois números estiverem na mesma WABA, consultar os modelos dessa conta e validar a elegibilidade do remetente; não pressupor nova aprovação só pela existência do segundo número. Se forem contas diferentes, manter cadastros e aprovações separados. [Coleção oficial de gestão de modelos](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-f5af1f0d-7bf0-4a27-afee-34fd511f64a0).

#### Funcionamento no chat

- Mostrar **janela aberta até…**, **janela encerrada** ou **sem interação recebida**, calculadas no servidor por canal e vigência do número.
- **Iniciar contato** serve para interessado com autorização registrada; criar a origem comercial pela evidência do formulário/pedido, sem fabricar mensagem recebida para satisfazer uma guarda legada.
- **Retomar conversa** abre modelos elegíveis. Prévia mostra destinatário, número remetente, motivo do contato, modelo/categoria, variáveis e caso. Se faltar requisito, explicar qual; não trocar por texto livre.
- Confirmar envio registra mensagem e recibo antes/depois da rede pelos serviços existentes. Exibir **Aguardando resposta** após aceitação; entrega e leitura não liberam o compositor de texto fora da janela.
- A resposta do contato atualiza a janela daquele canal; retomar o caso preservado e o responsável humano quando houver. Descadastro é processado antes do bot e não vira seleção fiscal/comercial.
- Mensagens rápidas permanecem disponíveis para preparar texto, mas seu envio respeita a janela. Aprovação interna da biblioteca não substitui aprovação de template na Meta.
- Primeira entrega terá envio individual explícito, sem cadência automática. Lembretes internos de acompanhamento podem ser planejados; envio programado ao cliente exige outro lote com frequência, horário, cancelamento e supressão definidos.

#### Encaixe técnico e teste futuro

Evoluir `TemplateWhatsapp`, hoje com chave global e poucos estados, para referência lógica + versões por WABA/nome/idioma, preservando compatibilidade dos modelos de guia. Não migrar tudo como UTILITY por causa do default atual. Reutilizar operações de gestão/transporte de `WhatsappCloudClient`, recibos de `SaidaWhatsappService` e experiência de aprovação de `ComunicadosWhatsappService`; extrair serviço compartilhado de catálogo, sem acoplar conversa individual a campanha.

Adicionar serviços de consentimento, catálogo e contato ativo; guardas de finalidade, acesso do operador, identidade, versão, aprovação e canal tanto na prévia como imediatamente antes da saída. Campos livres não podem virar componentes de template arbitrários. Na API, separar listar/modelar/submeter/sincronizar de preparar/enviar; credenciais permanecem no servidor. A IA não será necessária para criar, escolher ou enviar esses modelos.

Teste obrigatório com provedores substituídos: template enviado sem resposta não abre janela; resposta pelo outro número não abre a janela deste; consentimento ausente/revogado interrompe antes da rede; descadastro cancela pendentes nos dois canais; mudança de titular não herda consentimento; template rejeitado/pausado ou WABA errada bloqueia; categoria/texto alterados invalidam prévia; proposta revogada impede acompanhamento; submissão/envio incertos não duplicam; botão “Continuar” não aceita contrato; nenhuma mensagem recebida fictícia é criada para iniciar um lead. Homologação real e submissão de modelos ficam para execução futura autorizada.

## 7. Interface aprovada e desempenho

Aplicar o desenho aprovado aos componentes React existentes, com tokens e componentes do projeto. O HTML de prévia é referência visual, não fonte a copiar inteira para produção. O padrão de seções e densidade está alinhado com a [barra lateral do Slack](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences) e sua [visualização compacta de mensagens](https://slack.com/help/articles/213893898-Change-how-messages-are-displayed).

- Lista esquerda compacta: 238 px inicial, ajustável entre 210 e 280 px; grupos Clientes, Leads e A identificar. Preferência por usuário; celular mantém lista/conversa alternadas.
- Roxo para Lead, azul para Cliente e neutro para A identificar, sempre com texto/ícone. Cliente com oportunidade recebe selo secundário do pedido; não migra de grupo por isso.
- Cada linha mostra nome confiável ou observado identificado, uma linha de prévia, horário e não lidas. Erros relevantes continuam visíveis, sem empilhar todos os detalhes cadastrais na lista.
- Centro com autor, horário e conteúdo em sequência, reduzindo espaço desperdiçado por balões. Preservar anexos, recibos de envio/entrega/leitura e falhas.
- Cabeçalho mostra pessoa, relacionamento, responsável e canal de resposta. Faixa discreta mostra empresa selecionada pela automação e caso comercial ativo como informações distintas.
- “Abrir empresa” abre diretamente quando há uma; oferece escolha quando há várias. Não filtra o histórico. CNPJ só com números e copiável ao clicar.
- Atendimento/dados/propostas em painel sob demanda; etapa atual e uma ação principal. Detalhes concluídos recolhidos, reabertos para consulta.
- Mensagens rápidas continuam em gaveta à esquerda do chat, com título, descrição, busca, prévia e inserção no rascunho. Preservar recurso, versão, variáveis, caso e etapa até o envio para manter rastreabilidade; só copiar texto perde essa prova. Edição vira adaptação identificada, exige nova prévia e não certifica automaticamente o cumprimento da orientação original. Gerenciar biblioteca abre nova aba e recarrega versões aprovadas ao voltar.
- Notas internas têm modo e cor próprios, CTA “Salvar nota interna” e endpoint separado. Nenhuma nota interna chega ao transportador Meta. `CompanyNote` atual continua na ficha da empresa; não serve como histórico interno universal de leads.

Criar `NotaInternaAtendimento` com interlocutor, autor e escopo explícito de caso ou empresa/segmento. Fixar o escopo ao preparar a nota, incluí-lo na chave do rascunho e revalidá-lo no POST; mudar empresa não pode salvar na B um texto preparado para A. Notas gerais de pessoa exigem acesso ao conjunto abrangido. Operador de carteira parcial não pode receber prévias/contagens de mensagens ou notas de empresas não autorizadas. Texto de nota nunca alimenta automaticamente a resposta ao cliente nem um prompt com possibilidade de exposição.

A listagem passa a consultar o agrupamento por interlocutor **antes** de `limit/cursor`. Busca/filtros globais ficam no servidor, respeitando acesso também nos contadores e trechos de prévia. Buscar pessoa, telefone, empresa, CNPJ e apelido; busca textual em todo o conteúdo das mensagens é um recurso separado, não prometido por esse campo. Deixar de buscar todos os onboardings para cruzar telefone no navegador. Usar consultas em lote e índices; evitar uma consulta por contato. Cursor opaco usa ordem estável, desempate por ID e identificação dos filtros/escopo; atualizações reconciliam páginas sem duplicar interlocutores.

Manter primeiro o polling atual (2,5 s no fio aberto, 10 s na lista, pausa em aba oculta), corrigindo leituras caras, com paginação por cursor, proteção contra resposta obsoleta, atualização após ações e preservação de rascunho/rolagem. Após implementação e medição, foi mantida a leitura completa da página durante o polling: ela inclui alterações de entrega e notas sem nova mensagem. Delta incremental de transporte e SSE ficam para uma otimização posterior, guiada por medição, sem substituir a atualização correta desses eventos. Resultados comparativos no guia de implantação.

Separar leitura de dados e reconhecimento de mensagens vistas: hoje o GET do detalhe também marca leitura. Criar comando de leitura até a última mensagem efetivamente apresentada no fio ativo, sem marcar como lido só porque um polling ocorreu. Rascunho será identificado por interlocutor + canal + modo (mensagem/nota); mudar empresa não o apaga, e chegar mensagem em outro canal não altera seu remetente. Falha de atualização conserva dados anteriores e mostra aviso de desconexão.

Em `api/real/realApi.js` e `api/mock/mockApi.js`, manter contratos equivalentes; componentes não fazem `fetch` próprio. Reaproveitar `Button`, `Modal`, `BotaoCopiar`, `PageShell` e `AppShell`; consolidar CSS conflitante sem outro framework. Testar navegação por teclado, foco ao fechar gavetas, Enter para nova linha, Ctrl/Cmd+Enter com modo explícito, zoom 200% e tela de 360 px. Leitor de tela não deve anunciar todo o histórico em cada atualização.

Metas de validação, não promessas já medidas: uma linha por interlocutor, paginação sem omissões na navegação estável, busca além da página carregada, quantidade de consultas independente do número de linhas; mensagem visível em até um ciclo de polling mais latência. Medir p95 em base sintética representativa e registrar antes/depois.

## 8. Mapa de implementação

| Lote | Arquivos/áreas principais | Entrega e critério de conclusão |
| --- | --- | --- |
| 0 — Contrato e cenários | Novo contrato de DTO e fixtures; docs deste plano | Matriz de identificação, solicitações e acesso aprovada nos testes antes de alterar atendimento |
| 1 — Identidade e projeção | Prisma/migration; `vinculoTelefone`, `ContatoWhatsappService`; novos `IdentidadeComunicacaoService` e `ClassificacaoAtendimentoService` | Vínculo temporal, projeção com motivo, revisão humana e invalidação; cliente sem portal e ambiguidade cobertos |
| 2 — Caso e coleta comercial | `LeadService`, `JornadaLeadService`, `FiscalLeadService`, `politicaComercialWhatsapp`, `AssistenteComercialService`, `MenuWhatsappService`; rotas comerciais | Cliente pode ter caso comercial; coleta sem IA; transições protegidas no backend; não duplicar onboarding |
| 3 — Proposta e conclusão | `PropostasComerciaisService`, `PropostaComercialPdf`, `EnvioPropostaService`, conversão e `ArquivoConversaoService` | PDF e versão corretos; conclusão conferida; avulso sem recorrência e empresa com ficha/documentos preservados |
| 4 — Lista e design | Rotas `whatsappConversas`/resumo; `renderWhatsappPage`, `conversasTela`, `FioDaConversa`, `ConversaVisual`, `PainelAtendimento`, `AtendimentoComercial`, `FormOnboarding`, hooks e CSS | DTO único, busca/paginação corretas, design aprovado, notas internas isoladas e atualização sem perder rascunho |
| 5 — Múltiplos canais | Parser/webhook, conversas/responsável, cliente Cloud, saída, arquivos, menus, guias, comunicados, propostas e workers | Todas as saídas/callbacks usam canal explícito; janela e confirmações não atravessam canais |
| 6 — Migração e liberação | Backfill verificável, flags, observabilidade e regressão integrada | Identificação comparada em modo de observação, piloto controlado e plano de reversão testado |
| 7 — Templates e contato ativo (futuro) | Seção 6.1; biblioteca/gestão de modelos, consentimento, `TemplateWhatsapp`, Cloud/saída e compositor | Criar/revisar/submeter/sincronizar modelos; iniciar e retomar por envio individual com evidência e canal corretos. Não executar agora |

Contratos de API propostos: estender resumo/listagem com os quatro contextos; consulta de histórico por interlocutor com cursor; comando de conferência de identidade; comandos comerciais por `atendimentoLeadId`; notas internas em rota própria; canais e capacidades para compositor. Preservar rotas antigas por adaptador durante a migração, mas rejeitar operação quando o contexto não for inequívoco. Não aceitar `phoneNumberId`/token arbitrário do navegador.

Contrato de leitura proposto para a implementação, a ser mantido único entre API real, mock e interface:

```js
{
  id: "interlocutor-id",
  revisao: 12,
  identidade: {
    estado: "RECONHECIDA_NO_CADASTRO", // não é autenticação civil
    origemNome: "CADASTRO",
    vinculoNumeroId: "vinculo-id"
  },
  relacionamento: {
    tipo: "CLIENTE", motivo: "CONTATO_ATIVO_CADASTRADO",
    fonte: "CONTATO_WHATSAPP", versao: 4
  },
  solicitacaoComercial: { id: "caso-id", origem: "ABERTURA", etapa: "COLETA" },
  contextoOperacional: { empresaId: "empresa-id", versao: 7, pendente: false },
  atendimento: { modo: "HUMANO", responsavelId: "operador-id" },
  canais: [{ id: "principal", podeResponder: true }],
  empresasParaComunicacao: [], // somente empresas visíveis ao operador
  capacidades: {},            // específicas por ação; revalidadas no comando
  ultimaMensagem: {}, naoLidas: 2
}
```

Organização de código: `classificarRelacionamento(fontes)` e `avaliarTransicaoComercial(evidencias, comando)` são funções puras testáveis; serviços carregam dados e executam comandos transacionais; routers autenticam/validam contratos; React só renderiza projeções/capacidades. O motor de conversa decide próximo passo por essas políticas e não possui implementação paralela das regras de autorização.

No lote 3, definir ficha de serviço avulso sem reutilizar `PortalClient.status=SUSPENSA` como sinônimo de ausência de mensalidade: esse campo controla processamento operacional. Registrar modalidade/serviços contratados separadamente e usar essa habilitação para impedir recorrência/workers/portal automáticos. Criar comando próprio para a ficha avulsa, extraindo somente persistência cadastral e arquivamento reutilizáveis. Não chamar `converter`, `provisionarEmpresa` ou `aplicarPosCriacao` completos nesse caminho: o provisionamento atual exige e-mail do responsável e cria usuário/vínculo de portal, além da carteira. Na conclusão anterior aos dados finais, conservar dossiê e pendência explícita de ficha, sem declarar objetivo concluído. Dados/capital/sócios exigem revisão e documentos obrigatórios seguem o checklist aplicável.

Dependências: 1 antes de 2 e 4; contratos de 2 antes de 3; canal pode ser estruturado em paralelo após 1, porém segundo número só é ativado após 5 e 6. Interface visual pode ser desenvolvida com fixtures enquanto backend evolui. Integrar em PRs pequenos com donos de arquivo; migrations e contrato de API têm um único integrador. Antes de começar, atualizar a base sem sobrescrever alterações de outros agentes.

O lote 7 é backlog explicitamente adiado pelo dono: sua criação de catálogo/consentimento pode aproveitar o canal principal após 1, 2 e 4; uso nos dois números depende de 5 e da homologação. Sua conclusão não é requisito para considerar entregues os lotes anteriores. Campanhas, cadências automáticas e integrações Asaas/DocuSign não são incluídas por consequência desta extensão.

## 9. Migração, observação e reversão

1. Aplicar migration aditiva com tabelas/colunas inicialmente compatíveis. Não apagar segmentos, mensagens, arquivos, consentimentos ou vínculos existentes.
2. Cadastrar apenas o canal principal a partir da configuração atual. Não semear segundo número fictício ou marcar templates como aprovados sem consulta real.
3. Criar vínculos por telefone exato vigente e associar segmentos/contatos. Conflitos, reuso suspeito e casos comerciais duplicados geram relatório para revisão. Não unir por nome, e-mail ou CNPJ.
4. Manter IDs e `providerMessageId`; preservar recibos, versões e todas as referências. Adicionar nova chave única por canal/vínculo/escopo, mantendo compatibilidade com chaves antigas até completar a transição. Replay de webhook antigo continua duplicado.
5. Executar nova classificação em modo de observação: comparar com decisão atual sem mudar respostas. Registrar códigos de motivo e divergências, não conteúdo privado em logs públicos.
6. Migrar escritas para o novo contrato e revalidar jobs pendentes. Jobs sem contexto suficiente vão para revisão; não disparar acumulados por ligar flag.
7. Habilitar classificação/tela, depois coleta comercial por piloto e por último segundo canal. Flags implementadas, desligadas por padrão: `WHATSAPP_IDENTIDADE_V2`, `WHATSAPP_CHAT_V2`, `WHATSAPP_COLETA_COMERCIAL`, `WHATSAPP_MULTICANAL`. Seguir o guia de implantação, incluindo inventário, backfill, auditoria de classificação e pausa dos workers.
8. Reversão desliga novas automações/canais e conserva dados. Depois que houver tráfego multicanal, não voltar a uma versão antiga que misture números: manter leitor compatível e pausar saídas do canal afetado. Correção não pode reenviar jobs indeterminados.

Não fazer backfill de “representante verificado”, assinatura, pagamento ou diagnóstico usando apenas existência de ficheiro. Não criar `CompanyClientUser`, permissões fiscais ou consentimento como efeito de migração/agrupamento.

Indicadores: mensagens sem classificação, razão de encaminhamento humano, conflito de identidade, ações recusadas por versão/canal, tempo até primeira resposta útil, abandono por etapa, repetição de pergunta, atualização da tela e saídas incertas. Custos de IA por atendimento mantêm os controles atuais; nenhuma chamada de modelo é necessária para testar este plano.

## 10. Testes e aceite

Todos os testes automatizados usam dados fictícios, provedores substituídos, relógio controlado e bloqueio de rede externa. Não consumir Anthropic, enviar WhatsApp real, consultar fiscal pago, emitir nota, criar cobrança ou assinar contrato real.

| Nível | Cenários obrigatórios |
| --- | --- |
| Unidade | Matriz de identificação inteira, telefone estrito, campos parciais/“não sei”, precedência de intenção, preços do snapshot, passos aplicáveis à modalidade |
| Contratos/API | Cliente com oportunidade, contato sem portal, assinatura/pagamento separados, chamadas diretas tentando pular etapas, alteração concorrente e idempotência |
| PostgreSQL real descartável | Índices parciais, criação concorrente de caso/vínculo, troca/revogação durante operação, recibos e rollback, migração/replay de dados legados |
| Transporte simulado | Dois números/contas, mensagem e status fora de ordem, janela distinta, mídia por canal, remetente fixo, timeout/aceite sem persistência, sem reenvio automático |
| Conversação | Percursos abaixo com variações de texto, botões antigos, erro ortográfico, anexos e interrupção humana; saída estruturada falsa da IA também validada |
| Interface | Grupos/cores com texto, carteira parcial sem vazamento, busca completa, paginação agrupada, notas privadas, teclado/foco, largura compacta e celular |
| Desempenho | Base sintética com múltiplos segmentos por pessoa; consultas/lista/polling mensuradas; sem recarregar todos os onboardings ou perder rascunho |

Roteiros ponta a ponta:

1. Abertura com contabilidade: frase livre → ficha → revisão → proposta/PDF → aceite → contrato/assinatura → pagamento → execução → cadastro com dados e documentos.
2. Abertura avulsa: mesmo caminho aplicável, sem procurar CNPJ inexistente e sem ativar mensalidade/portal automaticamente.
3. Transferência com procuração já válida: verificação reutilizada, SITFIS simulado, diagnóstico e proposta.
4. Empresa parada sem procuração: orientação, prova posterior, falha temporária e retomada sem duplicidade.
5. Cliente que representa três empresas: guias autorizadas de todas, nova abertura em paralelo ao suporte, troca de empresa por texto, nota com retenção encaminhada ao contador.
6. Cliente sem vínculo de portal: comunicação e liberação de guia pelos contatos ativos; tentativa fiscal sem permissão bloqueada.
7. Cliente diz que mudou o telefone / número reciclado: identificação humana sem vazamento do cadastro/histórico anterior, sem herdar janela de mensagem do titular antigo ou consumir callback antigo na nova vigência.
8. Mesma pessoa fala nos dois números: histórico único na tela, resposta pelo canal correto, duas janelas independentes e uma intervenção humana consistente.
9. Recomeço de abertura para transferência e pedido de segunda empresa: duas fichas preservadas, sem reuso de contrato ou confirmação antiga.
10. Assinatura ou pagamento ausente: chamada direta não conclui a contratação/serviço contra a política aprovada; upload isolado não basta.

Depois de cada lote, revisar a conversa simulada pelo ponto de vista do cliente e do contador. Na revisão multiagente, um agente executa os roteiros, outro tenta trocar contexto/permissões, outro revisa clareza e navegação. Nenhum roteirista controla a expectativa para simplesmente espelhar a implementação.

Base de regressão a ampliar: `verify-commercial-lead-postgres.js`, `checks-jornada-lead.js`, `verify-opening-company-postgres.js`, `verify-whatsapp-multiempresa-postgres.js`; suites de vínculo/menu/assistente comercial, propostas e jornada; na interface, `responsavelEmpresas.test.jsx`, `pollingCorridas.test.jsx`, `resumoEPolling.test.jsx`, `whatsappRedesign.test.jsx` e `historicoLixeira.test.jsx`. Testar também `ChatDaEmpresa`, para que o chat aberto dentro da ficha não volte a separar o histórico por empresa.

Aceite final: nenhum cenário crítico troca empresa/pessoa/canal ou revela informação indevida; fluxos avulso/recorrente terminam no destino correto; duas mensagens ou cliques concorrentes não criam dois casos/envios; contador vê identidade, pedido, canal e contexto selecionado; a conversa continua compreensível quando o cliente sai do menu e escreve livremente. Testes locais e homologação externa são evidências distintas e serão relatadas separadamente.

## 11. Limites e registro desta rodada

Este documento não afirma identificação infalível: telefone conhecido não prova titularidade atual e uma pessoa pode compartilhar o aparelho. A proteção é explicitar a evidência, detectar conflitos e interromper funções sensíveis quando ela não basta.

O planejamento inicial envolveu leitura de código, pesquisa em documentação oficial e revisão multiagente. Após a autorização para executar, os lotes 0–6 foram implementados em worktree isolado, com migration aplicada em banco descartável, testes locais e revisão cruzada. As evidências e limitações estão no guia de implantação; teste local não equivale a ativação em produção ou homologação externa da Meta.

Adendo de templates: a seção 6.1 e o lote 7 incorporam a solicitação de planejar criação e aprovação de modelos. O texto anexado pelo dono foi tratado como referência, confrontado com o código e as fontes oficiais. Essa parte continua sem implementação: nenhum novo modelo, consentimento ou envio foi cadastrado por consequência do anexo.
