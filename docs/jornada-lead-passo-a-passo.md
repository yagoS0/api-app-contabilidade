# Jornada guiada do lead — 14/09/2026

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
