# Um responsável, várias empresas no WhatsApp

O telefone identifica o contato; cada pedido tem empresa, conversa e versão fixadas em um recibo. O cliente pode escolher por botão, número da lista atual, razão social, apelido cadastrado ou CNPJ. O pedido inicial é retomado depois da escolha.

## Cadastro e operação

- Cadastrar o mesmo telefone exato e o mesmo usuário do portal em cada empresa que a pessoa atende. O usuário precisa de vínculo ACTIVE e papel válido em cada uma. Permissões de funções continuam no contato de cada empresa; emissão continua dependendo também da liberação fiscal do cadastro.
- Contatos duplicados ou usuários diferentes associados ao mesmo telefone exigem revisão humana. O sistema não identifica a pessoa pela semelhança do nome nem acrescenta dígitos ao número.
- O escritório pode cadastrar até cinco nomes curtos em “Empresa do atendimento”, no chat. Razões sociais e apelidos ambíguos exigem escolha explícita; apelido não concede acesso.
- Para várias empresas, um novo pedido genérico pede a empresa. Durante a coleta, CPF/CNPJ, valor e dados do tomador permanecem no rascunho da emissora. “Emitir pela Alfa para a Beta” escolhe Alfa como emissora.
- Trocar de empresa pausa o rascunho e cancela códigos pendentes. Na volta, o menu informa que há um rascunho: “retomar” continua; “nova emissão” inicia outro. A revisão gera um código novo.
- Após 30 minutos sem interação é necessário escolher novamente. Uma resposta de campo recebida nesse momento só pode retomar a coleta da empresa original. Os rascunhos têm validade própria de 24 horas.
- “Guias de todas” consulta apenas empresas autorizadas, com identificação e falhas separadas. Não prepara nem autoriza emissão em várias empresas.
- Responder citando uma guia/documento usa o identificador da mensagem enviada no mesmo atendimento; texto encaminhado e nome de arquivo não comprovam empresa. Envios programados não alteram a seleção.

## Atendimento do escritório

A caixa agrupa os segmentos pelo responsável, exibe a empresa atual e permite filtrar o histórico. Cada mensagem conserva sua empresa de origem. Quem tem carteira parcial vê apenas os segmentos autorizados; entradas sem empresa e a lista completa do seletor só aparecem quando toda a carteira do grupo é acessível.

“Assumir” pausa a automação do responsável em todos os segmentos. A resposta humana exige seleção atual e reconfere vínculo, versão, janela e reserva antes de enviar. “Devolver” invalida o contexto anterior; uma mensagem nova inicia a seleção. Histórico não é transferido entre empresas.

## Persistência e concorrência

A migração `20260910120000_whatsapp_responsavel_empresas` é aditiva. `AtendimentoResponsavelWhatsapp` guarda a sessão; `ResolucaoContextoWhatsapp` mantém um recibo por entrada. A mensagem original do provedor permanece imutável, inclusive quando chegou sem empresa. O texto efetivo e seu tipo podem retomar o pedido guardado, sem criar outra mensagem do provedor.

Menu, coleta e worker compartilham a reserva `responsavel:<id>`. Jobs e ações carregam empresa/versão, e as guardas são refeitas antes de leituras, preparo, reserva fiscal e saída. Mudanças humanas incrementam a versão; novas entradas do responsável também bloqueiam uma confirmação antiga. O resultado de um executor já iniciado permanece na empresa original, inclusive quando o contexto muda durante a execução. Resultado incerto nunca provoca repetição automática.

A instalação atende um número empresarial configurado. Eventos que informem outro `phone_number_id` são recusados; o canal persistido é `principal`. Adicionar outro número empresarial exige configurar outro canal e segmentar suas chaves antes de recebê-lo.

## Publicação e validação

O seletor segue `INTEGRACAO_WHATSAPP_MENU`, `IA_EMPRESAS_PILOTO` e `WHATSAPP_MENU_TELEFONES_PILOTO`. Não amplia pilotos ou permissões. Uma empresa autorizada ainda fora do piloto é encaminhada explicitamente à equipe. Cadastro conhecido sem acesso não entra no fluxo comercial.

Publicar API/migração e interface na mesma entrega. Não transportar documentos comerciais, dados de contatos ou conversas reais para o repositório. O vínculo de um responsável real deve ser conferido antes do piloto; migração não cadastra pessoas nem concede acesso.

Os testes Jest cobrem seleção, identidade, acesso, expiração, retomada, lease, confirmação, guias agregadas e isolamento da interface. O workflow `whatsapp-confirmacao-postgres.yml` aplica o histórico completo no PostgreSQL 16 descartável e executa `verify-whatsapp-multiempresa-postgres.js`, incluindo payload Meta → seleção → coleta → confirmação, transações, concorrência, reinício e escopo do escritório. O script bloqueia rede externa e usa transportes/executores sintéticos; não consome tokens de modelo nem pratica atos fiscais reais.
