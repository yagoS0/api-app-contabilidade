# Revisão do diálogo comercial — 20/09/2026

## Evidência e escopo

A revisão começou reproduzindo entradas sintéticas nas funções existentes, sem banco de produção, chamadas de IA ou mensagens reais. Encontramos intenções comerciais comuns sem reconhecimento, negação interpretada como contratação mensal, retomadas gravadas como nome, respostas naturais recusadas e uma resposta genérica de preços para qualquer pergunta com `?`. A saudação com ficha antiga já estava corrigida; esta revisão cobre também os turnos seguintes.

O parser determinístico foi separado em `apps/api/src/application/onboarding/interpretacaoComercialWhatsapp.js`. Ele interpreta dados declarados, sem atribuir acesso fiscal, escolher regime tributário ou confirmar preço. O coletor continua sendo responsável por guardar evidências, respeitar atendimento humano, revalidar identidade/canal, consultar dados públicos e encaminhar à equipe.

## Referências consultadas

- **Desenho de conversa — Google:** aproveitar informações oferecidas juntas, manter contexto e tratar agradecimentos como atos de conversa. Aplicação: “Sou Ana, médica, moro em Niterói/RJ” preenche campos separados; “voltei” não vira nome. A documentação é uma referência de linguagem e interação; o produto Conversational Actions foi descontinuado e não está sendo adotado. [Princípios de conversa](https://developers.google.com/assistant/conversation-design/learn-about-conversation).
- **Recuperação de dúvida — Google:** repetir de forma breve e específica; não culpabilizar a pessoa nem insistir indefinidamente. Aplicação: “desde 2022” recebe uma pergunta sobre o mês, sem fabricar janeiro; perguntar documentos não produz uma oferta genérica de preço. [Tratamento de erros](https://developers.google.com/assistant/conversation-design/errors).
- **Saúde — Unimed Fortaleza:** o relatório da própria instituição descreve autosserviços por WhatsApp e acesso humano para demandas específicas. Aplicação à Altan: coleta e consulta pública simples podem ser automáticas; decisões fiscais e dúvidas fora do alcance seguem para o contador com contexto preservado. Trata-se de adaptação do padrão de atendimento, não de reprodução do sistema da Unimed. [Relatório de gestão 2025, Nossas Pessoas](https://www.unimedfortaleza.com.br/relatorio-gestao-2025-nossas-pessoas).
- **Varejo — Twilio:** a documentação de soluções descreve atendimento com contexto e dados do próprio cliente para continuidade e orientação. Aplicação à Altan: não pedir novamente o que já foi informado e distinguir necessidade avulsa de acompanhamento mensal. Não importamos campanhas, dados pessoais nem alegações de resultado. [Atendimento no varejo](https://www.twilio.com/en-us/solutions/retail).

## Casos de aceitação de linguagem

| Situação | Entrada sintética | Comportamento esperado |
| --- | --- | --- |
| Novo lead | “Sou médico e preciso de CNPJ para meu consultório” | Reconhecer abertura, guardar atividade e pedir só dados ausentes. |
| Abertura para faturar | “Quero abrir empresa para emitir notas” | Iniciar abertura; não iniciar emissão fiscal. |
| Serviço negado | “Não quero abrir empresa, já tenho CNPJ” | Não classificar como abertura. Acolher e esclarecer a necessidade. |
| Modalidade | “mensal”, “avulso”, “só o serviço”, “as duas” | Aceitar a escolha no contexto da pergunta de modalidade. |
| Negação mensal | “não quero contabilidade mensal” | Registrar preferência avulsa; não contratar recorrência. |
| Funcionários | “não”, “só eu”, “dois” | No contexto da pergunta, aceitar zero, zero e dois. |
| Resposta incompleta | “sim” à pergunta sobre funcionários | Pedir a quantidade uma vez. |
| Empresa parada | “desde janeiro de 2023” | Registrar 2023-01. |
| Data aproximada | “desde 2022” | Pedir o mês sem inventar precisão. “Não sei” mantém a lacuna para revisão. |
| Data em dois turnos | “desde 2022” → “janeiro” ou “5” | Usar apenas o ano declarado para completar 2022-01 ou 2022-05. |
| Objetivo da parada | “quero fechar”, “quero voltar” | Registrar o objetivo declarado, sem executar baixa ou reativação. |
| Retomada com ficha | “voltei”, “pode continuar”, “já mandei meu nome” | Preservar ficha e retomar a pergunta pendente. |
| Agradecimento/pausa | “obrigado”, “só um momento” | Acolher, manter o estado e não contar erro de entendimento. |
| Dados juntos | “Sou Ana, médica, moro em Niterói/RJ” | Separar nome, atividade e cidade. |
| Contato junto ao nome | “Ana e meu email é ana@example.test” | Guardar nome e email, sem obrigar a repetição. |
| Dúvida durante coleta | “Quais documentos preciso?”, “Qual o prazo?” | Responder à dúvida específica e retomar a pergunta pendente. |
| Informação desconhecida distinta | CNPJ pendente; “não sei meu faturamento” | Não marcar o CNPJ como desconhecido. |
| Reinício | “quero recomeçar” | Encaminhar a organização de nova solicitação preservando a anterior. |

## Contrato do parser e limites

`interpretarColetaComercial` mantém `operacoes`, `desconhecido`, `humano` e `resposta`. Acrescenta `retomada`, `aguardar`, `reinicio` e `respostaSubstituiPergunta`. Os três primeiros sinalizadores não contêm operações cadastrais; `reinicio` expressa uma intenção e não autoriza apagar ficha. `respostaSubstituiPergunta` evita duas perguntas na mesma resposta quando já há uma repergunta específica. FAQ comum mantém a pergunta pendente.

`responderDuvidaComercial(texto, { origem })` pode ser chamado antes de existir ficha: sem origem, explica abertura e empresa existente sem exigir um CNPJ de quem ainda não o possui. Não fornece preços, taxas ou prazos fixos. Procuração já existente deve ser conferida pela equipe; o parser não afirma que há autorização fiscal só porque o lead disse que a concedeu.

`triagem.anoParadaPendente` conserva somente o ano declarado enquanto falta o mês. Não é uma data concluída. O parser aceita mês isolado apenas com esse contexto e pergunta ativa; mês/ano completos prevalecem como correção. Desconhecimento ou avanço para outro campo limpa a pendência; retomada conserva a pergunta específica. Mensagens antigas não alteram esse contexto.

Pedidos operacionais como “faturamento”, “meu faturamento” e “faturamento de agosto” reutilizam o reconhecimento de consulta e não viram nome. A declaração “meu faturamento é 10000” permanece uma informação declarada, sem consultar outra empresa. A intenção futura “abrir empresa para emitir notas” não pode ocultar outro pedido explícito de guia, faturamento ou documentos na mesma mensagem.

Teste de linguagem: `apps/api/src/application/onboarding/__tests__/interpretacaoComercialWhatsapp.test.js`. Esses testes são locais e não provam entrega no WhatsApp nem funcionamento de um provedor externo. A revisão integrada acrescenta testes do coletor, menu, roteamento e jornadas com PostgreSQL; verificar o relatório da execução para o resultado efetivo de cada camada. Casos de linguagem não reconhecida continuam exigindo repregunta curta ou atendimento humano: isto não é compreensão irrestrita de texto livre.
