# P0.1 — calendário documental de IBS/CBS na NFS-e

22/11/2026. Base: `b4cf79ef4c0252300950d7f7d9efe94c4efae914`. Implementação local delimitada, revisada independentemente em Fiscal, arquitetura e regressão. Não incorpora PR310/311.

## Fontes e matriz antes/depois

Conferidos o [Ato 4/2026 original](https://cgibs.gov.br/upload/arquivos/202607/31091735-20260730-16h30-ato-conjunto-rfb-cgibs-na-c2-ba-4-260731-090909.pdf), art. 1º, III e §1º, e o [Ato 7/2026](https://cgibs.gov.br/upload/arquivos/202611/13061456-ato-conjunto-7-rfb-cgibs-alteracao-ato-4.pdf), art. 1º. O [comunicado CGNFS-e de 13/11/2026](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-informa-ato-conjunto-rfb-cgibs-no-7-2026-atualiza-o-cronograma-de-obrigatoriedade-de-emissao-da-nfs-e-para-ibs-e-cbs/) aponta para este segundo PDF. Consulta em 22/11/2026. A matriz cobre todas as alíneas da NFS-e do inciso III; outros documentos fiscais não são implementados aqui.

| Art. 1º, III — hipótese | Não optante: Ato 4 original → Ato 7 | Simples: original → novo | Representação atual |
| --- | --- | --- | --- |
| a — plataformas do art. 22, §1º, LC214 e intermediação dos §§12–14 | 01/12/2026 → 01/03/2027 | 01/01/2027 → 01/03/2027 | `PLATAFORMA_DIGITAL`, classificação explícita |
| b — ISS, subitens 1.03/1.05/1.09 | 01/12/2026 → 01/03/2027 | 01/01/2027 → 01/03/2027 | Prefixos `0103`, `0105`, `0109` |
| c — ISS, subitem 16.01 | 01/12/2026 → 01/03/2027 | 01/01/2027 → 01/03/2027 | Prefixo `1601` |
| d — demais serviços ISS da LC116, excluídos a–c | 01/10/2026 → mantido | 01/01/2027 → mantido | `SERVICO_ISS` fora dos prefixos especiais |
| e — imateriais fora da LC116 e do ICMS, inclusive imunidades constitucionais indicadas | 01/12/2026 → 01/01/2027 | 01/01/2027 → mantido | Não representada |
| f — taxas, valores e outras receitas condominiais | 01/12/2026 → 01/01/2027 | 01/01/2027 → mantido | Não representada |
| g — locações móveis; locações, cessões onerosas e arrendamentos imóveis, ressalvada d | 01/12/2026 → 01/01/2027 | 01/01/2027 → mantido | Não representada |
| h — serviços residuais fora de a–g | 01/12/2026 → 01/01/2027 | 01/01/2027 → mantido | Não representada |

O §1º novo distingue d–h (janeiro) das demais hipóteses do caput (março) para Simples. NFS-e Via pertence ao inciso XIII: data geral de 03/08/2026 preservada, fora deste contrato. O calendário não determina alíquota, opção de apuração, incidência concreta nem disponibilidade do leiaute.

## Decisão técnica e limites

`obrigacaoIbscbs` conserva assinatura e campos de retorno (`estado`, `motivo`, `inicio`, `versao`), com versão `ato-7-2026-revisao-2026-11-22`. Continua pura, sem relógio, rede ou persistência. A data é a competência recebida, não a data atual, importação ou vencimento. O chamador continua responsável pelo regime histórico correto.

Somente as categorias existentes são aceitas. Plataforma significa a hipótese legal confirmada, não uso da internet, CNAE ou nome comercial. Os quatro subitens convergem em março mesmo sem categoria; os demais códigos exigem classificação para identificar a data. Categoria ausente não adquire prazo de dezembro por fallback. A partir de março, para não optante com código coberto e categoria ausente, todos os prazos possíveis já iniciaram: retorna obrigatório, mas `inicio: null`, sem inventar a data exata. Para Simples em 2026, preservar facultativo inclusive com classificação incompleta: nenhum prazo do §1º iniciou; `inicio` somente é informado quando a categoria/código o comprova. Isso não dispensa as validações cadastrais existentes fora desta política.

Alíneas e–h são documentadas, mas não convertidas em `SERVICO_ISS`, plataforma ou nova categoria. Códigos fora do contrato e categorias desconhecidas exigem conferência; não implementar essas hipóteses por analogia. O reconhecimento legado de códigos de seis dígitos e itens 01–40 não constitui validação completa da lista nacional; não foi ampliado nesta entrega. A saída histórica anterior a outubro permanece a avaliação restrita do contrato existente, sem abranger NFS-e Via.

A política identifica o início legal de janeiro ou março para Simples classificado. Antes desse início, retorna facultativo; a partir dele, preserva `INDETERMINADO` com `inicio` explícito. A opção `REGULAR`/`NO_DAS` e seu contrato técnico ainda exigem validação específica: o consumidor `verificarNfse` também usa o estado para exigir o bloco, sem passar pelo resolvedor de emissão. Não transformar o calendário em erro por grupo ausente sem essa comprovação. `apuracaoIbsCbsDaCompetencia` e a recusa `NFSE_CONTRATO_SIMPLES_2027_PENDENTE` permanecem anteriores ao preparo do XML. O contrato `nfse-nacional-dps-1.01-20260727`, campos não suportados e esquemas não foram alterados. Obrigação legal não homologa XML.

O Ato7 entrou em vigor em 13/11/2026; o art.1º do Ato4 vincula os marcos aos fatos geradores. A vigência da norma, a competência fiscal e a disponibilidade de um leiaute são fatos distintos. Não se altera uma decisão histórica persistida nem se usa a data atual como competência. A FAQ consultada ainda contém cronograma anterior em trecho específico; os atos normativos e o comunicado de13/11 fundamentam esta correção.

## Contextos e compatibilidade para o Principal

Donos: Fiscal/NFS-e e documentação fiscal. Consumidores diretos rastreados por imports:

- `resolverContextoFiscalDaNota` → preparação/pré-voo/gerador → `NfseService.issue`, usado por rotas, lote e recorrência: mesmas interfaces e guardas; muda somente avaliação temporal.
- `verificarNfse`: reutiliza a política e incorpora sua versão na versão do verificador; novas leituras podem produzir achados diferentes, sem modificar XML ou resultado persistido anterior. `ReformaFiscalService` considera conferências com versão anterior desatualizadas; isso exige nova conferência, não executa ato fiscal. Usa categoria do snapshot da própria emissão, não do perfil atual; recebidas não herdam a categoria do tomador.
- `snapshotFiscal`: mantém cópia da decisão e versão; nenhuma regravação ou backfill.
- `routes/firm/perfisEmissao`: enum importado permanece exatamente com dois valores; sem novo cadastro.

API mantém contratos e permissões. Portal, Web, Comercial, Comunicação e Operações continuam usando os mesmos pontos de entrada, sem alteração de telas, agendas ou comandos. Guias e Contabilidade não recebem escrita ou mudança de regra. Nenhuma migration, banco, configuração, emissão, cancelamento, captura ADN ou integração real foi executada. Regras operacionais pertinentes: R01/R02/R07/R19/R20; preservados R25/R26 e limites fiscais das seções36/37. Referência operacional fornecida conferida por SHA256 `4edbbc7134008570aa1152d34019c467afabd3aa6768dc89c80830ac166f6113`.

Risco fiscal alto: enquadramento incorreto muda uma recusa do emissor. A matriz não homologa cadastros concretos. Revisor independente deve confirmar fonte, alcance de Simples e ausência de inferências em e–h. Principal registra governança/revisões; executor não altera gates. Rollback: reverter apenas este diff, preservando snapshots e dados; a reversão restaura calendário antigo e exige avaliação fiscal antes de uso. Não há ação de reversão no banco.

## Validação preparada e resultado real

Testes adicionados/ajustados: fronteiras de outubro/janeiro/março, dezembro adiado, quatro subitens e serviços vizinhos sem exceção, plataforma, Simples (`2`/`3`), dados inválidos, categorias ausentes/não representadas, competência histórica e versão. Conferência XML acompanha as mesmas datas e preserva o documento. Emissão simulada mantém recusa de contrato2027 sem transação, criação de nota ou POST; os testes anteriores de ausência de GET/POST permanecem.

Checagem de sintaxe dos quatro arquivos JavaScript modificados aprovada via `Get-Content <arquivo> -Raw | node --input-type=module --check`. Esta checagem não executa testes, imports ou integrações. O preparo fiscal simulado também ganhou cobertura de dezembro, com local de prestação explícito para preservar a guarda municipal do transporte.

Comando em `apps/api`:

```text
node ../../node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/application/nfse/__tests__/prioridadesFiscais.test.js src/application/nfse/__tests__/emissaoDps.test.js src/application/fiscal/reforma/__tests__/verificarNfse.test.js
```

Não executado pelo runtime: Node falhou no carregamento inicial com `EPERM: operation not permitted, lstat 'C:\Users\yagoa'`. Essa tentativa do executor não produziu aprovação de testes. Uma primeira chamada na raiz usou caminho relativo incorreto e retornou `MODULE_NOT_FOUND`; a chamada acima corrigiu o diretório, revelando o impedimento de acesso. O plano `node scripts/governance/check.mjs plan --base b4cf79ef4c0252300950d7f7d9efe94c4efae914` sofreu o mesmo `EPERM`. Permissões não foram alteradas nem contornadas. `git diff --check` passou. A execução posterior pelo Principal e os pareceres estão registrados abaixo; a falha inicial não foi apagada.

## Revisão independente e fechamento local

O Principal interrompeu o controlador após a conclusão do executor para tratar o achado fiscal F01. A execução bruta permanece preservada em `.altan-governance/runs/2026-11-22T16-01-19-822Z-2470c3ea`; não foi declarado `ready_for_human`. Nenhuma alteração de permissões ou gates foi feita.

F01 corrigido: não converter Simples2027 em exigência do bloco sem resolver o contrato. Também preservada a resposta temporal histórica do Simples2026 e a conclusão para não optante sem categoria quando todos os prazos cobertos já iniciaram, sem inventar data inicial. P3 corrigido: o teste de emissão declara precisamente a guarda genérica de contrato2027; a matriz de categorias é exercitada pela política, preparo fiscal e verificador, sem alegar percurso ponta a ponta por categoria.

Pareceres independentes em22/11/2026: `/root/fiscal_p01` favorável após conferir os dois atos integrais; `/root/arquitetura_p01` favorável quanto a contratos/dependências; `/root/regressao_p01` favorável após precisão do teste de guarda. São revisões técnicas de agentes, não autorização humana de integração ou homologação fiscal.

Resultados do Principal: referência anterior de19testes aprovada; focal final172/172 em3suítes; governança88/88; arquitetura5/5; diagnose5019→5019, zero novas violações; estrutura/perfis/registro válidos; diff sem erros. Log e JSON dos comandos ficam na área local ignorada de governança. A primeira seleção ampla incluiu quatro suítes PostgreSQL não configuradas: falharam antes do acesso ao banco. Não foram modificadas; a regressão final usa somente funções e integrações simuladas, conforme o escopo autorizado. Não houve acesso a banco real, dados de cliente, certificado real ou emissão fiscal.

Regressão final simulada: **85 suítes e 1.853 testes aprovados**, zero falhas. As quatro suítes que exigem PostgreSQL ficam fora desta seleção, sem alterações ou declaração de aprovação local. Os172 testes focais estão incluídos nesse total, não são somados novamente. CI hospedada será registrada no PR no SHA final.

## Atualização sobre a main após #313 e #314

Em 22/11/2026, reconciliada a branch original com `3a68fcd128586e825ffbeced85b7351c3054a0ad` por merge não destrutivo, sem conflitos e sem force push. Os quatro arquivos próprios de código/testes permanecem idênticos a `8f3675a4c2d4b78639810d75ba8208406401d976`; os 43 arquivos incorporados da main preservam integralmente o ADN e os modais. Não há nova mudança fiscal ou operacional.

Revisões independentes fiscal e arquitetural favoráveis ao diff atualizado, condicionadas à validação final. Governança 40/40, testes arquiteturais 5/5 e diagnose 5020 → 5020, zero novas violações. Estrutura, perfis e referência operacional validados. A contagem anterior de testes de governança é histórica; este registro usa o total efetivamente reportado nesta execução. Resultados da regressão fiscal, modais e CI integral serão vinculados ao SHA final no PR #312.

Sem novo executor ou alteração funcional na reconciliação; preservado o estado histórico do controlador interrompido, sem declarar `ready_for_human`. Mantidos o escopo, as limitações normativas e o rollback descritos acima. Nenhuma autorização de merge na main, deploy ou P0.2.
