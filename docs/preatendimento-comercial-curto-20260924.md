# Pré-atendimento comercial curto — 24/09/2026

## Regra atual

O WhatsApp acolhe, identifica a necessidade, aproveita informações espontâneas e apresenta um benefício pertinente. O limite da automação é encaminhar ao contador com contexto. Não concluir onboarding, diagnóstico, proposta, contratação ou pagamento automaticamente.

O menu comercial tem Abrir uma empresa, Trocar de contador, Planejamento tributário, Regularizar empresa e Falar com a equipe. Texto livre também inicia o atendimento. ABRIR, CONTADOR, IMPOSTO, MARGEM e DRE são palavras de entrada sem distinção de maiúsculas; no canal principal de um cliente identificado, pedidos operacionais e o atalho para contador permanecem operacionais. A palavra usada não comprova a origem de uma campanha.

## Conversa

- Abertura: nome, atividade e cidade, aproveitando o que já foi informado e o nome conhecido. Sem exigir CNPJ, endereço completo, modalidade, funcionários, faturamento ou documentos.
- Transferência: entender o que deseja melhorar. Conhecido o motivo, chamar o contador. Nome informado fora de ordem não pode virar motivo.
- Regularização: entender o que aconteceu e o que pretende resolver. Não exigir mês/ano exato, procuração ou decidir baixa/reativação para encaminhar.
- Planejamento e gestão: identificar a atividade e o nome, registrar objetivo espontâneo e encaminhar. Não criar ficha fictícia de transferência. Não prometer redução de imposto, agenda confirmada ou preço.
- Desconhecimento, anexo, solicitação de reunião e outra necessidade que precise de análise humana podem antecipar o encaminhamento. No máximo três perguntas de qualificação; pausas/retomadas não consomem esse limite. FAQ não se torna dado cadastral.

Exemplo: “Sou médica e quero abrir uma empresa” → apresentação breve e pergunta do nome → cidade → encaminhamento. “Quero trocar de contador” → o que deseja melhorar → “meu contador só manda guias” → explicar o acompanhamento dos resultados conforme o serviço contratado e chamar o contador. A menção a guias nessa reclamação não é uma consulta operacional.

## Persistência e tela

`atendimentoLead.triagem.preatendimento` armazena intenção, dados essenciais, dados voluntários, palavra de entrada, origem declarada, urgência/preferência quando informadas, último relato, referências das mensagens e estado. Não há pontuação comercial ou campanha automática.

Nas três origens já suportadas, campos espontâneos validados continuam alimentando o rascunho existente. Planejamento/gestão usam o caso comercial sem onboarding. O resumo aparece no atendimento e em solicitações anteriores; uma nova solicitação preserva o histórico. A API não oferece próxima pergunta do questionário completo para um caso de pré-atendimento curto.

Clientes cadastrados continuam CLIENTE, mesmo com oportunidade nova. Pessoas sem vínculo e com intenção confirmada aparecem em LEAD, inclusive em filtros/contagens SQL sem onboarding. Classificação de comunicação nunca concede acesso fiscal ou ao portal.

## Continuação humana e segurança

Consulta pública/fiscal, procuração, preços, propostas e contratos continuam disponíveis nas ferramentas internas. Nenhum desses serviços é acionado automaticamente no pré-atendimento. Catálogo aprovado, modelos privados, pisos e guardas de aceite permanecem os existentes.

Preservar flag/piloto, canal do remetente, vínculo/versão da pessoa, pausa humana, recibos duráveis, versão da ficha/caso, checagem anterior ao envio, reentregas e mensagens atrasadas. A resposta de handoff sai uma vez; mensagens posteriores não religam o bot. O comercial continua sem modelo de IA.

## Validação

Testes puros e de persistência cobrem fala direta, FAQ, nome fora de ordem, modalidade apenas espontânea, CNPJ opcional, três perguntas, pausa, anexo, replay e intervenção humana. A simulação PostgreSQL usa webhook, menu, coletor e transporte rastreado reais com transporte externo substituído e rede bloqueada. Inclui canal comercial, principal piloto, retorno em outro canal, cliente de várias empresas, identidade em revisão e menu antigo. As transações internas de proposta, contrato, arquivo e conclusão avulsa são verificadas separadamente.

A tela foi conferida no navegador com componentes reais e API mock: resumo sem ficha, painel estreito, nova solicitação e histórico anterior. Não usar Anthropic, enviar mensagens reais, consultar fiscal pago, assinar ou cobrar para validar esta alteração.
