# Revisão do atendimento — 21/09/2026

## Conversa e ações do contador

Recebidas ficam à esquerda em balão neutro mais claro que o fundo; enviadas à direita em azul discreto. O corpo usa 15 px e espaçamento de leitura consistente. A direção continua determinada pelo recibo, não pelo autor ou pela cor. Notas ficam separadas no centro e não são transmitidas ao WhatsApp.

Clique na mensagem ou em seu menu para criar uma nota com o trecho de origem. A gravação exige um dos escopos autorizados pelo servidor, conserva o rascunho em caso de falha e usa chave de idempotência. O compositor começa diretamente pelo campo de texto, com anexos, mensagens rápidas e envio no rodapé. Rascunhos continuam isolados por pessoa e canal.

Biblioteca aprovada oferece **Usar no chat**: leva à central, pede selecionar a conversa se necessário e abre uma prévia com os dados atuais. **Inserir na conversa** prepara texto editável; somente **Responder** envia. Um texto existente nunca é sobrescrito silenciosamente. A gestão da biblioteca abre em outra aba.

## Etapas, propostas e alternativas manuais

A lateral abre em **Ficha**, **Recomeçar** e **Nova solicitação**, com solicitações anteriores próximas. Todas as etapas aparecem acima da ação atual. Ações ficam abertas; alternativas são abas que preservam a edição. Dados capturados vêm depois. Uma proposta recém-gerada aparece imediatamente na aba do resultado, com os dados do orçamento disponíveis em outra aba.

Honorários, serviços e taxas podem ser personalizados antes do aceite com justificativa. O contrato usa o modelo aprovado e os valores aceitos, preservando a opção avulsa ou recorrente. Este lote não implementa aditivo, DocuSign nem criação automática de cobrança Asaas.

Consulta pública indisponível permite conferência manual com CNPJ, fonte e evidência. A impossibilidade de consulta privada permite diagnóstico de escopo limitado, explicitado na apresentação e no PDF. Apresentação em outro meio exige registro de meio/data/evidência e não cria recibo WhatsApp. Campos materiais alterados invalidam o diagnóstico e recuperam o texto anterior somente como rascunho para nova conferência; correções de contato/orçamento não equivalem automaticamente a alteração material.

SITFIS reutiliza a prova oficial recente de procuração do mesmo caso, CNPJ e procurador. Falhas preservam protocolo para acompanhamento; sem PDF armazenado não há conclusão fiscal. Esperas conhecidas respeitam o prazo informado. Nenhuma dessas alternativas inventa uma consulta realizada ou regularidade fiscal.

## Canal e janela

Lead é atendido pelo comercial. O chat informa o destino explícito e não reutiliza a conversa antiga do caso quando aberto fora do chat. Devolutiva, proposta e orientação com caso revalidam canal, vínculo vigente e destinatário no servidor. Cliente com cadastro ativo conserva o canal válido escolhido. Entrada no comercial não abre a janela do principal, e vice-versa.

A janela usa a maior data efetiva de entrada do mesmo número/canal/vigência, considerando o menor instante entre provedor e recebimento. Webhook antigo entregue com atraso não fecha uma janela mais recente. Prévia preparada para outro canal exige cancelamento e novo preparo.

## Validação visual e limites

A interface foi conferida no navegador local em desktop e em 390 × 844: contraste, direção dos balões, Ctrl+B/botão, redimensionamento, ações por etapa, apresentação manual, edição/geração/aprovação da proposta e criação de nota a partir de mensagem. O mock não comprova valores reais de catálogo nem transportes externos. Contratação até ficha e documentos, valores, concorrência e integridade foram exercitados separadamente com serviços reais e PostgreSQL descartável, substituindo somente integrações externas.

Testes não consumiram Anthropic, não enviaram mensagens reais e não efetuaram consultas fiscais pagas. Evidências locais com dados de operação ficam fora do repositório público. A aprovação da compilação e dos checks do commit é requisito para publicação.

Rodada integrada local: 381 testes de interface (377 passaram inicialmente; quatro expectativas antigas foram corrigidas, e as duas suítes afetadas passaram integralmente em 7 testes). API: 584 testes passaram; uma suíte de rotas não carregou pela ausência local de `nfe-danfe-pdf` nas dependências compartilhadas e fica coberta pela instalação limpa da CI. Compilação Vite aprovada. PostgreSQL final: 41 verificações da jornada e 9 de identidade após a correção de canal; consultas omitindo destino resolveram o comercial real e clientes preservaram canal escolhido. Provas adicionais: 7 verificações da alternativa manual até a conclusão, 11 da abertura até ficha/documentos e 6 da janela com mensagens atrasadas. Esses números são execuções distintas e não devem ser somados como casos únicos.

## Contatos e contagens

A lista lateral apresenta nome (ou telefone na ausência de nome), relacionamento e mensagens não lidas. Detalhes de empresa, papel do contato, origem do nome, motivo do caso e prévia da mensagem permanecem fora das linhas da lista.

O botão Contatos e Ctrl+B recolhem/restauram a lista sem desmontar o fio nem descartar o rascunho. A largura fica entre 200 e 380 pixels, ajustável por arrasto, setas/Home/End no separador e controle de largura em Opções; a preferência é armazenada por usuário neste navegador.

Os filtros Todos, Leads e Clientes mostram **mensagens não lidas globais**, e não quantidade de pessoas nem a soma da página carregada. O contrato `/firm/whatsapp/resumo`, com chat V2, fornece `contagensNaoLidas: { TODOS, LEAD, CLIENTE, A_IDENTIFICAR }`. Busca, paginação e filtro local não alteram os totais. Se o resumo estiver indisponível, a interface omite o número e identifica a indisponibilidade. A atualização usa o polling do resumo, a cada 30 segundos enquanto a aba está visível.

Listagem e resumo compartilham a consulta de identidade, carteira e resolução de mensagens. Saídas e entradas já reconhecidas como lidas não são contabilizadas; histórico anterior e lixeira têm totais separados. A prova com carteira vazia identificou um defeito anterior: `NOT IN (NULL)` não excluía recibos neutros de clientes restritos. O conjunto vazio agora é uma subconsulta vazia, conservando a restrição tanto na listagem como no resumo.

Atualizações após criar atendimento, conferir identificação, preparar formulário ou concluir envio da biblioteca usam `atualizarConversa`, reutilizando a recarga guardada do hook. Lista e fio são atualizados independentemente; só o fio ainda selecionado é relido. A conclusão de uma operação em A não reabre A depois que o operador selecionou B. Rascunhos permanecem separados por pessoa/canal e a mensagem pronta não substitui texto existente.

### Validação desta seção

- `listaContatos.test.jsx`: 7 testes passaram (conteúdo, atalhos, restauração, largura, totais globais, indisponibilidade e classificação fresca após criação mesmo com falha da lista).
- `atualizacaoConversaPendente.test.jsx`: 2 testes passaram com promessa pendente em A, troca para B e conclusão preservando B e seu rascunho.
- Em conjunto com `compositorIdentidade.test.jsx` e `usarMensagemBiblioteca.test.jsx`: 26 testes passaram. Não houve envio externo.
- Regressões de vínculo: 20 testes passaram. Identidade da inbox, resumo/polling e histórico/lixeira: outros 13 testes passaram.
- `whatsappConversas.test.js`: 86 testes passaram, incluindo contrato V2, perfil sem acesso e falha que não vira zero. Os 4 testes de resumo foram repetidos após reforçar as verificações dos parâmetros de carteira.
- `verify-whatsapp-contagens-postgres.js`: 9 verificações passaram no PostgreSQL descartável, com transação revertida e HTTP externo bloqueado. Cobrem agrupamento de duas empresas e dois canais, leitura, resolução de contexto, paginação, categorias, carteira parcial/vazia, histórico e lixeira. O script aceita o banco local explicitamente permitido e o banco descartável da CI; foi incluído no job PostgreSQL de `.github/workflows/ci.yml` e não depende de binários Windows.

Essas provas validam componentes, contrato e SQL. Não representam envio pela Meta, consulta fiscal, avaliação de modelo de linguagem ou execução remota da CI. A conferência visual do conjunto é registrada separadamente pelo responsável pela revisão da interface.
