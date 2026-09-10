# Um responsável, várias empresas no WhatsApp

O telefone identifica o contato; cada pedido tem empresa, conversa e versão fixadas em um recibo. O cliente pode escolher por botão, número da lista atual, razão social, apelido cadastrado ou CNPJ. O pedido inicial é retomado depois da escolha.

## Cadastro e operação

- Cadastrar o mesmo telefone exato e o mesmo usuário do portal em cada empresa que a pessoa atende. O usuário precisa de vínculo ACTIVE e papel válido em cada uma. Permissões de funções continuam no contato de cada empresa; emissão continua dependendo também da liberação fiscal do cadastro.
- Contatos duplicados ou usuários diferentes associados ao mesmo telefone exigem revisão humana. O sistema não identifica a pessoa pela semelhança do nome nem acrescenta dígitos ao número.
- O escritório pode cadastrar até cinco nomes curtos em “Empresa do atendimento”, no chat. Razões sociais e apelidos ambíguos exigem escolha explícita; apelido não concede acesso.
- A empresa escolhida permanece durante a sessão, inclusive em novos pedidos pelo menu ou por texto livre. Sem seleção vigente, com ambiguidade ou ao pedir outra empresa, o sistema confirma o contexto. “Guias do mês” informa o período e não muda a empresa. Durante a coleta, CPF/CNPJ, valor e dados do tomador permanecem no rascunho da emissora. “Emitir pela Alfa para a Beta” escolhe Alfa como emissora.
- Reações ficam no histórico, mas não iniciam atendimento nem invalidam menus. Repetir a mesma lista de empresas durante sua validade preserva os botões já exibidos.
- Botões do menu carregam responsável, empresa e versão da seleção. Um botão de seleção anterior reapresenta o menu da empresa atual sem executar a função antiga nem pausar o rascunho. Sem sessão válida, exige nova escolha; menus anteriores a essa vinculação também exigem confirmação da empresa.
- Trocar de empresa pausa o rascunho e cancela códigos pendentes. Na volta, o menu informa que há um rascunho: “retomar” continua; “nova emissão” inicia outro. A revisão gera um código novo.
- O responsável pode digitar “trocar”, “mudar de empresa”, “trocar de empresa”, “pode mudar a empresa?” ou “outra empresa, por favor”. O seletor mostra as empresas autorizadas, inclusive durante a preparação de uma nota. A interpretação aceita pontuação e pedidos de cortesia sem usar IA; correções como “trocar o valor” continuam no atendimento atual.
- Após 30 minutos sem interação é necessário escolher novamente. Uma resposta de campo recebida nesse momento só pode retomar a coleta da empresa original. Os rascunhos têm validade própria de 24 horas.
- “Guias de todas” consulta apenas empresas autorizadas, com identificação e falhas separadas. Não prepara nem autoriza emissão em várias empresas.
- Responder citando uma guia/documento usa o identificador da mensagem enviada no mesmo atendimento; texto encaminhado e nome de arquivo não comprovam empresa. Envios programados não alteram a seleção.

## Guias e faturamento sem modelo

“Me manda a guia” e o botão “Guias do mês” localizam arquivos liberados com vencimento no mês atual. Uma guia encontrada é enviada diretamente em PDF. Com várias, o cliente escolhe por botão, número ou nome como “INSS”; “todas” envia somente as guias da página apresentada. A lista mostra valor e vencimento, sem exigir tipo e competência como campos de entrada. Pedidos históricos aceitam nomes dos meses, ano e datas como `08/26`. Ausência de arquivos liberados não é apresentada como ausência de imposto a pagar.

As opções são gravadas em `MensagemWhatsapp.contextoConsulta` pela migração aditiva `20260910213000_whatsapp_opcoes_consulta`. Cada lista contém os IDs oferecidos, empresa, versão, mensagem de origem e validade de 30 minutos. Números usam a página realmente apresentada. Botões antigos, troca de empresa e intervenção humana invalidam a seleção; antes de enviar o PDF, o acesso e a liberação do arquivo são reconferidos. Cada PDF do envio múltiplo tem recibo próprio, e resultados incertos não são reenviados automaticamente.

“Qual meu faturamento?”, inclusive o erro “faturamemto”, oferece “Este mês”, “Mês passado” e “Outro mês ou ano”. A resposta informa período, total e quantidade de notas. A consulta usa a mesma população de notas emitidas autorizadas da apuração e agrega todas as notas do período, sem limitar a uma página. Exclui recebidas, canceladas e outras empresas; requer a permissão de leitura de notas. Valor ausente ou falta de registros gera uma explicação, nunca um total inventado. O valor é de notas registradas, não de movimentação bancária. “Faturamento da Alfa” identifica a empresa autorizada indicada; uma pergunta livre pode sair da escolha de período.

“Atualizar guia” apresenta guias vencidas e prepara o pedido com código de confirmação, preservando as travas fiscais existentes. A consulta em si não recalcula nem emite tributos. Respostas do modelo compostas apenas por marcadores, como `[Mensagem alcance]`, são recusadas pelo validador e encaminhadas à equipe, sem nova chamada ao modelo.

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

Os testes Jest cobrem seleção, identidade, acesso, expiração, retomada, lease, confirmação, guias agregadas e isolamento da interface. O workflow `whatsapp-confirmacao-postgres.yml` aplica o histórico completo no PostgreSQL 16 descartável e executa `verify-whatsapp-multiempresa-postgres.js`, incluindo payload Meta → seleção → coleta → confirmação, reações → seleção → menu → guias do mês, transações, concorrência, reinício e escopo do escritório. O script bloqueia rede externa e usa transportes/executores sintéticos; não consome tokens de modelo nem pratica atos fiscais reais.
