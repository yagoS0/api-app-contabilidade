# Retomada de WhatsApp e uso no telefone — 28/09/2026

O modelo de retomada do principal estava aprovado na Meta, mas o cadastro local permanecia EM_ANALISE sem nome. A versão anterior bloqueava antes de consultar a Meta e recusava tanto o assunto {{1}} quanto o botão Falar com a equipe do modelo real. O comercial usa outra WABA e ainda não tinha o modelo.

## Comportamento

- Retomar conversa consulta explicitamente a WABA do canal. Não consulta pelo polling e não herda aprovação entre números. Nome ausente usa reabrir_conversa; idioma é conferido exatamente. O cache local não autoriza nem bloqueia a retomada moderna.
- A equipe informa o assunto (uma linha, até 120 caracteres), confere o texto completo e envia. Assunto, texto aprovado, categoria, destinatário, vigência e canal participam do hash; a API reconfere a Meta no envio. Formatos não representáveis, mídia, outros parâmetros e botões dinâmicos são recusados.
- O corpo aceita modelo estático ou {{1}} como assunto; o botão aprovado Falar com a equipe usa quick_reply com ID humano já reconhecido pelo webhook. Nunca emitir mensagem livre para contornar janela fechada.
- Se ausente, Solicitar aprovação cadastra apenas o modelo fixo exibido (MARKETING), na conta do canal autorizado. Consulta antes de criar; nome estável evita duplicação após resposta incerta. PENDING, REJECTED, PAUSED, erro técnico e modelo ausente têm estados distintos. Não marca aprovação só pelo retorno de criação. Não cria nova migração nem muda permissões.
- GET /retomar consulta; POST /retomar/previa prepara assunto; POST /retomar/modelo submete; POST /retomar envia somente após intenção idempotente e hash. Rotas exigem contador/admin, carteira e conversa ativa. Configuração não envia mensagem a cliente.
- Mobile reutiliza Modal/Button do projeto, campo de 16px, alvos de 44px, corpo rolável e ações fixas. Não manda o operador para uma página de configurações que só explica a integração. Mudança de pessoa/canal fecha a prévia; falha de atualização elimina a prévia anterior.

## Validação

Testes com Meta, banco e transporte simulados: cache desatualizado, parâmetros, status, idioma, canal, hash adulterado, papéis/carteiras, idempotência, timeout, remontagem, troca de canal e payload quick_reply. Simulação navegável local percorreu assunto → prévia → envio → histórico, mantendo a janela fechada. Inspeção em 320×568 e 390×844, sem rolagem horizontal e com rodapé visível. Nenhum token de IA, consulta fiscal ou mensagem real usada nos testes.

Configuração externa: cache do principal corrigido após GET confirmado APPROVED; mesmo modelo submetido ao comercial, inicialmente PENDING. A aprovação final é exclusivamente da Meta; conferir no canal ao usar. Publicação depende dos checks e validação dos dois serviços.

Referências oficiais:
- https://www.postman.com/meta/whatsapp-business-platform/request/7whkjje/get-template-by-name-default-fields
- https://www.postman.com/meta/whatsapp-business-platform/request/lwtlz1k/send-message-template-interactive

## Simplificação solicitada após uso

O dono rejeitou o modal por excesso de texto. A retomada agora substitui temporariamente o compositor, sem overlay: primeiro assunto e Ver mensagem; depois balão da prévia e Enviar mensagem. A aprovação só aparece em caso de bloqueio. Contexto compacto mantém pessoa e canal; Escape/Fechar voltam ao compositor e conservam o assunto, com foco restituído. Histórico permanece acessível. Preservar preparação no servidor, hash, intenção, pendências e troca de canal. Sem mudança de API ou modelo Meta.
