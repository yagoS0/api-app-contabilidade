# Configuração de emissão e planejamento — 07/09/2026

## Entrega

Editor de perfis fiscais por serviço com 16 campos, criação, edição, desativação e escolha de padrão. Sugestões de NBS terminal e pares cIndOp/cClassTrib usam os catálogos oficiais versionados; o contador confirma o enquadramento. cTribNac fica restrito aos serviços habilitados da empresa. cTribMun permanece informado pelo contador, pois não há catálogo municipal versionado no projeto.

Imunidade e suspensão de exigibilidade são persistidas no perfil e validadas no salvamento e antes da reserva de numeração. Migração aditiva 20260907193000_add_perfil_imunidade_suspensao acrescenta três colunas opcionais com restrições de formato.

Escritório, portal cliente e WhatsApp aceitam valores explícitos de IRRF/previdência, obra por CNO/CEI ou CIB e destinatário nacional diferente do tomador. Os dados aparecem na confirmação e chegam ao XML validado. Não há cálculo por alíquota presumida nem reaproveitamento automático desses dados por operação no portal cliente. WhatsApp continua preparando pendência; o ato depende de confirmação por código.

Perfis são restritos à empresa autenticada. Seleção explícita inválida ou indisponibilidade de consulta bloqueiam emissão. O portal cliente recebe erro real em falha de consulta, e habilitado:false somente com a integração desligada.

Planejamento: perfis de atividade sem padrão e com alíquotas ISS divergentes exigem confirmação do contador, em vez de escolher a primeira atividade.

## Verificação técnica

- Backend: 285 suítes, 5.357 testes exercitados. Duas guardas de importação foram atualizadas para incluir o novo catálogo de configuração (continua reutilizando nbsParaDps); as duas suítes passaram no rerun, 33 testes.
- Escritório: 23 suítes, 459 testes passaram; build Vite aprovado.
- Portal cliente: 10 suítes, 174 testes de emissão, perfil, impostos e dados por operação passaram; build Vite aprovado. Indisponibilidade de perfis bloqueia emissão e permite recarregar.
- Rota de perfis do cliente: 3 suítes, 41 testes passaram.
- Schema Prisma validado; migração revisada por agente independente, sem exclusão de dados.
- Revisão independente identificou exportação incompleta; corrigida com recusa nomeada antes de reservar numeração ou transmitir.
- Builds mantêm avisos existentes de tamanho de bundle e importação estática/dinâmica.

## Publicação e teste fiscal

Publicação em main/Railway autorizada pelo usuário. O início da API executa prisma generate e migrate deploy. Ativação dos perfis exige INTEGRACAO_PERFIL_EMISSAO_NFSE=1. IBS/CBS exige INTEGRACAO_NFSE_IBSCBS=1 e perfil preenchido pelo contador.

Empresa indicada pelo usuário: Klaus Nigro. O próprio usuário fará a emissão real e o cancelamento; a verificação automatizada não transmite notas reais nem inventa tomador, valor ou competência. O sucesso desse teste fiscal precisa ser conferido após a operação do usuário.

## Limites explícitos

Esta entrega não equivale integralmente ao Portal Nacional. Exportação completa (comExt e cenários do Anexo I), identificação estrangeira e alternativas de obra por endereço permanecem pendentes. Exportação é recusada com NFSE_EXPORTACAO_NAO_SUPORTADA, orientando usar o Portal Nacional. Destinatário diferente exige IBS/CBS ativo e configurado. A alíquota efetiva do Simples permanece mensal, sem congelamento no perfil.

## Fontes

- [Documentação atual de produção da NFS-e Nacional](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual): XSD e Anexo I v1.01 de 09/02/2026; Anexo B de 22/01/2026.
- Anexo VIII local: docs/leiaute-nfse/documentacao-tecnica/anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-01-00.xlsx. Catálogo de possibilidades, sem confirmação automática de enquadramento.
- Planejamento: docs/fontes-fiscais.md e tabelas versionadas do módulo; verificação de comportamento do software, sem nova homologação de todos os enquadramentos tributários.
