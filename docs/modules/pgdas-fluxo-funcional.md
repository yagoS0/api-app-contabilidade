# Fluxo funcional PGDAS-D: evidências e recuperação documental

## Escopo e limite de publicação

Base remota confirmada: `c248135c71939bc0a4292bf1b2b17c3407e562b8`. Branch exclusiva `codex/pgdas-fluxo-funcional-20261118`. Implementação autorizada pelo proprietário em 18/11/2026. O PR de migração #302 permanece independente; esta entrega não depende dele e não cria schema ou migração.

**PA 11/2026 e 12/2026 continuam sem despacho real. 2027 permanece bloqueado.** A política B3.3a retorna `mesesPropostos:null`; o ensaio de FS12 usa seleção explicitamente sintética e transporte falso. Não constitui homologação fiscal nem uma apuração liberada em produção. Não há flag HTTP, variável de ambiente ou parâmetro do navegador para contornar o bloqueio.

## Caminhos e responsabilidades

| Caminho | Responsabilidade e efeito |
| --- | --- |
| Apuração → cálculo | Mantém motor, Fator R, anexos e contratos históricos. A preparação FS12 autentica, lê a revisão confirmada, aplica a política e revalida contexto. Ainda não composta no despacho produtivo afetado. |
| Conferência → transmissão | Preserva identidade do cálculo, reserva exclusiva e guardas existentes. Só uma resposta de transmissão identificada produz confirmação local. |
| Transmissão → documentos | A evidência da transmissão sobrevive à indisponibilidade do DAS ou extrato. A recuperação explícita é independente de transmitir. |
| Apuração externa | Marcação manual não é prova. Consulta oficial identificada produz evidência externa sem associar a declaração ao cálculo local. |
| Reabertura → acompanhamento | GET recompõe os fatos persistidos; não consulta provedor nem escreve. Tentativa local incerta continua distinta de declaração localizada externamente. |
| Operações | Preserva os três containers, indicadores, seleção e contratos existentes. Orientação remete à Apuração para consulta documental; não cria transmissão ou cálculo externo artificial. |

Fiscal possui interpretação e prova declaratória. Guias conserva persistência documental; adaptadores reutilizam captura e armazenamento existentes. Contabilidade não recebe novo comando no caminho documental. Comunicação não recebe envio. A aplicação depende de portas específicas; composição liga autorização, leitura, consulta, captura e persistência. Nenhum repositório genérico ou transação aberta durante rede foi introduzido.

O helper legado `pgdasDocumentos.js` conserva sua fachada. A projeção pura de disponibilidade foi extraída sem converter dado ausente ou string vazia em zero comprovado. O verificador continua em diagnose.

## Contratos oficiais confrontados

- [TRANSDECLARACAO11: retorno da declaração mensal](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/entregar_declaracao_mensal_saida/): `idDeclaracao`, data/hora, valores e PDFs quando fornecidos. Simulação não é entrega. Não exigir ecos de PA/CNPJ que não sejam obrigatórios no contrato; rejeitar divergências explícitas e correlacionar ao pedido do servidor.
- [CONSDECLARACAO13: índice por ano/PA](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_por_ano_pa/): índice identifica uma declaração, mas não prova qual cálculo local foi utilizado.
- As lacunas de seleção de meses permanecem conforme `pgdas-2026-b33-protocolo-fs12.md` e a política integrada do B3.3a. Nenhuma resposta foi descoberta usando clientes reais.

## Estados e efeitos

| Evidência | Tratamento |
| --- | --- |
| Simulação com identificador | Simulação concluída; nunca confirmação de transmissão. |
| Transmissão com declaração identificada | Preserva número, PA, CNPJ do pedido e data/protocolo efetivamente retornados no JSON existente. |
| Recusa fiscal identificada | Mantém código e mensagens de validação; não apresenta sucesso. |
| Resposta contraditória, timeout ou falha ao persistir após envio | Resultado incerto; sem redespacho automático. |
| Índice positivo com cálculo local | Não muda o cálculo para transmitido nem fabrica vínculo causal. |
| Índice positivo após timeout | Permite consulta documental; tentativa local continua incerta sem prova causal. |
| Marca externa sem consulta comprovada | “Apuração realizada fora da Altan — verificação pendente”. |
| Documento completo | Disponibilidade independente de pagamento e transmissão. |
| Zero devido comprovado em extrato | `NAO_DEVIDO`, distinto de documento disponível e de falha. |
| PDF, número, valor ou vencimento insuficientes | Pendência; não inventar dado nem gravar como documento comprovado. |

A consulta nova exige uma declaração identificável no índice. Índices com revisões ambíguas permanecem inconclusivos; não escolhe uma revisão por suposição. A identidade é conferida antes de persistir documentos. O novo caminho usa `somenteDocumentos`, preserva pagamentos e não gera provisão ou lançamento. Os caminhos legados de sincronização contábil continuam existentes e não são apresentados como livres de efeitos.

## HTTP, segurança e persistência mínima

- GET `/firm/companies/:companyId/fechamento/:competencia`: preserva os dados anteriores e acrescenta `dados.fluxoPgdas` com transmissão, documentos e pagamento independentes.
- POST no mesmo prefixo `/documentos`: exige `confirmCompetencia`, sessão e política canônica ACCOUNTANT. Recupera documentos, nunca transmite declaração.
- A sessão é passada separadamente do DTO. O vínculo por empresa é revalidado depois do aceite da tarefa assíncrona e antes dos serviços/documentos. Não cria papéis nem muda a política do lote moderno ou a correção #275.
- Tarefas documentais parciais usam `partial:true`; não aparecem como conclusão integral. Repetição da mesma tarefa conserva a deduplicação existente.
- Respostas tardias na interface não atualizam outra empresa/competência. Consulta paga requer confirmação explícita.
- A evidência identificada da transmissão fica em `_portalTransmissao` do snapshot existente. A observação oficial do índice é append-only e idempotente na estrutura existente de registros, separada do cálculo e dos PDFs; identifica empresa, PA, CNPJ, declaração, serviço, ator e momento. Não grava credenciais nem transforma uma consulta em ato fiscal.

## FS12: ensaio integrado, não liberação produtiva

### Continuidade documental e concorrência

Operações registra `CONSULTA_EXTERNA` com o estado original `calculada`/`fechada`, sem transformar o cálculo em transmissão. A continuidade exige a mesma liberação, empresa/CNPJ, competência, identidade e hash do cálculo e dos documentos. Mudanças para reaberta, erro ou transmitindo recusam a continuidade; o lote só aceita a evolução comprovada do número documental, mantendo as demais comparações.

A evidência do índice usa `AppSetting`: a imutabilidade é da operação da aplicação, não uma garantia de custódia por trigger ou contra administradores. `createMany(skipDuplicates:true)` e leitura posterior preservam o primeiro ator/instante em disputa concorrente. O teste usa duas conexões no isolamento padrão, em 12 rodadas; não prova ausência de conflitos em Serializable e não autoriza repetição externa.

### Preparação isolada

`prepararCalculoPgdas` é uma capacidade de leitura/preparação ainda não composta nas rotas. Recebe portas autenticadas para B3.2, seleção, parâmetros e construção. Usa valores da revisão confirmada, não valores substitutos enviados pelo planejamento. Revisa identidade e versão antes de devolver o preparo e sempre informa `autorizaEfeitoFiscal:false`.

O harness de teste confirma FS12 no B3.1, prepara pelo B3.2, injeta seleção sintética, constrói o payload legado, simula transporte e grava snapshot/vínculo na mesma transação local Serializable. Cobre revisão obsoleta, outra empresa, revogação, duas conexões, rollback, replay e reabertura. Não persiste declaração oficial fictícia. O futuro coordenador produtivo e a homologação dos meses não estão liberados por esses testes.

## Validação e revisão

- Referência original extraída de Git, sem modificar a worktree: 41 suítes / 657 testes aprovados, incluindo PostgreSQL 16 descartável.
- Evidências finais, contagens e pareceres ficam no registro de governança desta entrega e na descrição do PR. Não somar suítes sobrepostas.
- CI focal adicionada ao workflow existente do piloto, com PostgreSQL 16, contratos fiscais, preparo FS12 e recuperação documental. Transporte exclusivamente falso.
- Capturas desktop/celular usam componentes React reais, fixtures sintéticas e bloqueio de origens externas; não comprovam homologação do SERPRO.
- Controlador executado em `2026-11-19T00-32-03-997Z-861e740d`: executor relatou implementação parcial e falhas EPERM; principal interrompeu na fase de testes para concluir e revisar as lacunas. Estado do arquivo de execução preservado; interrupção registrada separadamente. **Sem ready_for_human do controlador.**

## Impacto e rollback

Validação local final: API 58 suítes/873 testes, incluindo 98 PostgreSQL 16; interface 44 suítes/509 testes; governança 88; verificador 4. Sem falhas ou testes ignorados nessas execuções. Diagnose: 5023 na base, 5021 na candidata, zero acréscimos. As 12 capturas sintéticas desktop/celular e verificação de teclado estão em `test-evidence/pgdas-fluxo` (artefatos locais não versionados), reproduzíveis pelo script `apps/web/scripts/verify-pgdas-fluxo-layout.mjs`. Não houve ensaio de leitor de tela nesta entrega.

Revisões independentes Fiscal/segurança, UI/arquitetura e Operações/sistema favoráveis no recorte inspecionado. O revisor de Operações também escreveu três testes negativos e a inclusão deles na CI; esses dois arquivos receberam outra revisão independente UI/arquitetura. Nenhum parecer substitui CI hospedada ou decisão humana. Resultados hospedados são registrados na descrição do PR no SHA efetivo.

Implementa os contratos de evidência, isolamento e separação de estados R01/R02/R04–R06/R19/R20/R22; conserva as seções 36/37 sobre FS12 e bloqueios. Não altera regra tributária, cálculo monetário, regime, Fator R, reservas, leases, retenção de resultados incertos, schema ou migração. Corrige a apresentação/conclusão sem prova, conforme pedido explícito do proprietário. A referência operacional compartilhada e os trabalhos anteriores permanecem preservados.

Rollback de código por reversão do commit, com nova validação. Preservar os registros de consulta e snapshots existentes; não limpar evidências nem reabrir uma tentativa incerta. A reversão pode restaurar as limitações legadas de apresentação/prova e precisa de avaliação humana. Não há rollback de banco a executar nesta entrega.

Antes de integrar: revisar o SHA final, todos os workflows, revisões independentes e limitações abaixo. Merge/deploy continuam dependentes de autorização específica. Não reativar Railway.

## Limites remanescentes

- Seleção fiscal de FS12 e 2027 não homologadas; sem despacho real dos períodos bloqueados.
- Sem coordenação durável/custódia completa do futuro B3.3b.2; falha após aceite externo continua incerta, não recebe retry automático.
- Registros legados sem prova causal mantêm origem desconhecida; não há backfill nem atribuição retroativa.
- Reservas incertas, fechamento contábil e política de recuperação continuam podendo impedir recuperação automática. A ação explícita não é bypass.
- Captura legada mantém riscos previamente documentados, inclusive deduplicação e recuperação contábil; esta entrega não reescreve esses mecanismos.
