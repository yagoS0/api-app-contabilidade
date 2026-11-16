# PGDAS-2026-B3.1 — FS12 manual na Apuração

## Escopo e base

Base: `434ae8405d63cdf314ac594f10902d874c341338` (main confirmada remotamente).
Implementação separada da proposta aprovada no [PR #294](https://github.com/yagoS0/api-app-contabilidade/pull/294).
Branch: `codex/pgdas-fs12-manual-b31-20261116`.
O proprietário autorizou a estrutura aditiva e sua aplicação exclusivamente em desenvolvimento/banco descartável.

O contador informa, confere, confirma e revisa uma série completa na Apuração. A confirmação prova autoria da declaração manual; não certifica a origem externa nem a veracidade da folha. Nada alimenta cálculo, Fator R, transmissão, DP, Guias ou Contabilidade. Bloqueios B2 e a política temporal B1 permanecem. Não existe vínculo com `calculoId` nesta etapa.

## Responsabilidades e contratos

| Camada | Arquivos/capacidade | Responsabilidade |
| --- | --- | --- |
| Apresentação web | FechamentoModal, Fs12DeclaratoriaPanel, fs12Formulario | Entrada local, completude, conferência explícita, revisão/histórico; zero não é ausência |
| HTTP/composição | routes/firm/apuracaoV2.js, composition/fs12DaApuracao.js | Guarda canônica, identidade da sessão/rota, DTO público sem chave idempotente ou hash do comando |
| Fiscal aplicação | confirmarFs12DaApuracao, consultarFs12DaApuracao | Coordenação por operações específicas; confirmação não libera efeitos fiscais |
| Fiscal domínio | serieManualFs12 + política B1 existente | Janela, centavos inteiros seguros, meses exatos/únicos, soma segura |
| Identidade domínio | acessoEmpresaEscritorio, public.js | Política já existente extraída para reúso pelo middleware e releitura transacional; mesmas permissões |
| Infraestrutura | fiscal/infrastructure/prisma/fs12DaApuracao.js | Prisma, locks, hash determinístico, isolamento e retries locais |

Prefixo HTTP: `/firm/companies/:companyId`; nesse contrato legado, o identificador da rota é o PortalClient. Company é resolvida pelo servidor.

| Método/caminho | Entrada | Resultado/efeito |
| --- | --- | --- |
| GET /fechamento/:competencia/fs12 | Contrato B2 existente | Preservado |
| GET /fechamento/:competencia/fs12/confirmacoes | PA na rota; usuário autenticado | Política/contexto B1, revisão vigente, confirmação e histórico desc.; zero escritas, RepeatableRead, no-store |
| POST no mesmo caminho | serie[{mes,valorCentavos}], revisaoEsperada, contextoRevisao, chaveIdempotencia, motivo | Confirmação completa persistida ou replay, HTTP200; autorizaEfeitoFiscal=false |

Autoria, timestamp, empresa real, regime, revisão sequencial e versão da política não vêm do navegador.
Guarda inicial ACCOUNTANT preserva admin global e filtros canônicos. Dentro da transação, usuário e vínculo são relidos; revogação/inatividade impede confirmação.
Erros: 400 identidade/comando inválidos; 401 sem autenticação; 403 política de acesso; 404 empresa não encontrada; 409 contexto, revisão ou idempotência conflitantes; 422 série/contexto fiscal inválidos; 503 falha inesperada sanitizada. A UI não apresenta sucesso em falha.

## Estados visuais

| Estado | Evidência e ação |
| --- | --- |
| Não informada | Nenhum mês digitado; sem total |
| Em preenchimento | Contagem preenchida; sem total enquanto incompleta/inválida |
| Pronta para confirmar | Todos os meses válidos; total exato em centavos; conferência explícita |
| Confirmada | Resposta persistida do servidor; autor, instante, revisão |
| Alterada | Valores locais diferentes ou contexto cadastral alterado; requer nova conferência e motivo |
| Revisão anterior | Histórico imutável, série e substituição identificadas |
| Indisponível/conflito | Orientação para recarregar e aviso de descarte do rascunho; nenhum sucesso fictício |

Troca de empresa/PA remonta o painel e ignora respostas tardias. Uma submissão pendente não pode ser duplicada pelo botão; perda da resposta permite replay da mesma chave e conteúdo. Valores até o inteiro seguro são formatados e reidratados sem perda de centavos com BigInt. Total excedente é recusado.

## Persistência e consistência

Única tabela nova: `apuracao_fs12_revisoes`, migration `20261116000000_add_apuracao_fs12_revisoes`.
Sem backfill de fs12Manual/ConfigMemory/snapshots, rascunhos permanentes, tabela geral de folha, ponteiro vigente ou cálculo associado.

Cada revisão guarda PortalClient, Company, PA, número sequencial, série ordenada JSON em centavos, política, contexto/hash, hash da série/comando, autor FK, instante do banco, idempotência e motivo.
Unicidade por PortalClient+Company+PA+revisão; idempotência por PortalClient+PA+chave. FK restritiva, CHECK de PA/revisão/motivo e triggers validam série/associação e impedem UPDATE/DELETE.
Reassociação do PortalClient não expõe confirmações da Company anterior.

Confirmação usa uma única transação Serializable. Leituras, autorização, contexto, revisão e INSERT compartilham tx. Locks FOR SHARE protegem linhas de identidade/vínculo/cadastro já existentes. Serializable e unicidade resolvem corridas; até três tentativas locais em P2034/P2002, sem transporte.
Mesma chave/conteúdo retorna a confirmação original; chave diferente com revisão vencida conflita. A releitura da autorização permanece mesmo no replay.
O contexto é comparado por hash da representação determinística, incluindo data de abertura e histórico fiscal; não há fallback para regime atual sem prova.
A linha imutável incorpora a auditoria mínima (autor/instante/contexto); não há segunda escrita de auditoria que possa ficar dissociada.

## Validação e evidências

- Referência antes da extração: API128 e web33 testes aprovados.
- Candidata API: 852 aprovados em53 suítes, quatro ignorados (dois testes PostgreSQL condicionais e dois cenários intencionalmente desabilitados da antiga vulnerabilidade #275).
- PostgreSQL16.15 descartável: 26 aprovados, sem skips (14 B3.1 +12 B3); histórico completo de214 migrations aplicado do zero.
- Testes PostgreSQL incluem HTTP/ACL reais com sessão sintética, contexto alterado, replay, duas conexões independentes, rollback após INSERT, triggers de imutabilidade, isolamento e ausência de transporte/escritas contábeis.
- UI focal:50 aprovados em3 suítes. Cobertura de série, revisão, falhas/replay, trocas de contexto, precisão, foco e cálculo recuperado.
- Regressão web Apuração/Apuração-v2/Operações:917 aprovados em76 suítes, sem skips, executados em lotes locais para evitar a execução ampla sem progresso no Windows.
- OperationsConsultas com PostgreSQL real:23 aprovados, incluindo os dois cenários condicionais ignorados na execução API sem banco.
- Governança88; analisador arquitetural5; diagnose5023→5023, zero novas violações.
- Gate de dados aprovado: validação Prisma/migrations e regressões DRE/fluxo de caixa em banco sintético.
- Build web aprovado; aviso de chunks grandes preexistente, sem mudança da configuração.
- CI hospedada: resultado no PR, vinculada ao head final; passo B3.1 acrescentado sem retirar os gates anteriores.

Uma tentativa conjunta de PG usou nome diferente do exigido pela suíte B3 e falhou na proteção de destino antes dos testes B3; foi corrigida criando banco descartável com o nome exigido, sem enfraquecer o guard legado. Tentativas amplas web sem progresso foram interrompidas somente nos processos desta execução; resultados não contabilizados como sucesso.

### Evidência visual

Componentes React reais e tokens existentes, fixtures sintéticas e bloqueio de rede externa. 26 cenários desktop/mobile com zero violações axe, overflow e erros JavaScript; foco de conferência/retorno/sucesso verificado. Não equivale a ensaio com leitor de tela ou dispositivo físico.

| Antes | Depois |
| --- | --- |
| [Desktop](../design/evidencias/pgdas-fs12-b31/antes-desktop.png) | [Conferência desktop](../design/evidencias/pgdas-fs12-b31/depois-desktop-confirmacao.png) |
| [Celular](../design/evidencias/pgdas-fs12-b31/antes-mobile.png) | [Conferência celular](../design/evidencias/pgdas-fs12-b31/depois-mobile-confirmacao.png) |

[Histórico desktop](../design/evidencias/pgdas-fs12-b31/depois-desktop-historico.png), [histórico celular](../design/evidencias/pgdas-fs12-b31/depois-mobile-historico.png), [axe/cenários](../design/evidencias/pgdas-fs12-b31/after.json), [teclado](../design/evidencias/pgdas-fs12-b31/keyboard.json).

## Governança e revisão

Controlador iniciado antes de alterações funcionais; run `2026-11-16T20-41-09-048Z-3b431fdc` terminou **escalated por timeout600s do executor**. Não concluiu os gates nem emitiu ready_for_human. Principal assumiu após liberação dos arquivos, executou testes e solicitou revisões nativas independentes, sem modificar permissões/gates.
Pareceres:
- Fiscal/arquitetura e sistêmico: /root/b31_fiscal, favorável, sem bloqueantes, revisão dos contratos, SQL e evidências.
- Segurança/backend: /root/b31_seguranca, favorável ao código produtivo. Foi autor dos testes PG; esses testes foram executados pelo Principal e examinados por Fiscal.
- UI/UX: /root/b31_ui_revisao_final, independente do autor /root/b31_visual, favorável após código e seis capturas; não reexecutou suites.
CI, revisão humana e aprovação de migração produtiva continuam decisões separadas.

## Aceite, limitações e rollback

Aceite: todos os cenários novos aprovados, zero novas violações, CI final aprovada, confirmação manual recuperável/revisável com autorização e concorrência, nenhum efeito fiscal/contábil, evidências e revisão humana do PR.
A declaração manual não autentica documentos externos. B2 bloqueia o novo cálculo no modal, não todos os caminhos legados da aplicação; este incremento não promete bloqueio global. Homologação de2027, integração do payload e vínculo ao cálculo continuam fora do escopo.

Rollback de código: reverter commits deste incremento, retornando ao B2, mantendo a tabela e todas as revisões já confirmadas. Não executar DROP, apagar confirmações, retroagir migrações ou remover autores. Antes de publicação futura: backup/restauração verificados, compatibilidade aditiva e plano aprovado. A reversão visual não reverte ato fiscal (nenhum é realizado aqui).
Nenhuma migração em produção, merge, deploy, transmissão, limpeza ou reativação Railway foi autorizada/executada.
