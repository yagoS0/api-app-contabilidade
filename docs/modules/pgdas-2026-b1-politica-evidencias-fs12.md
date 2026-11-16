# PGDAS-2026-B1 — política temporal e evidências mensais FS12

Incremento isolado, em desenvolvimento. Base local inspecionada: `028920a99bcef065014fedbde04439a8f1a44e92` (PR #290). Nenhum consumidor produtivo importa a nova porta. Não altera payload, fechamento, fórmula Fator R, opção CAIXA/COMPETENCIA, schema, transmissão, rotinas, Guias, Contabilidade ou interfaces.

## Descoberta e plano de impacto

Referências: [caracterização A](pgdas-2026-a-fs12-regime.md), [Plano Diretor](plano-diretor-operacoes-apuracao.md), [arquitetura](../governance/ARQUITETURA.md) e política de governança. Referência operacional fornecida integralmente ao executor e hash canônico conferido: `e50fa30d9c205d4f09fb7638429509bb49bfb49016107e9e27d759faa649639f`. Aplicam-se R01/R02/R19/R20: identidade, ausência diferente de zero, revisão e preservação das evidências. Nenhum estado operacional é escrito. R25/R26 e demais regras existentes permanecem intactas.

Plano delimitado antes da implementação: (1) política temporal pura, (2) verificação mensal independente de fonte/persistência, (3) coordenação pública sem I/O, (4) testes de decisão/contrato e repetição das caracterizações A, (5) documento e revisão independente pelo Principal. Risco alto por contrato fiscal, mesmo inerte. Governança e revisão não são aprovadas pelo autor.

| Dono/consumidor | Contrato observado e compatibilidade B1 |
| --- | --- |
| Fiscal, novo `modules/fiscal/publicFs12.js` | Porta opt-in; aplicação coordena somente fatos explícitos; domínio decide exigência e qualidade. Nenhum import de Prisma, Express, filesystem, SDK ou outro contexto. |
| `FechamentoService.folhasSalarioSeAplicavel` | Legado filtra por flags/catálogo, sem PA. B1 recebe sua decisão histórica como fato; não copia o classificador, não muda fallback, formulário ou payload. Integração futura depende de adaptador revisado. |
| `FatorRService.resolverFolha12m/decidirFatorR` e motor | Agregado atual/anterior e fórmula III/V intactos. Nenhuma dependência do novo módulo para o motor. Exigência declaratória não determina tributação. |
| `FolhaDerivadaService` / Contabilidade | Soma contábil é conferência auxiliar; não comprova composição fiscal nem zero. Não é adaptada automaticamente para evidência mensal. Nenhuma escrita contábil. |
| `PgdasSimulacaoService`, períodos aceitos/recusados, `CalculoConfirmado` | Contratos e tokens inalterados. Cobertura local não define quais meses serão enviados nem autoriza repetir chamada. |
| Memória de configuração, circular, snapshots | Sugestão/agregado anterior não vira série atual. Sem alteração, conversão ou migração. |
| Operações, web, portal | Nenhum consumidor ligado, endpoint, tela ou DTO existente alterado. Sem impacto visual; testes desktop/mobile não se aplicam a este incremento. |

Rollback: retirar exclusivamente os oito arquivos novos após revisão do diff. Não há dado a migrar, configuração a desligar ou ato fiscal a desfazer. Não reverter trabalhos paralelos nem referências de governança.

## Fontes e matriz de decisão

A política utiliza o [Manual PGDAS-D/DEFIS 2018–2026](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf), versão 13/11/2026, §§8.2–8.2.2, páginas 74–77. Hash da versão já inspecionada no incremento A: `1786a9badcd6676567b8a2ce27c6f11466b3abaf1ea1330a27eef31ec013119f`. Este executor utiliza essa evidência versionada; não declara novo download ou homologação remota.

| PA / condição | Regra | Janela local de evidências para estabelecida |
| --- | --- | --- |
| 10/2026, exigência histórica positiva | Exigida, condicionada à atividade histórica | 10/2025–09/2026 |
| 10/2026, exigência histórica negativa | Não exigida por essa política; não significa folha zero | Não avaliada |
| 10/2026, classificação desconhecida | Pendente; não presume dispensa | Não calculada |
| 11/2026, com ou sem Fator R, inclusive receita zero | Exigida para Simples | 11/2025–10/2026 |
| 12/2026, com ou sem Fator R | Exigida para Simples | 12/2025–11/2026 |
| 01/2027 em diante | Política pendente de homologação específica | `null`; não antecipa manual futuro |
| Regime do PA sem prova/referência | Pendente | Não calculada |
| Regime comprovado fora do Simples (inclusive MEI/SIMEI) | Fora do escopo PGDAS-D, não dispensa universal | Não avaliada |

Datas/competências seguem formato estrito `YYYY-MM`. A versão do manual cobre 2018–2026; períodos anteriores ficam pendentes, sem extrapolação. Política retorna versão, empresa, PA, situação, exigida (true/false/null), regra, fundamento, janela, impedimentos e limitações. `PENDENTE` com `exigida:true` significa que a exigência é conhecida, mas a janela não pôde ser determinada.

Início de atividade segue §8.2.1, sem anualizar ou aplicar fórmula de Fator R:

| Abertura / PA | Fase | Meses de evidência |
| --- | --- | --- |
| 11/2026 / 11/2026 | Primeiro período | 11/2026 |
| 10/2026 / 11/2026 | Posterior, primeiro ano | 10/2026 |
| 09/2026 / 11/2026 | Posterior, primeiro ano | 09/2026 e 10/2026 |
| 12/2025 / 11/2026 | 12º período | 12/2025–10/2026 (11 meses) |
| 11/2025 / 11/2026 | 13º período, estabelecida | 11/2025–10/2026 (12 meses) |

Abertura desconhecida/inválida/futura impede determinar a janela exigida. Não inventar meses anteriores à abertura. Essas janelas representam cobertura fiscal local, não a cardinalidade que o SERPRO aceitará em uma chamada quando já possui declarações anteriores.

## Contrato mensal v1

`avaliarExigenciaFs12({ contexto, evidencias, avaliadoEm })` é síncrono, determinístico e não escreve. O relógio é um argumento; não há consulta, cache, fallback ou adaptação de agregados. Identificador empresarial é opaco: o futuro adaptador deve mapear Company/PortalClient explicitamente e autorizar acesso antes da leitura. Nunca misturar os dois namespaces.

Contexto: `empresaId`, `competenciaApuracao`, `inicioAtividade` (mês comprovado), `regimeDoPeriodo: { empresaId, tipo, competencia, referencia }` e `exigenciaHistorica` (booleano ou ausente). Esse último é resultado do contrato histórico, não flag para mudar o Fator R; é desconsiderado em novembro/dezembro. Ausência de receita ou `semMovimento` não dispensa folha.

Cada evidência possui:

| Campo | Significado/invariante |
| --- | --- |
| empresaId / competenciaApuracao | Escopo da avaliação atual; evidência de outra empresa/PA não é reutilizada automaticamente |
| competenciaFolha | Um mês da janela, sem duplicação, inclusive quando valores/revisões coincidem |
| valorCentavos | BRL, inteiro seguro não negativo; 0 explícito aceito com prova/conferência; null/string/vazio/decimal/NaN recusados |
| origem.tipo | DECLARACAO_MANUAL, DOCUMENTO_FOLHA ou DECLARACAO_PGDAS; origem desconhecida é pendência |
| origem.referencia / origem.revisao | Referência rastreável e revisão opaca não vazia; não são geradas pelo avaliador |
| revisaoAtual | Revisão obtida independentemente da fonte na leitura consistente do caso de uso; divergência invalida a evidência antiga |
| obtidoEm | Instante UTC ISO canônico, milissegundos e Z; não aceita data impossível ou posterior à avaliação |
| conferencia.situacao / autor / em | CONFERIDA, ator autenticado e instante entre obtenção e avaliação; presença do valor não prova conferência |
| conferencia.conteudo | Cópia dos campos empresaId, competenciaApuracao, competenciaFolha, valorCentavos, origem (tipo/referencia/revisao) e obtidoEm exatamente conferidos |

Comparação de conteúdo protege contra consumo inadvertido de valores/origens/revisões modificados. Não é assinatura criptográfica: o domínio não autentica arquivos, identidades ou declarações do chamador. Fonte, autor e revisão atual devem vir de adaptadores confiáveis, jamais diretamente de JSON público. B1 não cria esses adaptadores. Reconfirmar conteúdo após retificação é ação explícita futura; o avaliador não altera o histórico.

Cobertura informa `esperadas`, `presentes`, `conferidas`, `ausentes` e `naoConferidas`. Um mês inválido pode estar presente, mas nunca conferido. Duplicatas, extras fora da janela ou itens malformados impedem sucesso sem poda silenciosa. Soma exata em centavos é devolvida somente para série completa conferida sem impedimento; overflow é recusado. `totalCentavos:null` não equivale a zero. Esse total é soma das evidências, não resultado tributário do Fator R.

`NAO_AVALIADA` com cobertura `null` distingue política não exigida, fora de escopo ou pendente de série completa. `evidenciaSuficiente` só é true quando exigência e qualidade estão satisfeitas; `autorizaEfeitoFiscal` é sempre false, inclusive com série completa.

## Exemplo sintético

```js
const contexto = {
  empresaId: "empresa-sintetica", competenciaApuracao: "2026-11", inicioAtividade: "2026-11",
  regimeDoPeriodo: { empresaId: "empresa-sintetica", tipo: "SIMPLES_NACIONAL", competencia: "2026-11", referencia: "historico:r1" },
  exigenciaHistorica: false,
};
const conteudo = {
  empresaId: "empresa-sintetica", competenciaApuracao: "2026-11", competenciaFolha: "2026-11",
  valorCentavos: 0,
  origem: { tipo: "DECLARACAO_MANUAL", referencia: "folha:novembro", revisao: "r1" },
  obtidoEm: "2026-11-16T10:00:00.000Z",
};
const resultado = avaliarExigenciaFs12({
  contexto, avaliadoEm: "2026-11-16T12:00:00.000Z",
  evidencias: [{ ...conteudo, revisaoAtual: "r1", conferencia: {
    situacao: "CONFERIDA", autor: "contador-sintetico", em: "2026-11-16T11:00:00.000Z",
    conteudo: structuredClone(conteudo),
  } }],
});
// politica: EXIGIDA / FS12_TODAS_ATIVIDADES_2026 / janela [2026-11]
// qualidade: COMPLETA_CONFERIDA / totalCentavos 0 / ausentes []
// evidenciaSuficiente true; autorizaEfeitoFiscal false
```

Com `evidencias:[]`, a mesma entrada resulta em PENDENTE, `MES_AUSENTE` para 11/2026 e total null. Mudando apenas `revisaoAtual` para r2, retorna `FONTE_RETIFICADA`. Alterando valor sem nova conferência, retorna `CONTEUDO_NAO_CONFERIDO`. Para 01/2027, contexto com regime desse PA retorna `HOMOLOGACAO_2027_PENDENTE`, janela null e qualidade não avaliada.

## Integração futura e critérios de B2

1. Revisão Fiscal independente confirma temporalidade, início de atividade, qualidade e limites. Revisão de arquitetura confirma isolamento e contratos, seguida do juízo sistêmico aplicável. Nenhuma aprovação é declarada neste documento.
2. Principal confirma SHA remoto, plano de impacto e gates, com testes no SHA candidato. B2 depende de autorização própria; não é iniciado por B1.
3. Definir fonte mensal autorizada, prova de abertura/regime por período, leitura consistente de revisões e autorização por empresa. Não reconstruir meses do agregado fs12Manual, memória anterior ou contabilidade auxiliar.
4. Antes de adaptar UI/backend, definir persistência de conferência, auditoria atômica, revisão, invalidação de cálculo e respostas tardias. A conferência deve ser produzida pelo servidor para a revisão exata, não aceita do formulário como prova.
5. Caracterizar seleção de meses já declarados e contrato remoto; série local completa não impõe reenvio integral. Nenhuma homologação externa está autorizada por estes testes.
6. Preservar fórmula/anexo, guardas, leases, calculoId, transmissão incerta, fechado/reaberto e fluxo de recuperação. Nenhuma chamada fiscal, guia ou lançamento como efeito de avaliar qualidade.
7. 2027 permanece entrega específica: novo manual, início de atividade, janela e contrato técnico homologados. Não reutilizar B1 como autorização.

## Validação e pendências reais

Em 16/11/2026, o Principal confirmou novamente a main remota `028920a99bcef065014fedbde04439a8f1a44e92`. A suíte API focal e de regressão passou com 560 testes em 32 suítes, incluindo 73 novos testes B1. Nove testes PostgreSQL existentes ficaram ignorados sem URL descartável local; não são aprovação de persistência. B1 não introduz adaptador, consulta ou escrita em banco.

Governança executável: 88 testes aprovados. Verificador arquitetural em diagnose: 5023 violações legadas na base e candidata, zero acréscimos. O código produtivo da worktree A usada como baseline foi comparado ao commit integrado e é idêntico. Nenhum consumidor existente importa a porta nova.

O controlador foi iniciado antes das alterações (`2026-11-16T16-09-55-373Z-1fe29625`). O executor concluiu oito arquivos, mas registrou EPERM para testes e indisponibilidade de rede no subprocesso. O Principal confirmou a referência remota e executou os testes no ambiente disponível. Interrompeu a rodada durante o gate API para incorporar o achado independente sobre identidade empresarial do regime. Não se declara `ready_for_human`: a rodada não concluiu seus gates/revisores automáticos. O registro do run permanece local; a interrupção não foi convertida em aprovação. As revisões independentes e a CI do PR são evidências separadas.

A revisão Fiscal independente foi favorável após a correção e inspecionou os resultados, sem reexecutar a suíte. Pareceres finais e workflows serão registrados no PR e no registro de impacto. Sem alteração visual, revisão de layout não se aplica. Homologação SERPRO, autenticidade da fonte e integração produtiva permanecem fora desta entrega.

Rollback: reverter somente os arquivos novos de B1, inclusive seu registro de impacto; não há transformação de dados nem efeito fiscal a desfazer. B2, merge e publicação exigem autorização humana específica.
