# Altan — especificação de revisão do produto

Versão 1.0 · 16/10/2026 · Entrega documental editável.

## Objetivo

Organizar o trabalho do Codex para corrigir a integração operacional e revisar todas as telas do escritório, preservando a identidade dark, a densidade útil das tabelas e os componentes existentes. O produto deve permitir identificar o que falta, por que falta e qual ação resolve, sem depender de legendas extensas ou marcações manuais redundantes.

Este pacote especifica trabalho futuro. Não afirma que as telas foram alteradas, que os fluxos foram homologados ou que regras tributárias foram validadas. Nenhum envio, transmissão, consulta fiscal, migração ou implantação faz parte desta entrega.

## Ordem de leitura

1. [Regras operacionais e fluxo integrado](REGRAS_OPERACIONAIS.md).
2. [Design system](DESIGN_SYSTEM.md) e [regras de UX](UX_RULES.md).
3. [Plano de revisão de todas as telas](PLANO_REVISAO_TELAS.md).
4. [Testes, aceite e revisão visual](TESTES_E_REVISAO_VISUAL.md).
5. [Instruções de execução e fases](INSTRUCOES_CODEX.md).
6. [Referências visuais e limitações](REFERENCIAS_VISUAIS.md).

## Integração com o projeto

Projeto localizado em `C:/Users/yagoa/Documents/ChatGPT/ALTAN`. A árvore de referência operacional é `altan-regras-operacionais`. Este pacote é instalado em `altan-regras-operacionais/docs/revisao-produto-2026-10/`.

A fonte operacional viva permanece `altan-regras-operacionais/REGRAS_OPERACIONAIS.md`, conforme o AGENTS.md do workspace. O arquivo homônimo deste pacote é um complemento de fluxo, com referências R01–R24 e decisões V01–V08; não substitui aquela fonte. A [cópia de referência](REFERENCIA_OPERACIONAL_EXISTENTE.md) é um retrato congelado de 16/10/2026 para permitir leitura fora do projeto. Não editar essa cópia como fonte de novas regras. Atualizações devem ocorrer na fonte viva e ser reconciliadas neste pacote.

Também foram consultados `docs/design-review.md`, a orientação de identidade em `CLAUDE.md`, `apps/web/src/styles/tokens.css`, os componentes compartilhados e os scripts dos pacotes web/API. A inspeção de código nesta entrega foi dirigida a essas referências; os diagnósticos herdados da fonte operacional não equivalem a nova reprodução dos defeitos.

## Convenções de evidência

- **Observado:** visível nas dez imagens recuperadas e inspecionadas; não comprova comportamento interativo.
- **Relatado:** problema descrito pelo usuário, ainda sujeito a reprodução.
- **Preservar:** contrato ou decisão já registrada no projeto.
- **Proposto:** solução de produto para futura implementação; decisões fiscais e operacionais pendentes continuam pendentes.
- **Aceite:** resultado verificável exigido da implementação; não significa teste já executado.

Os prints iniciais de Empresas e Operações não foram recuperados entre os dez anexos disponíveis. Essas duas telas estão especificadas com base no relato e na documentação local, com essa limitação explícita. As respostas anteriores do assistente vieram como marcadores de conteúdo, sem texto recuperável; não foram tratadas como decisões aprovadas.

## Impacto deste incremento

Somente documentação: explicita organização visual, integração dos estados, cobertura de telas e testes futuros. Preserva R01–R24, não aprova V01–V08 e não altera as regras do calendário. As imagens são referências internas com dados empresariais; não devem ser publicadas como demonstração ou usadas como dados de testes. Usar dados fictícios nas novas capturas.

## Registro de decisão

| Data | Origem | Decisão / situação | Efeito |
| --- | --- | --- | --- |
| 16/10/2026 | Pedido atual do usuário | Criar documentação de todas as telas; preservar dark e reduzir ruído | Este pacote |
| 16/10/2026 | Fonte operacional existente | R01–R24 e propostas V01–V08 preservadas | Sem mudança de política |
| 16/10/2026 | Inspeção de dez anexos | Registrar problemas visuais e rastrear referências | Não atribuir defeitos de backend a prints |

Antes de cada implementação, conferir a versão viva das regras, o checkout ativo e alterações de outros chats. A existência desta documentação não autoriza sobrescrever trabalho concorrente.
