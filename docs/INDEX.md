# Documentação da Altan

| Preciso de… | Começar por |
|---|---|
| Entender o produto e seus módulos | [Apresentação do repositório](../README.md) e [mapa por módulo](modules/README.md) |
| Escolher uma worktree ou abrir o projeto no Zed | [Guia do ambiente de desenvolvimento](development/AMBIENTE.md) |
| Decidir como executar ou revisar uma alteração | [Normas de desenvolvimento](#normas-de-desenvolvimento) |
| Conferir uma regra de negócio | [Regras operacionais](#regras-operacionais) |
| Localizar contratos, fontes e procedimentos | [Referências técnicas](#referências-técnicas) |
| Saber por que algo mudou | [Histórico e planos](#histórico-e-planos) |
| Encontrar um documento pelo nome ou pela pasta | [Acervo por classe](#acervo-por-classe) |

## Normas de desenvolvimento

- [Instruções da raiz](../AGENTS.md) e [decisões gerais do repositório](../CLAUDE.md). Para um módulo específico, consulte também suas [instruções de agentes](#instrução-de-agentes) e [decisões de escopo](#decisões-de-escopo).
- [Funcionamento do controlador](governance/README.md), [política de risco e aprovação](governance/POLICY.md), [contrato de revisão](governance/REVIEW-CONTRACT.md) e [dependências entre áreas](governance/DEPENDENCIES.md).
- **Perfis usados pelo controlador.** [Orquestrador](../.codex/agents/altan_orchestrator.toml), [executor](../.codex/agents/altan_implementer.toml) e revisores de [domínio](../.codex/agents/altan_domain_reviewer.toml), [backend](../.codex/agents/altan_backend_reviewer.toml), [dados](../.codex/agents/altan_data_reviewer.toml), [interface](../.codex/agents/altan_ui_reviewer.toml), [experiência de uso](../.codex/agents/altan_ux_reviewer.toml) e [impacto sistêmico](../.codex/agents/altan_system_reviewer.toml).
- **Produto e interface.** [Orientações iniciais](../LEIA_ME_PRIMEIRO.md), [plano mestre](../PLANO_MESTRE_CODEX.md), [sistema de design](../DESIGN_SYSTEM.md), [regras de usabilidade](../UX_RULES.md) e [critérios de revisão visual](design-review.md).
- [Arquitetura da Altan](governance/ARQUITETURA.md) orienta a propriedade dos dados, as dependências entre contextos e camadas e a revisão de novas violações.

## Regras operacionais

- [Regras operacionais versionadas](../REGRAS_OPERACIONAIS.md) e [manifesto da fonte canônica](governance/operational-reference.json). O manifesto identifica a fonte viva e a versão que a cópia do repositório representa.
- [Mapa do sistema pelo fluxo mensal do escritório](mapa-do-sistema.md) e [complemento de jornada da revisão de outubro de 2026](revisao-produto-2026-10/REGRAS_OPERACIONAIS.md). O complemento registra o recorte e as pendências daquela revisão.

## Referências técnicas

- [Rotas da API](api-routes.md), [camada de aplicação](../apps/api/src/application/README.md), [infraestrutura](../apps/api/src/infrastructure/README.md) e [workers](../apps/api/src/workers/README.md).
- [Desenvolvimento em Windows](desenvolvimento-windows.md) e [procedimento de implantação](deploy-digitalocean.md).
- **Emissão fiscal.** [Preenchimento da NFS-e](nfse-preenchimento.md) e [origem e versão dos códigos de tributação nacional](lista-servico-nacional/README.md).

## Histórico e planos

- [Registros de progresso](progress/README.md), [revisão do produto de outubro de 2026](revisao-produto-2026-10/README.md) e [auditoria de governança](governance/AUDIT.md).
- [Pesquisa de Departamento Pessoal](departamento-pessoal-pesquisa.md) e [planos por assunto](#plano-ou-investigação). Para apurar o estado de uma entrega, confira o código, as decisões posteriores e as evidências de validação do período.

## Acervo por classe

Os caminhos são relativos à raiz do repositório. Cada arquivo aparece na classe que melhor descreve sua finalidade; os atalhos acima priorizam as fontes mais consultadas.


### Decisões de escopo

- [CLAUDE.md](../CLAUDE.md)
- [apps/api/CLAUDE.md](../apps/api/CLAUDE.md)
- [apps/api/src/application/accounting/CLAUDE.md](../apps/api/src/application/accounting/CLAUDE.md)
- [apps/api/src/application/accounting/exportacao/CLAUDE.md](../apps/api/src/application/accounting/exportacao/CLAUDE.md)
- [apps/api/src/application/declarados/CLAUDE.md](../apps/api/src/application/declarados/CLAUDE.md)
- [apps/api/src/application/dre/CLAUDE.md](../apps/api/src/application/dre/CLAUDE.md)
- [apps/api/src/application/fiscal/serpro/CLAUDE.md](../apps/api/src/application/fiscal/serpro/CLAUDE.md)
- [apps/api/src/application/fluxo/CLAUDE.md](../apps/api/src/application/fluxo/CLAUDE.md)
- [apps/api/src/application/guides/CLAUDE.md](../apps/api/src/application/guides/CLAUDE.md)
- [apps/api/src/application/nfse/CLAUDE.md](../apps/api/src/application/nfse/CLAUDE.md)
- [apps/api/src/application/nfse/danfse/CLAUDE.md](../apps/api/src/application/nfse/danfse/CLAUDE.md)
- [apps/api/src/application/notas/CLAUDE.md](../apps/api/src/application/notas/CLAUDE.md)
- [apps/api/src/workers/CLAUDE.md](../apps/api/src/workers/CLAUDE.md)
- [apps/pdf-reader/CLAUDE.md](../apps/pdf-reader/CLAUDE.md)
- [apps/portal-cliente-web/CLAUDE.md](../apps/portal-cliente-web/CLAUDE.md)
- [apps/portal-cliente-web/src/features/emitir/CLAUDE.md](../apps/portal-cliente-web/src/features/emitir/CLAUDE.md)
- [apps/portal-cliente-web/src/features/emitir/lib/CLAUDE.md](../apps/portal-cliente-web/src/features/emitir/lib/CLAUDE.md)
- [apps/portal-cliente-web/src/features/fiscal/CLAUDE.md](../apps/portal-cliente-web/src/features/fiscal/CLAUDE.md)
- [apps/portal-cliente-web/src/features/painel/CLAUDE.md](../apps/portal-cliente-web/src/features/painel/CLAUDE.md)
- [apps/web/CLAUDE.md](../apps/web/CLAUDE.md)
- [apps/web/src/features/accounting/CLAUDE.md](../apps/web/src/features/accounting/CLAUDE.md)
- [apps/web/src/features/apuracao-v2/CLAUDE.md](../apps/web/src/features/apuracao-v2/CLAUDE.md)
- [apps/web/src/features/calendario/CLAUDE.md](../apps/web/src/features/calendario/CLAUDE.md)
- [apps/web/src/features/companies/CLAUDE.md](../apps/web/src/features/companies/CLAUDE.md)
- [apps/web/src/features/fiscal/sitfis/CLAUDE.md](../apps/web/src/features/fiscal/sitfis/CLAUDE.md)
- [apps/web/src/features/guides/CLAUDE.md](../apps/web/src/features/guides/CLAUDE.md)
- [apps/web/src/features/notas/CLAUDE.md](../apps/web/src/features/notas/CLAUDE.md)
- [apps/web/src/features/onboarding/CLAUDE.md](../apps/web/src/features/onboarding/CLAUDE.md)
- [apps/web/src/features/planejamento/CLAUDE.md](../apps/web/src/features/planejamento/CLAUDE.md)
- [apps/web/src/features/relatorios/CLAUDE.md](../apps/web/src/features/relatorios/CLAUDE.md)
- [packages/shared/src/nfse/CLAUDE.md](../packages/shared/src/nfse/CLAUDE.md)

### Direção de produto e interface

- [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md)
- [LEIA_ME_PRIMEIRO.md](../LEIA_ME_PRIMEIRO.md)
- [PLANO_MESTRE_CODEX.md](../PLANO_MESTRE_CODEX.md)
- [UX_RULES.md](../UX_RULES.md)
- [docs/design-review.md](design-review.md)
- [docs/plano-mestre.md](plano-mestre.md)
- [docs/revisao-produto-2026-10/AJUSTES_COMERCIAL_CONTABIL_20261020.md](revisao-produto-2026-10/AJUSTES_COMERCIAL_CONTABIL_20261020.md)
- [docs/revisao-produto-2026-10/DESIGN_SYSTEM.md](revisao-produto-2026-10/DESIGN_SYSTEM.md)
- [docs/revisao-produto-2026-10/ENCERRAMENTO_OPORTUNIDADES_20261020.md](revisao-produto-2026-10/ENCERRAMENTO_OPORTUNIDADES_20261020.md)
- [docs/revisao-produto-2026-10/ENTREGA_DEV.md](revisao-produto-2026-10/ENTREGA_DEV.md)
- [docs/revisao-produto-2026-10/IMPLEMENTACAO_DEV.md](revisao-produto-2026-10/IMPLEMENTACAO_DEV.md)
- [docs/revisao-produto-2026-10/INSTRUCOES_CODEX.md](revisao-produto-2026-10/INSTRUCOES_CODEX.md)
- [docs/revisao-produto-2026-10/PAGAMENTO_CLIENTE_CORRECAO_CONTABIL.md](revisao-produto-2026-10/PAGAMENTO_CLIENTE_CORRECAO_CONTABIL.md)
- [docs/revisao-produto-2026-10/PLANO_REVISAO_TELAS.md](revisao-produto-2026-10/PLANO_REVISAO_TELAS.md)
- [docs/revisao-produto-2026-10/README.md](revisao-produto-2026-10/README.md)
- [docs/revisao-produto-2026-10/REFERENCIAS_VISUAIS.md](revisao-produto-2026-10/REFERENCIAS_VISUAIS.md)
- [docs/revisao-produto-2026-10/REFERENCIA_OPERACIONAL_EXISTENTE.md](revisao-produto-2026-10/REFERENCIA_OPERACIONAL_EXISTENTE.md)
- [docs/revisao-produto-2026-10/REGRAS_OPERACIONAIS.md](revisao-produto-2026-10/REGRAS_OPERACIONAIS.md)
- [docs/revisao-produto-2026-10/REVISAO_COMERCIAL_CONTABIL_20261019.md](revisao-produto-2026-10/REVISAO_COMERCIAL_CONTABIL_20261019.md)
- [docs/revisao-produto-2026-10/REVISAO_COMUNICACAO_ROTAS_DEV.md](revisao-produto-2026-10/REVISAO_COMUNICACAO_ROTAS_DEV.md)
- [docs/revisao-produto-2026-10/REVISAO_CONTABIL_DEV.md](revisao-produto-2026-10/REVISAO_CONTABIL_DEV.md)
- [docs/revisao-produto-2026-10/REVISAO_FISCAL_DEV.md](revisao-produto-2026-10/REVISAO_FISCAL_DEV.md)
- [docs/revisao-produto-2026-10/TESTES_E_REVISAO_VISUAL.md](revisao-produto-2026-10/TESTES_E_REVISAO_VISUAL.md)
- [docs/revisao-produto-2026-10/UX_RULES.md](revisao-produto-2026-10/UX_RULES.md)
- [docs/revisao-produto-2026-10/tracking-guias-20261018.md](revisao-produto-2026-10/tracking-guias-20261018.md)
- [docs/revisao-produto-2026-10/validacao-comercial-guias-20261018.md](revisao-produto-2026-10/validacao-comercial-guias-20261018.md)

### Espelho operacional

- [REGRAS_OPERACIONAIS.md](../REGRAS_OPERACIONAIS.md)

### Governança

- [docs/governance/ARQUITETURA.md](governance/ARQUITETURA.md)
- [docs/governance/DEPENDENCIES.md](governance/DEPENDENCIES.md)
- [docs/governance/POLICY.md](governance/POLICY.md)
- [docs/governance/README.md](governance/README.md)
- [docs/governance/REVIEW-CONTRACT.md](governance/REVIEW-CONTRACT.md)
- [docs/governance/test-batches.md](governance/test-batches.md)

### Instrução de agentes

- [AGENTS.md](../AGENTS.md)
- [apps/api/AGENTS.md](../apps/api/AGENTS.md)
- [apps/api/prisma/AGENTS.md](../apps/api/prisma/AGENTS.md)
- [apps/api/src/application/accounting/AGENTS.md](../apps/api/src/application/accounting/AGENTS.md)
- [apps/api/src/application/fiscal/AGENTS.md](../apps/api/src/application/fiscal/AGENTS.md)
- [apps/api/src/application/guides/AGENTS.md](../apps/api/src/application/guides/AGENTS.md)
- [apps/api/src/application/notas/AGENTS.md](../apps/api/src/application/notas/AGENTS.md)
- [apps/api/src/application/onboarding/AGENTS.md](../apps/api/src/application/onboarding/AGENTS.md)
- [apps/api/src/application/whatsapp/AGENTS.md](../apps/api/src/application/whatsapp/AGENTS.md)
- [apps/api/src/routes/AGENTS.md](../apps/api/src/routes/AGENTS.md)
- [apps/api/src/workers/AGENTS.md](../apps/api/src/workers/AGENTS.md)
- [apps/portal-cliente-web/AGENTS.md](../apps/portal-cliente-web/AGENTS.md)
- [apps/web/AGENTS.md](../apps/web/AGENTS.md)
- [apps/web/src/features/accounting/AGENTS.md](../apps/web/src/features/accounting/AGENTS.md)
- [packages/shared/AGENTS.md](../packages/shared/AGENTS.md)

### Plano ou investigação

- [accounting-circular-plan-2026-04-28.md](../accounting-circular-plan-2026-04-28.md)
- [docs/abertura-empresa-simulacao-completa.md](abertura-empresa-simulacao-completa.md)
- [docs/apuracao-plano-integral-2026-10-12.md](apuracao-plano-integral-2026-10-12.md)
- [docs/atendimento-pwa-implantacao-20260925.md](atendimento-pwa-implantacao-20260925.md)
- [docs/comunicacao-identidade-implantacao.md](comunicacao-identidade-implantacao.md)
- [docs/departamento-pessoal-pesquisa.md](departamento-pessoal-pesquisa.md)
- [docs/piloto-openai-leads-20260928.md](piloto-openai-leads-20260928.md)
- [docs/planejamento-analise-mercado-2026-09-15.md](planejamento-analise-mercado-2026-09-15.md)
- [docs/planejamento-automatico-2026-09-16.md](planejamento-automatico-2026-09-16.md)
- [docs/planejamento-estudos-dev-2026-09-16.md](planejamento-estudos-dev-2026-09-16.md)
- [docs/planejamento-evolucao-2026-09-15.md](planejamento-evolucao-2026-09-15.md)
- [docs/planejamento-publicacao-2026-09-16.md](planejamento-publicacao-2026-09-16.md)
- [docs/plano-captura-nfe-emitidas.md](plano-captura-nfe-emitidas.md)
- [docs/plano-comunicacao-identidade-leads-20260916.md](plano-comunicacao-identidade-leads-20260916.md)
- [docs/plano-conformidade-emissao-nfse-2026-10-06.md](plano-conformidade-emissao-nfse-2026-10-06.md)
- [docs/plano-consulta-cnpj-2026-10-13.md](plano-consulta-cnpj-2026-10-13.md)
- [docs/plano-consultas-fisco-facil-rj.md](plano-consultas-fisco-facil-rj.md)
- [docs/plano-emissao-whatsapp-20260925.md](plano-emissao-whatsapp-20260925.md)
- [docs/plano-executavel-central-operacoes-2026-10-15.md](plano-executavel-central-operacoes-2026-10-15.md)
- [docs/plano-nfse-2026-10-05.md](plano-nfse-2026-10-05.md)
- [docs/plano-pendencias-fiscais-2026-10-06.md](plano-pendencias-fiscais-2026-10-06.md)
- [docs/plano-reforma-tributaria-2026-10-10.md](plano-reforma-tributaria-2026-10-10.md)
- [docs/plano-suporte-comercial-2026-10-06.md](plano-suporte-comercial-2026-10-06.md)
- [docs/proposta-contrato-formulario-20260921.md](proposta-contrato-formulario-20260921.md)
- [docs/serpro-pgdasd-plan.md](serpro-pgdasd-plan.md)
- [docs/suporte-gpt-implantacao.md](suporte-gpt-implantacao.md)

### Procedimento técnico

- [docs/auth-rbac-setup.md](auth-rbac-setup.md)
- [docs/contingencia-comercial-20261013.md](contingencia-comercial-20261013.md)
- [docs/development/AMBIENTE.md](development/AMBIENTE.md)
- [docs/deploy-digitalocean.md](deploy-digitalocean.md)
- [docs/desenvolvimento-windows.md](desenvolvimento-windows.md)

### Proveniência e referência técnica

- [apps/api/src/application/tomador/dados/municipios-tom.fonte.md](../apps/api/src/application/tomador/dados/municipios-tom.fonte.md)
- [docs/irpf/README.md](irpf/README.md)
- [docs/lc116/README.md](lc116/README.md)
- [docs/leiaute-efd-contribuicoes/README.md](leiaute-efd-contribuicoes/README.md)
- [docs/leiaute-nfse/README.md](leiaute-nfse/README.md)
- [docs/leiaute-nfse/documentacao-tecnica/README.md](leiaute-nfse/documentacao-tecnica/README.md)
- [docs/leiaute-nfse/documentacao-tecnica/rtc-2026-10-05/README.md](leiaute-nfse/documentacao-tecnica/rtc-2026-10-05/README.md)
- [docs/lista-servico-nacional/README.md](lista-servico-nacional/README.md)
- [docs/reforma-consumo/README.md](reforma-consumo/README.md)
- [docs/retencao-fonte/README.md](retencao-fonte/README.md)

### Referência funcional ou técnica

- [NFEmodulo.md](../NFEmodulo.md)
- [docs/a-lancar-simplificado-20260908.md](a-lancar-simplificado-20260908.md)
- [docs/agenda-fiscal-explicita-2026-09-24.md](agenda-fiscal-explicita-2026-09-24.md)
- [docs/ajustes-lancamentos-tarefas-serpro-20260923.md](ajustes-lancamentos-tarefas-serpro-20260923.md)
- [docs/apuracao-cbs-contrato-2026-10-11.md](apuracao-cbs-contrato-2026-10-11.md)
- [docs/apuracao-ibs-contrato-2026-10-12.md](apuracao-ibs-contrato-2026-10-12.md)
- [docs/atendimento-comercial-configuracoes-20260908.md](atendimento-comercial-configuracoes-20260908.md)
- [docs/atendimento-pwa-api.md](atendimento-pwa-api.md)
- [docs/biblioteca-mensagens-rapidas.md](biblioteca-mensagens-rapidas.md)
- [docs/calendario-dias-uteis-20260929.md](calendario-dias-uteis-20260929.md)
- [docs/calendario-estabilidade-20261018.md](calendario-estabilidade-20261018.md)
- [docs/calendario-remover-legado-20261015.md](calendario-remover-legado-20261015.md)
- [docs/calendario-unificado-20261015.md](calendario-unificado-20261015.md)
- [docs/central-tarefas-20260927.md](central-tarefas-20260927.md)
- [docs/centro-operacoes-notas-20261023.md](centro-operacoes-notas-20261023.md)
- [docs/chat-atendimento-20260921-revisao.md](chat-atendimento-20260921-revisao.md)
- [docs/chat-empresa-20260921.md](chat-empresa-20260921.md)
- [docs/chat-historico-arquivos-20260925.md](chat-historico-arquivos-20260925.md)
- [docs/chat-simples-20260921.md](chat-simples-20260921.md)
- [docs/comercial-coerencia-p0-20261017.md](comercial-coerencia-p0-20261017.md)
- [docs/comercial-contratacao-20261018.md](comercial-contratacao-20261018.md)
- [docs/comunicacao-atendimento-20260914.md](comunicacao-atendimento-20260914.md)
- [docs/conectar-openai.md](conectar-openai.md)
- [docs/configuracoes-credenciais-consumo-2026-10-12.md](configuracoes-credenciais-consumo-2026-10-12.md)
- [docs/conversas-ia-leads-20260928.md](conversas-ia-leads-20260928.md)
- [docs/correcao-consultas-contador-20261013.md](correcao-consultas-contador-20261013.md)
- [docs/diagnostico-contato-procuracoes-20261020.md](diagnostico-contato-procuracoes-20261020.md)
- [docs/documentos-whatsapp-20261014.md](documentos-whatsapp-20261014.md)
- [docs/domains-tls.md](domains-tls.md)
- [docs/dre-fluxo-caixa.md](dre-fluxo-caixa.md)
- [docs/efd-contribuicoes-onde-paramos.md](efd-contribuicoes-onde-paramos.md)
- [docs/fiscal-incidente-e-perfil-2026-09-15.md](fiscal-incidente-e-perfil-2026-09-15.md)
- [docs/fluxo-carteira-2026-10-06.md](fluxo-carteira-2026-10-06.md)
- [docs/fluxo-comercial-leads.md](fluxo-comercial-leads.md)
- [docs/fluxo-emissao-whatsapp-danfse-20261018.md](fluxo-emissao-whatsapp-danfse-20261018.md)
- [docs/fontes-fiscais.md](fontes-fiscais.md)
- [docs/guias-parcelamentos-dp-20261021.md](guias-parcelamentos-dp-20261021.md)
- [docs/guru-conferencia-20261022.md](guru-conferencia-20261022.md)
- [docs/ia-leads-openai-20260927.md](ia-leads-openai-20260927.md)
- [docs/inss-baixa-circular-20260923.md](inss-baixa-circular-20260923.md)
- [docs/jornada-lead-passo-a-passo.md](jornada-lead-passo-a-passo.md)
- [docs/login-email-seguranca-20260924.md](login-email-seguranca-20260924.md)
- [docs/mapa-automacao-empresa-guias-pagamentos-2026-10-15.md](mapa-automacao-empresa-guias-pagamentos-2026-10-15.md)
- [docs/monitoramento-pgdas-procuracoes-2026-10-14.md](monitoramento-pgdas-procuracoes-2026-10-14.md)
- [docs/nfse-historico-regras-municipais-2026-10-10.md](nfse-historico-regras-municipais-2026-10-10.md)
- [docs/nfse-preenchimento.md](nfse-preenchimento.md)
- [docs/nfse-recorrentes.md](nfse-recorrentes.md)
- [docs/operacoes-continuidade-2026-10-15.md](operacoes-continuidade-2026-10-15.md)
- [docs/operacoes-design-20261103.md](operacoes-design-20261103.md)
- [docs/operacoes-execucao-2026-10-15.md](operacoes-execucao-2026-10-15.md)
- [docs/operacoes-modais-20261030.md](operacoes-modais-20261030.md)
- [docs/organizacao-escritorio.md](organizacao-escritorio.md)
- [docs/parcelamento-origens-dev-status.md](parcelamento-origens-dev-status.md)
- [docs/parcelamentos-acompanhamento-2026-09-24.md](parcelamentos-acompanhamento-2026-09-24.md)
- [docs/preatendimento-comercial-curto-20260924.md](preatendimento-comercial-curto-20260924.md)
- [docs/recalculo-sitfis-contabilidade.md](recalculo-sitfis-contabilidade.md)
- [docs/reclassificacao-documento-nao-arrecadatorio-20261022.md](reclassificacao-documento-nao-arrecadatorio-20261022.md)
- [docs/retomada-whatsapp-mobile-20260928.md](retomada-whatsapp-mobile-20260928.md)
- [docs/robustez-nfse-adn.md](robustez-nfse-adn.md)
- [docs/rotinas-r2a-coleta-calculo-20261102.md](rotinas-r2a-coleta-calculo-20261102.md)
- [docs/segregacao-receitas-simples.md](segregacao-receitas-simples.md)
- [docs/whatsapp-central-retomada.md](whatsapp-central-retomada.md)
- [docs/whatsapp-comunicados.md](whatsapp-comunicados.md)
- [docs/whatsapp-conteudo-indisponivel-20260929.md](whatsapp-conteudo-indisponivel-20260929.md)
- [docs/whatsapp-emissao-sem-ia.md](whatsapp-emissao-sem-ia.md)
- [docs/whatsapp-entrega-1.md](whatsapp-entrega-1.md)
- [docs/whatsapp-qualidade-respostas.md](whatsapp-qualidade-respostas.md)
- [docs/whatsapp-recuperacao-e-arquivos.md](whatsapp-recuperacao-e-arquivos.md)
- [docs/whatsapp-responsavel-multiempresa.md](whatsapp-responsavel-multiempresa.md)
- [docs/whatsapp-teste-isolado-20261018.md](whatsapp-teste-isolado-20261018.md)

### Registro de trabalho ou evidência

- [CORRECOES-SERPRO-20260909.md](../CORRECOES-SERPRO-20260909.md)
- [docs/ajustes-leads-validacao-20260923.md](ajustes-leads-validacao-20260923.md)
- [docs/ajustes/2026-09-08-etapa2.md](ajustes/2026-09-08-etapa2.md)
- [docs/ajustes/2026-09-08-fluxo-dre-cliente.md](ajustes/2026-09-08-fluxo-dre-cliente.md)
- [docs/ajustes/2026-09-08-painel-acumulado-automatico.md](ajustes/2026-09-08-painel-acumulado-automatico.md)
- [docs/ajustes/2026-09-08-previsao-imposto-pago.md](ajustes/2026-09-08-previsao-imposto-pago.md)
- [docs/ajustes/2026-09-08.md](ajustes/2026-09-08.md)
- [docs/ajustes/2026-09-10-planejamento-analise-dev.md](ajustes/2026-09-10-planejamento-analise-dev.md)
- [docs/ajustes/2026-09-14-plano-relatorios-laboratorio.md](ajustes/2026-09-14-plano-relatorios-laboratorio.md)
- [docs/ajustes/2026-09-16-dre-meses-fechados.md](ajustes/2026-09-16-dre-meses-fechados.md)
- [docs/ajustes/2026-09-16-portal-cliente-mobile.md](ajustes/2026-09-16-portal-cliente-mobile.md)
- [docs/ajustes/2026-09-16-relatorios-laboratorio-dev.md](ajustes/2026-09-16-relatorios-laboratorio-dev.md)
- [docs/apuracao-cbs-etapa-2-2026-10-11.md](apuracao-cbs-etapa-2-2026-10-11.md)
- [docs/apuracao-consumo-etapas-0-1-2026-10-11.md](apuracao-consumo-etapas-0-1-2026-10-11.md)
- [docs/auditoria-guias-emissao-20261018.md](auditoria-guias-emissao-20261018.md)
- [docs/avaliacao-dialogos-ia-leads-20260928.md](avaliacao-dialogos-ia-leads-20260928.md)
- [docs/avaliacao-real-ia-leads-20260927.md](avaliacao-real-ia-leads-20260927.md)
- [docs/central-operacoes-etapa-1-2026-10-15.md](central-operacoes-etapa-1-2026-10-15.md)
- [docs/fiscal-revisao-2026-09-14.md](fiscal-revisao-2026-09-14.md)
- [docs/governance/ACCEPTANCE-2026-10-16.md](governance/ACCEPTANCE-2026-10-16.md)
- [docs/governance/AUDIT.md](governance/AUDIT.md)
- [docs/governance/REVIEW-2026-10-16.md](governance/REVIEW-2026-10-16.md)
- [docs/homologacao-consulta-cnpj.md](homologacao-consulta-cnpj.md)
- [docs/homologacao-whatsapp-nfse-20261019.md](homologacao-whatsapp-nfse-20261019.md)
- [docs/nfse-correcoes-prioritarias-2026-10-10.md](nfse-correcoes-prioritarias-2026-10-10.md)
- [docs/operacoes-layout-revisao-2026-10-15.md](operacoes-layout-revisao-2026-10-15.md)
- [docs/progress/2026-04-29_17-43-45.md](progress/2026-04-29_17-43-45.md)
- [docs/progress/2026-04-29_22-36-59.md](progress/2026-04-29_22-36-59.md)
- [docs/progress/current.md](progress/current.md)
- [docs/readiness-audit.md](readiness-audit.md)
- [docs/revisao-comercial-procuracoes-20261020.md](revisao-comercial-procuracoes-20261020.md)
- [docs/revisao-comunicacao-cenarios.md](revisao-comunicacao-cenarios.md)
- [docs/revisao-dialogo-leads-referencias.md](revisao-dialogo-leads-referencias.md)
- [docs/revisao-fiscal-2026-09-18.md](revisao-fiscal-2026-09-18.md)
- [docs/revisao-mensagens-onboarding-20261017.md](revisao-mensagens-onboarding-20261017.md)
- [docs/revisao-parcelamento-2026-09-21.md](revisao-parcelamento-2026-09-21.md)
- [docs/revisao-planejamento-notas-2026-09-08.md](revisao-planejamento-notas-2026-09-08.md)
- [docs/serpro-debug-session-2026-04-24.md](serpro-debug-session-2026-04-24.md)
- [docs/validacao-emissao-planejamento-2026-09-07.md](validacao-emissao-planejamento-2026-09-07.md)
- [docs/whatsapp-conversacao-validacao.md](whatsapp-conversacao-validacao.md)

### Índice ou visão geral

- [README.md](../README.md)
- [apps/api/assets/danfse/README.md](../apps/api/assets/danfse/README.md)
- [apps/api/src/application/README.md](../apps/api/src/application/README.md)
- [apps/api/src/application/fiscal/serpro/README.md](../apps/api/src/application/fiscal/serpro/README.md)
- [apps/api/src/infrastructure/README.md](../apps/api/src/infrastructure/README.md)
- [apps/api/src/routes/README.md](../apps/api/src/routes/README.md)
- [apps/api/src/workers/README.md](../apps/api/src/workers/README.md)
- [apps/landing/README.md](../apps/landing/README.md)
- [apps/pdf-reader/README.md](../apps/pdf-reader/README.md)
- [apps/web/README.md](../apps/web/README.md)
- [docs/api-routes.md](api-routes.md)
- [docs/mapa-do-sistema.md](mapa-do-sistema.md)
- [docs/modules/README.md](modules/README.md)
- [docs/progress/README.md](progress/README.md)
- [prototipos/emissor-notas/README.md](../prototipos/emissor-notas/README.md)
