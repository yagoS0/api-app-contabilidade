# Atendimento comercial pelo WhatsApp

Implementação de setembro/2026. Abertura pode ser avulsa ou acompanhada de contabilidade. O interessado responde pela conversa; o formulário interno continua como cadastro estruturado e local de revisão.

## Operação

1. Uma mensagem de número desconhecido, incluído no piloto, cria ou retoma `AtendimentoLead`. A intenção identificada cria o onboarding. Um atendimento ativo por conversa é garantido em transação e por índice parcial. O contador pode conferir uma ficha anterior sugerida pelo telefone e vinculá-la explicitamente. Telefone semelhante não autoriza fusão de cadastros. Fichas antigas sem vínculo devem ser reconciliadas antes de incluir o telefone no piloto.
2. A IA registra declarações em campos permitidos antes de responder, com mensagens de origem e versão. Mensagens consecutivas já recebidas formam um pedido; depois do resultado da função, a IA responde à dúvida em linguagem natural. A próxima pergunta orienta a coleta sem obrigar a recitar o formulário. Preço, aprovação, procuração e assinatura continuam sob as regras do servidor e revisão do contador. Orientações são enviadas na versão aprovada da biblioteca.
3. Com CNPJ, a consulta pública existente é reaproveitada com cache por uma hora e registro da data. Situação cadastral não comprova regularidade fiscal. A instrução de procuração vem da biblioteca aprovada e dos dados institucionais configurados pelo escritório. A declaração “já autorizei” vira aguardando conferência.
4. O contador assume quando solicitado, ao encerrar a coleta inicial, ao precisar de análise/escopo, ou quando faltam recursos aprovados. Assumir a conversa interrompe a resposta automática, inclusive depois de o modelo começar. A opção de devolver à IA segue as guardas de vínculo e janela existentes.
5. Na conversa ou detalhe do onboarding, o contador confere representação e solicita verificação de procuração/SITFIS. São trabalhos persistidos, com autorização e CNPJ rechecados. Um trabalho pago com resultado incerto não é repetido automaticamente. Nunca se cria uma empresa provisória para consultar o lead.
6. “Preparar uma nova proposta” usa o catálogo aprovado. Avulso, mensalidade, regularização e taxas ficam separados. Abertura não possui preço inicial inventado: o contador configura o catálogo ou informa valor e justificativa. Dados insuficientes e pisos violados bloqueiam a aprovação.
7. O contador aprova uma versão e pode enviar pelo WhatsApp ou gerar link pessoal. A saída passa pelo registro durável, respeita a janela, preserva a versão e bloqueia repetição incerta. “Enviado” não significa entregue ou lido. O aceite público fixa opção e versão; mudanças na ficha invalidam ofertas ainda não aceitas.
8. O contrato é preenchido a partir da opção aceita e de um modelo aprovado. Honorários e condições vêm da proposta; o modelo não reescreve cláusulas. Há revisão da minuta, download em PDF, upload do documento assinado e conferência humana explícita. O upload isolado não comprova assinatura.
9. Documentação, pagamento de honorários e análise são conferências independentes e auditáveis. Serviço avulso termina com evidência da entrega, sem empresa na carteira nem mensalidade. Novas propostas recorrentes exigem assinatura conferida antes da conversão pelo provisionamento existente.

## Onde encontrar

- Central WhatsApp: atendimento comercial no painel do interessado; “Mensagens rápidas” no fio, com prévia e envio por versão aprovada.
- Detalhe do onboarding: “Propostas e contratação”, incluindo cadastro coletado, propostas, contrato, assinatura e conferências.
- Biblioteca no mesmo painel: mensagens, preços, dados institucionais e modelos. Criar versão nova preserva o histórico.
- Página pública: `/proposta/publica#token=...`, sem sessão do escritório. A tabela de propostas guarda somente o hash do token. A mensagem enviada conserva o link pessoal no histórico interno do atendimento.

## Publicação e piloto

1. Aplicar a migration aditiva `20260909010000_commercial_lead_flow` depois do histórico atual; gerar Prisma. Publicar web e API juntos: o PATCH interno de onboarding agora exige `versao` e responde 409 a gravação desatualizada.
2. Na biblioteca, iniciar orientações genéricas e conferir preços, escopos e condições. Catálogo e minuta não estão embutidos no código público. Importe a configuração privada com `node apps/api/scripts/import-commercial-resources.mjs --file /privado/recursos.json --actor-id ID_EXISTENTE`: sem `--apply`, somente prévia; com `--apply`, cria rascunhos sem alterar versões existentes. A conta deve ser ativa, do escritório, admin ou contador. O arquivo segue `{ "formatVersion": 1, "resources": [...] }`, com tipo, chave, versão, título, texto e dados de cada recurso. Guarde-o fora do checkout e dos logs. Revise e aprove pela biblioteca; modelos com marcadores pendentes continuam bloqueados. Use modelos próprios para avulso, recorrente e contratação anterior ao CNPJ.
3. Configurar e aprovar CNPJ do procurador e endereço HTTPS das instruções. Revisar o passo a passo oficial usado pelo escritório e publicá-lo como texto versionado ou link aprovado. Não solicitar senha ou código de acesso do cliente.
4. Configurar `COMERCIAL_WEB_URL` com a origem HTTPS da aplicação. Manter as credenciais já exigidas pelos conectores WhatsApp, Anthropic e SERPRO e pela criptografia de documentos. Nenhuma credencial nova está no código.
5. Habilitar `INTEGRACAO_IA_COMERCIAL=1` somente com `IA_COMERCIAL_TELEFONES_PILOTO` preenchido com números de teste autorizados, separados por vírgula e com país/DDD. Lista vazia não responde a ninguém. A integração geral WhatsApp e seu worker precisam estar ativos. O perfil dos clientes existentes continua separado.
6. `INTEGRACAO_FISCAL_LEADS=1` habilita os trabalhos privados de leads. Requer representante conferido, configuração SERPRO e procuração correspondente. A conferência e o início de consulta privada permanecem ações do contador nesta entrega.
7. Guardas adicionais: `IA_COMERCIAL_TETO_CONVERSA_CENTAVOS` (padrão 500 centavos de USD/mês por conversa) e `IA_COMERCIAL_MAX_CHAMADAS_DIA` (25 em 24 horas), além do limite global existente. Desligar os dois flags suspende os respectivos processamentos; preservar histórico e migrations.

## Limites desta entrega

- Integrações externas reais ainda precisam de homologação com um número de teste e uma autorização válida. Testes de banco usam PostgreSQL real descartável; transportes, modelo e integrações fiscais usam substitutos locais. Não houve consulta fiscal paga nem envio real de mensagem.
- Assinatura é conferida manualmente a partir de PDF; não foi integrado provedor de assinatura eletrônica. Pagamento também depende de conferência manual; não há conciliação bancária automática neste fluxo.
- Os textos iniciais de procuração são rascunhos e dependem dos dados e procedimentos aprovados pelo escritório. O contrato-mestre de referência não é tratado como instrumento pronto para uso.
- O modo demonstração usa valores fictícios. Propostas e links comerciais mock vivem na memória da sessão; recarregar a aplicação os reinicia. A API real persiste o histórico.

## Validação reproduzível

Backend: `node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns='fluxoComercial|comercialService|onboarding|turnoIaWhatsapp|processarEventoWhatsapp|guardaIa|whatsappConversas'` em `apps/api`.

Frontend: `node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns='fluxoComercial|comercialPublico|telasOnboarding|onboardingSpec|onboardingZod|conversasTela|FioDaConversa'` em `apps/web`.

PostgreSQL local Windows: `node scripts/run-commercial-postgres.mjs <diretório-de-binários-postgresql>`. O runner cria um cluster próprio em `test-evidence`, aplica o histórico completo e encerra o processo ao final. O teste direto `apps/api/scripts/verify-commercial-lead-postgres.js <url>` recusa banco remoto e usuário diferente de `lead_test`; usar somente banco descartável vazio.

Os 27 cenários de banco cobrem concorrência, importação privada, histórico, conflitos de versão, preços, aceite, PDF, documento/assinatura, avulso sem carteira, troca de CNPJ, envio sem repetição, função seguida de resposta, intervenção humana, vínculo manual e conferências. O teste também executa a fila com Prisma e PostgreSQL reais, com clientes e leads habilitados juntos: verifica a pausa de agrupamento, a seleção dos autorizados antes do limite e a reentrega. Há bloqueio explícito de rede no teste de banco. A regressão integrada local passou 827 testes em 42 suítes de API; os componentes comerciais passaram 29 testes e o importador passou 4 testes de CLI. O build de produção da interface também passou.

A fila resolve primeiro os IDs das conversas comerciais autorizadas e usa `conversaId` no filtro de turnos. `TurnoIaWhatsapp` não declara relação Prisma `conversa`; usar essa relação no filtro impedia também o processamento dos clientes quando o piloto comercial estava ativo. A regressão foi reproduzida antes da correção com o banco real.

A homologação Node 20/Linux no CI e dos serviços reais é distinta da validação local Windows/Node 24. As conversas simuladas não consomem tokens Anthropic e não comprovam, sozinhas, a qualidade do modelo real em produção.
