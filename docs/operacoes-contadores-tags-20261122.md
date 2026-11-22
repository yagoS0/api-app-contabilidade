# Operações — contador, leitura e tags — 22/11/2026

Base fornecida: `07e24a2bf60d93d49960c170043b77478497ab0b`. Árvore inicialmente limpa. Implementação delimitada, rodada 0; não representa aprovação independente ou autorização de integração.

Referência operacional: fonte canônica `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`, SHA256 conferido `4edbbc7134008570aa1152d34019c467afabd3aa6768dc89c80830ac166f6113`; snapshot integral recebido no pedido. Regras R01, R02, R11, R19, R21, R22. Nenhuma decisão fiscal nova.

## Diagnóstico e alteração

- O cartão Calculado usa `resumirEtapasOperacoes` → `fluxo.apuracao.apurada`. A projeção da carteira inclui evidência legada/externa e transmissão; o filtro da tabela de aprovação exigia `operation.calculation`, que é outra evidência. Agora Calculadas/Não calculadas/A verificar consultam a mesma projeção por competência, antes de busca, ordenação e paginação. Os valores e a conferência continuam dependendo das evidências locais: sem snapshot, a linha informa cálculo local não disponível, sem inventar valores ou habilitar confirmação/transmissão. Não foi inspecionado dado produtivo para comprovar individualmente as oito empresas do relato.
- `lerEnvioDaGuia` usava a quantidade de entregas (incluindo e-mail enviado) no resumo Lida. Leitura agora conta apenas `status=lido`; entrega conta `entregue/lido`. Exemplo: e-mail enviado + WhatsApp lido = `lida (1/2 canais)`, com fatos individuais no título e detalhe. Classificação, polling, falhas, resultado incerto, pagamento e transporte permanecem iguais.
- Tags compartilhadas por Operações têm fundo semântico integral usando tokens existentes; hover conserva o fundo. Disponível/Indisponível saem do texto visível de tags documentais, permanecendo no nome acessível/título. Nome, erro, conferência, envio, leitura, pagamento e recálculo permanecem. Inclui guias da tabela de transmissão e seus controles de recibo/extrato. Modais sem tags documentais não ganharam tags fictícias.

## Contextos, consumidores e compatibilidade

| Contexto | Impacto e evidência esperada |
| --- | --- |
| operations / web | Donos da projeção/filtro e apresentação; regressões de 8/41, legado/transmitida sem snapshot, snapshot presente, 35 calculadas em duas páginas, busca e estados desconhecidos. |
| guides / communication | Donos da evidência de documento/envio. Resumo compartilhado também consumido por `renderCompanyGuidesTable.jsx`; estrutura do retorno, situação, flags e frases individuais preservadas. Testes de leitura por canal e falha/incerteza. |
| accounting | Somente exibição de pagamento preservada; nenhuma baixa, lançamento, fechamento ou API alterados. Teste mantém Paga na tag. |
| commercial / portal | Nenhuma rota, permissão, contrato, dado ou automação alterados; helper modificado é local ao web do escritório. |
| documentation | Este registro contém diagnóstico, limites e encaminhamento; registro formal de governança pertence ao Principal/controlador, fora dos caminhos autorizados ao executor. |

Risco de apresentação médio; helper compartilhado requer revisão de comunicação/guias e revisão sistêmica conforme mapa. Sem escrita operacional, migration, novo evento, alteração de autenticação, payload, regime, cálculo fiscal, guarda, pausa ou agenda. Filtro não concede elegibilidade para comandos. Rollback: reverter somente o diff desta entrega, preservando outros trabalhos; nenhum dado a restaurar.

## Validação real e pendências

- `git diff --check`: executado, sem erro de whitespace; Git informa conversão LF/CRLF normal da árvore.
- `node scripts/governance/check.mjs plan --base 07e24a2bf60d93d49960c170043b77478497ab0b`: não iniciou o verificador; Node falhou com `EPERM: operation not permitted, lstat C:\Users\yagoa`.
- `npm --workspace apps/web test -- --runInBand --runTestsByPath src/features/operacoes/__tests__/OperationsStageModal.test.jsx src/features/operacoes/__tests__/OperationsGuides.test.jsx src/features/operacoes/__tests__/OperationsCalculationDetails.test.jsx src/features/operacoes/__tests__/OperationsLayout.test.jsx src/features/guides/lib/__tests__/envioNaTela.test.js`: não iniciou Jest, mesmo EPERM no bootstrap do Node. Não há testes aprovados nesta rodada. O teste adicional de transmissão foi incluído após essa tentativa; executar a versão final inteira.
- Regressões CSS e DOM não substituem prova visual. Desktop/mobile, foco, contraste, overflow, build, testes e revisão independente permanecem pendentes no ambiente preparado pelo Principal. Nenhuma prova antiga foi atribuída ao código novo.
- Nenhum acesso a produção, transporte, consulta fiscal/paga, mudança de permissão, commit, merge ou publicação executado. Propostas fiscais pendentes permanecem fora do escopo.

## Fechamento complementar pelo Principal — 22/11/2026

Os registros acima descrevem a tentativa inicial e foram preservados. As falhas de ambiente e de expectativas antigas não foram convertidas em aprovação. O controlador original `2026-11-22T19-00-14-511Z-22f21a84` permanece interrompido, sem `ready_for_human`; este fechamento complementar referencia os resultados materiais e as revisões independentes, sem alterar runtime, gates ou políticas.

Fonte funcional congelada em `ALTAN/output/operacoes-contadores-tags-20261122/snapshot-final.json`, SHA256 `336dcb9a2bc2b109d07fa6630e4419874a8c663d92108c346e54fde9e6a76ccd`. Somente este relatório e o registro de impacto foram completados depois das validações. O produto, testes, dependências, banco e configurações não foram alterados nesse fechamento.

| Prova | Resultado e limites |
| --- | --- |
| Interface — `fechamento-web/manifest.json` | 600 suítes distintas, 7.134 assertions aprovadas; zero falhas, pendências e não executadas. Reuso por identidade, hash, dependências e ponteiro para JSON bruto; 46 suítes reexecutadas na composição final, sem somar provas sobrepostas. Fontes inalteradas. |
| API — `fechamento-api-final/manifest.json` | Cobertura identificada das 831 suítes: 807 integralmente aprovadas, 23 skipped e uma com assertions pendentes, rotulada `focused` pelo agregador Jest. 13.745 assertions aprovadas, zero falhas, 154 pendentes, zero suítes não executadas. Pendência não é aprovação. Fontes inalteradas; tempo cumulativo da segunda rodada 641.422 ms, dentro dos 1.200.000 ms do catálogo. |
| Portal e governança | Reaproveitados da execução original: portal 102 suítes/1.610 assertions aprovadas e governança 88 testes aprovados. Seus arquivos, configuração, dependências e contratos não mudaram após essas provas. Build do portal aprovado. |
| Build final da interface | Vite concluído, código zero, 38,03 s. Avisos existentes de importação mista e tamanho dos chunks não são novos erros. |
| Visual | Componentes reais com dados exclusivamente fictícios, computador e celular; filtro Calculadas com paginação, leitura 1/2 canais, estado indisponível acessível, fundo integral e hover real das tags, foco/rolagem e rodapé. Sem comandos fiscais, envios ou gravações. |
| Revisões | UI/UX/comunicação e contratos/backend/domínio aprovaram o snapshot final sem achados ativos. Parecer sistêmico e CI são condições próprias da integração, não substituídos por este texto. |

As evidências completas, hashes, resultados brutos, revisões e falhas anteriores estão preservados em `ALTAN/output/operacoes-contadores-tags-20261122`. O reuso foi auditado independentemente. A API não foi modificada nesta entrega. Três simulações legadas dependem exclusivamente de um endereço de banco diferente e permanecem pendentes, conforme o ambiente padrão do CI; uma preparação local as ativou incorretamente, foi recusada pela guarda existente e está preservada. Corrigiu-se somente a preparação privada, sem mudar esses testes ou sua proteção. O status `focused` citado é produzido pelo agregador para suíte com assertions pendentes; não representa execução seletiva introduzida nesta entrega.

Os apontamentos de revisão sobre leitura documental ausente e hover foram reproduzidos, corrigidos e revalidados. Falta de leitor não aparece como documento existente; lista vazia, erro e leitura indisponível continuam distintos. As expectativas antigas da página agora verificam disponibilidade pelo nome acessível e bloqueio do botão, sem retirar essas verificações. Tags conservam nome, erro, pagamento, recálculo e informações de envio, retirando apenas a disponibilidade visível solicitada.

Integração/publicação autorizadas pelo usuário somente após CI e revisões. Implantação limitada ao frontend, sem migração ou alteração de variáveis. Automações continuam desligadas; dados e atos reais não são usados como teste. Conferência pós-publicação será somente leitura. Pendências anteriores do plano permanecem fora desta correção. Reversão: reverter o commit desta entrega e republicar o frontend anterior, sem restauração de dados.
