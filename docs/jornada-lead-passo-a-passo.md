# Jornada guiada do lead — 14/09/2026

## Dados e correção da proposta — 21/09/2026

A etapa reúne nome/e-mail do responsável, modalidade, regime, funcionários, notas recebidas/despesas e consultoria para o cálculo mensal, além do escopo já conferido. Serviços avulsos e taxas são preenchidos conforme o caso. Valores personalizados exigem fonte/justificativa interna antes da geração; não afirmar que todos esses campos são obrigatórios para toda modalidade.

Um rascunho legado com pendência mostra a correção diretamente na etapa e recupera seus valores monetários. O contador informa a justificativa e gera outra versão para revisão. A versão antiga permanece registrada; aprovar, compartilhar e obter o aceite seguem ações separadas. Não preencher justificativa em nome do usuário, não alterar valores aceitos e não registrar aceite apenas porque o contador aprovou o PDF. O teste reproduz a pendência, impede geração sem justificativa e segue por correção → aprovação → link de aceite, sem transporte externo ou IA.

## Conferência manual e recuperação fiscal — 21/09/2026

As integrações ajudam a obter dados; sua indisponibilidade não exige fabricar uma consulta nem impede uma contratação com escopo conferido manualmente. Para transferência ou empresa parada, o contador pode salvar o CNPJ na ficha e registrar a fonte e a evidência da conferência cadastral. A rota existente `POST /firm/comercial/onboardings/:id/jornada/conferencia` aceita `{tipo:"PUBLICA",versao,manual:{fonte,evidencia}}`: fonte de 3 a 300 caracteres e evidência de 10 a 2.000. Apenas admin/contador, mesma ficha ativa e versão atual. Não existe modo manual de marcar um SITFIS como consultado.

O evento `JORNADA_PUBLICA_MANUAL_CONFERIDA` conserva CNPJ, origem, ator, data, versão e evidência. Nenhuma análise `CONCLUIDA` é criada. O GET da jornada devolve `publicaConferencia` com `modo:"MANUAL"` e `publicaConferida:true`. Nova evidência incrementa a versão da ficha; recarregar o painel após salvar. Cliques idênticos conservam o mesmo registro. Troca de CNPJ/origem ou revisão da conferência invalida o diagnóstico correspondente; propostas de versões anteriores ainda não aceitas precisam ser refeitas.

Se não houver consulta fiscal privada, o contador registra `dispensaConsultaPrivada` ao delimitar o diagnóstico (20 a 1.200 caracteres). Essa limitação acompanha a proposta. A apresentação pode ser registrada por meio e evidência quando não houver envio pelo WhatsApp. Assim, o percurso manual é: cadastro conferido → escopo limitado fundamentado → apresentação registrada → proposta e aceite → contrato assinado conferido por arquivo → pagamento conferido → execução/conclusão conforme a modalidade. Nenhuma dessas conferências declara regularidade fiscal, assinatura ou pagamento que não tenham sido verificados.

O snapshot interno da proposta preserva a origem da conferência cadastral. Sua projeção pública/PDF mostra apenas que os dados foram conferidos manualmente e que a consulta automática não foi utilizada; fonte, evidência e identificação do operador ficam internas. Honorários podem ser ajustados com justificativa antes do aceite, respeitando o catálogo e os pisos aplicáveis; cada geração cria uma proposta nova. O contrato usa exatamente a opção e os valores aceitos. Gerar novamente não altera uma minuta já existente; depois do aceite, mudança de preço/escopo requer outra solicitação ou um futuro fluxo de aditivo.

Na consulta fiscal explícita, a prova oficial recente do próprio atendimento pode ser reaproveitada por até cinco minutos, somente com CNPJ, representante, identidade e procurador atual conferidos. Revogação conhecida impede o uso. Consulta interrompida conserva o protocolo do mesmo CNPJ/procurador; ausência de PDF ou falha de armazenamento não conclui a análise. Intervalos conhecidos de consulta viram espera limitada na fila; resultados desconhecidos e limites de consumo nunca são repetidos automaticamente. Sem migration, nova rota ou ampliação dos serviços SERPRO.

O painel **Atendimento**, dentro da conversa do WhatsApp, apresenta a etapa atual, o que falta e a ação correspondente. O mesmo componente atende o detalhe do onboarding. A conversa continua por pessoa; cada solicitação conserva seu onboarding. Nova solicitação/reinício preservam o histórico anterior.

## Percursos

- **Abertura:** nome, atividade, município e endereço → conferência de viabilidade e escopo pelo contador → prévia e envio da devolutiva → avulso, mensal ou comparação de preços → proposta revisada e aceite no link → minuta, PDF assinado e conferência → pagamento conferido manualmente → execução no onboarding.
- **Transferência:** CNPJ e consulta pública → conferência explícita dos dados → orientação de procuração, representante conferido e autorização verificada → consulta fiscal, PDF/tabela e conferência explícita → diagnóstico da transferência/regularização → envio do PDF e serviços necessários → proposta, assinatura e pagamento manual → execução no onboarding.
- **Empresa parada:** as mesmas verificações cadastrais/fiscais, com diagnóstico de regularização e separação de serviços avulsos e contabilidade mensal. Situação cadastral não equivale a regularidade fiscal.

Gerar formulário não conclui coleta; enviar manual não comprova procuração; anexar PDF não confirma assinatura; enviar link de cobrança não comprova pagamento. Cada passagem depende de registros salvos, consultados novamente ao abrir o atendimento. Etapas futuras ficam desabilitadas. Casos com proposta já aceita retomam a assinatura sem afirmar que conferências antigas inexistentes foram realizadas.

## Operação

O contador mantém a decisão sobre diagnóstico, preços, envio e conferências. Textos de orientação vêm da versão aprovada na biblioteca compartilhada. Modelos institucionais, catálogo e contratos precisam estar revisados/aprovados para uso. Formulários alimentam o onboarding existente; dados também podem ser preenchidos durante a conversa. A consulta fiscal privada continua sujeita à configuração e autorização do módulo existente; abrir ou atualizar o painel nunca dispara consulta paga.

DocuSign e criação de cobrança pelo Asaas **não fazem parte desta entrega**. Há assinatura por arquivo, conferência manual do pagamento do contrato específico e opção de compartilhar um link Asaas já criado. Nenhuma cobrança é gerada ou assinatura presumida. A conclusão comercial apenas orienta a execução no onboarding; não cria empresa nem declara o serviço executado.

## Contratos técnicos

- `JornadaLeadService`: eventos `JORNADA_PUBLICA_CONFERIDA`, `JORNADA_SITFIS_CONFERIDA`, `JORNADA_DIAGNOSTICO`; conferências ligadas à análise exata, diagnóstico ligado ao CNPJ, origem, endereço/atividade e análise fiscal. Mudança material exige revisão.
- `GET /firm/comercial/onboardings/:id` inclui `jornada`. POSTs em `/jornada/conferencia`, `/diagnostico`, `/devolutiva`, `/pagamento` exigem admin/contador e escopo. Escritas de análise/diagnóstico verificam a versão e reservam a linha em transação. Pagamento manual exige `ASSINADO_CONFERIDO` da proposta aceita não revogada, associa `contratoId` ao marco existente e é idempotente.
- Devolutiva usa lease e `enviarMensagemRastreada`; PDF e texto têm correlação independente ao diagnóstico. Antes de cada parte, conferir novamente diagnóstico, atendimento ativo, janela, telefone e invalidação. Parte confirmada não é repetida; rejeição explícita permite retomar a parte faltante; resultado incerto bloqueia nova tentativa. `enviado` comprova aceitação pelo transporte, não leitura pelo destinatário.
- `montarJornada` deriva a navegação de evidências salvas. `FluxoComercial` lê resultados a cada 10 segundos, respeita componente desmontado/resposta antiga e não chama IA. Rascunhos locais conservam versão; diagnóstico alterado durante edição pede revisão antes de salvar.
- Mock expõe os novos contratos internos, usa dados fictícios e recusa envio externo/consulta fiscal real. Arquivos temporários de prévia não entram no build publicado.

## Validação

Regressões da API/WhatsApp e interface, testes dos três percursos e rascunhos concorrentes, compilação Vite e conferência no navegador. `checks-jornada-lead.js` é executado pelo verificador comercial em PostgreSQL descartável com HTTP/fetch bloqueados. Exercita CAS, deduplicação concorrente, vínculo de análises, CNPJ/contexto alterado, devolutiva parcial/incerta, janela fechada, encerramento durante envio e pagamento do contrato exato. Nenhum token Anthropic, mensagem real, consulta fiscal paga, assinatura ou cobrança real é utilizado.

Sem migration ou dependência nova. Publicar API e web em conjunto e verificar saúde das duas aplicações.
## Ajustes de 15/09/2026

- A etapa atual fica visível; a lista completa abre em “Ver etapas do atendimento”. Orientações abrem prévia antes do envio e se recolhem ao concluir. Dados, diagnóstico, devolutiva, proposta, contrato e pagamento abrem sob demanda.
- Autorização: preparar orientação (opcional quando já existe procuração), enviar, registrar conferência do representante, confirmar em OK e verificar procuração. Resultado ativo avança para a consulta fiscal. Uma nova confirmação do representante preserva a prova do mesmo CNPJ. A consulta continua dependendo de ação explícita.
- A integração fiscal dos leads precisa estar habilitada na API (`INTEGRACAO_FISCAL_LEADS=1`, com worker ativo). Antes de habilitar em produção, conferir trabalhos pendentes para não disparar consultas antigas inadvertidamente. O painel informa quando a configuração está desligada. `TODOS` em resposta SERPRO ativa e vigente equivale à autorização de SITFIS; resposta sem validade ou revogada não libera nada.
- Proposta: conferir regime, funcionários, notas recebidas/despesas e consultoria; calcular pelo catálogo privado aprovado; informar avulsos/taxas quando aplicáveis; gerar a versão; baixar PDF para revisão; aprovar; enviar PDF com link pessoal de aceite na legenda. Abertura avulsa continua disponível. Orçamento personalizado confirmado acima do piso não fica preso como pendência.
- O PDF apresenta somente o caso do lead, nunca tabela completa, pisos, justificativa interna ou identificação de operadores. CNPJ contém apenas números. Razão social/atividade podem vir da consulta pública salva do mesmo CNPJ. O documento usa o snapshot daquela versão, não os preços atuais da biblioteca. Rascunho tem aviso; versão alterada, revogada ou expirada é recusada. Aceite, assinatura e pagamento continuam separados.
- Rotas de PDF: GET `/firm/comercial/onboardings/:id/propostas/:propostaId/pdf` (gestor autenticado) e GET `/public/proposta/pdf` (Bearer pessoal de proposta válida). Ambas sem cache. O segundo exige exatamente as mesmas verificações do link de aceite.
- Mensagem iniciada pelo escritório: só um template aprovado pela Meta pode iniciar/retomar fora da janela de 24h. Cadastro/aprovação de orientação na biblioteca não substitui aprovação da Meta. Implementar a escolha de modelo com prévia, finalidade/variáveis compatíveis, destinatário autorizado, recibo e bloqueio de repetição incerta; não reutilizar modelo de guia para conteúdo comercial genérico. Referência: https://business.whatsapp.com/policy . A aprovação e a habilitação de novos modelos ainda são uma etapa separada.
- Validação: cenários de procuração `TODOS`, expiração/revogação, concorrência, PDF e projeção pública, versão/escopo de download, passagem das etapas e PostgreSQL com transportes simulados. Nenhuma consulta fiscal paga nem mensagem real durante testes.
