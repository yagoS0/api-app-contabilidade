# DAS/SERPRO — consulta operacional 4.4.6

Base informada e preparada pelo Principal: `98943f8ae1f399d72a695262774353fe07141871`, PR #282. Implementação restrita aos caminhos atribuídos ao executor. Não altera a projeção 4.4.5, proteção #275, permissões ou dados persistidos.

## Caracterização anterior à implementação

A leitura pública interna de 4.4.5 recebe empresa e competência e aplica as guardas reais `requireAccountType('FIRM')` e `requireFirmCompanyAccess({minRole:'ACCOUNTANT'})`. Falhas de autorização são fatais; falhas de fontes independentes são representadas com `items:null`. O limite padrão é 50, máximo 100 por fonte/linhas; não existe paginação de fontes. Nenhum resultado comprova conciliação global.

`OperationsPage` já recebe a carteira visível e a competência. A carteira e o lote moderno admitem política global de contador distinta da leitura 4.4.5. Por isso o seletor usa somente `companies` recebidas, mas a seleção não concede acesso: a composição revalida a guarda por vínculo no servidor, sem harmonizar as políticas. Não há descoberta multiempresa, novo contador, loop, prefetch ou consulta ao abrir o modal.

O ponto escolhido é um acesso discreto junto de `OperationsRoutineCompanies`, com `Modal` compartilhado tamanho lg. Reutiliza Operações sem criar página ou rota de navegação. Um apresentador puro de Operações converte a projeção autorizada em descrições humanas, sem importar Prisma ou outros interiores de domínio. Composição conecta leitura 4.4.5 e apresentador; não injeta capacidades de escrita.

## Contrato HTTP e apresentação

`GET /firm/companies/:companyId/operacoes/:competencia/pendencias-das`, sob a montagem autenticada existente de Operações. Sessão exclusivamente de `req.auth`, passada separadamente à composição. Query opcional restrita a `servico`, `documentoId` e `limit`; arrays, objetos, chaves desconhecidas, `page` e `offset` são recusados. Os validadores da projeção preservam competência, identificadores, serviços e limites.

Respostas produzidas pelo handler usam `Cache-Control: private, no-store` (recusas anteriores da autenticação do router pai preservam o contrato existente): 400 entrada inválida, 401 sessão ausente, 403 acesso negado, 503 falha fatal segura sem mensagem interna ou orientação sobre escritas. Fontes parciais permanecem no DTO, não viram falha total ou lista vazia. A UI usa só empresa/competência; os filtros opcionais não ampliam o escopo autorizado. O cliente GET desabilita a retentativa de renovação para esta chamada, preservando o comportamento das demais APIs.

DTO `pendencias-das-leitura-4.4.6`: identidade, momento da leitura, limite, fontes com quantidade nullable/estado/truncamento, achados com dimensão/origem/evidência/classificação/limitação e limitações gerais. Nomes técnicos não são rótulos, não há JSON bruto. IDs/hashes identificam evidências. Valores persistidos não são recalculados. Cache histórico não comprova situação fiscal atual; pagamento local e referência de comprovante não comprovam baixa/validação bancária. Múltiplas guias são revisão ambígua a conferir, sem declarar duplicata removível. Fechamento não impede leitura e não é alterado.

Paginação de 12 achados por página apenas sobre o retorno em memória, com total explicitamente local. Truncamento de fonte ou linhas e falhas parciais ficam visíveis. Troca de seleção, API/sessão, carteira ou competência invalida o resultado; fechamento/desmontagem descarta resposta tardia. O mock declara indisponibilidade. Fixtures somente nos testes. Não há ações de recuperação, envio, liberação, correção ou pagamento.

## Compatibilidade, validação e limites desta execução

Regras R01/R02/R19–R22: identidade, incerteza, isolamento de leitura e apresentação. Sem decisão fiscal nova. Fiscal/SERPRO, Guias, Contabilidade e Operações fornecem a mesma leitura 4.4.5; transporte, reservas, cache/TTL, captura, provisões, fechamento, baixa, pagamentos, comprovantes, limpeza, procurações, workers, schema e migrations permanecem intocados. Portal do cliente não ganha consumidor ou autorização.

Testes escritos antes da implementação: apresentador puro (incerteza, falha, truncamento, duplicidade/revisão e provisão não comprovada), handler (whitelist, sessão separada, erros sem retentativa) e UI (clique único, seleção, resposta tardia, paginação local). Acrescidos contrato do cliente GET/401/403/503, integração na página, trocas de contexto e PostgreSQL16 com guardas reais, sessões sintéticas, outra empresa/usuário de outra carteira, conta cliente, competência distinta, filtro documental escopado e operações Prisma somente leitura. Fixtures PostgreSQL usam nomes únicos e banco loopback explicitamente validado; não fazem limpeza de ambientes.

### Evidências consolidadas pelo Principal

- Base antes da implementação: API 9 suítes/132 testes aprovados e 2 ignorados; web 6 suítes/92 testes aprovados.
- Projeção 445 + consulta 446: 7 suítes/86 testes aprovados em PostgreSQL 16 descartável novo (63 anteriores + 23 novos). Os testes HTTP executam router, requireAuth, tipo de conta e guarda por empresa reais; somente o resolvedor de sessão é sintético. Vínculos INACTIVE/REMOVED, STAFF, outra carteira, sessão ausente e exceção admin comprovados. Recusa por vínculo acessa apenas CompanyFirmAccess.findUnique.
- Regressão API: 100 suítes aprovadas, 1 suíte com colisão de hash sintético fixo ao repetir a base no mesmo banco; 1325 testes aprovados, 1 falhou, 2 ignorados, 42 snapshots. A suíte afetada foi repetida integralmente no banco novo dentro das 86 verificações aprovadas, sem modificar o teste legado ou limpar bancos anteriores.
- Web: 38 suítes/446 testes aprovados; build aprovado, com aviso existente de tamanho dos bundles. Cliente GET sem replay em 401/403/503, resposta tardia descartada e paginação local sem novas chamadas.
- Governança 88/88; verificador 4/4; contratos HTTP do piloto 25/25; fechamento/concorrência PostgreSQL 10/10. Diagnose 5023 → 5023, zero novas violações.
- Ensaio visual com Chrome, dados sintéticos e rede bloqueada fora de localhost: desktop 1440×1000 e celular 390×844, sem overflow horizontal, uma consulta por ação, Escape fecha e devolve foco. Nenhum dado ou serviço real consultado.
- Pareceres independentes favoráveis: Fiscal/SERPRO, Guias e Contabilidade (/root/dominios446); Operações/UIUX (/root/integracao446); segurança/backend (/root/seguranca446). Avisos permanentes foram separados dos achados; estados operacionais e contagem registrada preservados sem inferir sucesso.
- Controlador `2026-11-15T00-37-57-297Z-c2f49469`: planejador e executor concluíram; gate de governança aprovado. Executor relatou EPERM do Node na sessão filha. Principal interrompeu a execução durante o gate de regressão API após ajustes independentes, preservando evidências locais e executando os testes descritos acima. Estado persistido ficou `testing`; execução **interrompida, não ready_for_human**. Nenhum gate, papel ou permissão foi alterado. CI hospedada no SHA definitivo será registrada no PR.

Avisos permanentes e ausência de registros ficam nas limitações da consulta, fora da contagem de achados. Estados, contagens e identificadores exibidos são observações locais. Fontes sem registros não geram pendências artificiais. A página continua sem comandos de recuperação.

Rollback: remover somente o incremento de apresentação/consulta e seus testes, sem reverter projeção 4.4.5 ou modificar dados. Executor não realizou commit, push, PR, integração, deploy, consulta fiscal, mensagem ou alteração de permissões. Registro de governança, resultado formal do controlador e PR ficam com o Principal.
