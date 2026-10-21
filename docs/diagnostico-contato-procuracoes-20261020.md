# Contato comercial e procurações — diagnóstico local de 20/10/2026

Atualização do incremento integrado: o pedido atual e o parecer do Principal informam que o contato Neurogenesis já foi vinculado em produção, anteriormente a esta execução, com autorização por solicitação direta. As pendências de telefone/autorização/vínculo descritas abaixo são históricas e estão superadas por essa informação recebida; o executor não verificou nem alterou produção. Representação e aceite na Receita continuam dependendo de evidência própria. O relatório consolidado [revisao-comercial-procuracoes-20261020.md](revisao-comercial-procuracoes-20261020.md) registra o escopo funcional completo desde `48dc5efa`, seus limites e a validação ainda pendente. Não reduzir o escopo aos documentos escritos por último.

Base informada: `48dc5efa`. Correção delegada, rodada 0, sobre o checkpoint local `317414d74`, não aprovado. O run `37866838` foi interrompido pelo Principal após reprovação independente da suficiência do plano. O diagnóstico da primeira tentativa abaixo é histórico e fica atualizado pela seção final. Árvore inicialmente sem alterações em `git status --short`. Sem produção, banco real, consultas pagas, mensagens, commit ou publicação pelo executor. Referência operacional fornecida integralmente no pedido; hash da fonte canônica e da cópia local conferido: `8a0c578e5cac16376fd0e156c32b2712a2b9e8929936a12f051384363d12b302`.

## Objetivo e achados

Investigar acesso ao contato existente para uma ficha retomada e o motivo de procurações em Revalidar, preservando R02/R19/R20/R22/R31. O relato das 26 empresas e da ficha retomada é contexto recebido do Principal, não reprodução produtiva realizada por este executor.

### Contato

`GET /onboardings/:id/acompanhamento` em `apps/api/src/routes/firm/fluxoComercial.js` retorna a conversa de atendimento não encerrado vinculado à ficha. Não procura nem associa uma pessoa pelo nome ou telefone. `ContatoComercialService.js` exige autorização/evidência, escopo, identidade, canal e ausência de atendimento conflitante; pode reaproveitar atendimento compatível. Não é correto fabricar `conversaId` pela identificação declarada na ficha.

Defeito de percurso comprovado no componente: quando não recebe `conversaId`, AcompanhamentoComercial oferecia somente Iniciar contato e Agendar retorno. A central existente `/comercial/conversas` permite localizar contatos; `AtendimentoComercial.jsx` já oferece conferência de candidatos e vínculo explícito de ficha. Foi adicionado o link Localizar contato, sem pré-seleção, comando de associação ou envio. Abrir a central não garante que a ficha seja candidata elegível. O vínculo concreto continua sendo tarefa autorizada do Principal e sujeito ao servidor.

Iniciar contato também ficava disponível durante a primeira leitura ou após falha sem nenhum estado carregado. Agora aguarda um estado disponível; erro inicial não equivale a ausência de vínculo. A conversa vinculada continua sendo aberta pelo identificador persistido. Nenhuma automação ou consentimento foi reativado.

### Procurações: produtor → persistência → projeção → consumidores

1. `SerproProcurationService.checkCnpjProcuration` valida o retorno de OBTERPROCURACAO41. O resumo contém status, validade e sistemas. Retorno inconclusivo lança erro; não deve ser interpretado como ausência.
2. `checkCompanyProcuration` persiste evidência em `serpro_procuration_status:<portalClientId>`, incluindo CNPJ, procurador, checkedAt, validUntil, systems, payload e sequência. A tentativa tem chave separada `serpro_procuration_attempt:`; erro preserva evidência anterior. Há controle de sequência/transação na persistência.
3. `attachSerproStatusToCompaniesList`, em `apps/api/src/routes/firm/index.js`, lê essas chaves e produz `serproStatus`. `projetarProcuracaoSalva` separa evidência e última tentativa e compara o vínculo com os documentos atuais. O contrato distingue `procurationStatus` do `status` de elegibilidade técnica.
4. `marcadorProcuracao` é compartilhado pela carteira e Consultas. Exige vínculo confirmado, data não futura, idade inferior a 24h e validade para apresentar Ativa. Uma tentativa vinculada em erro/processamento tem precedência. Ausência confirmada recente e vencimento não viram Ativa.
5. `alertasMonitoramento.js` e `pgdasDocumentos.js` são consumidores independentes; poderes PGDAS-D continuam exigidos. O marcador visual não concede esses poderes. Reutilização fiscal também confere identidade, idade e vigência no servidor.

Defeito de explicação comprovado: diversos caminhos retornavam apenas Revalidar sem orientação; o caso de 24h tinha orientação genérica sem causa. Foram acrescentados motivos específicos para vínculo não confirmado, verificação antiga, data de verificação inválida/futura e validade ausente/inválida. Consultas já renderiza a orientação recebida; não precisou mudar seu componente. A carteira conserva a linha compacta, expondo a orientação em título e nome acessível, sem nova legenda ou contador. O título nativo não substitui detalhe visível no celular; Consultas continua sendo o local que mostra o motivo em texto.

Não foi alterada nenhuma condição de classificação, duração de cache, guarda fiscal ou dado persistido. Não foi provado defeito no produtor ou perda de evidência para as 26 empresas. Não se recuperou validade, systems ou vínculo a partir de hipótese. Tal recuperação exigiria evidência confiável da mesma empresa/procurador e análise adicional do Principal, fora dos arquivos atribuídos a esta rodada.

## Validação e limites

Adicionados cenários de regressão para navegação ao contato existente sem mutação, conversa já vinculada, falha inicial de leitura e motivos de revalidação sem completar evidência. Preservados os cenários de validade, janela de 24h, vínculo, tentativa, filtro e resultados fora do filtro.

Comandos tentados:

```text
node scripts/governance/check.mjs plan --base 48dc5efa
npm test --workspace apps/web -- --runInBand --runTestsByPath src/features/comercial/__tests__/AcompanhamentoComercial.test.jsx src/features/fiscal/serpro/lib/__tests__/procuracao.test.js src/features/fiscal/serpro/pages/__tests__/resultadosForaFiltro.test.jsx src/features/companies/list/components/__tests__/tabelaEmpresasLeitura.test.jsx
```

Ambos encerraram com código 1 antes da execução, por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'` no Node v20.20.2. Nenhum teste foi aprovado nesta execução. Não foram ampliadas permissões nem contornado o sandbox. O Principal/controlador deve executar os testes e o levantamento de impacto em seu ambiente autorizado. Validação visual desktop/celular, build e revisão independente permanecem pendentes. Esta rodada não declara aprovação dos revisores.

## Impacto, risco e reversão

Arquivos alterados limitam-se à apresentação web comercial/fiscal/carteira, seus testes e este diagnóstico. Domínios diretamente afetados: commercial, fiscal, operations, web e documentation; comunicação é acessada por navegação existente. Accounting, guides e portal são consumidores transitivos conservadores do mapa, sem código ou contrato alterado. Risco conservador alto pelo contexto fiscal; nenhuma regra de negócio nova e nenhuma decisão V02/V03/V05–V08 resolvida.

Rollback: reverter somente o diff desta rodada nos arquivos atribuídos. Não há migração nem mutação de dados a desfazer. Registro de governança e pareceres ficam a cargo do Principal/controlador: editar esses caminhos foi expressamente excluído do escopo do executor.

## Correção após reprovação do escopo — 20/10/2026

Evidência recebida do Principal em `.altan-governance/evidencias-neurogenesis-procuracoes.txt`: são 38 empresas em Revalidar, não 26. Seis apresentam consulta de 18/10 e validade futura: DLN e Koda até 12/10/2031, GL e Iohanna até 13/10/2031, Erisangela e Fadini até 14/10/2031. O ramo comprovado é ATIVA, vínculo confirmado, validade futura e consulta antiga. As outras 32 não expõem validade; isso não comprova ausência de procuração. Não houve nova consulta externa nem recuperação de dados pelo executor.

Explicar Revalidar era insuficiente. `marcadorProcuracao` agora fornece `rotuloDocumental` separado de `chave`/`rotulo` operacionais para evidência ATIVA com vínculo confirmado, validade futura e checkedAt válido não futuro. A carteira mostra **Procuração ativa até DD/MM/AAAA**, inclusive quando a consulta tem 24 horas ou mais. Nesse caso mantém cor de atenção, orientação no título/nome acessível, classificação `revalidar` e exclusão do filtro `ativa`. Consultas apresenta o mesmo rótulo documental e, quando necessário, Revalidar e o motivo explícito de atualizar antes de operar. Não exibe a linha de última verificação nem duplica a validade já contida no rótulo.

Tentativa vinculada em erro/pendente continua tendo precedência; vínculo não confirmado, validade ausente/inválida/vencida e checkedAt inválido/futuro não recebem rótulo documental ativo. Os demais casos conservam seus estados e motivos, sem preencher validade por hipótese. A projeção não muda dados, consulta, seleção, execução ou autorização. Guardas backend de identidade/24h e poderes PGDAS permanecem sem alteração. Aplicam-se R02/R19/R20/R22; nenhuma regra fiscal nova ou decisão pendente é implementada.

O diff combinado desde `48dc5efa` inclui o acesso anterior Localizar contato e sua proteção durante leitura indisponível, preservados nesta correção. O Principal já confirmou responsável cadastrado para a Neurogenesis, sem atendimento vinculado; telefone e origem da autorização ainda dependem de confirmação do usuário. Não vincular por nome, telefone presumido ou pela mera abertura da central. R31 e controles comerciais/de comunicação permanecem vigentes.

Regressões ajustadas/adicionadas nos três testes atribuídos: limite exato de 24h mantém classificação, com rótulo documental; evidências inconclusivas e tentativas não mostram ativa documental; carteira mostra validade e aviso acessível; Consultas mantém filtro Revalidar, exclui Ativas e não dispara consulta ao renderizar/filtrar. A validade ausente continua com motivo e sem estado fabricado. Testes comerciais anteriores foram incluídos no comando de validação combinado, sem editar seus arquivos.

Validação desta correção: repetidos os dois comandos listados acima. Ambos falharam antes de executar por `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`, Node v20.20.2. Não há testes aprovados pelo executor nesta rodada. `git diff --check` executado sem erro. O controlador deve executar gates reais, testes e revisões independentes sobre `48dc5efa..HEAD` mais working tree; não reaproveitar aprovação inexistente. Validação visual 1440/390 fica com o Principal, conforme atribuição. Build, revisão independente e aprovação técnica permanecem pendentes.

Rollback desta correção: reverter apenas os sete arquivos atribuídos em relação ao checkpoint, preservando o incremento comercial anterior. Não há migração, efeito externo ou alteração de governança/configuração a desfazer.
