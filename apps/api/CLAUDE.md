# CLAUDE.md — API (apps/api)

Backend Node.js 20 + Express.js + Prisma + PostgreSQL.

## Estrutura

```
src/
  application/       - Casos de uso / lógica de negócio (Services)
  infrastructure/    - Integrações externas (db, mail, storage, pdfReader)
  modules/           - Módulos de domínio (agrupam entidades)
  routes/            - Definição de rotas Express
    auth.js
    admin.js
    clients.js
    invoices.js
    firm/
      index.js
      accountingEntries.js
    ...
  middlewares/       - Auth, RBAC, error handling
  utils/             - Funções auxiliares
  workers/           - Jobs em background (ex: guideEmailWorker.js)
  server.js          - Entry point
config.js            - Variáveis de ambiente centralizadas
prisma/
  schema.prisma      - Schema do banco
  migrations/        - Migrations geradas pelo Prisma
  seed.js
```

## Padrões

### Rotas

- Cada grupo de rotas em arquivo separado dentro de `src/routes/`
- Rotas de escritório ficam em `src/routes/firm/`
- Sempre usar `requireAuth` + `requireRole` nos middlewares
- Retornar JSON limpo — sem expor stack traces em produção

```js
// Padrão de rota
router.get('/', requireAuth, requireRole(['FIRM_ADMIN']), async (req, res) => {
  try {
    const data = await SomeService.list(req.user);
    res.json(data);
  } catch (err) {
    next(err);
  }
});
```

### Services (Application Layer)

- Lógica de negócio fica nos Services, nunca nas rotas
- Services ficam em `src/application/`
- Services importam do `infrastructure/db` (Prisma client)

### Prisma / Banco

- Nunca rodar queries raw no Prisma sem necessidade
- Sempre filtrar por `firmId` ou `companyId` para garantir isolamento multi-tenant
- Migrations geradas com `prisma migrate dev --name <descricao>`
- Nunca editar arquivos de migration já aplicados

### Autenticação e RBAC

- JWT gerado e validado via `AuthService`
- Middleware `requireRole` recebe array de roles permitidas
- Roles FIRM: `FIRM_ADMIN`, `FIRM_ACCOUNTANT`, `FIRM_STAFF`
- Roles CLIENT (por empresa, `CompanyClientUser.role`, gate por `requireClientCompanyAccess(minRole)`):
  `OWNER` (3) > `CLIENT_ADMIN` (2) > `FINANCEIRO` (1); `CLIENT_USER` (1) só legado. Gestão de
  usuários exige OWNER; pró-labore/certificado/sócios exigem CLIENT_ADMIN.
- Usuários novos precisam de aprovação do admin antes de acessar

### Workers

- Jobs de background ficam em `src/workers/` — ver `src/workers/CLAUDE.md`.
- Executados internamente (sem fila externa por ora)
- Ex: `guideEmailWorker.js` envia guias em lote por email
- **Q17:** `serproPgdasdWorker` também busca o **extrato** (`syncPgdasByCompetencia`), que
  gera os lançamentos — não só as guias. Agendamento vem de `SerproRuntimeSettings`
  (página do SERPRO), não fixo.

> **Blocos com `CLAUDE.md` próprio** (ler antes de mexer; atualizar ao terminar):
> `src/workers/`, `src/application/accounting/`, `src/application/guides/`,
> **`src/application/declarados/`** (conferência de lançamentos — a nota vira despesa, o extrato
> vira o pagamento dela; ⚠⚠ a invariante do caixa mora lá).
> **Fechamento contábil do mês (Q17)** ≠ `estado` da apuração: campos
> `CompanyMonthlyCircular.fechadoContabilEm/Por`; endpoints `.../fechamento-contabil/...`;
> gate por lançamento (em branco / D≠C). Guia `status="VAZIO"` = ausência confirmada (amarelo).

### Infraestrutura

| Módulo           | Localização                        | Propósito                     |
|------------------|------------------------------------|-------------------------------|
| DB               | `infrastructure/db`                | Prisma client singleton       |
| Mail             | `infrastructure/mail`              | Gmail API / Nodemailer        |
| Storage          | `infrastructure/storage`           | Upload local / cloud          |
| PDF Reader       | `infrastructure/pdfReader`         | Chamadas ao serviço Python    |

## Módulo de Apuração Simples Nacional (Q14/Q15) — fluxo novo

> Princípio fundador: **a nota é SINAL, o cadastro é AUTORIDADE, o motor calcula,
> nada é chutado.** Item sem regra vira pendência (não vai pra anexo "provável").

**Camadas (em `application/notas/apuracao/v2/`):**
- `ClassificadorService.js` — classifica `NotaItem` → `TipoReceita` (regra EMPRESA →
  GLOBAL → capítulo LC116 → pendência). Sem match = `FilaPendencia(ITEM_SEM_REGRA)`.
- `AprendizadoService.js` — resolver pendência cria `RegraClassificacao` escopo EMPRESA.
- `AtividadeResolver.js` — converte receita classificada (tipoReceita+mercado) nas
  `atividades[]` do PGDAS-D (de-para via model `AtividadePgdasd`).
- `FechamentoService.js` — orquestra o modal: getDados / calcular / salvar / transmitir.
- `RbtExtratoService.js` — RBT12 (cache `RbtExtratoCache`; fonte SIMULACAO > local).
- `ApuracaoConfigMemoryService.js` — memória da **FORMA** da última config por empresa (ver seção
  própria abaixo: ela guarda atividade/anexo/**mercado**, NUNCA o valor).
- `DisparidadeService.js` — avisa atividade↔CNAE (nunca bloqueia).
- `FatorRService.js`, `AliquotaResolver.js`, `MotorApuracaoService.js` — cálculo
  LOCAL (double-check; a verdade do DAS vem da RFB via simulação).

**SERPRO PGDAS-D (`application/fiscal/serpro/`):**
- `PgdasSimulacaoService.js` — monta o payload `TRANSDECLARACAO11` e chama:
  - `simular()` = `indicadorTransmissao:false` → cálculo oficial **sem transmitir**
    (é a verdade do botão [Calcular]). `transmitir()` = `true` → declara/gera DAS.
- idServicos em uso: `GERARDAS12`, `CONSDECLARACAO13`, `CONSULTIMADECREC14`,
  `TRANSDECLARACAO11`. Cliente HTTP: `SerproHttpClient` (baseUrl + cert + OAuth2
  vêm de `getResolvedSerproCredentials` — **uma só config**, prod por padrão).

**Regras CRÍTICAS do PGDAS-D (validadas contra a API real):**
- ⚠ **"Período desnecessário" vale para as DUAS listas.** A RFB só aceita, em
  `receitasBrutasAnteriores` **e** em `folhasSalario`, os meses que ela ainda não tem declarados;
  para os demais rejeita a declaração inteira apontando o mês:
  `"Foi enviada receita bruta de um período desnecessário: MM/AAAA"` e
  `"Foi enviada folha de um período desnecessário: 07/2025"` (as duas frases confirmadas em
  produção). `executarComAjusteDePeriodos` remove o mês da lista CERTA e re-executa.
  **O subject no regex é o que decide de qual lista remover** — sem ele, a queixa de folha removia
  de receitas: ou o erro voltava intacto (e o Calcular de toda empresa com Fator-R "não fazia
  nada"), ou comia um mês de receita que a RFB precisava e repetia até estourar o teto, gastando
  até 14 chamadas SERPRO por clique. Coberto por `__tests__/ajustePeriodos.test.js`.
- O contador escolhe **ATIVIDADE** (`idAtividade`), NÃO o anexo. A RFB decide
  anexo, faixa, III↔V do Fator-R, repartição e DAS. A gente só envia atividades.
- Mercado interno/externo é codificado no próprio `idAtividade` (ex: 1=interno,
  3=exterior) — NÃO há flag `tipoMercado` em `receitasAtividade`.
- `pa` é **Number** (AAAAMM). `receitaPaCaixa*`/`valorFixo*` = `null` quando não
  se aplica (valorFixo "deve ser > 0", senão null — não mandar 0).
- DAS = **soma de `valoresDevidos[]`** no retorno (não existe `valorTotalDevido`).
- Tabela `AtividadePgdasd`: **43 atividades oficiais**. Só as `verificadoTrial:true`
  foram exercidas contra a API; o resto vem da spec — confirmar antes de produção
  (`apps/api/scripts/mark-atividade-verificada.js <id>`).
- **Fila de transmissão** (`workers/apuracaoBatchWorker.js`, opt-in
  `APURACAO_BATCH_WORKER_ENABLED=1`): **consulta-antes-de-transmitir**
  (CONSDECLARACAO13) — PA já declarado NÃO é retransmitido (evita retificadora).

**Status (2026-06-09):** simulação validada em produção real (LENTE 2026-05 →
DAS R$ 26.670,52, `[Sucesso-PGDASD]`). Transmissão real (`true`) ainda não
exercida. Scripts úteis: `rodar-simulacao-pgdasd.js`, `gerar-payload-pgdasd.js`,
`gerar-curls-trial.js`, `test-fechamento-dados.js`.

### ⚠ TRÊS NÚMEROS DE DAS, TRÊS COLUNAS — a simulação NÃO mora em `dasCalculadoLocal`

`ApuracaoSnapshot` tinha **duas** colunas de DAS e **três** números para guardar. O resultado:
`FechamentoService.calcularFechamento` gravava o valor da **simulação oficial da RFB** dentro de
`dasCalculadoLocal` — a coluna do **nosso motor**, que `MotorApuracaoService` também escreve. A
coluna passou a guardar ora um, ora o outro, **sem nada na linha que os distinguisse**, e a tela
teve de inventar um estado ("DAS gravado — procedência ambígua") para não mentir sobre dado fiscal.

| coluna | quem escreve | o que significa |
|---|---|---|
| `dasCalculadoLocal` | `MotorApuracaoService.calcularApuracaoLocal` | conta NOSSA, tabela versionada de alíquotas. Conferência — não declara nada |
| `dasSimuladoSerpro` | `FechamentoService.calcularFechamento` | a RFB calculou (`indicadorTransmissao:false`). **Nada foi transmitido** |
| `dasRetornadoSerpro` | `FechamentoService.transmitirFechamento` | a declaração **existe na Receita** (`:true`) |

⚠ **Por que coluna NOVA e não gravar a simulação em `dasRetornadoSerpro`** (a opção mais barata):
simular não é transmitir, e o código **já depende** dessa diferença. `dasRetornadoSerpro` é escrita
no MESMO update que `numeroDeclaracao`, `transmitidoEm` e `estado:"transmitida"` — os quatro
descrevem um ato que aconteceu na Receita. No caminho `jaDeclarado` (PA já declarado, não
retransmitido) ela fica **nula de propósito**: "não há valor transmitido POR NÓS". E
`routes/firm/index.js` expõe a coluna literalmente como **`dasTransmitido`**, com
`apuracaoBatchWorker` lendo-a como resultado da transmissão em lote. Colapsá-las faria "a Receita
calculou R$ X" e "a declaração de R$ X foi entregue" virarem o mesmo dado.

⚠ **`dasCalculadoLocalProcedencia`** (`MOTOR_LOCAL` | `AMBIGUO`, vocabulário em
`apuracao/v2/procedenciaDas.js`) marca **de quem é** o número da primeira coluna. A **ausência** de
marca responde "ambíguo", nunca "nosso": linha com valor e sem marca é linha velha. Tratar o
default como nosso faria a ambiguidade sumir por omissão — que é como ela nasceu.

⚠ **O `{}` em `receitaPorTipo`/`receitaPorAnexo` era destrutivo, e o motivo era outro.** O
comentário original (`mantém compat com schema (NOT NULL? — confere)`) diz o que era: preenchimento
para satisfazer o NOT NULL no `create`, aplicado **também no update**. Efeito medido: toda
competência que passasse pelo [Calcular] tinha a segregação por tipo do mês **apagada** do
snapshot. Hoje:
- **`receitaPorTipo` volta a ser gravada de verdade** também no caminho da simulação — ela TEM esse
  dado (`receitaPorTipoMercado`, a mesma função que o `getDadosFechamento` e a `detectarDisparidades`
  já usam; não é segunda definição de faturamento);
- **`receitaPorAnexo` virou anulável**: NULO = *"o motor local não calculou esta competência"*;
  `{}` seria *"calculou e não achou anexo nenhum"*. O caminho da simulação **não decide anexo** —
  quem decide, a partir das `atividadesEscolhidas`, é a RFB —, então ele não escreve nada no grupo
  de colunas do motor (`dasCalculadoLocal`, `receitaPorAnexo`, `aliquotaEfetivaPorAnexo`,
  `vigenciaAliquota`). Sobrescrevê-las deixaria o número do motor sem a conta que o sustenta.

**Migration `20260813120000_add_procedencia_das` — escrita, NÃO aplicada.** O backfill desambigua
**só o que a própria linha prova**: os dois escritores gravam objetos inteiros numa transação, e
`receitaPorTipo` denuncia quem escreveu por último (vazio ⇒ simulação, que sempre zerava; não-vazio
⇒ motor, que sempre grava as sete chaves de `TipoReceita`). O que não casar com nenhuma das duas
assinaturas fica **`AMBIGUO`** — inventar procedência é o que este conserto existe para impedir.
Medir antes, sem escrever nada: **`scripts/diag-procedencia-das.mjs`** (só leitura, zero chamada
externa; roda antes e depois da migration e confere o gravado contra a mesma conta).

Regressão: `apuracao/v2/__tests__/procedenciaDas.test.js` (11) — inclusive a trava de que o estado
**ambíguo continua funcionando** para o snapshot antigo, dos dois lados (backend e
`apps/web/.../lib/relatorioFaturamento.js`).

### ⚠⚠ MEDIDO EM 26/08/2026: O DE-PARA DA CLASSIFICAÇÃO **NÃO** É O BLOQUEIO

⚠⚠ **A FRASE "`tipoReceita` nulo em 16.153/16.153 itens" ESTÁ SUPERADA, e ela sobrevive em ~14
comentários pelo repositório** (`relatorioFaturamento.js`, `SugestaoModal.jsx`, `notaItens.js`,
`docs/segregacao-receitas-simples.md`, `docs/dre-fluxo-caixa.md`, o mock, e este arquivo em três
pontos). Ela sustentava a conclusão de que faltava um de-para "item da LC 116 → tipo de receita" e
que a Fase 6.1 dependia de construí-lo. **As duas coisas são falsas.**

Medido contra a produção (`scripts/diag-classificacao-cobertura.mjs` · `-amostra` · `-55`, os três
só leitura, zero chamada externa):

| | |
|---|---|
| `RegraClassificacao` escopo GLOBAL | **127** — o seed ESTÁ aplicado (87 itens LC 116 + os 40 capítulos) |
| `NotaItem` total | 17.791 |
| ⤷ `tipoReceita` **NULO** | 16.476 — *o classificador nunca encostou* |
| ⤷ **`RECEITA_NAO_CLASSIFICADA`** | **0** — *ele rodou e não achou regra* |
| ⤷ classificados | **1.315** |
| `FilaPendencia(ITEM_SEM_REGRA)` abertas | **0** |

⚠ **A distinção entre as duas linhas do meio é o diagnóstico inteiro**, e é ela que a frase antiga
apagava: NULO diz *"ninguém olhou"*; `RECEITA_NAO_CLASSIFICADA` diz *"faltou regra"*. São **zero** da
segunda. Onde o classificador rodou, ele acertou **1.315 de 1.315**.

**E o alvo é muito menor do que parecia.** Os 16.476 itens não tocados usam **55 códigos de serviço
distintos** — é isso que um de-para cobre, não 16 mil itens:

- **54 de 55 já têm regra** · 16.472 de 16.476 itens (**99,98%**);
- **42 códigos / 16.331 itens (99,1%)** resolvem por **regra precisa** (código exato ou item da LC 116);
- **12 códigos / 141 itens (0,86%)** resolvem **só pelo fallback de capítulo**;
- **1 código / 4 itens** sem regra: **`990101`** → capítulo **99**, que **não existe na LC 116** (ela
  tem 40 itens). É o guarda-chuva de "não classificado", e a resposta certa para ele é **pendência**,
  não uma regra.

⚠⚠ **O RISCO NÃO É LACUNA — É RESPOSTA ERRADA EM SILÊNCIO.** O fallback de capítulo responde
**tudo**, então **nada cai na fila mesmo quando a resposta está errada para o subitem** — e é por
isso que a fila estar vazia não é prova de saúde. Capítulo que mistura anexos responde o subitem
pelo vizinho: **cap. 7** (engenharia × obra → Anexo IV), **cap. 17** (consultoria × **advocacia** →
Anexo IV), **cap. 4** (saúde). Os 12 códigos afetados saem listados pelo script, com descrição e
volume — os maiores são `17.12` "Administração em geral" (57 itens), `4.23` "Medicina veterinária"
(47) e `7.13` "Dedetização, desinfecção… higienização" (1, ⚠ que é candidato a *limpeza/conservação*,
Anexo IV pelo art. 18 § 5º-C). **Decisão do contador, 12 vezes, uma vez só.**

⚠ **A frase IRMÃ foi medida no mesmo dia, e ela CONTINUA VERDADEIRA** — só o número envelheceu:
**`flagExportacao` é `false` em 17.791 de 17.791** (era 16.153/16.153). São afirmações diferentes e
não devem ser colapsadas: uma é sobre classificação, a outra sobre exportação. A causa da segunda é
estrutural e não mudou — o único escritor de `flagExportacao` é `notas/dfe/DfeParser.js` (CFOP 7xxx,
ou seja **NF-e**), e serviço prestado ao exterior é **NFS-e** por definição. Confirmado por
`scripts/diag-exportacao-servico.mjs`: das 22 declarações transmitidas, as **2** com receita externa
são da CDA MARKETING e vieram da **memória da apuração** (`mercado: EXTERNO`), nunca da coluna.

⚠⚠ **E DOIS DEFEITOS DE ESCALA CONTINUAM ABERTOS**, hoje com custo ZERO (a fila está vazia) e custo
linear em 1.000 clientes: a pendência é deduplicada por **(empresa, código)** e não por código, e
`AprendizadoService` grava a regra resolvida em escopo **EMPRESA**. O mesmo código de serviço seria
decidido uma vez por cliente — O(n) onde o problema é O(1), porque o código não muda de significado
conforme o cliente. **Resolver uma pendência precisa poder promover a regra para GLOBAL.**

### ✅ 26/08/2026 — O CLASSIFICADOR RODOU. `tipoReceita` NULO caiu de 16.476 para **ZERO**

⚠⚠ **A SEÇÃO ACIMA MEDE O ESTADO DE ANTES. Este bloco mede o de DEPOIS**, e foi a execução que
provou a conclusão dela: o de-para nunca foi o bloqueio.

`scripts/rodar-classificacao.mjs --aplicar --tudo`, contra produção:

| | antes | depois |
|---|---|---|
| `NotaItem` total | 17.791 | **17.796** (⚠ +5 chegaram durante a execução — a captura do ADN roda) |
| `tipoReceita` **NULO** | 16.476 | **0** |
| `RECEITA_NAO_CLASSIFICADA` | 0 | **4** |
| classificados | 1.315 | **17.792** |
| `FilaPendencia(ITEM_SEM_REGRA)` abertas | 0 | **1** |

**Bateu com a previsão do diagnóstico, item por item:** 54 dos 55 códigos tinham regra, e o único
sem era o **`990101`** com 4 itens. É exatamente ele que virou a única pendência.

Distribuição: `SERVICO_FATOR_R` 16.143 · `SERVICO_ANEXO_III` 278 · `SERVICO_ANEXO_IV` 51.

⚠ **NADA foi CHUTADO e nada foi transmitido.** A execução é cálculo local sobre regras que já
estavam no banco — zero chamada a ADN, SEFAZ ou SERPRO. `force` **não é oferecido pelo script**: o
default (`false`) filtra `tipoReceita: null`, então os 1.315 itens já classificados e as
competências **já transmitidas** ficaram intocados.

⚠ **O script é o primeiro desta família que ESCREVE**, e por isso: ensaio por padrão, **lista de
desfazer gravada ANTES da primeira escrita** (os ids que estavam nulos), e **canário obrigatório** —
`--aplicar` sozinho roda UMA empresa e para. ⚠ O canário é a **MENOR exposição**, nunca a primeira
da lista: ela vem ordenada por volume, e `slice(0, 1)` pegaria a SINTROPIA, que sozinha é **94,5%**
dos itens. Canário que escreve quase tudo é a carteira com outro nome.

⚠ **A lista de desfazer tem ids de PRODUÇÃO e está no `.gitignore`** — artefato operacional, não
código. O script avisa para movê-la para fora da árvore.

**O que isto destrava:** a conciliação DAS × SERPRO (Fase 5) exigia `preApurado.ok`, e o motor
recusava por receita não classificada em 100% das empresas. Essa recusa deixou de existir.
⚠ **Mas o motor não roda sozinho** — `MotorApuracaoService.calcularApuracaoLocal` continua sendo
disparado por competência, pelo fluxo do [Calcular]. Classificar removeu o impedimento; não
calculou nada.

⚠⚠ **E A FILA VAZIA CONTINUA NÃO SENDO PROVA DE SAÚDE.** O fallback de capítulo responde **tudo**,
então os **12 códigos / 141 itens** que dependem dele foram classificados **sem cair na fila** —
inclusive nos capítulos que misturam anexos (7: engenharia × obra · 17: consultoria × advocacia ·
4: saúde). Eles estão agora gravados com um `tipoReceita`, e **conferi-los é decisão do contador**.
`scripts/diag-classificacao-55.mjs` lista os 12 com descrição e volume.

### ⚠⚠ AS DUAS ROTAS PUBLICAM A MESMA FORMA DO FATOR R — `cnaes`, nunca `cnaesDeFatorR`

A regra pura `sujeitoAoFatorR` (`application/planejamento/lib/`) devolve **`cnaesDeFatorR`**.
`DadosPlanejamentoService` renomeia para **`cnaes`** ao publicar em `GET /planejamento`; o
`PerfilFiscalService` **repassava a resposta CRUA**, e as duas rotas passaram a falar formas
diferentes da MESMA coisa.

⚠⚠ **O sintoma seria MUDO.** A tela lê `fatorR.cnaes`; sem ele o banner cai na frase genérica
("há atividade sujeita ao Fator R") **em vez de nomear os CNAEs** — que é exatamente o problema que
a mudança existe para resolver, numa empresa com seis CNAEs. Nenhum erro, nenhum log.

⚠ **E o navegador NÃO pegou**: o mock já devolvia `cnaes`, a forma certa. Quem pegou foi o teste
(`apuracao/v2/__tests__/perfilFiscal.test.js`) — a divergência mock × real que este projeto já
pagou várias vezes. A amarração é **textual**: um teste lê `DadosPlanejamentoService.js` e exige que
os dois publiquem a mesma chave, porque os dois serviços não se importam.

**Hoje `PerfilFiscalService` monta o objeto campo a campo** (`resposta`, `origem`, `motivo`,
`cnaes`, `divergencia`) em vez de espalhar a regra. Espalhar de novo reabre o defeito.

⚠ `PerfilFiscalService` **não tinha um único teste** até 26/08/2026, e é ele que responde "quais
atividades esta empresa exerce, e qual anexo cada uma implica". Os 20 testes de lá cobrem também o
defeito do `if` dentro do laço (CNAE que o contador DESATIVOU continuava forçando o Fator R da
empresa inteira) e o `temCadastro`/`prefill` que a tela usa para distinguir cadastro SALVO de perfil
DERIVADO — medido: **28 das 34 empresas não têm linha em `cadastros_fiscais`**.

## ⚠⚠ O ESTADO DAS MIGRAÇÕES — medido em 01/09/2026, e o que a medição NÃO diz

Durante muito tempo este arquivo repetiu *"migration escrita, NÃO APLICADA"* sem dizer **onde**, e
as notas envelheceram caladas: medido contra o banco de desenvolvimento (Postgres em Docker,
`localhost:5432/enviar`), **142 de 142 estão aplicadas**, incluindo quatro que este documento ainda
dava como pendentes (`add_tomador_emitido`, `add_carga_tributaria_nao_simples`,
`add_codigos_servico_nacional`, `add_password_reset_token`).

⚠⚠ **"NÃO APLICADA" É UMA AFIRMAÇÃO SOBRE UM BANCO, NÃO SOBRE O REPOSITÓRIO.** Sem dizer qual, ela
não se pode conferir — e uma nota que não se confere vira paisagem. Quem escrever uma nova diga
**em qual banco**, e com a data.

⚠ **PRODUÇÃO NÃO FOI MEDIDA e esta máquina não a alcança.** O `DATABASE_URL` local aponta para o
Docker; o de produção vive no Railway. Nada aqui autoriza concluir que a produção está em dia — e
aplicar migration em produção continua sendo ato do dono.

**Como medir, em vez de acreditar:**

```
cd apps/api && npx prisma migrate status      # o que falta
node scripts/diag-migracoes-01set.mjs         # se a COLUNA existe de verdade
```

⚠⚠ **As duas perguntas são diferentes, e a segunda é a que importa.** `migrate status` diz que o
Prisma REGISTROU a aplicação; o diagnóstico lê o `information_schema` e diz que a coluna EXISTE.
Uma migration com DDL torto consta como aplicada e deixa a coluna faltando.

## Situação Fiscal (SITFIS) + Confirmação de pagamento (Q40/Q41/Q43)

**SITFIS — situação fiscal do contribuinte** (`application/fiscal/serpro/SerproSitfisService.js`).
Serviço assíncrono em 2 etapas, resolvido inline (~28s) ou devolvido como `processando`:
- `/Apoiar` (`SOLICITARPROTOCOLO91`, versão **2.0**) → protocolo. Cache do dia: se já existe,
  responde **304** com o protocolo no header **ETag** (corpo vazio). Se o limite da conta foi
  atingido, responde **200 sem protocolo** com aviso **`[Aviso-Sitfis-AV02]`** + `tempoEspera`
  → tratamos como **"processando"** (não erro), com mensagem pedindo aguardar ~Xs.
- `/Emitir` (`RELATORIOSITFIS92`) → PDF em `dados.pdf` (base64). Status: 200 pronto · 202/204
  processando (aguarda `tempoEspera`) · 304 reusar protocolo.
- **Protocolo do dia é salvo** em `CompanyFiscalStatus.protocolo` e **reusado** (pula o `/Apoiar`,
  que é o que abre "slot" e dispara o AV02 — limite é **por contratante**, não por empresa).
  Reuso só no mesmo dia (America/Sao_Paulo); expirado → re-solicita.
- **Situação** derivada por palavra-chave sobre o **texto extraído do PDF** (`pdf-parse`):
  `devedor|dívida ativa|débito|pendência|…` → `COM_PENDENCIA`; com guard removendo frases de
  negação ("não há débitos") pra evitar falso-positivo. Best-effort, `verificadoTrial:false`.
- Rota `POST /firm/companies/:id/serpro/sitfis/relatorio` grava `CompanyFiscalStatus`
  (situacao/protocolo/texto/relatorioPdfFileId); numa reconsulta ainda "processando",
  **preserva** o último relatório/situação (não zera). PDF servido inline em
  `GET .../serpro/sitfis/pdf`. Página **Pendências** = `GET /firm/pendencias/fiscal`.
- Flag: **`INTEGRACAO_SERPRO_SITFIS`**. Status (2026-07): fluxo validado end-to-end em produção
  (Apoiar 304/ETag → Emitir 200 → PDF exibido/baixável); heurística ligada.

**PAGTOWEB — confirmação de pagamento por comprovante**
(`SerproPagtoWebService.js` + `SerproPaymentConfirmationService.js`, worker próprio).
- idServiço `COMPARRECADACAO72` via `/Emitir`; comprovante (PDF) = pago.
- **Validado em produção real (2026-07-28).** O payload é `{"numeroDocumento":"<só dígitos>"}`:
  com máscara → **HTTP 500** (`Erro-PAGTOWEB-00099`); com o nome `numeroDocumentoArrecadacao` →
  **HTTP 400**. A resposta traz **só `dados.pdf`** — não há data nem valor estruturados, então o
  rateio principal/juros/multa sai do **texto do PDF** (`parseComprovanteArrecadacao.js`, que só
  devolve o rateio se `principal+juros+multa == total`).
- ⚠ **A ordem das colunas de acréscimo é `principal · MULTA · JUROS · total`** — o inverso do
  cabeçalho impresso ("Total Juros Multa Principal"). A autoverificação da soma **não** pega uma
  troca entre juros e multa (a soma é a mesma), então a ordem está fixada por evidência: no
  comprovante real de INSS, 12,94/178,31 = 7,26% = 0,33%/dia × 22 dias (multa de mora) e
  1,78/178,31 = 1,00% (juros do mês do pagamento). Importa porque juros e multa viram lançamentos
  separados, em contas diferentes (501 e 506).
- ⚠ **O número do documento é a entrada de tudo.** Ele vive em
  `dados.detalhamentoDas.numeroDocumento` (DAS) — e `dados` vem ora objeto, ora array de 1 item.
  O extrator antigo varria o payload inteiro e pegava `contratante.numero`, o CNPJ do **escritório**
  ecoado na resposta: toda guia de DAS ficou com um número inexistente e a busca nunca achava nada.
  Hoje `extractDocumentNumber` tenta o **nome exato dentro de `dados`** antes da varredura ampla e,
  não achando, devolve `null` — nunca o CNPJ. Guias antigas se corrigem sem gastar chamada com
  `scripts/corrigir-numero-documento.mjs` (reextrai do `rawPayload` salvo); sem `rawPayload`, só
  recapturando. Diagnóstico: `scripts/diag-numero-documento.mjs`.
- A busca **só marca** a guia como paga (`pagamentoLocalizado`); quem faz o lançamento de baixa é o
  contador, pela Circular — ver "Guias na Circular".

### O comprovante não serve para dar baixa POR TRIBUTO (e o `PAGAMENTOS71` talvez sirva)

O DARF do Lucro Presumido é **um documento com até quatro tributos** (PIS, COFINS, IRPJ, CSLL).
Para **enviar**, isso está certo — é uma guia só, e `guideCompliance` mantém PIS+COFINS agrupados
de propósito. Para **dar baixa**, não: são quatro provisões, em contas diferentes.

O `COMPARRECADACAO72` **não fecha essa conta**: devolve só o PDF, e `parseComprovanteArrecadacao`
lê o bloco "Totais" do documento inteiro — sem quebra por código de receita. Ratear os quatro por
conta própria seria inferência virando lançamento contábil (regra 1). Hoje o worker **marca a guia
do LP como paga** e para aí: `gerarBaixaSePreciso` trata `parcelamentoId` e INSS, e o resto cai em
`tipo_sem_baixa_automatica`.

| | idServiço | endpoint | devolve |
|---|---|---|---|
| hoje | `COMPARRECADACAO72` | `/Emitir` | PDF do comprovante (lido por heurística) |
| candidato | `PAGAMENTOS71` | `/Consultar` ⚠ | `valorPrincipal`/`valorMulta`/`valorJuros` como CAMPOS + `desmembramentos`, cada um com sua `receitaPrincipal` |

Filtros confirmados na documentação: **`intervaloDataArrecadacao` e `codigoReceitaLista`**, mais
`primeiroDaPagina`/`tamanhoDaPagina`. ⚠ **Não há filtro por número de documento documentado** — o
casamento com a nossa guia se faz depois, pelo `numeroDocumento` de cada pagamento da resposta, e
**por dígitos**: as guias guardam o número COM máscara.

⚠ **Duas coisas não saem da fonte oficial** e estão marcadas no probe: o **endpoint** (o doc do
serviço não o declara; `/Consultar` vem do padrão já validado do próprio código — consulta que
devolve dados vai em `/Consultar`, emissão de documento vai em `/Emitir`) e **`versaoSistema`** (os
exemplos oficiais do PAGAMENTOS71 não trazem o campo, então não é enviado).

### ✅ EXERCIDO em 2026-08-09 — as três perguntas voltaram SIM

`scripts/probe-pagamentos71.mjs` rodou contra a produção em dois contribuintes. **A quebra por
tributo existe**: `receitaPrincipal` em **73/73** e **22/22** desmembramentos, com `valorMulta` e
`valorJuros` próprios em cada um. O DARF consolidado volta **inteiro**, com N desmembramentos.
`/Consultar` e a ausência de `versaoSistema` estavam certos (`versaoSistema=1.0` também passa).

⚠ **MAS ISSO NÃO AUTORIZA PARTIR O DAS DO SIMPLES.** Regra do dono (2026-08-09):

> *"a guia do Simples vem desmembrada nos impostos, porém contabilizamos junto, como DAS Simples
> Nacional."*

O `PAGAMENTOS71` devolve o DAS partido em seis (`1001` IRPJ-SN, `1002` CSLL-SN, `1004` Cofins-SN,
`1005` PIS-SN, `1006` INSS-SN, `1010` ISS-SN) — e **isso é informação, não instrução**. O DAS é
**um** lançamento. Quem partir em seis muda a forma do lançamento contábil sem pedido, que é
proibido.

**A baixa por tributo vale para a DARF consolidada do LUCRO PRESUMIDO**, e só: lá são quatro
provisões de verdade, em contas diferentes (PIS, COFINS, IRPJ, CSLL), e é esse rateio que hoje não
se consegue fazer sem inferência.

**Discriminador estruturado**, medido: `tipo.codigo` vem `"9"` (DOCUMENTO DE ARRECADAÇÃO DO SIMPLES
NACIONAL) ou `"4"` (DOCUMENTO DE ARRECADAÇÃO DE RECEITAS FEDERAIS). Não é preciso adivinhar pelo
texto.

⚠ **Ainda NÃO conhecidos: os códigos de TJLP do parcelamento do SIMPLES (PARCSN).** A rodada no
contribuinte do Simples não trouxe nenhum item de parcelamento — a empresa não tinha parcela paga
na janela. `CODIGOS_TJLP_PARCELAMENTO` cobre os de DARF (`380`/`389`/`391`/`387`) e o do IRRF
(`16`); sem os do PARCSN, uma parcela do Simples é classificada como recolhimento em atraso.
Para escolher o CNPJ certo antes de gastar chamada: `scripts/diag-parcelamentos-ativos.mjs`.

⚠ **O código de receita chega em DUAS escritas.** O PDF do comprovante imprime com zero à esquerda
(`"0380"`); o `PAGAMENTOS71` devolve sem (`"380"`, `"16"`). Comparar cru faz a classificação errar
em silêncio — use `normalizarCodigoReceita` (`classificarDocumentoArrecadado.js`).

⚠ **O `numeroDocumento` também diverge:** as guias guardam **com máscara e com zero à esquerda**
(`07.16.26218.4614539-3`, 17 dígitos); a API devolve 16 dígitos sem o zero. Casar por dígitos crus
falha. Ainda não há casamento implementado — quando houver, normalizar os dois lados.

`SERPRO_PAGTOWEB_SERVICE_PAGAMENTOS` existe em `config.js` e **nenhum código de produção o consome
ainda** — o probe provou o contrato, o serviço é o próximo passo.

## ⚠ REGRA DO DONO: notas só com o A1 da PRÓPRIA empresa

> *"O A1 do escritório nunca deve consultar notas, e um A1 de outro CNPJ nunca deve ser usado em
> outra empresa."*

Vale para **as duas capturas**, e as duas já tentaram furar essa regra por caminhos diferentes:

| | O que tinha | Consequência | Hoje |
|---|---|---|---|
| **ADN (NFS-e)** | fallback para o cert do escritório | o escritório **é** cadastrado no gov.br/nfse → voltavam as notas DELE, gravadas na empresa cliente | `NO_COMPANY_CERT` |
| **SEFAZ (NF-e)** | `loadOfficeCert()` como 2º caminho | a SEFAZ rejeita (cStat 593), mas o erro chegava tarde e confuso | `NO_COMPANY_CERT` · função **removida** |

⚠ **Procuração e-CAC não reabre isso.** Ela autoriza o escritório a agir no e-CAC; não transforma o
certificado dele no certificado do cliente perante o ADN ou a SEFAZ. `resolveCertForCompany` pode
devolver `source:"procuracao_escritorio"`, e **nenhum dos dois serviços de notas aceita esse source**.

**A checagem de dono do certificado roda na LEITURA**, em `CertResolver.loadCompanyCert`, não só no
upload. A rota de upload já recusa arquivo de CNPJ divergente (`inspectPfx` → `cert_cnpj_mismatch`),
mas é validação recente: todo certificado subido antes dela nunca passou por conferência. Guarda que
mora só no upload protege o futuro e deixa o passado como está. Erro: **`CERT_CNPJ_MISMATCH`**.

- **Mesma função** (`security/inspectPfx.js`) nas duas portas — duas heurísticas para ler o CNPJ do
  subject divergiriam, e o arquivo passaria numa e seria recusado na outra.
- **14 dígitos exatos**, igual ao upload. (Consequência conhecida: cert da matriz não serve para a
  filial. É o comportamento que já existia; mudar isso é decisão do dono, não detalhe de
  implementação.)
- ⚠ **CNPJ ilegível não bloqueia.** e-CPF ou subject fora do padrão ICP-Brasil só geram aviso no log:
  ausência de dado não é prova de certificado alheio, e recusar por falta de informação derrubaria
  empresa legítima. Quem pega o resto é o cinturão de ingestão, abaixo.

## Emissor de NFS-e — Fase 1 (backend). ✅ JÁ EMITIU EM PRODUÇÃO REAL

⚠⚠ **ESTA SEÇÃO AFIRMAVA O CONTRÁRIO ATÉ 18/08/2026** — ela abria com *"NADA FOI EMITIDO, EM NENHUM
AMBIENTE"* e com *"nenhuma variável `NFSE_*` está definida no Railway"*. As duas frases ficaram
**falsas** quando o dono configurou e emitiu, e um documento que erra sobre o próprio estado é pior
que documento nenhum: ele faz a próxima sessão decidir como se não houvesse nota no mundo.

**Medido em produção em 18/08/2026** (leitura direta, sem chamada externa):

| | |
|---|---|
| `NFSE_BASE_URL` | `https://sefin.nfse.gov.br/SefinNacional` |
| `NFSE_ENV` | **`producao`** |
| `ServiceInvoice` | **1 linha**, série `00001` nº 1, `status: "issued"`, **com chave**, de 17/08/2026 |

⚠ **A regra do dono NÃO mudou, e o que mudou foi quem a exerce.** Continua valendo: *nenhum agente
emite, cancela ou transmite NFS-e* — em ambiente nenhum, nem homologação. Quem emitiu foi o dono,
pela interface. O que caiu foi a rede de proteção acidental (`integrationReady()` falso): **hoje o
caminho está ligado e apontado para o sistema nacional de PRODUÇÃO**, então errar aqui produz nota
fiscal de verdade. Trate qualquer mexida em `NfseService`/`nfseNumeracao`/`buildDpsXml` com esse peso.

⚠ **E o cancelamento deixou de ser hipótese.** `POST /nfse/:chaveAcesso/eventos` (`e101101`) existe
e não tem porta na tela — o front só chama `/nfse/issue`. Havendo nota nossa emitida em produção, a
falta dessa porta passou a ser lacuna, não prudência. **Decisão do dono, ainda não tomada.**
⚠ Não confundir com o botão **"Marcar como cancelada"** da aba Notas
(`PATCH /firm/companies/:id/notas/:notaId/status`): ele só escreve `statusEfetivo` na NOSSA linha,
para a nota sair do faturamento e da apuração. **Não fala com o sistema nacional.** O rótulo dizia
"Cancelar" e foi trocado justamente porque, para um contador, esse é o nome do ato fiscal.

### ⚠ A CONFIGURAÇÃO DE EMISSÃO GANHOU ROTA PRÓPRIA (dono, 19/08/2026)

`PATCH /firm/companies/:companyId/emissao-nfse` (`routes/firm/index.js`, gate `ACCOUNTANT`+, no
molde da `emissao-cliente`). Nasceu porque a configuração de emissão virou **aba própria com salvar
próprio** no portal do contador.

- ⚠ **O `PATCH /firm/companies/:id` continua exigindo a empresa INTEIRA, e isso é a garantia, não o
  problema.** Medido: `validateAndNormalizeCompanyProfile` recusa payload parcial com **400**
  (`company_cnpj_invalid` → `company_razao_social_required` → `company_cnae_principal_required` →
  endereço) e o `tx.company.update` escreve ~30 colunas de uma vez. **Afrouxá-lo abriria a porta
  para meia empresa ser salva por qualquer chamador** — por isso a rota nova, e não um relaxamento.
- **Aceita SÓ sete campos:** `codigoServicoNacional`, `codigosServicoNacional`,
  `codigoServicoMunicipal`, `rpsSerie`, `pTotTribFed/Est/Mun`. Campo de fora é **recusado nomeando**
  (`campos_nao_aceitos`) — aceitar e descartar em silêncio é o defeito que estas mesmas colunas já
  sofreram (200 na resposta, campo vazio na recarga).
- ⚠ **`undefined` = não mexer · `null` = apagar** (regra do commit `11187501`): só entra no `data`
  do Prisma o que veio no corpo (`hasOwnProperty`). Um `data` com os sete sempre apagaria a carga
  tributária a cada salvar da aba, e a empresa pararia de emitir **em silêncio**.
- ⚠ **A normalização é a MESMA do cadastro:** `normalizeCamposEmissaoNfse` foi **extraída** de
  `validateAndNormalizeCompanyProfile` (`application/company/companyProfile.js`) e é chamada pelas
  duas portas. Refatoração pura — `routes/firm/__tests__/companyCamposNfse.test.js` passa **sem
  edição**. Duas normalizações fariam o mesmo valor ser aceito por uma porta e recusado pela outra.
- **Empresa sem `Company` legada responde 409 `company_legada_ausente`**, nunca 200: as sete colunas
  vivem na `Company`, e um "salvo" mentiroso deixaria o contador com a emissão recusando.
- ⚠ **A liberação ao cliente NÃO passa por aqui** — continua na `emissao-cliente`, com auditoria de
  quem/quando. Duas rotas para o mesmo ato é o começo de duas regras.
- Testes: `routes/firm/__tests__/emissaoNfseSalvarProprio.test.js` (14), olhando o **argumento
  passado ao Prisma** — só o `data` prova que a coluna não foi tocada.

### ⚠ QUEM PODE EMITIR (E CANCELAR) — o portão do cliente, decisão do dono, 18/08/2026

> *"o acesso a emissão deve ser liberado para o cliente pelo portal do contador"*

**O que estava medido:** `POST /nfse/issue` e `POST /nfse/:chaveAcesso/eventos` — os dois atos
fiscais — autorizavam só por `ensureLegacyCompanyAccess`, que é checagem de **VÍNCULO, não de
permissão**: `listAccessibleLegacyCompanyIds` inclui todo `CompanyClientUser` com `status:"ACTIVE"`.
Ou seja, **qualquer membro ativo do lado do cliente, do papel mais forte ao mais fraco, alcançava a
emissão** — e o caminho está ligado e apontado para o **sistema nacional de produção**.

**Duas guardas independentes**, e uma sem a outra não serve:

| guarda | onde | quem liga |
|---|---|---|
| a empresa | `PortalClient.emissaoClienteLiberada` (+ `...Em`/`...Por`) | o contador, `PATCH /firm/companies/:id/emissao-cliente` (`minRole: "ACCOUNTANT"`) |
| o papel | `CompanyClientUser.role` **≥ `CLIENT_ADMIN`** | ninguém — é regra |

- Regra pura: **`application/nfse/emissaoClienteAutorizacao.js`**; ligação (Prisma + HTTP):
  **`routes/middlewares/emissaoNfseGate.js`**. Testes: o da regra + `routes/__tests__/portaoEmissaoNfse.test.js`
  (a matriz nas duas rotas) + `routes/firm/__tests__/emissaoClienteLiberacao.test.js` (a porta do contador).
- ⚠ **O ESCRITÓRIO PASSA SEMPRE**, sem consultar a flag (admin-like **ou** `CompanyFirmAccess`
  ATIVO). Foi por esse caminho que a nota real de 17/08/2026 saiu; travá-lo pararia o contador, e é
  a regressão mais cara desta entrega.
- ⚠ **`ensureLegacyCompanyAccess` NÃO FOI TOCADA** — ela é usada em 12 pontos, em 4 arquivos, e
  autoriza LEITURA de notas e o ADN inteiro. O portão é um **segundo passo**, depois dela, e **só
  nos dois atos**. `GET /nfse`, `POST /nfse/consulta`, `adn.js` e `invoices.js` ficaram como estavam
  — ler nota não é ato fiscal, e há teste provando que a leitura não apertou.
- ⚠ **O mínimo é `CLIENT_ADMIN` por PRECEDENTE**: pró-labore, certificado A1 e sócios já o exigem.
- ⚠ **A recusa NOMEIA o motivo**, com **códigos distintos** (403): `EMISSAO_CLIENTE_NAO_LIBERADA` ×
  `EMISSAO_CLIENTE_PAPEL_INSUFICIENTE` — conserto diferente (um clique do contador × troca de
  papel). Faltando as duas, o `codigo` nomeia a da empresa e `motivos` traz as duas.
- ⚠ **Os dois ids.** A permissão mora no **`PortalClient`**; o que chega às rotas é a **`Company`
  legada**. A volta é por `PortalClient.companyId` (`@unique`) — **nunca** `portalClient.findUnique({where:{id}})`
  com o id legado.
- ⚠ **Empresa legada sem `PortalClient` não é "liberada por omissão"** — sem a linha do portal não
  existe a chave que o contador ligaria. Recusa nomeada.
- ⚠ **Desligar zera `...Em`/`...Por`.** Elas respondem *"quem autorizou este cliente a emitir?"*;
  guardar nelas o instante da REVOGAÇÃO daria dois significados a uma coluna só. Quem revogou fica
  no log. Mesmo desenho do `reabrir` do fechamento contábil.
- ⚠ **O estado volta no payload da empresa** (`emissaoCliente: {liberada, liberadaEm, liberadaPor,
  liberadaPorNome}`) — as três colunas entraram nos **três** `select` explícitos de `PortalClient`
  em `routes/firm/index.js`, e o nome é resolvido em uma query (`anexarQuemLiberouEmissao`).
- **Migration `20260818120000_add_emissao_cliente_liberada`** — aditiva, `DEFAULT false`, **sem
  backfill** de propósito (nenhum dado no banco prova que o contador quis liberar alguma empresa).
  **Aplicada no banco LOCAL em 18/08/2026; ainda NÃO em produção.**

#### A porta do cliente — `POST /client/companies/:companyId/nfse` (18/08/2026)

O app do cliente fala tudo por `/client/...`, e a emissão vivia só em `POST /nfse/issue`, **outro
router, que não sabe distinguir escritório de cliente** — foi essa indistinção que criou o buraco de
autorização fechado no mesmo dia. Em vez de ensinar aquele router a falar duas línguas, o lado do
cliente ganhou a própria porta, em `routes/client/index.js`.

⚠ **É FACHADA, e a palavra importa: nenhuma regra de emissão mora nela.** Ela delega — validador
(`validateNfsePayload`), resolução dos dois ids (**`resolveLegacyCompanyId`**, a mesma de
`/nfse/issue`), portão (`ensureEmissaoNfseAutorizada`), serviço (`NfseService.issue`) e desfechos.
Escrever uma segunda resolução, uma segunda validação ou um segundo mapa de resposta é o defeito que
o desenho existe para impedir: as duas portas discordariam na primeira correção, e a que o cliente
usa é a que ninguém do escritório testa.

- **Os desfechos saíram de dentro de `routes/nfse.js` para `routes/nfseEmissaoHttp.js`**
  (`responderResultadoEmissao` / `responderErroEmissao`), consumido pelas DUAS portas. O mapa das
  três camadas continua o mesmo: `NOSSA` → 400 · `TRANSPORTE` → 502 · `RECEITA` → 422. Aquele
  arquivo **não valida e não decide nada** — só traduz para HTTP.
- ⚠ **O PATH VENCE O CORPO**, e o spread vem antes: `{ ...body, companyId: path }`. Invertido, um
  `companyId` no corpo apontaria a emissão para OUTRA empresa depois de a permissão ter sido
  conferida nesta — literalmente o furo de multi-tenancy medido na F1 do WhatsApp.
- `requireClientCompanyAccess()` entra **sem `minRole`**, de propósito: quem responde "este papel
  emite?" é o portão, com código e mensagem próprios. Um `minRole` aqui devolveria
  `insufficient_role` genérico, e o cliente não saberia se o problema é o papel dele ou a liberação
  do contador.
- **A flag viaja em `GET /client/companies`** como **`emissaoNfseLiberada`** (booleano, `=== true`).
  Antes disto o app só descobria o portão pela RECUSA, depois de preencher a nota inteira.
  ⚠ **SÓ A FLAG.** `emissaoClienteLiberadaEm`/`...Por` são registro de **auditoria do contador** —
  o id e o instante de um usuário do escritório não são dado do cliente. Ampliar aquele `select` é
  o caminho por onde vazamento entre lados acontece sem ninguém notar; há teste varrendo o JSON.
  ⚠ E a flag **não é a permissão**: quem decide continua sendo o portão, no servidor, a cada
  emissão. Ela existe para a tela não oferecer um botão que vai ser recusado.
- Testes: `routes/client/__tests__/emissaoNfseCliente.test.js` (18) — a matriz do portão medida por
  **`NfseService.issue` não ter sido chamado**, os três desfechos, o corpo malicioso e a flag.

#### A porta do DANFSe do cliente — `GET /client/companies/:companyId/notas/:notaId/danfse` (19/08/2026)

> Pedido do dono: *"o DANFE da nota deve ser gerado"*, no portal do cliente.

**A feature inteira já existia** (gerador NT 008 com QR Code, 50 testes; rota do escritório desde
`700a1b18`). Faltava a porta deste lado, e **nada de PDF foi escrito**.

⚠ **A rota `/firm` não dava para reusar**: `requireFirmCompanyAccess()` responde *"esta pessoa é do
ESCRITÓRIO desta empresa?"*. Afrouxá-lo abriria as outras ~20 rotas do mesmo router (fechar/reabrir
competência, classificar, transmitir apuração) ao lado do cliente.

⚠ **O CORPO DA ROTA DO ESCRITÓRIO FOI EXTRAÍDO, não copiado** — achar a nota, recusar sem XML e
derivar a **marca d'água** do ciclo moram agora em **`application/nfse/danfse/danfseDaNotaDoPortal.js`**,
e os desfechos HTTP em **`routes/danfseHttp.js`** (mesmo desenho de `nfseEmissaoHttp.js`). Duas
cópias da regra da marca d'água divergiriam, e o cliente veria um PDF **sem** "CANCELADA" sobre a
MESMA nota em que o contador vê com.

- `requireClientCompanyAccess()` **sem `minRole`**: baixar documento auxiliar é LEITURA, e o piso
  das rotas financeiras é "membro ativo" — exigir `CLIENT_ADMIN` seria mais estrito que o
  `GET /invoices` que lista a mesma nota e serve o XML dela.
- ⚠ **O 503 `danfse_sem_qrcode` chega ao cliente com o `motivo`.** Um DANFSe sem QR Code não é um
  DANFSe (NT 008 §2.2/§2.4.3). Tela em branco ou "falha ao baixar" seria a mentira que ele impede.
- Testes: `routes/client/__tests__/danfseCliente.test.js` (14) — o portão, o escopo do path, as
  cinco recusas nomeadas e os headers. O PDF em si continua medido em `danfse/__tests__/danfse.test.js`.

#### A porta de CANCELAMENTO do cliente — `POST /client/companies/:id/notas/:notaId/cancelar` (19/08/2026)

> Decisão do dono: *"esqueça substituir então, deixe apenas o cancelar."*

⚠⚠ **É o ato mais perigoso que o app do cliente pratica**, e o caminho está ligado e apontado para
o sistema nacional de PRODUÇÃO. Mesma fachada da emissão, com o **MESMO portão**
(`ensureEmissaoNfseAutorizada`) — decisão já registrada em `routes/nfse.js`: *"emitir e cancelar são
os dois atos da mesma tela, e duas regras divergiriam na primeira correção"*.

- ⚠ **A CHAVE NÃO VEM DO CLIENTE.** O app manda o `notaId` (o `PortalInvoice.id` que ele já tem na
  lista) e a chave é lida no servidor, de uma nota escopada por `clientId`. Aceitá-la no corpo
  deixaria qualquer membro cancelar a nota de outra empresa conhecendo a chave — que sai **impressa
  no DANFSe**. `tipoEvento` também não vem do corpo: a porta faz UMA coisa (`e101101`).
- ⚠ **`sendEvent` ganhou `companyId` opcional.** Sem ele a empresa saía de `findByChaveAcesso`, que
  procura em **`ServiceInvoice`** — a tabela das NOSSAS emissões. Nota capturada do ADN (emitida no
  Emissor Web, em outro ERP) não tem linha lá e morria em `NFSE_NOT_FOUND`, **que é a maioria da
  lista que o cliente vê**. Ausente, o comportamento é exatamente o de antes.
- Recusas NOSSAS antes de qualquer I/O: `nota_nao_encontrada` (404), `nota_sem_chave` (422),
  `nota_ja_cancelada` (422 — um segundo pedido volta recusado e se lê como "falhou").
- Testes: `routes/client/__tests__/cancelamentoCliente.test.js` (23) — cada recusa medida por
  **`NfseService.sendEvent` NÃO ter sido chamado**.

#### As duas portas do LOTE POR PLANILHA — `/client/companies/:id/nfse/lote` (19/08/2026)

> Dono: *"a planilha deve ser baixada por nós o modelo, o cliente preenche; se o CNPJ preenchido for
> de um tomador que já teve antes, só preencher; se não teve consultamos na API; e se a API não
> retornar nós avisamos isso em uma tela para ajuste daquela nota."*

⚠⚠ **ESTE BLOCO DIZIA QUE A EMISSÃO EM LOTE NÃO EXISTIA. ELA FOI CONSTRUÍDA EM 20/08/2026.**
`GET /modelo` devolve um .xlsx e `POST /leitura` classifica sem gravar nada — as duas continuam
inertes. O que mudou é que existem mais **quatro** portas, e elas EMITEM NOTA FISCAL EM SÉRIE:
`POST /emissao`, `GET /emissao/:loteId`, `POST /emissao/:loteId/retomar` e
**`POST /emissao/:loteId/retentar`** (21/08/2026 — ver "A RETENTATIVA" abaixo).

⚠⚠ **AS QUATRO NASCEM DESLIGADAS (`INTEGRACAO_NFSE_LOTE`), COM O SERVIDOR RECUSANDO (503 nomeado)** —
não é a tela que esconde o botão; um `curl` passaria por cima dela. Ligar é ato do dono,
acompanhando o primeiro lote real. Ver a seção "A EMISSÃO EM LOTE" logo abaixo.

Regra pura em `application/nfse/lote/` (`colunasLote` · `modeloPlanilhaLote` · `lerPlanilhaLote` ·
`celulasLote` · `classificarLinhaLote` · `ajustesLote`), fábrica de router em
`routes/nfseLoteRoutes.js`, montada em `routes/client/index.js`.

**Quatro estados, lista FECHADA:** `pronta` · `conferir` · `consultar` · `pendente`. ⚠ `PRONTA`
exige as duas listas vazias **e** endereço resolvido por origem conhecida — estado não previsto cai
em `PENDENTE`, nunca em `PRONTA`.

⚠⚠ **A PLANILHA TEM QUATRO COLUNAS DESDE 20/08/2026 — eram DOZE.** Dono: *"não precisamos de nada do
tomador, apenas o CNPJ ou CPF. Em caso que precise de mais informações, na hora da revisão nós
avisamos e permitimos o preenchimento."* Ficaram `documento` · `descricao` · `valor` ·
`competencia`, **todas obrigatórias**. Saíram `nome`, `email` e o bloco inteiro de endereço.

⚠⚠ **ELAS NÃO SUMIRAM DO FLUXO — MUDARAM DE LUGAR.** Continuam em `CAMPOS_DA_REVISAO`
(`colunasLote.js`), e são **duas listas com perguntas diferentes**: `COLUNAS_LOTE` é o que o
cabeçalho pode conter; `CAMPOS_DA_REVISAO` é o que uma pessoa pode corrigir — e é contra a segunda
que `ajustesLote.js` valida. Nome, e-mail e endereço vêm, nesta ordem: **revisão** (o que a pessoa
digitou vence) → **memória** (`tomadores_emitidos`) → **consulta** (só CNPJ).
⚠ `ORIGEM_ENDERECO.PLANILHA` virou **`ORIGEM_DO_DADO.REVISAO`**, e não é renomeação cosmética:
aquelas células não têm mais coluna de onde vir. A linha devolve também `origemNome`.

⚠⚠ **O NOME É EXIGIDO PELO VALIDADOR (`tomador_nome_obrigatorio`) E MESMO ASSIM SAIU DA PLANILHA.**
A regra antiga — *"a razão social da consulta NÃO preenche um nome em branco"* — caiu junto com a
coluna: ela existia porque o nome era coluna obrigatória. Hoje branco é o estado normal, e o que vira
pendência é a ausência das TRÊS origens. ⚠ A consulta passa a ser pedida **pelo nome também**: sem
isso, um CNPJ cujo endereço a pessoa já digitou iria a `PENDENTE` por `nome_ausente` sem que a
Receita fosse perguntada.

⚠⚠ **CPF QUE NUNCA RECEBEU NOTA CAI SEMPRE NA REVISÃO — é a regra, não um buraco.** CPF não se
consulta, então não existe origem nem para o nome nem para o endereço, e as duas faltas voltam
nomeadas (`nome_ausente` + `cpf_sem_endereco`).

⚠⚠ **O `cMun` CONTINUA SENDO CÓDIGO, E NINGUÉM O DIGITA.** *"Código do IBGE é abstração"* (dono) —
a revisão usa o `SeletorMunicipio` que a emissão avulsa já tem (busca por nome, mostra município **e
UF**, não autosseleciona nem com resultado único) e devolve o código junto da escolha.
⚠⚠ **NÃO EXISTE, EM LUGAR NENHUM, CONVERSÃO DE NOME EM CÓDIGO.** Medido na lista oficial: **240 nomes
cobrem 521 municípios**. `conferirMunicipioDaRevisao` recusa o que não for código e manda escolher.
⚠ **E o campo não tem PADRÃO nenhum** (dono: *"o município do tomador só deve ser preenchido pelo
cliente se a consulta do CNPJ não retornar"*): valor escolhido pelo sistema fica indistinguível de
valor conferido por uma pessoa.

⚠ **NÃO HÁ COLUNA DE ATIVIDADE / CÓDIGO DE SERVIÇO**, e o dono pediu explicitamente que não houvesse
(*"o cliente não sabe escolher isso"*). Nunca houve. O lote **não manda o campo** e quem decide é
`escolherCodigoServicoNacional`, lendo o cadastro — o caminho de sempre. ⚠ A troca POR NOTA dentro
do lote **não foi construída**: ela exigiria o código viajar no payload congelado de cada linha.

⚠⚠ **O `:companyId` DO PATH NÃO SERVE PARA A MEMÓRIA — e errar isso é SILENCIOSO.** Ele é um
`PortalClient.id`; `TomadorEmitido.companyId` é o id da `Company` legada (gravado com `company.id`
depois do `markIssued`). Sem resolver, o `findMany` volta **vazio, sem erro nenhum**: todo CNPJ cai
em `consultar` e o *"se já teve antes, só preencher"* — metade do pedido do dono — nunca acontece,
com a tela funcionando. É a mesma família do `legacyCompanySelect`. Por isso a fábrica recebe
**`resolverCompanyId: resolveLegacyCompanyId`** (a mesma resolução da emissão) e o padrão é
identidade. ⚠ **Só o escopo da MEMÓRIA usa o id resolvido; o de ACESSO é sempre o do path.**
Travas: `routes/__tests__/nfseLoteRotas.test.js` (comportamento) +
`routes/client/__tests__/loteMontadoNoPortalDoCliente.test.js` (varredura da montagem).

⚠⚠ **E ISTO SE REPETIU NA QUINTA VEZ, EM 20/08/2026** — `GET /client/companies/:companyId/nfse/tomadores`,
a porta de LEITURA da mesma memória para o SELETOR da tela de emissão avulsa (dono: *"na aba de
emissão deve haver um seletor para selecionarmos tomadores já emitidos"*). Mesma resolução, mesma
trava por varredura de fonte (`routes/client/__tests__/tomadoresEmitidosDoCliente.test.js`).
⚠ **Nenhum cadastro novo foi criado**: `listarTomadoresEmitidos` mora no MESMO
`application/nfse/tomadorEmitido.js`, responde *"quem eu já conheço?"* (a irmã
`buscarTomadoresEmitidos` responde *"conheço ESTE documento?"*), **não lança** — com a migration
`20260819140000_add_tomador_emitido` não aplicada a tabela não existe (P2021), e isso não pode
derrubar a tela de emissão — e **não escreve nada**: quem escreve é uma nota que o sistema nacional
autorizou. Não existe rota de escrita de tomador do lado do cliente, e criar uma transformaria o
registro do que a emissão TEVE num cadastro editável.

⚠ **`requireClientCompanyAccess()` SEM `minRole`**: baixar um modelo e conferir uma planilha são
LEITURA, e o piso das rotas financeiras do cliente é "membro ativo". O portão de emissão
(`ensureEmissaoNfseAutorizada`) é da EMISSÃO e fica na rota que emitir.

⚠⚠ **A CONSULTA À RECEITA NÃO SAI DAQUI.** (⚠ O parágrafo abaixo descrevia um `cMun` vindo da
PLANILHA; desde 20/08/2026 ele só pode vir da REVISÃO, e o servidor **tem** a lista para conferi-lo.
O que continua valendo inteiro é de quem sai a consulta.) O
classificador é PURO: devolve `consultar` com a lista `aConsultar`, e quem consulta é o front — é lá
que a chamada à BrasilAPI já mora (direto do browser) e onde está a lista oficial do IBGE. A mesma
lista é o que falta para provar o `cMun` que vem NA PLANILHA: por isso ele sai marcado
`municipio_nao_conferido` (estado `conferir`, **nunca** `pronta`) e **a conferência acontece na
tela**, que a completa e rebaixa para `pendente` (`municipio_inexistente`) o código que não existir.
⚠ A tabela do IBGE virou **arquivo único** em `@contabilidade/shared/municipios-ibge` em
20/08/2026 (eram duas cópias, uma por portal). Isso **não reabre** a recusa de 19/08/2026, que foi
contra ACRESCENTAR uma terceira cópia no `apps/api`: mover elimina cópias. ⚠ E o classificador
continua recebendo a lista **por parâmetro** — ele não importa o pacote.

**O segundo passe vem no MESMO POST**, em dois campos, os dois parciais por natureza:

| campo | chave | malformado |
|---|---|---|
| `consultas` | **documento** (20 linhas do mesmo CNPJ = 1 consulta) | vira "nenhuma consulta conhecida"; as linhas voltam em `consultar` |
| `ajustes` | **número da linha DO EXCEL** | ⚠⚠ **RECUSA NOMEADA** (`ajuste_forma_invalida`) |

⚠ A assimetria é deliberada: consulta é dado DERIVADO (o front refaz), ajuste é o que uma **pessoa
digitou** — descartá-lo em silêncio faria a tela dizer que enviou a correção e o servidor
reclassificar com o valor velho. Pelo mesmo motivo, coluna fora da lista fechada
(`ajuste_coluna_desconhecida`) e linha inexistente (`ajuste_linha_desconhecida`) **recusam sem
aplicar nada**. ⚠ O número é o do EXCEL, nunca índice de array: eles divergem na primeira linha em
branco, e o ajuste iria para a NOTA ERRADA.

⚠ **A resposta devolve `linhasAjustadas` e as `valores` de cada linha.** As células voltam porque a
linha PENDENTE — a que precisa de ajuste — tem `dados: null`, e sem elas a tela não sabe de que nota
está falando nem tem o que editar. ⚠ A data sai formatada com os **mesmos acessadores** de
`lerCompetenciaDaPlanilha` (hora local), nunca em ISO: o ISO converte para UTC e mostraria um dia
diferente do que o classificador leu. ⚠ E o ajuste **não persiste** — a planilha no disco continua
dizendo o antigo, e é por isso que `linhasAjustadas` existe e a tela precisa dizê-lo.

⚠ A **linha de exemplo do modelo**, voltando intacta, é descartada e reportada
(`exemploDescartado`): ela é uma nota completa e bem formada, e na fase de emissão sairia como
documento fiscal de verdade.

- Testes: `application/nfse/lote/__tests__/` + `routes/__tests__/nfseLoteRotas.test.js` +
  `routes/client/__tests__/loteMontadoNoPortalDoCliente.test.js` (6).

### ⚠⚠ A EMISSÃO EM LOTE — trabalho PERSISTIDO, sequencial, e que PARA no desfecho desconhecido (20/08/2026)

> Dono: *"ao importar a planilha, as notas devem aparecer em resumo, com campos a modificar se
> necessário, e ao final ele pode clicar em emitir para emitir todas."*

⚠⚠ **CADA LINHA É UM ATO FISCAL IRREVERSÍVEL**, e o caminho está apontado para o sistema nacional de
PRODUÇÃO. Nasce DESLIGADA (`INTEGRACAO_NFSE_LOTE`), com o **servidor** recusando.

**Por que NÃO é síncrono — medido, não estimado:**

| | |
|---|---|
| piso local por nota | **48 ms** (janela de numeração 29 + assinatura 5,7 + gzip 0,1 + mTLS 13, contra localhost) |
| teto por nota | **15 000 ms** — o `timeout` do axios em `NfseService.js`. **313× o piso** |
| conexão | `buildAxiosClient` cria um `https.Agent` NOVO por chamada ⇒ handshake mTLS por nota, sem keep-alive |
| `server.requestTimeout` (Node 20) | **300 000 ms**, e o `server.js` NÃO o sobrescreve |

Lote de 50 no teto = 750 s ⇒ **o runtime mata a requisição aos 300 s**, no meio, com notas reais já
emitidas e a resposta descartada. Determinístico para qualquer lote cuja média passe de 6 s/nota.

⚠ **E a razão mais forte não depende disso.** As `ServiceInvoice` já são duráveis (a reserva grava
antes do envio) — as NOTAS não se perdem. O que não sobrevive a um POST é o **LOTE**: quais linhas
são dele, qual virou qual nota, **qual é a linha indeterminada**, quais números foram queimados, e a
identidade que faz a segunda subida ser reconhecida. **Idempotência é afirmação sobre estado que
dura mais que uma requisição** — não existe versão síncrona dela.

**Models:** `LoteEmissaoNfse` (`lotes_emissao_nfse`) + `LoteEmissaoNfseLinha`
(`lotes_emissao_nfse_linhas`). Migration `20260820120000_add_lote_emissao_nfse` — **escrita, NÃO
APLICADA** (⚠ o `schema.prisma` foi editado junto: models NOVOS que nenhuma consulta existente lê).

**As regras, e onde cada uma mora** (`application/nfse/lote/emissaoLote.js`):

- ⚠ **SEQUENCIAL**: `for...of` com `await`, **sem parâmetro de concorrência** — parâmetro é como
  alguém põe 2 nele depois. Há teste varrendo o arquivo atrás de `Promise.all`.
- ⚠⚠ **`TRANSPORTE` para o lote NA HORA**, grava `linhaIndeterminada`, `break`. As seguintes ficam
  `nao_tentada` — que é a verdade: ninguém encostou nelas.
- ⚠⚠ **A retomada é uma QUERY, não um `if`**: `numeroLinha > linhaIndeterminada`, estritamente
  maior. A linha cujo desfecho não se sabe **não está no conjunto, por construção**.
- ⚠⚠ **O estado `enviando`** é gravado ANTES do POST. É a janela entre a reserva de numeração
  commitar e a resposta voltar: sem ele, um processo que morresse ali deixaria a linha dizendo
  `nao_tentada` — com número queimado e nota possivelmente emitida — e a retomada a emitiria DE
  NOVO. Toda linha achada em `enviando` vira `indeterminada`.
- ⚠⚠ **A reserva da linha é ATÔMICA** (`updateMany` com o desfecho no `where`, e o `count` é lido).
  **Isto — e não o lock — é o que impede a nota duplicada**: dois processamentos concorrentes do
  mesmo lote leriam ambos `nao_tentada` e ambos emitiriam. Medido desligando a cláusula: **8
  emissões para 4 linhas**.
- ⚠ **Impressão digital** = SHA-256 sobre as linhas `PRONTA` já classificadas, na ordem — **não**
  sobre os bytes do arquivo (o Excel reescreve metadados; e os `ajustes` mudam o que será emitido
  sem tocar no arquivo). Segunda subida devolve **200 com o lote existente**, não 409.
- ⚠ **Só `PRONTA` entra.** `CONFERIR` também carrega `dados` — filtrar por "tem dados" deixaria
  passar tudo que a conferência rebaixou. Há teste.
- ⚠ **Recusa da camada `NOSSA` NÃO queima número**: ela acontece no pré-voo, antes da reserva. A
  linha fica com `rpsNumero` NULO, e o relatório não pode dizer o contrário.
- ⚠⚠ **Exceção não classificada PARA o lote como indeterminada.** Só uma lista FECHADA de códigos
  de pré-voo vira recusa local: o `catch` de `issue` grava com `markIssued`, e se ESSA gravação
  falhar a exceção escapa **depois de o POST ter saído**.

⚠ **`emissaoLote.js` não importa o `NfseService`** — quem emite é INJETADO. É o que faz o dublê ser
o caminho natural nos testes, não o cuidadoso. Travado por varredura de fonte.

Testes: `lote/__tests__/emissaoLote.test.js` (31, com um Prisma em memória que guarda estado de
verdade — inclusive o 502 que para o lote, a retomada que pula a indeterminada, a janela `enviando`
e a concorrência) + `routes/__tests__/nfseLoteEmissaoRota.test.js` (22 — a flag, o portão antes da
primeira linha, a reconferência no servidor e a idempotência).

#### ⚠⚠ A RETENTATIVA — reemitir SÓ o que provadamente não virou nota (21/08/2026)

> Caso real: lote de 3 notas (ALTAN, VAGALO, ARAUJO E SILVA 2) **recusado pela Receita** por erro de
> esquema (`E1235`). O erro do XML foi consertado e está em produção (`961e9c07`). O dono subiu a
> mesma planilha e a tela respondeu *"Esta planilha já havia sido emitida"* — com **Emitidas 0 ·
> Recusadas 3**. Zero notas no mundo, e nenhuma saída.

⚠⚠ **A IDEMPOTÊNCIA NÃO FOI REMOVIDA — ELA DEIXOU DE SER SOBRE O LOTE E PASSOU A SER SOBRE A
LINHA.** Subir a mesma planilha continua RECONHECENDO e continua **não reemitindo nada**; o que
existe agora é uma porta própria que reemite por linha, com o portão e a regra na frente.

**A regra, em `application/nfse/lote/emissaoLote.js` — lista FECHADA e de INCLUSÃO:**

| desfecho | retenta? | por quê |
|---|---|---|
| `RECUSADA_RECEITA` | **sim** | a Receita analisou e recusou: a recusa é anterior ao documento, não existe nota, e o número volta a ser reutilizável |
| `RECUSADA_NOSSA` | **sim** | recusa de pré-voo — nada saiu da máquina, nenhum número foi reservado |
| `NAO_TENTADA` | **sim** | ninguém encostou nela |
| `EMITIDA` | ⚠⚠ **NUNCA** | a nota EXISTE. Reemitir é duplicar documento fiscal |
| `INDETERMINADA` | ⚠⚠ **NUNCA** | a nota PODE existir e ninguém sabe qual |
| qualquer outro | **não** | a lista é de INCLUSÃO: estado novo entra bloqueado por construção |

- ⚠ **É a MESMA prova em que `NfseService.issue` já se apoiava** para aceitar `retryInvoiceId` (*"só
  é aceito quando a falha daquela linha LIBEROU o número — camadas `NOSSA` e `RECEITA`"*). Não é
  regra nova; é a que já existia, alcançando o lote.
- ⚠⚠ **O CASO PARCIAL É O QUE SEPARA UM CONSERTO DE UM DESASTRE:** lote com 2 emitidas e 1 recusada
  reemite **uma** nota. A decisão é **por LINHA** — nada neste caminho lê o status do LOTE.
- ⚠⚠ **A TRAVA É O `where` DA RESERVA ATÔMICA**, que passou de `desfecho: NAO_TENTADA` para
  `desfecho: { in: <conjunto do modo> }`. `emitida` e `indeterminada` não estão em conjunto nenhum —
  nem por default, nem por modo desconhecido (`desfechosDoModo` cai no conjunto MAIS ESTREITO). Um
  `curl` direto na rota bate nessa cláusula, não na tela.
- ⚠ **`selecionarParaRetomada` ganhou `modo`**: na RETOMADA continua `numeroLinha > linhaIndeterminada`
  (a regra 3, intacta); na RETENTATIVA é `not: linhaIndeterminada` — ela não é uma continuação, volta
  em linhas já tentadas, inclusive ANTES do ponto de parada. Nos dois, a linha indeterminada também
  está fora pelo DESFECHO.
- ⚠⚠ **A RETENTATIVA REUSA O NÚMERO** (`retryInvoiceId: linha.serviceInvoiceId`): não existe
  inutilização na NFS-e, e reservar número novo a cada tentativa abriria buraco permanente. Numa
  linha nunca tentada isso é `null` e o comportamento é o de antes. Quem recusa o reuso continua
  sendo `NfseService.issue` (falha de TRANSPORTE não libera número).
- **A rota:** `POST /emissao/:loteId/retentar` — flag, portão, escopo por empresa (404), e **422
  `nada_a_retentar`** quando o plano volta vazio (é por aqui que passa o lote inteiramente emitido).
  Ela **não** filtra linha e **não** aceita a planilha de novo: o payload de cada linha está
  congelado em `dados`.
- ⚠ **O `POST /emissao` reconhecido devolve `retentativa`** (o plano), para a tela oferecer sem uma
  segunda ida ao servidor.
- ⚠⚠ **`tentadaEm` passou a viajar em `paraTela`.** A coluna sempre existiu e não chegava à tela: o
  relatório dizia "Recusada pela Receita" **sem dizer quando**, e em 21/08/2026 um resultado das
  11:41 foi lido como sendo das 12:41. Nulo na linha `nao_tentada` — a tela mostra traço, nunca a
  data do lote no lugar.

### ⚠⚠ A LISTA DO IBGE PASSOU A SER LIDA PELO `apps/api` — e a regra 6 fechou

Até 20/08/2026 o classificador recebia `municipios: null`, e isso tinha duas consequências que só
apareceram ao desenhar a emissão:

1. **endereço vindo da PLANILHA nunca podia ser `pronta`** (saía `municipio_nao_conferido`, que é
   conferência e rebaixa a linha) — o cliente que preenchesse o endereço, que é o fluxo do dono,
   teria **zero** linhas emitíveis;
2. **o `cMun` da CONSULTA era aceito por um booleano do navegador** (`cMunVerificado`). Na emissão
   avulsa é uma nota por vez; num lote seriam 50 notas apoiadas numa afirmação não conferida.

Com a tabela unificada em `packages/shared` (arquivo único), o servidor **refaz a prova tripla**
(7 dígitos + existe na lista + município/UF batem com a MESMA resposta) em
`conferirMunicipioDaConsulta`. ⚠ **`cMunVerificado` não é mais lido em lugar nenhum** — um front
que mandasse `true` com o código de outro município é RECUSADO. Por isso o front passou a enviar
`municipio`/`uf` crus: sem eles a prova 3 não fecha e a linha é recusada (**falha fechado**).

⚠⚠ **E O PACOTE PRECISA ENTRAR NA IMAGEM DO DOCKER.** Em dev o import resolve pelo symlink de
workspace, então `npm test` passa VERDE sem ele; dentro do container o `import()` estouraria
`ERR_MODULE_NOT_FOUND` **em runtime**. `Dockerfile` (COPY do pacote, e do `package.json` **antes** do
`npm ci`) e `railway.toml` (`packages/**` nos `watchPatterns`) foram corrigidos junto, com teste
guardando os dois: `lote/__tests__/listaIbgeChegaNaImagem.test.js`.
- A tela: `apps/portal-cliente-web/src/features/lote/` — ver o `CLAUDE.md` de lá.

### ⚠⚠ O `cMotivo` DO CANCELAMENTO ERA ARBITRADO — e a lista não é a da substituição (19/08/2026)

**O defeito, medido:** `buildEventoXml` escrevia, no ramo do cancelamento,
`<cMotivo>${escapeXml(cMotivo || "1")}</cMotivo>`. Sem `cMotivo`, o código declarava ao sistema
nacional **"1 — Erro na emissão"** por conta própria; quem cancelasse por "Serviço não prestado"
declarava outra coisa, num ato irreversível. O ramo irmão (`e105102`) já recusava a ausência — e o
comentário logo acima afirmava, desde sempre, que *"o código é uma justificativa FISCAL e não se
arbitra uma"*. **A regra existia; o ramo não a seguia.**

⚠⚠ **AS DUAS LISTAS SÃO DIFERENTES, e o projeto acreditava que eram a mesma:**

| evento | tipo no XSD | valores | largura |
|---|---|---|---|
| `e101101` cancelamento | **`TSCodJustCanc`** (`tiposEventos_v1.01.xsd:233`) | **`1` `2` `9`** | **1** |
| `e105102` substituição | `TSCodJustSubst` (`:267`) | `01`…`05` `99` | 2 |
| ambos, `xMotivo` | `TSMotivo` (`tiposSimples_v1.01.xsd:348`) | 15 a 255 chars | — |

**Fonte e varredura, não suposição** (`application/nfse/motivosDeEvento.js`): o **ANEXO_I não cobre
eventos** — é o leiaute da DPS/NFS-e. Os **87 comentários de célula** do `.xlsx` foram extraídos de
`xl/comments1.xml`/`comments2.xml` e varridos por `cancel|cMotivo|justificativ|101101`: **zero
ocorrências**. O **ANEXO_II** (eventos) **não está versionado** — está nomeado como próximo
candidato no README daquela pasta. O XSD é primário e é o que valida; e há precedente do XSD vencer
o ANEXO_I registrado ali (o `TAM. = 1` incoerente do `cMotivo` da substituição).

- ⚠ **NENHUM `padStart` no `cMotivo`.** "Consertar" `1` para `01` mandaria código de outra lista, e
  a rejeição chega como erro de schema, sem dizer qual foi a confusão.
- ⚠ **As duas travas rodam ANTES DE ASSINAR** (`sendEvent`, no pré-voo). Sem elas, uma justificativa
  de 4 letras era montada, **assinada com o A1 da empresa**, transmitida, e voltava rejeitada por
  schema — um round-trip ao sistema nacional para descobrir uma regra que está no XSD do nosso disco.
- ⚠ **O `e105102` perdeu a checagem local de `cMotivo`** — ela subiu e virou geral. Era a condição
  `=== "e105102"` que deixava o cancelamento sem lista fechada.

#### ⚠⚠ NOTA RECEBIDA NÃO SE CANCELA — o buraco que o cancelamento tinha (20/08/2026)

> Dono: *"as notas recebidas não devem ter opção de emitir elas, nem cancelar. Nota recebida foi
> emitida **para nós** — não temos controle sobre esse tipo de nota."*

**O que faltava, medido:** o reaproveitamento já recusava `papel: "DEST"` nos dois portais; **o
cancelamento não conferia o papel em lugar nenhum** — nem na lib da tela, nem no responder, nem na
rota. O botão "Cancelar" aparecia numa nota que a empresa RECEBEU.

⚠ **CANCELAR É ATO DO EMITENTE.** Numa nota recebida quem emitiu foi o prestador; o cliente é o
tomador, e o certificado que assinaria o evento é o da empresa errada (a família do **E0718**).
⚠⚠ **"O sistema deles provavelmente recusa" não é guarda** — é sorte, e custa uma chamada externa
**assinada**, um erro que o contador vai tentar entender, e a suspeita de que este sistema deixa
cancelar nota alheia. A recusa é **NOSSA**, antes de qualquer I/O.

- **Duas fontes, como em `reaproveitarNota.js`:** a coluna `papel` e a comparação do CNPJ. A segunda
  não é redundância — ⚠ o filtro de direção da listagem (`buildWhereFilters`) **só é aplicado quando
  o `PortalClient` tem CNPJ**, então empresa sem CNPJ no cadastro vê as recebidas junto com as suas.
- ⚠⚠ **Ausência não casa com ausência:** `normalizeDoc` devolve `null`, nunca `""`. Com `""`, a
  comparação `docTomador === cnpjDaEmpresa` daria `true` e travaria o cancelamento de **toda** nota
  de uma empresa sem CNPJ. Há teste sobre exatamente isso.
- **NF-e junto:** `422 nota_nao_e_nfse`. O `pedRegEvento` é do leiaute da NFS-e; mandá-lo sobre uma
  NF-e é pedir o cancelamento no lugar errado (a SEFAZ é outra).
- ⚠ **`papel` passou a viajar no contrato do cliente** (`serializeInvoice`). Ele não chegava — a
  tela deduzia pelo CNPJ. Terceira vez que uma coluna fora do serializer/`select` some **sem erro
  nenhum** (as outras: `codigosServicoNacional`, carga tributária).
- **Na tela:** botão visível e desabilitado, com o motivo no `title`; o texto visível sai **uma vez
  por linha**, pela coluna "Usar como modelo" — impedimento da NOTA usa `ESCOPO.NOTA`
  (`lib/impedimento.js`), e não se escreve um segundo vocabulário.
- Testes: `cancelamentoCliente.test.js` (32 — a rota chamada **direto**, cada recusa medida por
  `NfseService.sendEvent` não ter sido chamado) + front `lib/cancelamentoNota` e a ligação.

### ⚠⚠ As TRÊS CAMADAS chegaram ao cancelamento — e a do TRANSPORTE desabilita a tela

Antes, toda falha de envio de evento virava um `NFSE_EVENT_FAILED` plano, traduzido em 422: **um
timeout de rede e uma recusa fiscal chegavam à tela com o mesmo rosto**. Hoje `sendEvent` classifica
com o **MESMO `classificarFalha`** da emissão (não é um segundo mapa), e `routes/nfseCancelamentoHttp.js`
traduz para HTTP nas duas portas:

| camada | status | `podeTentarDeNovo` |
|---|---|---|
| `NOSSA` | 400 `nfse_cancelamento_local` | `true` — nada saiu da máquina |
| `TRANSPORTE` | 502 `nfse_cancelamento_transporte` | **`false`** — desfecho DESCONHECIDO |
| `RECEITA` | 422 `nfse_cancelamento_rejeitado` | `true` — analisou e recusou; a nota NÃO foi cancelada |

⚠⚠ **O que NÃO se reusa é o TEXTO da `correcao` do TRANSPORTE.** Na emissão ele fala de NUMERAÇÃO
("não reemita com número novo; número pulado é buraco permanente"), porque lá o que fica
indeterminado é um número de DPS reservado. **Cancelar não consome número.** O que fica
indeterminado aqui é se a nota está cancelada — e mandar o cliente consultar um Id de DPS seria
mandá-lo procurar no lugar errado. O texto do cancelamento é `CORRECAO_TRANSPORTE_EVENTO`, em
`desfechoEmissao.js`, **ao lado do da emissão** para que a diferença fique à vista.

⚠ **`podeTentarDeNovo: false` é o campo que DESABILITA o botão na tela do cliente** — o botão
destrutivo some e sobra "Fechar". Reenviar sobre nota que já foi cancelada volta recusado e se lê
como "o cancelamento falhou", quando ele tinha dado certo.

- **A confirmação REPETE OS DADOS** (número, tomador, valor, data) — `ConfirmarCancelamento.jsx`.
  *"Tem certeza?"* não é confirmação: aprende-se a clicar sem ler, e o clique na linha errada recebe
  a mesma pergunta que o clique na certa.
- ⚠ **Nada vem pré-selecionado** no motivo, e **o mínimo de 15 caracteres aparece ANTES de digitar**,
  como contagem — não como erro depois de clicar num ato irreversível.
- Testes: `nfse/__tests__/motivosDeEvento.test.js` (21, as constantes conferidas contra o XSD) +
  `nfse/__tests__/cancelamentoEvento.test.js` (25 — cada recusa medida por `axios.post` **e** a
  assinatura **não** terem sido chamados) + os do front (`cancelamentoNaTela.ligacao` 20,
  `lib/cancelamentoNota` 24).

### ⚠⚠ A NOTA EMITIDA APARECE NA HORA — união na LEITURA, nunca gravação (19/08/2026)

> *"as notas que aparecem para o cliente são apenas as notas que vêm da consulta ADN, porém ao
> emitir uma nota, ela deve aparecer para o cliente, e depois que consultar o ADN aí fica confirmada
> na tela; deve ficar mais clarinha (…). **Não coloque explicação disso na tela.***"

**Medido:** a lista do cliente (`routes/portalInvoices.js`, `GET /`) lê **`PortalInvoice`** — a
projeção do ADN. A emissão (`NfseService.js:1445-1466`, `:1507-1515`) grava **`ServiceInvoice`** e
nunca um `PortalInvoice`. Entre emitir e a próxima captura, a nota não existia para o cliente.

⚠ **NÃO SE GRAVA `PortalInvoice` NA EMISSÃO.** Ela é a projeção de um sistema EXTERNO, com donos
declarados (`notas/ingestaoNfse.js` + o motor legado `sync/InvoiceSyncEngine.js`). Uma quarta
escrita criaria uma linha que a captura não sabe que existe — e o encontro das duas é onde este
projeto já mediu **faturamento somado duas vezes**. Além disso a linha escrita à mão não teria o
`xmlRaw` do sistema nacional, de onde saem os campos fiscais, o DANFSe e a série/nDPS da próxima
emissão. Na leitura, um dedup errado se conserta numa linha de código; na escrita ele é permanente.

**Regra em `application/notas/notasEmitidasNaoConfirmadas.js`** (só leitura, varredura de fonte no
teste proíbe escrita). **A chave de deduplicação são TRÊS provas independentes**, cada uma
suficiente, nenhuma com falso positivo, aplicadas só quando os **dois** lados têm o valor:

| # | prova | nosso lado | lado do ADN | cobertura |
|---|---|---|---|---|
| 1 | `chaveAcesso` | `ServiceInvoice.chaveAcesso` | `PortalInvoice.chaveAcesso` | parcial — o fallback `\|\| numeroNfse` de `NfseService.js:1510` a torna INCOMPLETA, nunca insegura (chave tem 50 dígitos, `nNFSe` tem poucos) |
| 2 | **a tupla do E0014 — `(série, nDPS)`** | `rpsSerie`+`rpsNumero`, reservados transacionalmente e com `@@unique` | `lerSerieENumeroDaDps(xmlRaw)` (`nfse/nfseUltimaNota.js`, leitura **por caminho**) | **completa** — e a única que funciona **sem chave dos dois lados** |
| 3 | `numeroNfse` (`nNFSe`) | `ServiceInvoice.numeroNfse` | `PortalInvoice.numero` | rede quando o XML não pôde ser lido |

⚠ **Por que a nº 2 IDENTIFICA, e não só "parece":** a RN **E0014** rejeita DPS cujo conjunto *Série
+ Número + Município Emissor + CNPJ/CPF* já exista. O escopo aqui já fixa os dois últimos — uma
`PortalClient` ↔ uma `Company` (`companyId` `@unique`) ↔ um CNPJ (`Company.cnpj` `@unique`). Dentro
dele o par é único **pela regra do próprio sistema nacional**. São literalmente os mesmos números:
`buildDpsXml` escreve `<serie>`/`<nDPS>` da numeração reservada (`NfseService.js:526`, `:776-777`) e
o sistema nacional devolve a DPS **dentro** da NFS-e. Cobertura do `xmlRaw` medida em produção:
**EMIT 14.946 = 100%**. Vale só com `papel: "EMIT"` — a numeração de nota recebida é do prestador dela.

⚠⚠ **AUSÊNCIA NÃO VIRA IGUALDADE.** Chave nula dos dois lados não é "são a mesma"; número nulo
tampouco. Mesma disciplina de `ingestaoNfse.js` e do índice único do Postgres.

- ⚠ **Só `status` fora de `pending|rejected|falha_envio` entra.** `pending` é o valor gravado **na
  reserva do número**, antes de o pedido sair da máquina — "a nota existe" é o que não se sabe.
- ⚠ **`incluirEmitidasNaoConfirmadas` é OPT-IN e SÓ o `/client` liga.** O mesmo router é montado em
  `/firm` e em `server.js`; o pedido é sobre a tela do cliente.
- ⚠ **A PAGINAÇÃO É CORRIGIDA, não ignorada.** O `skip` do banco recua pelo tamanho do conjunto
  nosso e a fatia é intercalada — sem isso a página 2 **pularia** tantas notas fiscais quantas
  fossem as nossas. A conta está escrita na rota e provada no teste (páginas somam ids distintos,
  nas duas ordens, inclusive com nota nossa no MEIO da lista).
- ⚠ **Os totais contam as nossas** — senão o card "Valor total" e a tabela discordariam do mesmo mês.
- **Contrato:** todo item ganhou **`confirmadaPeloAdn`**. `false` ⇒ a linha vem de `ServiceInvoice`,
  o `invoiceId` é um `ServiceInvoice.id`, e as sub-rotas de `/invoices/:id` (xml, pdf, DANFSe) **não
  a encontram** — por isso `hasXml`/`hasPdf` saem `false`. ⚠ No front, `undefined` é lido como
  **confirmada** (contrato antigo e app mobile), nunca como falsa.
- ⚠ **`status` continua `EMITIDA`.** A nota FOI emitida; o que falta é a confirmação. Um status novo
  a pintaria de rascunho ou de erro.
- Testes: `application/notas/__tests__/notasEmitidasNaoConfirmadas.test.js` (21, as três provas
  isoladas + os negativos) e `routes/__tests__/uniaoNotasDoCliente.test.js` (21, a paginação, os
  totais, o gêmeo do filtro e o opt-in).

Os cinco defeitos abaixo foram medidos e corrigidos **antes** dessa primeira emissão.

| # | Defeito medido | Hoje |
|---|---|---|
| 1 | `buildDpsId` lia `company.codigoMunicipioIbge`/`codigoMunicipio` — **nenhum dos dois existia no model** —, caía num env não definido e o `padStart` fabricava `cLocEmi="0000000"` | campo `Company.codigoMunicipioIbge` (migration **NÃO aplicada**), e vazio ⇒ **recusa** `NFSE_MUNICIPIO_NAO_CONFIGURADO` |
| 2 | `loadCertAndKey()` usava um **PFX global** para assinar e para o mTLS nos 3 caminhos, sem conferir de quem era (+ `cachedCertInfo` de módulo: o 1º cert carregado valia para a carteira toda) | `nfseCertificado.js` resolve o A1 **por empresa** reusando `CertResolver`; sem ele, `NO_COMPANY_CERT` |
| 3 | numeração read-modify-write **fora de transação** + `ServiceInvoice` sem nenhum `@@unique` | reserva transacional (`nfseNumeracao.js`) + `@@unique([companyId, rpsSerie, rpsNumero])` |
| 4 | `opSimpNac="3"` cravado; `pTotTribSN` sem validação; retenção calculada em 3 variáveis **mortas**; `cLocPrestacao = cLocEmi` "por enquanto" | tudo vem do dado, e o que não se sabe **recusa** |
| 5 | rejeição fiscal e queda de rede eram o **mesmo** `status:"rejected"`, sem coluna de motivo | 3 camadas + `falhaCamada/Codigo/Mensagem/Correcao/Em` |

### ⚠ SÃO DOIS CERTIFICADOS, E ELES NÃO PODEM VIRAR UM

| papel | quem valida | regra |
|---|---|---|
| **assinatura** do XML da DPS | o sistema nacional, ao processar | **E0718** — *"A assinatura deve ser feita com o certificado digital do emitente da DPS"* (+ Res. CGNFS-e nº 3, art. 2º, §1º, I) |
| **transporte** (mTLS) | bloco **E1200–E1209** | **não há regra exigindo que seja o mesmo** |

Hoje os dois apontam para o mesmo arquivo (o A1 da empresa) — mas são **campos separados** em
`resolverCertificadosDaEmpresa`. Colapsá-los é o que impediria depois a figura da **procuração**
(escritório transporta, empresa assina). E `procuracao_escritorio` **não é aceito** para assinar,
pelo mesmo motivo que a captura não o aceita: a procuração e-CAC não transforma o certificado do
escritório no certificado do cliente perante o sistema nacional.

⚠ **Não escreva uma segunda resolução de certificado.** Quem resolve continua sendo
`CertResolver.resolveCertForCompany` (que já confere o CNPJ do subject via `inspectPfx`) — foi
duplicar essa resolução que fez a captura divergir no passado.

### ⚠ NÃO EXISTE INUTILIZAÇÃO NA NFS-e — o número é o ativo

Varrido nos 16 eventos do Anexo II e nas RNs do Anexo I: **não há evento de inutilização** (a NF-e
tem; a NFS-e não). Número pulado é **buraco permanente**, e número repetido é **E0014**. Daí o
desenho:

- a reserva é **transacional** (`UPDATE "Company" … RETURNING`, uma instrução só). ⚠ É SQL cru de
  propósito: `rpsNumero` é **TEXT** e o `increment` do Prisma só existe para colunas numéricas.
  Uma coluna nova numérica seria **duas colunas com o mesmo significado** — o erro documentado em
  "TRÊS NÚMEROS DE DAS, TRÊS COLUNAS";
- **série obrigatória na faixa `00001–49999`** (RN **E0010**, emissor por aplicativo próprio). As
  outras faixas são do Emissor Móvel/Web/transcrição. ⚠ A conversão "letra vira número" que existia
  (`A`→1) foi abandonada: a série default `"UNICA"` virava **21**, sozinha;
- **o `@@unique` é `(companyId, rpsSerie, rpsNumero)`**, e não `idDps`: `companyId` responde pelo
  CNPJ (`Company.cnpj` é `@unique`) e pelo município emissor, então a tupla é a **mesma do E0014**.
  `idDps` é string DERIVADA e é escrita também pela CAPTURA a partir do payload do provedor — um
  índice ali obrigaria dado de terceiro a obedecer à nossa regra de derivação;
- **falha reusa o número, não o queima** (`retryInvoiceId` reaproveita a mesma linha).

### ⚠ AS TRÊS CAMADAS DE DESFECHO — e a do meio é a razão de existirem três

| camada | a DPS chegou? | número reutilizável? | status |
|---|---|---|---|
| `NOSSA` (validação, sem cert, sem município, série fora da faixa) | **não** | **sim** | `falha_envio` |
| `TRANSPORTE` (timeout, DNS, TLS, **5xx**) | **não se sabe** | **NÃO** | `falha_envio` |
| `RECEITA` (**4xx** com `E####`) | sim, e recusou | **sim** | `rejected` |

⚠ **5xx é TRANSPORTE, não recusa.** Erro de servidor pode ocorrer *depois* de a DPS ser aceita;
tratá-lo como recusa liberaria o número de uma nota que talvez exista. Na dúvida, **reter**.
⚠ `extrairCodigoReceita` procura só o formato `E####` no payload serializado e devolve `null` se
não achar — a forma da resposta de erro do sistema nacional **não está documentada no projeto**
(nenhuma emissão jamais saiu), e supor uma árvore de campos seria inventar contrato.

### ⚠ A SUBSTITUIÇÃO NÃO É O EVENTO `e105102` — marcado, não consertado (Fase 4)

Substituir é **`POST /nfse` com o grupo `<subst>` preenchido** (Manual dos Contribuintes §1.3.2.a;
exemplo real em `docs/leiaute-nfse/nfse-nacional-substituicao.xml`), e **o sistema nacional gera o
evento sozinho**. O `e105102` é o que se **lê depois**, não o que se **envia**. O caminho atual de
`sendEvent` está **invertido**, não incompleto — e `buildDpsXml` ainda não monta `<subst>`.

### ✅ Leiaute 1.00 → 1.01: **MIGRADO em 01/09/2026**

⚠⚠ **ESTA SEÇÃO SE CHAMAVA "não migrado, e é decisão de risco"** e dizia que *"o projeto não tem o
XSD versionado (nenhum `.xsd` na árvore)"* — falso desde 19/08/2026. `DPS_VERSAO` é **`"1.01"`**.

A migração foi decisão do dono, junto com a de construir IBS/CBS. A regra de expiração
(**E0001**/**E1260**) continua sem data de corte publicada, e o acréscimo (`IBSCBS`) continua
**facultativo** — ele é montado só com `INTEGRACAO_NFSE_IBSCBS` ligada, que nasce OFF.

**A prova que autorizou:** o MESMO XML emitido passa pela checagem inteira contra os **dois**
esquemas. Ver "SUBIDA PARA O LEIAUTE 1.01", abaixo — inclusive os **cinco** tipos que o gerador
escreve e que mudaram entre as versões, dois deles inertes **por acidente feliz**.

### O que precisou do dono e NÃO foi inventado

1. **Como `Company.codigoMunicipioIbge` será preenchido.** O município só existe como TEXTO em
   `PortalClient.municipio`/`uf` (33/33 preenchidos, 32 no Rio). O de-para nome→IBGE exige a tabela
   do IBGE, que não temos, e erra em homônimo. **Migration sem backfill**, de propósito.
   - ✅ **RESPONDIDO (2026-08-14): o contador ESCOLHE numa lista oficial embarcada.** A tabela do
     IBGE passou a existir no projeto (`packages/shared/src/municipios/municipiosIbge.data.js` desde
     20/08/2026 — antes em cópia nos dois portais —, 5.571
     linhas, extraídas da API de Localidades do IBGE, versionadas e datadas — **nunca** buscadas em
     runtime). O campo entrou no formulário de edição da empresa, no bloco "Inscrições".
     ⚠ **Escolher ≠ derivar:** nada é pré-selecionado, a busca não autosseleciona nem com um único
     resultado, e toda opção mostra município **e UF**. O de-para automático nome→código continua
     proibido, pelo mesmo motivo de sempre (homônimo → nota emitida no município errado).
   - **Caminho backend:** `validateAndNormalizeCompanyProfile` normaliza (7 dígitos ou nada;
     `company_codigo_municipio_ibge_invalid`), a rota grava em `tx.company.update` e o campo entrou
     em `legacyCompanySelect`. ⚠ A rota lista os campos aceitos UM A UM — antes disso o valor
     chegava no corpo, passava pelo Zod (`.passthrough()`) e era **descartado em silêncio**, com a
     resposta 200. Regressão: `routes/firm/__tests__/companyMunicipioIbge.test.js` (7 testes;
     removendo a linha do `update`, quatro deles caem com `undefined`).
   - **A ausência aparece ANTES da tentativa de emitir:** aviso no cadastro e bloqueio no primeiro
     passo do assistente (`EmitirNfseWizard`), espelhando `NFSE_MUNICIPIO_NAO_CONFIGURADO`.
   - Fonte de que `cLocEmi` **é** o código do IBGE: `docs/nfse-preenchimento.md` §2 e §5 ("cLocEmi:
     IBGE do município emissor, ex.: 3304557 (Rio de Janeiro)"; `cMun` "(IBGE, 7 dígitos)"),
     escrito a partir de emissão bem-sucedida em homologação — e o mesmo `3304557` que
     `NfseService` já usa na regra de IM do Rio.
2. **`opSimpNac` do MEI.** Simples→`3` e não optante→`1` têm evidência (a emissão homolog aceita, e
   a NFS-e real versionada com `opSimpNac=1` + `pTotTrib` + sem `regApTribSN`). O `2` do MEI tem
   **só um comentário de código**, escrito no mesmo bloco que cravava o `3`. MEI **recusa**.
3. **`totTrib` do não optante.** O ramo era inalcançável e emitia `vTotTrib` com `0.00` — que
   **afirma carga tributária zero** (Lei 12.741/2012). A nota real usa `pTotTrib` com percentuais.
   - ✅ **RESPONDIDO (18/08/2026): o CONTADOR configura, no cadastro da empresa.**
     > *"precisamos emitir para simples nacional também, as alíquotas efetivas do presumido não
     > precisam ser calculadas a não ser o ISS que varia de município, mas deve ser configurado do
     > lado do contador, no portal do contador."*

     Três colunas em `Company` — `pTotTribFed` / `pTotTribEst` / `pTotTribMun`, `DECIMAL(5,2)`,
     nullable, com CHECK 0–100 (migration **`20260818210000_add_carga_tributaria_nao_simples`**;
     ⚠ o `schema.prisma` foi editado JUNTO, então **aplicar antes de subir** — o cabeçalho da
     migration explica por que aqui a decisão é o oposto da da `Guide`). ⚠⚠ **APLICADA no banco de DEV** — medido em 01/09/2026 (`_prisma_migrations`); **produção é outra pergunta**, e esta máquina não a responde. Ver *"O ESTADO DAS MIGRAÇÕES"*.
     Caminho completo: `validateAndNormalizeCompanyProfile` → `companySchemas.js` →
     `tx.company.update` (spread condicional) → `CompanyProvisioningService` → `legacyCompanySelect`.
   - ⚠ **A ESTRUTURA ESTÁ CONFIRMADA**, e a frase "carece de confirmação sem o XSD" **deixou de
     valer**: `docs/leiaute-nfse/nfse-nacional-substituicao.xml` (`opSimpNac=1`) traz
     `<totTrib><pTotTrib><pTotTribFed>11.33</…><pTotTribEst>0.00</…><pTotTribMun>0.00</…>`, com os
     três filhos, nesta ordem, `pTotTrib` filho único de `totTrib`, sem irmãos.
   - ⚠⚠ **O DEFEITO QUE ELES SOMAVAM.** O portão usava `.some()` (UM percentual liberava) e o XML
     escrevia `?? 0` nos outros dois: o contador configurava só o municipal e a nota **afirmava ao
     tomador carga federal 0,00% e estadual 0,00%** — impresso, por força da Lei da Transparência.
     Hoje **o FEDERAL e o MUNICIPAL são exigidos** e a recusa nomeia quais faltam (`err.faltando`).
     O que decide o desenho é a própria amostra: ela declara `0.00` em dois campos, ou seja **zero
     DECLARADO é legítimo** — logo zero **por omissão** não pode produzir o mesmo XML. NULL = não
     configurado (recusa), 0.00 = o contador afirmou. Valor fora de 0–100 recusa com
     `INVALID_TOT_TRIB_NAO_SIMPLES` (camada `NOSSA`).
   - ⚠⚠ **O ESTADUAL DEIXOU DE SER EXIGIDO EM 02/09/2026 — e esta linha dizia "os TRÊS".** Decisão
     do dono, com o defeito na tela: *"o estadual pode ser nulo, não há problema com isso, empresas
     de serviço não têm ICMS que é estadual"*. O fundamento é **ESTRUTURAL**: a DPS documenta uma
     operação de **serviço (ISS)**, e serviço não sofre ICMS — a parcela estadual de uma NFS-e é
     zero pela natureza da operação, não por o contador não ter olhado. Ausente, ela sai **`0.00`**.
     - **Medido em produção no dia**, e o par é a prova: uma empresa do Lucro Presumido com
       `fed 11.33 · est NULO · mun 5.00` **não conseguia emitir**, enquanto a irmã de mesmo regime
       (`fed 11.33 · est 0.00 · mun 5.00`) emitia — a única diferença era ter o zero **digitado**.
       As outras 8 empresas não optantes têm os três vazios.
     - ⚠⚠ **"Ausente" sai como ZERO DECLARADO, nunca como tag omitida**, e o XSD não deixa
       escolher: em `TCTribTotalPercent` (1.01) os TRÊS filhos de `pTotTrib` são obrigatórios
       (nenhum tem `minOccurs="0"`). Quem quiser não informar **nada** tem o irmão **`indTotTrib=0`**
       do mesmo `xs:choice` (*"Não informar nenhum valor estimado para os Tributos"*, **Decreto
       8.264/2014**) — que este gerador **não monta**, e ligar é decisão à parte, porque ele cala
       também o federal e o municipal.
     - ⚠⚠ **ISTO NÃO REABRE O `?? 0`.** No defeito antigo, UM percentual liberava a nota e os
       **outros dois** saíam zero — inclusive o **federal**, que nunca é estruturalmente zero. Aqui
       o zero é assumido para **um campo só**, e só porque a norma da operação o torna zero. Há
       teste travando que o federal ausente **continua** recusando.
     - **A tela acompanhou, e a amarra confere os DOIS lados**: `CAMPOS_CARGA_TRIBUTARIA`
       (`apps/web/src/lib/nfse/cadastroEmissaoNfse.js`) ganhou `exigido`, o campo estadual
       **continua na tela** (só deixou de bloquear) dizendo que não é exigido, e o teste que lê o
       `NfseService.js` passou a comparar também o `true`/`false` de cada campo — antes ele
       comparava só os nomes. ⚠ `PORQUE_OS_TRES` virou **`PORQUE_OS_EXIGIDOS`** (o nome virou
       mentira). ⚠ `cargaParcial` passou a comparar com os **exigidos**, não com o tamanho da
       lista — senão "nada configurado" (2 de 3) se leria como "parcial", que é o estado de alerta.
     - ⚠ **Experimento executado:** revertendo só o backend para exigir o estadual, a amarra do
       front fica **1 vermelho** nomeando a divergência.
   - **Precedência:** cada campo resolve sozinho, **payload → cadastro**. Payload parcial não
     apaga o resto (era assim que o zero nascia). ⚠ O **Simples não passa por este bloco**: ele
     declara `pTotTribSN`, e valor torto nestas colunas não derruba a nota dele.
   - ⚠ **`pTotTribMun` NÃO é a alíquota de ISS**, e a mesma amostra prova: nela o ISS aplicado é
     `pAliqAplic = 5.00` (em `infNFSe/valores`) e o `pTotTribMun` é `0.00`. Mesmo documento, mesma
     nota, números diferentes. E a **alíquota de ISS não entra na DPS que enviamos** —
     `infDPS/…/trib/tribMun` leva só `tribISSQN` e `tpRetISSQN`; `data.servico.aliquota` só serve
     de guarda para `issRetido` (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`) e é gravada em
     `ServiceInvoice.aliquota`. Quem calcula o `pAliqAplic` é o município, a partir do `cTribMun`.
   - ⚠ **NADA É CALCULADO**, e não é preguiça: não há de-para CNAE→presunção neste repositório
     (está registrado em `features/companies/CLAUDE.md`), e errar entre 8% e 32% inverteria a
     comparação. O número vai IMPRESSO ao tomador — é afirmação, não preenchimento técnico.
   - Regressão: `nfse/__tests__/emissaoDps.test.js` (o bloco "carga tributária do não optante") e
     `routes/firm/__tests__/companyCamposNfse.test.js` (o bloco `pTotTrib*`).
4. **`cLocPrestacao` diferente do emissor.** Decide para qual município o ISSQN é devido, e **não se
   deduz do endereço do tomador** (LC 116/2003, art. 3º: `caput` + lista fechada de exceções). Virou
   campo informável; ausente aplica a regra geral **e registra a suposição no log**.

### ⚠ O CPF DO TOMADOR PASSOU A TER DÍGITO VERIFICADOR — pedido do dono, 18/08/2026

Medido antes: **o projeto inteiro não tinha nenhuma validação de DV**. Existiam `normalizeCpf`
(`validators/clientPayload.js`) e `fmtCpf` (front), as duas só mexendo em pontuação — o tomador
pessoa física entrava na DPS com qualquer sequência de 11 dígitos. Com o caminho ligado e apontado
para produção, um dígito trocado vira nota fiscal contra outra pessoa, e o conserto é
**cancelamento**, não edição.

- Regra pura: **`utils/cpf.js`** (`cpfTemDvValido`), consumida por `validators/nfsePayload.js`.
- ⚠ **NÃO SE CONSULTA CPF EM LUGAR NENHUM — decisão do dono.** A BrasilAPI é base de **CNPJ**;
  consulta de CPF é serviço pago e traz LGPD junto (o tomador é terceiro). É validação **local**, e
  só: nenhuma rede, nenhum cache, nenhuma gravação.
- ⚠ **A recusa é NOMEADA e DISTINTA de documento ausente**: `tomador_cpf_digito_invalido` ×
  `tomador_documento_invalido`. Consertos diferentes — "não preenchi o campo" × "digitei errado".
- ⚠ **Sequências repetidas** (`111.111.111-11` etc.) **passam no módulo 11** e são recusadas à
  parte: são o preenchimento para o formulário deixar seguir, exatamente o que a validação pega.
- ⚠ **O CNPJ SEGUE COMO ESTAVA.** Validar o DV dele não foi pedido, e inventá-lo passaria a recusar
  tomador legítimo com cadastro velho sem que ninguém tivesse decidido isso. Há teste prendendo essa
  ausência, para que ela não seja "consertada" por conta própria.
- O que o DV prova: que o número é **bem formado**. Não prova que existe, nem que é da pessoa cujo
  nome veio no payload.
- Testes: `utils/__tests__/cpf.test.js` (a aritmética, inclusive o ramo `resto < 2` ⇒ DV 0) +
  `validators/__tests__/nfsePayload.test.js`.

### ⚠ `buildMissingFields` exige CINCO campos — e três deles não tinham porta nenhuma

`REQUIRED_COMPANY_FIELDS` = `cnpj` · `inscricaoMunicipal` · `codigoServicoNacional` ·
`codigoServicoMunicipal` · `rpsSerie`. Os três últimos existiam no `schema.prisma`, na API e no
`legacyCompanySelect` (ou seja, **voltavam** para a tela) e **não tinham campo em formulário
nenhum**: a emissão recusava por eles e não havia por onde preenchê-los pelo portal. Mesma classe do
defeito do município — configuração que existe no model sem porta.

- **Caminho backend, os três:** `validateAndNormalizeCompanyProfile` normaliza e devolve, o Zod
  (`companySchemas.js`) declara, `tx.company.update` e `CompanyProvisioningService` gravam. ⚠ Faltar
  em **qualquer** um desses quatro lugares = 200 com o valor jogado fora, em silêncio.
  Regressão: `routes/firm/__tests__/companyCamposNfse.test.js` (14 testes; removendo as três linhas
  do `update`, **seis** caem com `undefined`).
- **A forma de cada um, e só a forma** — o CONTEÚDO não é conferido em lugar nenhum:
  | campo | regra | erro | fonte **no repositório** |
  |---|---|---|---|
  | `codigoServicoNacional` (`cTribNac`) | 6 dígitos | `company_codigo_servico_nacional_invalid` | `docs/nfse-preenchimento.md` §5/§11/§12 |
  | `codigoServicoMunicipal` (`cTribMun`) | só dígitos, **sem comprimento fixo** | `company_codigo_servico_municipal_invalid` | idem §5 |
  | `rpsSerie` | numérica, 1–49999, gravada com 5 dígitos | `company_rps_serie_invalid` | RN **E0010** via `nfseNumeracao.js` |
- ⚠ **A LISTA DE SERVIÇO NACIONAL PASSOU A EXISTIR NO PROJETO (16/08/2026)** — ver a seção
  "N CÓDIGOS DE SERVIÇO" abaixo. O `cTribNac` deixou de ser digitado e virou **escolha** numa lista
  oficial versionada com hash. A lista do **município** continua não existindo (não há tabela
  nacional; cada prefeitura publica a sua), então o `cTribMun` segue **digitado**.
  Nenhum de-para CNAE→serviço, nenhuma sugestão, nenhum default — inclusive **nenhuma série "1"**
  pré-preenchida: a série entra no identificador de toda nota emitida.
- ⚠ **O comprimento do `cTribMun` NÃO está provado.** A fonte diz "código municipal (últimos 3
  dígitos)" e `buildDpsXml` faz `.slice(-3)` — isso descreve o **XML**, não o código que a
  prefeitura publica. Exigir 3 no cadastro recusaria código legítimo mais longo, então não se exige;
  a tela **anuncia** quais 3 dígitos vão para a DPS, para que o corte não seja descoberto na
  rejeição.
  - ✅ **RESPONDIDO EM PARTE (25/08/2026).** Perguntado como obter a tabela de códigos de serviço do
    Rio, o dono respondeu: **"geralmente é 001"**. Ou seja: **não há tabela a construir** — o código
    é praticamente uniforme na carteira, e o formato de 3 dígitos se confirma.
  - ⚠⚠ **MAS "GERALMENTE" NÃO É "SEMPRE", E ISSO NÃO VIROU DEFAULT.** Medido em produção no mesmo
    dia (`scripts/diag-codigo-servico-municipal.mjs`, só leitura): **31 de 34 empresas com o campo
    VAZIO**, e as **3 preenchidas são todas `001`** — zero contraexemplos. A base **corrobora** a
    frase, com **três pontos de dado**. Isso sustenta uma **sugestão marcada**; preencher 33
    empresas a partir daí seria o portal **afirmando** a classificação de ISS delas, e o erro sai
    como nota emitida no município, contra o cliente.
  - ⚠ **E o lugar da sugestão NÃO é a coluna do Perfil Fiscal**: `perfilAtividades.codigoServicoMunicipal`
    é **write-only** (medido: nenhum leitor). Quem a emissão lê é `Company.codigoServicoMunicipal`.
    Sugerir na coluna morta alimentaria um campo que ninguém consulta — o defeito que a própria
    avaliação do dono apontou. Fica **nomeado**, não feito.
- ⚠ **A faixa da série vive em DOIS lugares** (`nfseNumeracao.js` e o normalizador do cadastro):
  aquele módulo carrega o Prisma no topo e este é um validador puro. A duplicação está **amarrada
  por teste** — `companyCamposNfse.test.js` compara os limites com `SERIE_MIN`/`SERIE_MAX`
  importados de lá.
- **A recusa passou a ter leitor.** `POST /nfse` devolvia `400 { error:"company_missing_fields",
  missing:[...] }` e **nada na interface lia essa lista** — o contador preenchia a nota inteira para
  receber um erro genérico. Hoje o `EmitirNfseWizard` a espelha no **passo 1**
  (`apps/web/src/lib/nfse/cadastroEmissaoNfse.js`), com rótulo, motivo e onde preencher, e a ficha
  da empresa mostra a mesma falta. ⚠ O espelho tem de acompanhar `REQUIRED_COMPANY_FIELDS` — há
  teste amarrando a lista e a ordem.
- ⚠ **Dado legado pode passar a bloquear a edição do cadastro.** Série não-numérica (`"UNICA"`) ou
  `cTribNac` com comprimento diferente de 6 gravados antes destas guardas agora devolvem **400
  nomeado** ao salvar a empresa — o campo tem de ser corrigido. Medir antes:
  **`scripts/diag-emissao-nfse.mjs`** (só leitura), que já conta as quatro colunas por empresa.
  Não foi possível medir nesta máquina: **não há banco alcançável**.

Tabelas de código com a evidência de cada linha e `verificadoNoLeiaute: false`: **`dpsCodigos.js`**.
Testes: `nfse/__tests__/` (`nfseNumeracao`, `nfseUltimaNota`, `nfseCertificado`, `dpsCodigos`,
`desfechoEmissao`, `emissaoDps`, **`codigoServicoDaNota`**) + `validators/__tests__/nfsePayload` +
**`utils/__tests__/cpf`** + **`routes/client/__tests__/emissaoNfseCliente`**. Medir antes da migration:
**`scripts/diag-nfse-numeracao.mjs`** (só leitura, zero chamada externa).

### ⚠ N CÓDIGOS DE SERVIÇO POR EMPRESA — decisão do dono, 16/08/2026

> *"ao cadastrar podemos ter mais de um código, a empresa pode usar mais de uma atividade e na hora
> da emissão ela deve escolher (…) existe uma lista da LC116 com texto vs o código, devemos mostrar
> o texto para que facilite a escolha."*

**A fonte existe agora, e é o que autoriza a mudança de campo digitado para escolha:**
`docs/lista-servico-nacional/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx`
(SHA-256 `a588fea0…55d424`), aba `LISTA.SERV.NAC.`, do portal `gov.br/nfse`. Ler o README de lá
antes de mexer. Gerador: `scripts/gerar-lista-servico-nacional.mjs` (só leitura, zero rede) →
`apps/web/src/lib/servicosNacionais/servicosNacionais.data.js` (`import()` dinâmico, 59 KB fora do
bundle inicial).

- ⚠ **O `cTribNac` NÃO é o item da LC 116.** É `item(2) + subitem(2) + desdobro nacional(2)`. O
  item `31.01` é o guarda-chuva; **`310104`** é "Serviços técnicos em telecomunicações e
  congêneres" — e é esse que o DANFSe imprime. Medido na planilha: **41 itens, 201 subitens,
  335 desdobramentos selecionáveis**. Carregar só o anexo da LC 116 daria a granularidade errada.
- ⚠ **ARMADILHA MEDIDA:** a coluna do código é NUMÉRICA e `010101` sai do arquivo como `10101`.
  O gerador dá padding para 6 **e prova o padding** conferindo cada linha contra as colunas
  ITEM/SUBITEM/DESDOBRO (335/335); divergência **aborta** a geração. Trava no front:
  `lib/servicosNacionais/__tests__/servicoNacional.test.js` ("o PRIMEIRO código é 010101").
- **Duas colunas, dois significados** (não duas com o mesmo — ver "TRÊS NÚMEROS DE DAS"):

  | coluna | o que é |
  |---|---|
  | `Company.codigosServicoNacional` (`TEXT[]`, nova) | **o conjunto habilitado** da empresa |
  | `Company.codigoServicoNacional` (existente) | **o que ESTA DPS leva** — é o que `buildMissingFields` exige e `buildDpsXml` escreve |

- **Coerência entre as duas**, em `validateAndNormalizeCompanyProfile`: lista com UM código ⇒ o
  singular é ele; lista com N e o singular fora dela (ou vazio) ⇒ **recusa nomeada**
  `company_codigo_servico_nacional_fora_da_lista`. ⚠ **Nunca "o primeiro da lista"**: seria o
  sistema decidindo qual serviço a empresa declara ao fisco.
- ⚠ **`undefined` ≠ `[]`.** Ausente = "não veio no payload, não mexer"; `[]` = "apague a lista". O
  `tx.company.update` usa spread condicional — sem isso, toda tela que salva a empresa sem este
  bloco (certificado, sócios, ficha) apagaria o cadastro de serviços.
- ✅ **A ESCOLHA POR EMISSÃO CHEGA AO XML DESDE 18/08/2026 — e a trava é o coração dela.**
  ⚠⚠ **Este item dizia o contrário** ("AINDA NÃO CHEGA AO XML, e isso está DITO na tela"): era uma
  ponte deliberada enquanto `NfseService.js` estava travado para outra sessão, para não existir
  seletor que parecesse funcionar e emitisse outro código (erro fiscal SILENCIOSO). A ponte foi
  fechada; a frase antiga fica aqui porque o **motivo** dela continua valendo para quem mexer.
  - **Campo:** `servico.codigoServicoNacional` (apelido `cTribNac`) em `validators/nfsePayload.js`.
    Lá se confere **só a forma** — 6 dígitos, `servico_codigo_nacional_invalido`.
  - **Trava (a decisão):** **`application/nfse/codigoServicoDaNota.js`**, regra PURA. ⚠ **O CADASTRO
    É A AUTORIDADE, NUNCA O PAYLOAD**: só vale código que esteja em `Company.codigosServicoNacional`.
    Fora dela ⇒ recusa nomeada **`NFSE_CODIGO_SERVICO_FORA_DA_LISTA`** (camada `NOSSA`), no espírito
    do `company_codigo_servico_nacional_fora_da_lista` que o cadastro já aplica ao SALVAR.
  - ⚠ **A trava mora no PRÉ-VOO de `issue`, não em `buildDpsXml`** — e por dois motivos: a recusa
    acontece **antes de reservar numeração** (não existe inutilização na NFS-e; número gasto à toa é
    buraco permanente), e assim **`buildDpsXml` não é alcançado**, ou seja, não há caminho em que um
    código não cadastrado vire `<cTribNac>`. Há teste sobre as duas coisas.
  - ⚠ **LISTA VAZIA NÃO É "PODE TUDO"** — e hoje ela está vazia em **33 de 33 empresas**. Sem lista,
    a autoridade do cadastro é o singular `codigoServicoNacional`: nada escolhido ⇒ sai o singular
    (**o comportamento de hoje, intacto**); escolhido = singular ⇒ passa; escolhido ≠ singular ⇒
    **recusa**. Aceitar qualquer código com a lista vazia desligaria a trava na carteira inteira.
  - ⚠ **Nunca "o primeiro da lista"**, nem aqui nem no cadastro — seria o sistema decidindo qual
    serviço a empresa declara ao fisco. Sem escolha, quem vale é o singular.
  - Elemento torto dentro da lista é **ignorado**, não recusa: a coluna não tem CHECK (ver a
    migration), e derrubar a emissão por causa de uma linha velha pararia quem escolheu certo.
  - Testes: `nfse/__tests__/codigoServicoDaNota.test.js` (a regra) + `emissaoDps.test.js` (o XML —
    o código dentro da lista **sai** no `<cTribNac>`; fora dela, `postMock` e
    `serviceInvoice.create` **não são chamados**).
- **Migration `20260816120000_add_codigos_servico_nacional`.** ⚠⚠ **APLICADA no banco de DEV** — medido em 01/09/2026 (`_prisma_migrations`); **produção é outra pergunta**, e esta máquina não a responde. Ver *"O ESTADO DAS MIGRAÇÕES"*. Aditiva
  (`TEXT[] NOT NULL DEFAULT '{}'`, espelhando `cnaesSecundarios`), com backfill do valor singular
  quando ele já tiver a forma. ⚠ **Sem CHECK, de propósito**: conferir cada elemento de um array
  exige `unnest`, que é subquery — e o Postgres a proíbe em CHECK; a alternativa
  (`array_to_string`) não é IMMUTABLE. Migration que falha é P3009 e servidor que não sobe. A forma
  é guardada no normalizador, no Zod e na tela. Medido: `codigoServicoNacional` está
  **vazio nas 33 empresas** (o campo só ganhou porta em 14/08/2026), então o UPDATE toca zero linhas
  hoje — ele existe para o intervalo entre escrever a migration e aplicá-la.

### ⚠⚠ O SELETOR DE CÓDIGO DE SERVIÇO NO PORTAL DO CLIENTE (19/08/2026)

**O que travava, e não era a tela:** `legacyCompanySelect` (`routes/client/index.js`) trazia
`codigoServicoNacional` (singular) e **não** `codigosServicoNacional` (a lista). Coluna fora de um
`select` explícito volta `undefined`, **sem erro nenhum** — o app do cliente não tinha o que
oferecer e não tinha como saber que havia o que escolher. Mesma armadilha da carga tributária e do
`codigoMunicipioIbge`, terceira vez.

⚠ **A AUTORIDADE CONTINUA SENDO `escolherCodigoServicoNacional`** (`application/nfse/codigoServicoDaNota.js`).
A tela é **ESPELHO** — `features/emitir/lib/codigoServicoDaNota.js` no portal do cliente — e o
espelho é **amarrado por teste**: `codigoServicoDaNota.test.js` importa a função do backend e roda
os MESMOS sete cenários pelas duas implementações, exigindo o mesmo veredito. Sem isso "espelho" é
intenção, não fato, e a divergência apareceria como *"a tela ofereceu e o servidor recusou"*.

**Três ramos, e o do meio é o único que renderiza hoje** (0 de 33 empresas têm lista plural):

| situação | a tela | o payload |
|---|---|---|
| `SEM_CODIGO` | diz que não recebeu código e manda falar com o contador | — |
| **`UNICO`** | **não pergunta**: diz qual código vai, com a descrição oficial | ⚠ **não manda o campo** — o servidor usa o cadastro, o caminho de sempre |
| `VARIOS` | seletor, **sem pré-seleção** | manda o escolhido |

- ⚠⚠ **COM VÁRIOS E NENHUM ESCOLHIDO, NADA SAI DA TELA.** Sem essa trava o campo não é enviado, o
  servidor cai no singular, e a empresa que habilitou três serviços emitiria sob o primeiro **em
  silêncio** — o erro fiscal silencioso que a própria autoridade descreve como "pior que a ausência
  do seletor". A tela **não elege**: recusa e diz o que falta (regra 3, "nunca o primeiro da lista").
- ⚠ **ENCONTRA, NUNCA ESCOLHE — nem com resultado único.** `UNICO` não vira "escolhido"; vira "é
  este, e a tela diz qual". A diferença está no payload, e é o que mantém intacta toda emissão
  existente.
- ⚠ **CÓDIGO GRAVADO FORA DA FORMA NÃO SOME** — aparece marcado, e não vira opção. Sumir faria o
  cliente achar que a empresa tem MENOS códigos do que tem, e a coluna **não tem CHECK** no banco
  (o Postgres proíbe subquery em CHECK), então isso acontece de verdade.
- ⚠ **Nenhum `padStart`, dos dois lados:** 6 dígitos ou nada. Padding fabricaria código plausível a
  partir de um dígito a menos — a classe do `cLocEmi="0000000"`.
- **A lista dos 335 entra por `import()` dinâmico** e sai em chunk próprio (medido no build:
  `servicosNacionais.data-*.js`, 59,61 kB, **fora** do bundle inicial).
  ⚠ **O GERADOR PASSOU A ESCREVER NOS DOIS PORTAIS** (`scripts/gerar-lista-servico-nacional.mjs`):
  uma atualização do Anexo B que chegasse a só um deles apareceria como "a tela ofereceu e o
  servidor recusou", no portal que ninguém do escritório testa.
- ⚠ **Trocar o código não reescreve descrição já editada** — o digitado vence, e o cruzamento é real
  desde que a descrição passou a chegar da nota de origem no reaproveitamento.
- **O mock exercita os DOIS ramos** (pc-001 sem lista; pc-002 com três, um deles fora da forma):
  este projeto foi mordido três vezes na mesma semana por ramo inalcançável offline.
- Testes: `contratoDeEmpresasDoCliente.test.js` (12 — varredura do `select`, com contraprova de que
  o padrão casa) + front `lib/codigoServicoDaNota.test.js` (30, com o amarre) e
  `codigoServicoNaTela.ligacao.test.jsx` (10, inclusive **o que chega ao payload**).

### ⚠ DUAS TABELAS FISCAIS NOVAS (25/08/2026) — LC 116 e NBS, com fonte, hash e gate

Pedido do dono ("baixar as tabelas nessa rodada"). As duas seguem o padrão de
`docs/lista-servico-nacional/`: o documento oficial entra no repositório com URL, data, tamanho e
SHA-256, e o código é **gerado** por um script que **aborta** na divergência.

| tabela | fonte | medido | consumidor |
|---|---|---|---|
| **LC 116/2003** | `docs/lc116/lcp116.htm` (Planalto, texto compilado) | 40 itens · 205 subitens · 5 vetados | `application/fiscal/lc116/` — descrição do serviço a partir do código |
| **NBS 2.0** | a MESMA planilha do Anexo B, aba `LISTA.NBS_v2.0` | 1.210 códigos | ⚠ **nenhum, por decisão** |

⚠⚠ **A NBS NASCE INERTE, E ISSO É DECISÃO DO DONO, NÃO ESQUECIMENTO.** O `cNBS` é campo **opcional**
da DPS e este projeto não o preenche; a recomendação foi esperar haver leitor (dado que ninguém lê é
o defeito que o Perfil Fiscal já tem), e ele decidiu gerar para estar pronta. **Ligar o `cNBS` na
emissão MUDA O XML de nota fiscal em produção** — é ato do dono, não consequência de a tabela
existir. Há teste **varrendo todo o `application/nfse/`** para provar que nenhum arquivo do caminho
de emissão a importa; se alguém a ligar, o teste cai e a decisão fica à vista.

⚠⚠ **AS ARMADILHAS DAS DUAS FONTES — todas custaram uma execução abortada:**

| onde | armadilha |
|---|---|
| LC 116 | o separador entre número e nome **não é hífen**: é `&#150;` (travessão do CP1252). Tratando só entidades **nomeadas**, o extrator achou **1 item de 40** |
| LC 116 | o texto compilado traz **as DUAS redações interleavadas** (original e LC 157/2016), com o **mesmo número**. Lido cru, a versão guardada é a **REVOGADA** |
| LC 116 | `"lista de serviços anexa"` aparece **quatro vezes** no corpo da lei — ancorar nela começa a extração no meio do art. 2º |
| LC 116 | a codificação é **latin-1**; lida como utf-8, todo acento vira U+FFFD |
| NBS | a coluna do código é **MISTA**: 1.108 vêm como texto e **102 como NÚMERO** (`1.0101` vira `10101`) |
| NBS | **112 códigos vêm com espaço no fim** — sem `trim`, `"1.0101.11.00 "` e `"1.0101.11.00"` são códigos diferentes |

⚠⚠ **A CONTAGEM NÃO É PROVA, e isso foi medido.** Uma entrada perdida e outra duplicada dão o mesmo
total. O gate da LC 116 exige que os subitens de cada item formem uma **sequência contígua** `.01` a
`.N`; o da NBS exige que **todo** código numérico remontado tenha **filho** na lista em texto (102 de
102). Foi a prova de contiguidade que corrigiu o total da LC 116: uma primeira sondagem dizia 204 e
estava **colando uma entrada no texto da anterior**, em silêncio.

⚠ **E o gate da LC 116 tinha um buraco, achado por experimento:** trocando o desempate para "a última
escrita vence", o total continuava 205 e ele **passava** — escrevendo a descrição **revogada**.
Contagem igual, conteúdo trocado. Hoje há prova de **conteúdo**, e o experimento aborta nomeando o
subitem. ⚠ O primeiro experimento que rodei **não media nada** (no documento a alterada já vem
depois da original); só a ordem invertida exercita a guarda.

⚠⚠ **`.gitattributes` NASCEU JUNTO E É PARTE DA ENTREGA.** O git ia converter CRLF→LF no `.htm`,
mudando os bytes e invalidando o hash do README e do arquivo gerado. **Hash que não confere é pior
que hash nenhum — ele parece garantia.** `docs/** -text`.

⚠⚠ **O QUE A LC 116 NÃO RESPONDE:** ela **não diz o anexo do Simples**, não diz a presunção do
Presumido e **não classifica receita**. É a lista dos serviços sujeitos ao **ISS** — outra lei, outro
tributo. O de-para "item da LC 116 → tipo de receita" é julgamento fiscal que não está em norma
nenhuma. Há teste que **cai** se alguém acrescentar `anexo`/`tipoReceita` aos subitens.

⚠ **Três listas, três granularidades:** item da LC 116 (4 dígitos) ≠ `cTribNac` (6) ≠ NBS. Há teste
recusando cada uma como sendo a outra.

### ⚠ A SÉRIE DA DPS É AUTOMÁTICA — decisão do dono, 16/08/2026

> *"sobre a série RPS, deve ser automática, devemos consultar a última nota emitida e extrair o RPS
> dela, e colocar para emissão, nem sempre o usuário vai emitir pelo nosso portal."*

`nfseUltimaNota.js` (leitura) + `nfseNumeracao.js` (decisão e reserva). **`NfseService.issue` não
foi tocado**: a assinatura de `reservarNumeracao({ companyId, rpsSerie, criarLinha })` é a mesma, e
`rpsSerie` deixou de ser a resposta para ser o **fallback**.

- **De onde sai, exatamente** (leiaute transcrito em `danfse/danfseLeiaute.js`, NT 008 §2.4.5):
  `NFSe/infNFSe/DPS/infDPS/serie` e `.../nDPS`. ⚠ **Não confundir com `infNFSe/nNFSe`**, que é o
  número da NFS-e (outro contador) — é ele que `PortalInvoice.numero` guarda.
- ⚠ **`PortalInvoice` NÃO tem a série da DPS em coluna.** `serie` existe no model mas só
  `DfeSyncService` (NF-e) a escreve; para NFS-e ela é sempre nula. **A única fonte é o `xmlRaw`.**
  Colunas dedicadas exigiriam backfill em 556+ notas e mudança na captura — decisão do dono.
- **Leitura por CAMINHO**, nunca `getTextByLocalNames` — mesma razão de `danfseDados.js`.
- **Janela de 50 notas** mais recentes (`papel: "EMIT"`, `xmlRaw` não nulo), e o piso é o **MAIOR
  `nDPS` da janela**, não o da primeira linha. ⚠ **Não filtra por situação:** nota CANCELADA
  consumiu o número, e não existe inutilização na NFS-e.
- **Reserva:** `GREATEST(contador interno, piso) + 1`, dentro do MESMO `UPDATE … RETURNING`. O
  contador continua valendo porque ele sabe das notas que nós acabamos de emitir e que o ADN ainda
  não devolveu (a captura é assíncrona).
- **As duas coisas proibidas, as duas com teste:** (1) reusar número já emitido — nota de fora com
  `nDPS` 127 e contador em 5 ⇒ o próximo é **128**; (2) pular em silêncio — leitura que falha
  **RECUSA** (`NFSE_ULTIMA_NOTA_ILEGIVEL` 422 / `NFSE_LEITURA_ULTIMA_NOTA_FALHOU` 503, mapeados em
  `routes/nfse.js`) e `criarLinha` nunca é chamada.
- ⚠ **A SÉRIE MANUAL NÃO FOI REMOVIDA, e não é esquecimento.** `Company.rpsSerie` cobre dois casos
  que a leitura não cobre: **empresa nova** (não há nota de onde ler) e **última nota fora da faixa
  E0010** (`00001–49999` é do emissor por aplicativo próprio; série do Emissor Web não é nossa para
  continuar). Além disso `issue` a exige no pré-voo (`normalizarSerie(company.rpsSerie)`), que é
  código travado. Remover coluna é migration destrutiva, decisão do dono. O rótulo na tela virou
  **"Série da DPS (ponto de partida)"**.
- ⚠ **Efeito colateral conhecido:** `rpsNumero` é um contador **único para todas as séries**. Se a
  série mudar, o `GREATEST` pode **pular** na série nova. Pular é buraco permanente (ruim); repetir
  é E0014 numa nota que talvez exista (pior). O desenho prefere o buraco. Um contador por série
  seria duas colunas com o mesmo significado.

## DANFSe — o PDF da NFS-e (NT 008), gerado por nós desde que a API oficial caiu

`application/nfse/danfse/` + `GET /firm/companies/:id/notas/:notaId/danfse`. A API oficial
(`adn.nfse.gov.br/danfse`) foi **sobrestada em 03/08/2026**, e a NT diz que é por isso: ela
"servirá de base para a geração do DANFSe por meios de softwares de emissão de NFS-e, ERPs e
sistemas fiscais, **motivo pelo qual** a API será sobrestada". Prazo prorrogado duas vezes
(01/07 → 15/07 → 03/08).

**Fonte versionada, com hash:** `docs/leiaute-nfse/NT_008_SE_CGNFSe_DANFSe_v1.02_2026-07-14.pdf`
(SHA-256 `1265f403…4fb0ff`), seção RTC do portal `gov.br/nfse`. **Ler o README de lá antes de
mexer** — ele traz item por item o que a NT exige. Regra-mãe (Res. CGNFS-e nº 3/2023, art. 13, e
NT §2.1): *"Não poderão ser impressas informações que não constem do arquivo da NFS-e."*

| arquivo | papel |
|---|---|
| `danfseLeiaute.js` | **transcrição** do §2.4.5: cada campo com caminho no XML, tag, altura/largura/esq/sup em cm e limite de caracteres. Nada deduzido por analogia com o DANFE da NF-e |
| `danfseDados.js` | lê o XML **por caminho**, monta os valores |
| `danfseDescricoes.js` | mapa código→descrição, **vazio de propósito** |
| `gerarDanfse.js` | pdfkit + `qrcode`; devolve `{ pdf, conformidade }` |

- ⚠ **A entrada é o XML, por parâmetro.** Nada lê banco, chama ADN/SEFAZ/SERPRO nem emite. A
  conferência contra as notas REAIS capturadas (`PortalInvoice.xmlRaw`) é o próximo passo, e é do
  dono — o gerador já está pronto para ela.
- ⚠ **Reusa o `pdfkit` que já existia.** A única dependência acrescentada é **`qrcode`**
  (node-qrcode), **escolhida pelo dono**: devolve PNG em Buffer e não tem binding nativo, o que
  importa porque o build é Docker/Railway.
- ⚠ **NÃO reusar `getTextByLocalNames` (`utils/xml.js`) aqui.** Ela devolve o primeiro elemento com
  aquele nome no documento inteiro, e o XML da NFS-e tem `CNPJ` em `emit`/`prest`/`toma`/`interm`,
  `xNome` em quatro grupos, `cMun` em cinco e `vBC` tanto em `infNFSe/valores` quanto em
  `IBSCBS/valores`. Num metadado isso é um campo torto; num DANFSe é **imprimir o CNPJ do prestador
  no lugar do tomador, num documento que circula**.
- **Gerado sob demanda, nunca salvo.** O PDF é inteiramente derivável do `xmlRaw`, que já está
  guardado; e o volume do Railway é efêmero — "registro existe, arquivo não" já é caso real com
  guias e SITFIS (ver "Armazenamento de PDFs"). Um DANFSe salvo herdaria essa classe inteira de
  defeito. Custo do derivado, medido: **7,4 KB** e ~90 ms por nota.

### ✅ QR Code — LIGADO (§2.2 e §2.4.3). A recusa NÃO foi apagada

Conteúdo: `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=` + a chave (`urlDeConsulta`).
Símbolo de **1,52 × 1,52 cm** em **X 17,48 / Y 1,67**, com as 3 linhas de 6 pt embaixo.

- ⚠ **A RECUSA CONTINUA, só deixou de ser o caminho normal.** Chave ausente no XML ou falha da
  biblioteca ⇒ `DANFSE_SEM_QRCODE` (com `motivo`) e **503** na rota. Um DANFSe sem QR Code não é um
  DANFSe: servi-lo em silêncio faria o contador mandar ao tomador um documento inválido achando que
  mandou o certo. **Ausência nunca é resposta.**
- ⚠ **`?semQrCode=1` e `permitirSemQrCode` FORAM REMOVIDOS**, e o motivo é que perderam o deles:
  existiam para conferir layout enquanto não havia biblioteca, e hoje a conferência se faz COM o QR,
  que é o layout de verdade. O que sobraria era servir o documento inválido exatamente quando ele é
  inválido. Chave com comprimento ≠ 50 **não** recusa — sai com aviso, como já fazia `danfseDados`.
- ⚠ **NÍVEL DE CORREÇÃO DE ERRO = M, E A NT NÃO O FIXA** (conferido em §2, §2.2, §2.4.3 e na tabela
  do §2.4.5: elas dizem tamanho mínimo, posição, conteúdo e contraste — e nada sobre nível, tamanho
  de módulo ou zona de silêncio). O envelope é fixo em 1,52 cm, então **subir o nível encolhe o
  módulo**: L=33 módulos/0,46 mm · **M=37/0,41 mm** · Q=45/0,34 mm · H=49/0,31 mm. Contra o risco
  real (laser comum + câmera de celular), módulo menor é piora certa; rasgo é risco eventual. O
  relatório declara a escolha em `conformidade.qrCodeTecnico`, com `fixadoPelaNt: false`.
- ⚠ **ZONA DE SILÊNCIO PINTADA NA PÁGINA, EM BRANCO** (0,17 cm ≈ 4,1 módulos — a folga que o próprio
  leiaute deixa entre o quadro e o complemento). Ela **não** pode sair de dentro dos 1,52 cm: uma
  margem embutida no PNG deixaria o símbolo em 1,25 cm, abaixo do mínimo da NT. E é branca porque o
  bloco "DADOS DA NFS-e" é pintado em cinza 5% — cinza encostado nos módulos é o que o §2.2 proíbe.
- ⚠ **O QR É O ÚLTIMO A SER PINTADO, e isso é defeito consertado.** PDF é pintor. O quadro do QR era
  desenhado ANTES do laço dos blocos, e o título do bloco (20,40 × 2,84 cm, cinza 5%) passa por cima
  dele inteiro — medido no content stream. Com a biblioteca ligada, o QR sairia **invisível** e o
  `conformidade.qrCode = "presente"` continuaria dizendo que estava lá. Ele vem depois da marca
  d'água pelo mesmo motivo: entre o carimbo K35 (§2.5.1) e a leitura garantida (§2.2), quem não pode
  ceder é a leitura.
- ⚠ **PNG em tons de cinza, SEM canal alfa** (`rendererOpts: { colorType: 0 }`), 10 px por módulo
  (370 px em 1,52 cm = 618 dpi, logo acima dos 600 dpi de uma laser). Alfa num QR preto-e-branco é
  dado que não existe **e** obriga o pdfkit a decodificar a imagem em JS (`splitAlphaChannel`) em vez
  de repassar o IDAT: 153 ms → 7 ms de embutimento, e o PDF cai de ~33 KB para ~7,4 KB.
  ⚠ O `toBuffer` empacota o PNG **linha a linha** por um stream de zlib, e dentro do jest cada
  escrita custa ~10 ms: 0,86 s a 296 px, 1,4 s a 370 px, 3,2 s a 592 px (em node puro, tudo < 50 ms).
  Foi por isso que a escala parou em 10 — subir dela só encarece o teste sem o dispositivo usar.

### ✅ CONFERIDO CONTRA UM DANFSe OFICIAL (documento real, lido só para leiaute)

O dono forneceu um DANFSe gerado pelo sistema oficial (uma página, `tpAmb=1`, leiaute 1.01).
⚠ **Ele não entra no repositório e nada dele virou fixture, teste, comentário ou doc** — é nota
fiscal real, com CNPJ, endereço, telefone e e-mail de prestador **e** de tomador. A conferência foi
feita lendo posição e rótulo com `pdf-parse`. O que ele **confirmou**: traço para campo ausente;
bloco IBS/CBS impresso **inteiro, com traços**, mesmo numa nota 1.01; destinatário e intermediário
condensados numa frase; e o **canhoto no rodapé** (Y 28,29 medido — a ordem do content stream o põe
primeiro no texto extraído, mas a posição é a do §2.4.5).

**A pergunta mais valiosa voltou resolvida: a descrição do serviço VEM DO XML.** O que o oficial
imprime acima do rótulo "Descrição do Serviço" é `xTribMun`/`xTribNac` (§2.4.5, campo "DESCRIÇÃO DO
CÓDIGO DE TRIBUTAÇÃO NACIONAL / MUNICIPAL", sem label), e a amostra versionada tem as duas tags.
**Não falta tabela nenhuma para este campo** — ele nunca foi um dos doze de `danfseDescricoes.js`,
que continuam pendentes.

Corrigido **por causa da NT** (o exemplo só confirmou):

| o que estava | o que a NT diz |
|---|---|
| todo rótulo impresso em CAIXA ALTA (o `nome` da tabela do §2.4.5) | §2.4.2: 6 pt, "primeira letra de cada palavra maiúscula", **exceto** o bloco 2.1.2 (7 pt, caixa alta). Virou o campo `rotulo` no leiaute |
| `"DADOS DA NFS-e"` e `"CANHOTO"` impressos **por cima** do primeiro rótulo, com o bloco inteiro em cinza 5% | §2.2.3 sombreia "cabeçalho, títulos de bloco" e dois campos. Nesses blocos a linha do §2.4.5 é a **caixa delimitadora** (o `esq`/`sup` dela é o do primeiro campo), não uma célula de título → `tituloImpresso: false` |
| CEP como `nnnnn-nnn` | §2.4.5: **`nn.nnn-nnn`** |
| `cTribNac` e `cNBS` crus | §2.4.5: **`nn.nn.nn / nnn`** e **`n.nnnn.nn.nn`** |
| campo composto vazio virava **um** traço | nota 12 + coluna de formato: **um traço por componente** (`- / -`), senão "- / -" e "-" ficam indistinguíveis |
| linha da nota 5 toda vazia saía com traços | nota 5: "poderá ser suprimida caso não existam dados em **todos** os campos da mesma linha". Implementado por `linhasDoBloco` (a linha é a coordenada `sup`), com `conformidade.linhasSuprimidas` |
| descrição complementar do QR **truncada com reticências** | §2.4.3 exige a frase inteira "disposta em 3 linhas" — e ela é obrigatória |

⚠ **Onde o oficial e a NT DISCORDAM, seguimos a NT — e a lista fica aqui para o dono decidir:**

| o oficial imprime | a NT | nós |
|---|---|---|
| `R$` antes de todo valor monetário e `%` depois da alíquota aplicada | só escreve o símbolo na **nota 10** (Totais Aproximados) e na coluna de formato de `redAliq`/`aliqIbs` (`% / %`) | sem símbolo, exceto onde a NT o escreve |
| código do IBGE com ponto (`nn.nnnnn`) | `nnnnnnn` | 7 dígitos crus |
| telefone como `(nn)nnnn-nnnn` | **nenhum formato** para `fone` | cru, como está no XML |
| `Município: <nome> - <UF>` no cabeçalho | `Informar "Município:  CCCC / CC"` | com barra |
| `0 - PIS/COFINS/CSLL Não Retidos` (código **e** descrição) só em `tpRetPisCofins` | "utilizar a descrição destas opções", igual para os doze | código cru + pendência declarada (a descrição continua faltando) |
| `Total do IBS/CBS` e `Valor Líquido + IBS/CBS` como **R$ 0,00** numa nota 1.01 | esses campos vêm de `IBSCBS`, inexistente no 1.01 | traço (nota 12) — imprimir 0,00 **afirmaria** que o total é zero |
| rótulos `VALOR DA OPERAÇÃO / SERVIÇO` e `VALOR LÍQUIDO DA NFS-e` em caixa alta; canhoto em caixa alta | §2.4.2 só excetua o bloco 2.1.2 | primeira letra maiúscula |
| `E-mail` no bloco do prestador | §2.4.5 e §2.1.3 escrevem **`EMAIL`** ali e `E-MAIL` nos outros três | a divergência da NT é preservada |

**Ainda não implementado, e é regra da NT:** o campo MUNICÍPIO do cabeçalho tem a observação *"Não
exibir, quando o item do cód. de tributação nacional informado for 99"* — a NT **não define** o que
é "o item" dentro de um `cTribNac` de 6 dígitos (`nn.nn.nn`), e escolher um dos três pares seria
inventar leitura de código.

### ⚠⚠ O QUE ESTAVA BLOQUEADO — QUATRO DOS SEIS CAÍRAM EM 24/08/2026

⚠⚠ **ESTA LISTA TINHA SEIS ITENS E QUATRO DELES JÁ ERAM FALSOS QUANDO FORAM LIDOS.** Em todos os
quatro o impedimento tinha deixado de existir dias antes, e **só o comentário continuou lá** — o
gerador seguiu imprimindo código cru e código de município porque ninguém voltou aqui. Ficam
registrados **como caíram**, porque o padrão é o achado: *bloqueio anotado envelhece calado*.

| # | era | hoje |
|---|---|---|
| 1 | "as descrições dos códigos não existem no repo — nenhum `.xsd` na árvore" | ✅ **os 20 XSD estão em `docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/`**, com a descrição na `<xs:documentation>`. `danfseDescricoes.js` preenchido, texto COPIADO do leiaute |
| 3 | "`prest/xNome` e `prest/end` **costumam** vir vazios; não caímos para `emit`" | ✅ caem para `infNFSe/emit`, **provado pelo CNPJ** — e o "costumam" era falso: ver o quadro abaixo |
| 4 | "a tabela do IBGE não está no projeto" | ✅ está, desde 20/08/2026, em `@contabilidade/shared/municipios-ibge`. Município sai `Nome / UF` |
| 6 | "logomarca oficial não versionada" | ✅ versionada em **`apps/api/assets/danfse/`** (⚠ não em `docs/`: `.dockerignore` ignora `docs/`) |

#### ⚠⚠ O ENDEREÇO DO PRESTADOR NÃO "COSTUMA" VIR VAZIO — MANDÁ-LO É PROIBIDO

Medido em 400 notas reais: `prest/xNome` e `prest/end` vieram em **0 de 400**; `emit/xNome`,
`emit/enderNac/*` e `emit/fone` em **400 de 400**; `emit/email` e `prest/email` em **397 de 400**.
Não é acaso, e o ANEXO_I diz por quê:

> **E0121** — *"Se o emitente da DPS for o prestador de serviço (`tpEmit = 1`), então o nome ou
> razão social **não deve ser informado**."* → Rej. 422
>
> **E0128** — *"O endereço do prestador do serviço **não deve ser informado** na DPS quando o
> próprio prestador for o emitente da DPS."* → Rej. 422

⚠ Esses campos existem para quando quem emite é o **tomador** ou o **intermediário** (E0122/E0129 os
tornam obrigatórios nesse caso). **Acrescentá-los ao `buildDpsXml` faria a nota ser REJEITADA** — e
o pedido "o endereço do prestador tem de estar na nota" já está atendido: ele está em
`infNFSe/emit`, escrito pelo próprio sistema nacional a partir do cadastro do CNPJ.

⚠ A queda para `emit` é condicionada ao **CNPJ igual nos dois blocos**. Documento diferente ⇒ nada
é completado (é nota emitida pelo tomador/intermediário, e `emit` é outra pessoa jurídica).
Medição: `scripts/diag-danfse-prestador.mjs` · `diag-danfse-campos-disponiveis.mjs` ·
`diag-danfse-prestador-preenchido.mjs` (300/300 notas reais com nome e endereço preenchidos).

#### O QUE CONTINUA BLOQUEADO

1. **O DANFSe é v2.0 (multitributário) e o nosso XML é 1.01.** Um bloco inteiro (Tributação
   IBS/CBS), mais `finNFSe`, o bloco DESTINATÁRIO e três totais saem dos grupos `IBSCBS`, que **não
   existem no leiaute 1.01**. Pela nota 12 saem com traço; a lista está em
   `CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01` e no relatório (`camposSemFonte`).
2. **Fontes Arial e Microsoft Sans Serif (§2.4) não estão embutidas.** Sem os `.ttf` o render cai
   em Helvetica **e reporta** — substituir por "parecida" em silêncio é o defeito. ⚠ O gancho já
   existe (`registrarFontes`, parâmetro `fontes`), e **nenhum chamador o usa**: 100% dos DANFSe de
   produção saem em Helvetica, com aviso.
3. ⚠ **O CORPO DA FONTE TEM TETO GEOMÉTRICO, NÃO NORMATIVO.** §2.1 diz que os números do §2.4 são
   **mínimos** e que os tamanhos do §2.4.5 **não são obrigatórios** — mas o conteúdo é desenhado a
   **8 pt fixos do topo da célula** e a altura mais comum é **0,63 cm = 17,9 pt**. A 8 pt ocupa
   17,2 pt (cabe); a 9,5 pt ocupa 18,9 pt e **vaza para a linha de baixo**. ⚠⚠ E o vazamento **não
   aparece em teste**: `pdf-parse` extrai a string igual e o `ellipsis` não dispara, porque o
   estouro é VERTICAL. Passar de 8 pt exige **crescer as células**, o que desloca todo o `sup`
   abaixo — rework de geometria, e a **disposição dos campos continua obrigatória** (§2.2.4, Anexo I).

#### ⚠⚠ OS TRÊS DEFEITOS DE 24/08/2026 — dois eram de LEITURA da NT, um era regressão minha

Relatados pelo dono sobre um DANFSe real: *"a descrição da nota deve aparecer completa, e esse
texto: TRIBUTAÇÃO MUNICIPAL (ISSQN) Tipo de Tributação do ISSQN está bugado no pdf ficando um em
cima do outro"* · *"Rio de Janeiro / - isso também tá errado, nesse caso deveria ser Rio de
Janeiro/RJ"*.

**1 · A descrição do serviço saía CORTADA — a célula não cabia nem UMA linha.**
`elastico: true` só ligava `multilinha`; a célula continuava com `alt: 0,63 cm = 17,9 pt`. O
conteúdo é desenhado a 8 pt do topo e `escreverConteudo` passa `height: h − (topo − y) − 1` =
**8,9 pt** com `ellipsis: true` — e uma linha de 8 pt ocupa **~9,2 pt**.

⚠ **O corte de UMA LINHA para NENHUMA é regressão do corpo da fonte** (`conteudoPt: 7 → 8`, commit
`2ee4749c`): a 7 pt a linha ocupava ~8,05 pt e ainda cabia. O corte do texto **longo**, esse, é
anterior e valia para qualquer corpo — sempre houve uma linha só.

Hoje `xDescServ` **cresce**, e os campos abaixo dele são deslocados — é o mecanismo que o §2.3 já
descreve para o bloco condensado, na direção contrária. ⚠ A altura sai da **folga do bloco elástico**
(Informações Complementares), que já encolhe sozinho porque o `alt` dele é calculado contra o
`canhoto.sup`, que é constante. Por isso o crescimento é **limitado** a essa folga: §2.2 exige *"uma
única página"*, e §2.1 autoriza o corte com reticências *"quando o campo não suportar a totalidade"*.
Primeiro se usa o espaço; só o excedente é truncado, e o relatório o **declara** (`camposCrescidos`,
com `truncado`).

⚠ **O canhoto NÃO acompanha o crescimento** — ele é o limite contra o qual a folga foi medida, e
empurrá-lo o jogaria para fora do A4 (sobram 0,93 cm abaixo dele). Por isso o crescimento usa um
acumulador **próprio**, separado do `deslocamento` das supressões.

Medido: descrição de 4.400 chars ⇒ célula de 0,63 → **3,25 cm**, **uma página**, com os 1.297
caracteres que o `truncaEm` deixa passar impressos inteiros e as reticências no fim.

**2 · O título do bloco ISSQN saía POR CIMA do rótulo do primeiro campo.**
⚠ **A transcrição estava FIEL** — a NT dá ao bloco `TRIBUTAÇÃO MUNICIPAL (ISSQN)` e ao campo
`TIPO DE TRIBUTAÇÃO DO ISSQN` exatamente as mesmas coordenadas: `0,63 · 5,09 · 0,30 · 14,43`
(p. 18 do PDF versionado; conferido também pela posição das palavras — o título em `x0 = 64,3` e o
campo em `x0 = 73,5`, ou seja o campo é **recuado sob** o bloco). Os dois textos saíam no mesmo `y`
(409,0 pt), na mesma célula, a 7 pt e a 6,5 pt.

⚠⚠ **A NT USA A MESMA FORMA DE LINHA PARA DUAS COISAS**, e só as coordenadas as separam: na maioria
dos blocos aquela linha é a **primeira célula da faixa** (e os campos seguem em `esq: 5,41`); em
alguns ela é a **caixa delimitadora** do bloco, e aí o `esq`/`sup` dela é o do PRIMEIRO CAMPO. O
critério já estava escrito neste projeto para CABEÇALHO, DADOS DA NFS-e e CANHOTO
(`tituloImpresso: false`) — **o `issqn` satisfazia o mesmo critério e nunca foi classificado**.

Hoje a regra é **derivada**, em `tituloEhCaixaDelimitadora` (`danfseLeiaute.js`), e não uma quarta
bandeira à mão: bloco novo cuja caixa coincida com a do primeiro campo já nasce sem a sobreposição.
⚠ A bandeira continua valendo para o CABEÇALHO, cujo primeiro campo tem coordenada própria
(`0,49 / 0,44`) e portanto não é pego por coincidência. Medido: **só o `issqn` colidia**.
⚠ Junto caiu o segundo estrago da mesma linha: `sombreado: temTitulo` pintava de cinza 5% a célula
do `tribISSQN`, contra o §2.2.3.
⚠ **O relatório sai do que a PÁGINA fez** (`!temTitulo`), nunca de uma segunda avaliação da mesma
condição — escrito à parte, ele dizia "título suprimido" com o título sendo impresso, e o teste de
conformidade passava sobre um PDF errado.

**3 · `Município / Sigla UF / País` imprimia `Rio de Janeiro / -` — a UF nunca entrava.**
O rótulo do §2.4.5 promete **três** componentes e a `obs` é explícita: *"Concatenar município, UF e
País"*. Montávamos `xLocIncid + cPaisResult` com `partes: 2`, e `xLocIncid` traz **só o nome do
município** — o traço do **país** ausente (nota 12) era lido como a UF faltando. Hoje a UF sai do
**código IBGE** (`cLocIncid` / `cLocPrestacao`) pela tabela, o mesmo caminho do município das
pessoas: `Rio de Janeiro / RJ / -`.
⚠ Sem a lista, ou com código fora dela, cai no `xLoc*` cru — o nome sozinho é melhor que nada e
nunca é uma UF inventada.

Regressão: os três blocos novos em `danfse/__tests__/danfse.test.js` (126 no arquivo). Experimentos
executados: desligando a regra geométrica, **2 vermelhos**; desligando o crescimento da descrição,
**5**.

⚠ **O teto de fonte do item 3 abaixo NÃO caiu com isto.** O que cresce é o campo **elástico**; a
célula de `0,63 cm` dos demais campos continua sendo o limite, e passar de 8 pt continua exigindo
rework de geometria com a disposição obrigatória do §2.2.4.

#### ⚠⚠ O QUE A NT **NÃO** PERMITE — medido contra o PDF versionado, para não ser repedido

Um mockup de layout novo (24/08/2026) pediu seis coisas que a norma recusa:

| pedido | veredito | citação |
|---|---|---|
| logo do **prestador** no cabeçalho | **PROIBIDO** | §2.4.3 nomeia **a logomarca da NFS-e**, com URL; §2.1 proíbe imprimir o que não consta do XML |
| preencher o prestador do **nosso cadastro** | **PROIBIDO** | §2.1 + nota 12 (campo sem informação ⇒ **traço**, não substituto) |
| colapsar grupo sem dados numa frase ("Sem retenções…") | **PROIBIDO** | §2.3 abre lista **fechada**: *"Poderão ser feitas **as seguintes** supressões"* |
| traço em **cinza** | **PROIBIDO** | §2.4: *"em **preto sólido (K100)**"* |
| continuar em **segunda página** | **PROIBIDO** | §2.2: *"deve ser impresso, **obrigatoriamente, em uma única página**"* |
| tarja **"SEM VALOR FISCAL"** em homologação | **texto errado** | §2: a expressão é **"NFS-e SEM VALIDADE JURÍDICA"**, 9 pt Arial negrito, vermelho M100/Y100 — já implementada |

⚠ E o que a NT **manda** e agora fazemos: traduzir os doze códigos e imprimir o município por
extenso (`Município / UF`, **com barra** — o DANFSe oficial usa hífen e nós seguimos a NT).

⚠ **A frase do art. 13 é atribuição NOSSA.** `danfseLeiaute.js` credita *"não poderão ser impressas
informações que não constem do arquivo da NFS-e"* à **Res. CGNFS-e nº 3/2023, art. 13** — e o PDF da
NT **não cita esse artigo em lugar nenhum** (varrido: "Resolu", "art.", "artigo", "nº 3" = zero
ocorrências). A NT enuncia a regra por conta própria, no §2.1. Não muda o efeito; muda a procedência.

### ⚠ Nota 12: campo vazio leva TRAÇO — ele não some

*"Os campos sem informações no XML devem ser preenchidos com um traço (-)"*. Isso **não** conflita
com o art. 13: o traço marca ausência, não inventa conteúdo. Suprimir a linha inteira só vale nos
casos nomeados (notas 1 e 5, e as supressões do §2.3, que condensam o bloco numa frase única e
transferem a altura liberada para Informações Complementares).

### ⚠ O transbordo de página se resolve TRUNCANDO, e o DANFSe não tem tabela de itens

Não existe grupo repetitivo de itens como no DANFE: há **um** `xDescServ` (1.300) e **um** bloco de
informações complementares (2.000). §2.1 manda cortar com **reticências (...)**; a linha de Totais
Aproximados (nota 10) é **fixa e fica fora do truncamento**. Ou seja, "nota com muitos itens" não é
o caso que estoura a página — e não foi preciso perguntar nada ao dono sobre isso.

### ⚠ A marca d'água vem do CICLO da nota, nunca do `chSubstda` do XML

`chSubstda` diz *"eu substituo AQUELA"*; quem responde *"esta foi substituída"* é o evento (ou
outra nota apontando para esta). Carimbar SUBSTITUÍDA por causa do `chSubstda` inverteria os dois
lados do vínculo — o mesmo defeito que o `NotaDetailModal` já teve. A rota deriva por
`derivarCiclo` (`notas/cicloNota.js`) e passa `marcaDagua` ao gerador, que **não decide sozinho**.

Regressão: `nfse/danfse/__tests__/danfse.test.js` (50) — inclusive **página única com descrição de
16 mil caracteres**, `tpAmb=2` imprimindo a expressão e `tpAmb=1` **não** imprimindo, campo ausente
virando traço, e a recusa quando o QR não pode ser feito. ⚠ O teste lê o texto do PDF com
`pdf-parse`: procurar a frase nos bytes crus **não funciona** (pdfkit comprime os content streams) e
faz o `not.toContain` passar por engano.

⚠ **O QR é conferido NO PDF, não no relatório** — `conformidade.qrCode` diria "presente" com o
símbolo coberto por outro desenho. Os testes medem no content stream: retângulo de 1,52 × 1,52 cm na
coordenada da NT, imagem pintada **depois** do sombreado do bloco, zona de silêncio `1 1 1 scn`
(branco puro), `DeviceGray` sem `SMask`, e **os módulos comparados um a um** com o símbolo da URL
exigida (pega imagem trocada, recortada, esticada, invertida ou de outra chave).
⚠ **Limite declarado:** essa comparação usa o mesmo codificador, então não re-deriva a cadeia de
caracteres. A **decodificação independente** (info de formato → máscara → zigue-zague →
desintercalação de blocos → segmentos, sem usar o `qrcode`) foi executada **fora do suite** sobre o
PDF da amostra e devolveu exatamente a URL + a chave, em versão 5, nível **M** lido do próprio
símbolo, máscara 6, 2 blocos, 86 codewords de dados.

## ⚠ ADN: `ultNSU` é EXCLUSIVO — o cursor guarda o último que já temos

`ultNSU` quer dizer **"último NSU que eu já recebi"**, e o ADN devolve os documentos
**posteriores** a ele. O cursor guardava `maxNSU + 1` e enviava isso como `ultNSU` — pedia "depois
do próximo", e **o documento exatamente naquele NSU nunca voltava**.

Medido contra o ADN de produção (ARAUJO BARRETO, 04/08/2026), com 7 documentos no banco e cursor 8:

```
ultNSU=6 -> DOCUMENTOS_LOCALIZADOS, NSUs 7 e 8
ultNSU=7 -> DOCUMENTOS_LOCALIZADOS, NSU 8
ultNSU=8 -> NENHUM_DOCUMENTO_LOCALIZADO
```

**Por que ficou tanto tempo sem ser visto:** a resposta era um `NENHUM_DOCUMENTO_LOCALIZADO`
legítimo. Sem exceção, sem `adnLastError`, sem log — a captura devolvia `ok:true, totalDocs:0`,
idêntico a "não há nota nova". O sintoma na tela era "a empresa ficou sem notas mesmo tendo
emitido".

⚠ **O estrago é por RODADA, não por empresa.** Como cada varredura recomeçava do cursor inflado, o
**primeiro documento de cada nova rodada** se perdia.

⚠ **`PortalInvoice` não guarda o NSU**, então não dá para saber quais documentos foram pulados. A
recuperação é **zerar o cursor e varrer de novo** — a ingestão é idempotente (dedup por
`chaveAcesso`, ou `idNfse` quando não há chave) e nunca rebaixa cancelamento.
`scripts/recuperar-nsu-pulados.mjs` recua o cursor (dry-run por padrão) e **não chama o ADN**: quem
varre é a captura, na hora que o escritório escolher.

**A SEFAZ (DFe) não tem esse problema:** `DfeSyncService` guarda o `ultNSU` que a **própria SEFAZ
devolve** na resposta, em vez de calcular. Guardar o que o servidor diz é a forma certa nos dois.

Regressão coberta por `notas/__tests__/adnCursorNsu.test.js`, com um ADN falso que implementa a
semântica exclusiva real.

## ⚠ ADN: o gate de 1h se mede por "OLHEI", não por "RECEBI" (o 429 de 09/08/2026)

Sintoma relatado: *"todas as empresas que entro na aba de notas estão com esse erro"*, com um
`[HTTP_429] … Path: /DFe/10. Body: <html>…` na tela. Eram **dois defeitos empilhados**, e nenhum
deles na aba.

**1) O laço.** `dfeNotasWorker` decidia consultar o ADN com `minutesSince(adnLastSyncAt) >= 60`.
Mas `adnLastSyncAt` **só é gravado quando vem documento** (`persistCursor`) — numa empresa que não
emitiu nota ele fica parado para sempre, a idade cresce sem limite, e o gate de 1 hora **nunca
fechava**. A empresa quieta era consultada a cada tick do worker, que é de **1 minuto**.

Medido em produção (10/08/2026): **44 a 50 varreduras por hora**, ininterruptas desde 05/08,
**13.000 a 16.000 consultas de NFS-e por dia** para capturar **de 9 a 32 documentos** — mais de
99,8% voltando vazias. Foi esse volume que produziu os 429.

Hoje o gate lê **`adnLastAttemptAt`** ("quando olhei"), que já era gravado em toda tentativa e
existia só para diagnóstico. ⚠ **O heartbeat deixou de furar o intervalo**: ele olha
`adnLastSyncAt > 7 dias`, que numa empresa quieta é a condição **permanente** — mantê-lo como `||`
reabriria o laço sozinho em um dia (as afetadas estavam em 5,7 dias). O que ele evitava (CNPJ
semanas sem consulta) o gate por tentativa já garante.

⚠ **A SEFAZ não tem esse defeito** e é por isso que só o ADN derreteu: `DfeSyncService` grava
`dfeLastSyncAt` em **toda** execução **bem-sucedida**, com ou sem documento — lá `sinceLast` já é
idade da tentativa. Por isso o gate **do worker** do DFe ficou como estava.

⚠ **Mas isso só vale para execução que TERMINA OK.** Quando a captura falha (656, erro de cert, 5xx)
`dfeLastSyncAt` não se move e o relógio volta a mentir. É por isso que a guarda de 1 h que hoje mora
dentro de `syncDfeForCompany` lê **`dfeLastAttemptAt`** — ver *"SEFAZ/DFe: a janela de 1 hora mora
DENTRO de `syncDfeForCompany`"*, logo abaixo.

**2) O eco.** `adnLastError` só era zerado por `persistCursor`, que também só roda com documento.
Empresa quieta termina em `NENHUM_DOCUMENTO_LOCALIZADO` e retorna `ok:true` **sem tocar no campo** —
então um erro de um dia ficava gravado **para sempre**. Medido: 13 empresas exibindo o 429 gravado
em 09/08 (15:01–16:08), com backoff expirado havia 19h e capturas bem-sucedidas 30 min antes que não
limparam nada. Hoje toda captura bem-sucedida apaga `adnLastError`/`adnBackoffUntil`; a que falha não
apaga nada.

⚠ **Abrir a aba Notas NUNCA consultou o ADN** — `GET /adn/state` é leitura de `PortalSyncState`, e a
consulta só sai pelo botão (`POST /adn/sync`). A aba já seguia a regra da Situação Fiscal; o texto na
tela era eco puro. Quem for investigar sintoma parecido: **confira se é leitura antes de suspeitar de
chamada**.

⚠ **O 429 do ADN não traz `Retry-After`** — medido nas 13 ocorrências: os headers eram só
`content-length`, `cache-control` e `content-type`. O cliente lê o header **se** ele existir, mas
quem decide a espera na prática é o backoff de 15 min do serviço. Não escreva que respeitamos um
`Retry-After` que não vem.

Regressões: `workers/__tests__/dfeNotasWorkerIntervaloAdn.test.js` (o gate e o heartbeat) e
`notas/__tests__/adnErroEco.test.js` (o eco, nas duas direções).

## ⚠⚠ SEFAZ/DFe: a janela de 1 hora mora DENTRO de `syncDfeForCompany` (23/08/2026)

Sintoma: o dono clicou em **capturar NF-e** numa empresa e levou `[CONSUMO_INDEVIDO] cStat=656` —
no **primeiro clique do dia**. A mensagem dizia *"outra aplicação consultando o mesmo CNPJ"*. **A
outra aplicação éramos nós.**

**Três regras para a mesma pergunta, e a terceira não existia.**

| caminho | onde | respeitava a janela? |
|---|---|---|
| worker | `workers/dfeNotasWorker.js` (`MIN_INTERVAL_BETWEEN_SYNCS_MS`) | sim |
| lote | `notas/captura/NotasCapturaService.js` (`INTERVALO_NFE_MIN`) | sim |
| **botão da empresa** | `routes/firm/notas.js`, `POST /dfe/sync` → `syncDfeForCompany` direto | **não** |

⚠ **Um clique bastava.** A espera de 1 h da NT 2014.002 é **condicional**: vale *"caso não existam
mais documentos a serem pesquisados"*, ou seja é disparada pelo **cStat 137** — e o laço de
`syncDfeForCompany` **itera até receber 137**. Toda execução bem-sucedida do worker **fecha a janela
sozinha**; o botão manual nunca teve como ganhar dele. Pior: o 656 grava **backoff de 60 min**, que
derruba **também o worker** — clicar tirava a empresa do ar por uma hora.

Hoje a regra mora **num lugar só**, dentro de `syncDfeForCompany`, e **quem chama herda** — mesma
disciplina de `fechamentoBlockers`, `guideContract` e `codigoServicoDaNota`. Worker e lote **mantêm
as guardas deles**: dupla checagem é inofensiva; removê-las faria a proteção depender de uma camada
só.

- Recusa **nossa e nomeada, antes de qualquer I/O**: `DFE_INTERVALO_NAO_CUMPRIDO`, com
  `ultimaConsultaEm`/`proximaConsultaEm`. **Nada sai para a SEFAZ.** Ela **não grava backoff nem
  tentativa** — gravar backoff aqui derrubaria o worker, que é o estrago que a guarda evita.
- ⚠ **A janela se lê por "OLHEI", nunca por "RECEBI".** O relógio é **`dfeLastAttemptAt`**, gravado
  em toda tentativa. `dfeLastSyncAt` só se move quando **chega** documento (e só em execução que
  termina OK) — usá-lo como relógio foi o defeito que custou **29 dias** no ADN e está escrito no
  comentário de `PortalSyncState` no `schema.prisma`.
- ⚠ **Empresa sem `PortalSyncState` passa.** Sem linha não há `dfeLastAttemptAt`, e quem nunca foi
  consultado não pode ficar preso.
- ⚠ **Não existe escape (`?forcar=1`).** A janela é regra **externa**: furá-la produz exatamente o
  bloqueio que a guarda evita. Diferente do teto do SERPRO (`podeForcarSerpro`), que é orçamento
  **nosso** e por isso admite forçar.
- ⚠ **O número vem de `DFE_NOTAS_WORKER_INTERVAL_MIN`** — a mesma constante do worker
  (`DFE_INTERVALO_MIN`), nunca um `60` escrito à mão. Duas janelas para a mesma regra dão no bloqueio
  que ambas evitam.

**A mensagem do 656 diz o FATO, não o palpite** (`explicar656`). Última tentativa **nossa** recente ⇒
*"este sistema consultou este CNPJ há X min; a SEFAZ exige 60 min"*. Só quando a nossa última
tentativa for **mais velha que a janela** é que a outra aplicação vira hipótese — e aí é dita **como**
hipótese. A frase antiga afirmava a hipótese e mandou o dono procurar culpado externo.

**A tela parou de prometer o botão.** `GET /dfe/state` devolve `ultimaConsultaEm`,
`proximaConsultaEm` e `podeConsultarAgora` (calculados por `avaliarJanelaDfe`, a **mesma** conta da
guarda). O botão fica **visível e desabilitado**, com o motivo no `title` — botão que some esconde
que a ação existe. ⚠ **O texto não é o da Situação Fiscal**: lá a janela é **nossa** (4 h, chamada
paga) e quem a consome é o contador; aqui é da **SEFAZ** e quem a consome é o **nosso worker**. Sem
dizer isso, o contador acha que a culpa é dele.

⚠⚠ **NÃO filtre o worker por `inscricaoEstadual`** — parece economia (20 empresas com A1, só 3 com
IE) e **quebraria a captura de notas de COMPRA**. Medido: as três únicas empresas com NF-e na base
(SINTROPIA 34, LENTE 11, ALBATROZ 2) **não têm IE**, porque as notas delas são **compras** — receber
NF-e de fornecedor não exige inscrição estadual. Quem tem IE é quem **emite**.

⚠ **PENDENTE, e é o mesmo raciocínio:** o **lote** (`NotasCapturaService.motivoParaPular`) **já tem**
esse filtro — pula NF-e de empresa sem IE com o motivo *"sem inscrição estadual (não emite NF-e)"*,
ou seja, pula justamente as três empresas que têm NF-e de compra. **Não foi mexido nesta correção**
(estava fora do pedido); fica registrado para o dono decidir.

Regressões: `notas/dfe/__tests__/dfeJanelaConsulta.test.js` (a recusa medida por **não-chamada** de
`fetchDistNSU`, empresa nunca consultada, `dfeLastSyncAt` velho × `dfeLastAttemptAt` recente, o ciclo
do worker continuando a passar, e os três textos do 656) e
`web/features/notas/components/__tests__/botaoBuscarNfeJanelaSefaz.test.jsx` (botão visível,
desabilitado, motivo no `title`).

## ⚠ ADN: quem consulta é o CERTIFICADO — nunca use o do escritório

O ADN Contribuinte identifica o contribuinte pela **SAN do certificado ICP-Brasil**. O path é
`/DFe/{NSU}` e **não carrega CNPJ nenhum**: o `cnpj` passado a `fetchDfeNFSe` é apenas validado.
Ou seja, quem consulta é o dono do cert — ponto.

`AdnNotasService` tinha um fallback para o cert do **escritório** quando a empresa não tinha A1,
apoiado numa suposição escrita no próprio código: *"provavelmente vai dar 404, mas mantém pra não
bloquear"*. A suposição estava errada — o escritório **é** cadastrado no gov.br/nfse, então o ADN
respondia com **as notas dele**, que eram gravadas debaixo da empresa cliente. Entravam como
**DEST** (o CNPJ não bate, então caem em "recebidas"), o que poupou o faturamento — que usa EMIT
autorizada — mas sujou a aba de Notas, a conferência ADN e as contagens da empresa.

Hoje: **sem A1 da empresa, não se consulta** (`NO_COMPANY_CERT`, com o motivo na mensagem). É o
mesmo caminho que o `ConferenciaAdnService` já seguia; o `AdnSyncService` legado também sempre
exigiu o cert da empresa (`ADN_CERT_REQUIRED`).

**Cinturão de segurança na ingestão:** `upsertNfseFromItem` recusa (`rejeitada_outro_cnpj`) todo
documento em que a empresa não seja nem prestadora nem tomadora. Isso pega a classe inteira, não o
caso: cert do escritório, A1 errado subido na empresa errada, ou qualquer mudança futura na
resolução de certificado — nenhuma delas avisa sozinha. Só recusa quando **há** CNPJ e ele não
bate: metadado sem nenhum dos dois não é evidência de nota alheia, e descartar por falta de dado
esconderia nota legítima (o erro oposto, igualmente caro).

**Dados já contaminados:** `scripts/diag-notas-de-outro-cnpj.mjs [cnpj]` lista as notas cuja empresa
não é nem prestadora nem tomadora, marcando as **EMIT** (essas afetariam faturamento e apuração).
Só leitura — não apaga nada, porque nota fiscal não volta e a decisão é do contador.

## ⚠⚠ NF-e DE VENDA ENTRA POR UPLOAD — não há, e não haverá, integração (23/08/2026)

> Pedido do dono: *"quero consultar as notas que ela [VAGALO] emitiu, mas não consigo"*.

**A resposta é normativa, e está PROVADA — não é limitação nossa.**

**NT 2014.002, §3** (PDF oficial, lido; a URL entra em loop de redirecionamento sem cookie jar —
use `curl -c/-b`):

> *"Este serviço permite que um ator da NF-e tenha acesso aos documentos fiscais eletrônicos (DF-e)
> e informações resumidas **que não tenham sido gerados por ele** e que sejam de seu interesse."*

E a **tabela normativa** da mesma página, coluna "Emitente":

| documento | Emitente | Destinatário |
|---|---|---|
| **NF-e** | **Não** | Sim |
| **Resumo de NF-e** | **Não** | Sim |

⚠ **E a consulta por chave também não salva** (§3.7): *"Para o emitente a NF-e **não** será
disponibilizada nesta consulta."*

⚠ **Manual NF-e da SEFAZ-RJ, item 1.15** — fecha o assunto: *"A SEFAZ **não presta esse tipo de
suporte** (envio de XML ou chave de acesso ou **disponibilização de relatório de emissões por
período**), tendo em vista a obrigação do contribuinte emitente de (…) **manter o arquivo XML**"*
(base legal: cláusula décima do Ajuste SINIEF 07/05).

**Medido:** 47 NF-e na base, **100% `papel: "DEST"`, ZERO `EMIT`**. Isso não é defeito de captura —
é o desenho do serviço.

### As alternativas, todas medidas e todas descartadas

| candidato | veredito |
|---|---|
| `NFeDistribuicaoDFe` (distNSU/consNSU/consChNFe) | não serve ao emitente — provado acima |
| `NfeDownloadNF` | desativado em 2017, substituído pela DistribuicaoDFe |
| `NfeConsultaProtocolo` | devolve situação + protocolo, **não o XML** |
| `arquivoXMLNFe` (BT 2018/001) | devolve XML por chave, mas é *"de uso **exclusivo das SEFAZ e do Ambiente Nacional**"* |
| **SERPRO Consulta NF-e** | ⚠ só `GET /{chave}`. Enumerados **todos** os paths do swagger: nada por CNPJ, período ou NSU. **Não descobre**, e descoberta é o problema. E **não é o Integra Contador** que já usamos — contrato à parte (o catálogo do Integra tem **zero** ocorrências de NF-e) |
| automatizar o **Fisco Fácil** | ver abaixo |

### ⚠⚠ Por que NÃO automatizar o Fisco Fácil — e o argumento decisivo é de arquitetura

O manual oficial do Fisco Fácil documenta a extração **tela por tela, botão por botão**, com 12
perguntas dedicadas: **zero menções a API ou web service**. Some-se a isso que a SEFAZ-RJ
**bloqueia por reputação de IP** os serviços com sigilo fiscal (página oficial dedicada) — robô em
datacenter cairia nisso e **derrubaria o acesso legítimo junto**; e que o Portal DFe usa recaptcha.

⚠⚠ **Mas o que encerra não é isso: o Fisco Fácil entrega um ZIP de XMLs.** Automatizar o portal
automatizaria **o clique de baixar** — alguém ainda teria de ingerir o ZIP. **O import é a
fundação, não a alternativa.** Se um dia houver API, ela devolverá XML, e o import já a recebe.

### A porta: `POST /clients/:clientId/invoices/import/nfe`

Regra em `application/notas/importXml/` (`zipLeitura` · `loteNfe` · `ImportNfeLoteService`), com
`application/notas/ingestaoNfe.js` como ingestão única.

- ⚠⚠ **O `papel` NÃO TEM DEFAULT, e é a razão de existir da entrega.** Em `DfeParser.js` o fallback
  dos **dois** ramos era `"DEST"` — se o import o reaproveitasse, **a nota de venda entraria
  rotulada como compra e o problema continuaria idêntico**. O papel sai da comparação
  `emit/CNPJ` × CNPJ da empresa, e **não havendo prova, não se inventa**.
- ⚠ **Sem CNPJ da empresa o lote inteiro RECUSA (422).** O CNPJ é o único jeito de MEDIR o papel.
- ⚠ **ZIP, não arquivo solto**, com `diskStorage` e leitura por stream (uma entrada por vez).
  `memoryStorage` carregaria o lote inteiro na RAM antes de a rota começar. O import de **NFS-e**
  (50 × 15 MB, memória) **não serve** de molde para o upload — só para a ingestão.
- ⚠ **Evento e outro modelo NÃO derrubam o lote** — saem contados e nomeados. NFC-e (**modelo 65**)
  é venda também e vem junto no varejo: sai contada, com o modelo no motivo, para o dono decidir.
- ⚠ **`resnfe` ESTÁ em `RAIZES_NFE`, e a ausência dele era defeito**: o resumo caía em
  `OUTRO_DOCUMENTO` ("não é nota fiscal") e o ramo `RESUMO_SEM_TITULARIDADE` — que existe para
  **não presumir `DEST`** num resumo de emitente que não é a empresa — ficava **inalcançável**.
- ⚠ **Lote da filial subido na matriz** sai `outro_estabelecimento`, **não** `nota_nao_pertence` —
  o segundo mandaria procurar defeito onde não há. A extração **não aceita raiz de CNPJ**.
- **O relatório é requisito:** *"importadas X · duplicadas Y · ignoradas Z"* + emitidas/recebidas.
  ⚠ O lote pode vir **legitimamente vazio** (o portal tem o estado *"Processada sem resultado"*) e
  sempre tem defasagem mínima de 10 dias. Sem os números, "não veio nada" e "deu erro" ficam iguais.

**Cotas do portal, para quem for usar:** carência **10 dias** · **6 meses** por solicitação ·
**5 anos** retroativo · **7 dias** para baixar · **3** solicitações sem download · não aceita raiz
de CNPJ. (⚠ Os **90 dias** da NT valem para a distribuição automática, não para o Fisco Fácil.)

⚠ **Nada neste caminho chama a SEFAZ.**

## ⚠ NFS-e: UMA ingestão só — o import de XML criava a nota de novo

O import manual (`routes/portalInvoices.js`) tinha uma **segunda implementação** da persistência, e
ela discordava da captura exatamente na chave de deduplicação:

| | chave gravada | upsert por |
|---|---|---|
| captura ADN | `chaveAcesso` quando há chave, **`idNfse` NULO** | `clientId_chaveAcesso` |
| import (antes) | **`chaveAcesso: null` FIXO**, `idNfse = numeroNfse` | `clientId_idNfse` |

O `idNfse` nulo na captura é **deliberado** ("evita colisão com nota DEST de mesmo número emitida
por outro prestador"), então o upsert do import **nunca encontrava** a linha da captura e criava uma
segunda. As duas `papel:"EMIT"` / `statusEfetivo:"autorizada"` → **o faturamento somava a nota duas
vezes**.

⚠ **O segundo efeito é pior.** `ConferenciaAdnService.getNossoConjunto` monta o nosso conjunto com
`chaveAcesso || idNfse`: a linha importada entra pelo **número**, o ADN responde com **chaves**, o
diff acusa `divergente` que não existe e **`salvarFechamento` TRAVA**. A única defesa contra nota
faltando passava a acusar nota que está presente. O import também não gravava `chaveSubstituida`/
`motivoSubstituicao`, então nota substituída importada perdia o vínculo.

Hoje a regra mora em **`application/notas/ingestaoNfse.js`** (`upsertNfseFromItem`, extraída de
`AdnNotasService`) e os dois caminhos a chamam. ⚠ **Não conserte isso "gravando a chave também no
import"** — foi reimplementar a regra que produziu a divergência. O que o import faz **a mais**
continua sendo dele: a titularidade (`nota_nao_pertence`, mais estrita que a guarda de dentro,
porque lá o arquivo vem de uma pessoa) e os contadores por arquivo.

- **Linhas legadas sem chave continuam na base**, e a decisão sobre elas é do dono (contador).
  Enquanto isso, importar o XML de uma nota que só existe como linha legada **não cria a segunda
  linha nem carimba a antiga**: conta como `duplicates` e devolve `duplicata_legado_sem_chave` com o
  `invoiceId`. O casamento exige chave no XML + mesmo número + **mesmo prestador**.
- Inventário: **`scripts/diag-notas-duplicadas.mjs`** (só leitura, zero chamada externa) — pares
  duplicados por empresa, faturamento duplicado por competência, competências `divergente` com nota
  entrando pelo número (divergência possivelmente falsa) e a linha de base de `tipoReceita`.
- Efeito colateral desejado: import em competência **fechada** agora vira `PendenciaPosFechamento`
  em vez de sobrescrever a base — é a regra que a captura já seguia.
- Regressão: `notas/__tests__/ingestaoNfseUnica.test.js`, que também **varre a rota** atrás de
  `portalInvoice.upsert`/`clientId_idNfse:` para a implementação não voltar.

### ⚠ OS CAMPOS FISCAIS DA NOTA NASCEM COM ELA — a projeção não pode virar fotografia

As colunas extraídas do XML (`cTribNac`, `cTribMun`, `xTribNac`, `xTribMun`, `xDescServ`,
`cLocPrestacao`, `issqnBaseCalculo`, `issqnAliquota`, `issqnValor`, `dpsSerie`, `dpsNumero` +
`camposFiscaisExtraidosEm`/`camposFiscaisMotivo`) nasceram de um **backfill** sobre 16.818 notas — e
a **captura não as preenchia**. Medido: durante a execução do próprio backfill chegaram **14 notas
novas, todas com as colunas nulas**; só entraram porque o script rodou outra vez.

⚠ **E isso é pior do que ficar desatualizado.** Como `NULL` também significa *"o XML não traz este
campo"*, duas semanas depois ninguém distingue "nota sem código de serviço" de "o extrator nunca
passou por esta linha". `camposFiscaisExtraidosEm` existe exatamente para desfazer essa ambiguidade —
e era ele que ficava nulo justamente nas notas novas.

**A porta é uma só:** `camposFiscaisNfse.camposFiscaisParaPersistir(xmlPlain)`, que devolve o bloco
de colunas pronto para espalhar no `create`/`update`. O extrator (`extrairCamposFiscaisNfse`, leitura
**por caminho**, NT 008 §2.4.5) continua intocado e continua sendo o **único** que sabe onde cada
campo mora.

| caminho de entrada de NFS-e | onde | ligado |
|---|---|---|
| captura ADN (`dfeNotasWorker` → `AdnNotasService`) | `notas/ingestaoNfse.js` | ✅ |
| import manual de XML pela tela (`POST /import/xml`) | idem (a rota chama a mesma função) | ✅ |
| motor de sync **legado** `POST /clients/:id/invoices/sync/start` | `sync/InvoiceSyncEngine.js` | ✅ |
| NF-e (SEFAZ DFe) | `notas/dfe/DfeSyncService.js` | ⛔ **de propósito** |

- ⚠ **A EXTRAÇÃO NÃO DERRUBA A CAPTURA.** `camposFiscaisParaPersistir` **não lança**: XML ruim vira
  coluna nula + motivo nomeado (`XML_ILEGIVEL`, `NAO_E_NFSE`, `NENHUM_CAMPO`, `EXTRACAO_LANCOU`) e a
  nota entra assim mesmo. Perder a nota é irreversível; o campo derivado se reconstrói do `xmlRaw`.
  O **extrator** continua propagando exceção — quem o chama para MEDIR (backfill, testes) tem de ver
  o erro, senão um leiaute quebrado se esconde atrás de um relatório limpo.
- ⚠ **RECAPTURA NÃO APAGA.** A extração é pura e sai do **mesmo `xmlPlain` que a escrita persiste em
  `xmlRaw`**: XML igual ⇒ colunas iguais; XML mudou ⇒ as colunas descrevem o XML novo. Não existe
  passo que limpe "para recalcular depois" — o defeito já pago com a classificação dos itens (abaixo).
- ⚠ **O ramo de EVENTO do `InvoiceSyncEngine` NÃO recebe a extração.** Lá o XML é o do *evento*, não
  o da nota: extrair dele devolveria `NAO_E_NFSE` e **zeraria** as colunas de uma nota correta.
- ⚠ **NF-e fora**, pelo mesmo motivo do backfill: `nfeProc/NFe/infNFe` não tem `cTribNac`, nem DPS,
  nem ISSQN. Carimbar `camposFiscaisExtraidosEm` numa linha em que tudo é nulo por natureza diria
  "olhamos e não achamos" onde o certo é "não se aplica". Quem responde isso já é a coluna `type`.
- ⚠ O `update` do ramo **competência fechada** segue estreito: os campos entram no `create` e não no
  `update`, pela mesma razão que o `xmlRaw` também não entra — recalcular o derivado sem reescrever a
  fonte faria os dois discordarem. Nota fechada já gravada se atualiza pelo backfill, que é idempotente.
- Regressão: **`notas/__tests__/camposFiscaisNaCaptura.test.js`** (15) — exercita o **caminho real**
  (`upsertNfseFromItem` + a rota de import), não o extrator isolado, e varre os três arquivos de
  ingestão atrás de caminho de XML reescrito à mão. Experimento executado: tirando o spread de
  `ingestaoNfse.js`, **11 vermelhos**; tirando o do `InvoiceSyncEngine`, **1**.

### AUDITORIA PRÉ-APURAÇÃO — TRÊS PERGUNTAS, e nenhuma delas é um veredito

> Pedido do dono (17/08/2026): *"nos ajuda em uma auditoria pré-apuração para entender se a nota está
> correta ou não, baseado na atividade e baseado na data de emissão"*.

É o consumidor das colunas acima. **Regra PURA** em `application/notas/auditoria/auditoriaNotas.js`
(nenhum import de prisma; só `utils/dataCivil.js`), ligação em `AuditoriaNotasService.js`, rota
**literal** `GET /firm/companies/:id/notas/auditoria?competencia=AAAA-MM` (registrada **antes** de
`/notas/:notaId`, mesmo cuidado de `/notas/summary`), tela em `apps/web/src/features/notas/` —
sub-aba **Auditoria** do grupo Fiscal, **antes de Apuração**, porque é *pré*-apuração.

#### ⚠⚠ O CORTE DE 21/08/2026 — de CINCO perguntas para TRÊS, aprovado pelo dono

⚠⚠ **ESTA SEÇÃO DESCREVIA CINCO PERGUNTAS ATÉ 21/08/2026.** A aba mostrava **~1.799 "pontos a
conferir"**, dos quais **~18** eram perguntas de verdade — e uma lista em que 99% é ruído treina o
contador a não ler a lista, afogando a única pergunta que entregava (o ISS zerado). O dono aprovou o
corte. O que mudou, e por quê:

| pergunta antiga | achados | veredito | hoje |
|---|---|---|---|
| 1 · atividade fora do cadastro | 0, com 33/33 empresas `NAO_CONFERIVEL` | não responde nada enquanto o cadastro estiver vazio, **mas a resposta honesta é a que ela dá** | **FICA** |
| 2 · emissão fora da competência | 1.738, sendo **1.727 de UM mês** | ruído; a pergunta útil são as **11** de 2+ meses | **ENXUGADA** (ver abaixo) |
| 3 · ISS zerado onde a atividade tributa | 7 | a única que entrega | **FICA** |
| 4 · numeração da DPS | 0 repetidos, **54 buracos** | ⚠ **falso positivo, provado na fonte** | **REMOVIDA** |
| 5 · nota que não pôde ser lida | 5 | defeito NOSSO, não pergunta de contador | **saiu da tela** (vira `manutencao`) |

##### ⚠⚠ Por que a numeração da DPS era falso positivo — a FONTE, para ninguém reintroduzi-la

Três motivos independentes, e o primeiro sozinho já basta:

1. **A norma não diz o que a pergunta afirmava.** A regra **E0014** do Padrão Nacional
   (`ANEXO_I`, aba **`RN DPS_NFS-e`, linha 148**) define a unicidade da DPS por **QUATRO**
   componentes — **Série + Número + Município Emissor + CNPJ/CPF do emitente**. A pergunta comparava
   **DOIS** (série + número), dentro de uma empresa: ela nunca esteve implementando a E0014.
2. **Não existe regra de numeração CONTÍNUA da DPS.** Varridas as **653 regras do `ANEXO_I`**:
   nenhuma exige sequência sem lacunas. O único campo com regra de sequência é o **`nNFSe`**, e ele
   é gerado pela Receita, não pelo contribuinte. Apontar "buraco" era o sistema inventando obrigação
   fiscal (princípio 1 do `CLAUDE.md` da raiz).
3. **Os buracos eram NOSSOS.** Duas causas medidas, as duas do nosso lado: (a) a consulta filtrava
   por `competencia: { gte, lt }` e **nota sem competência sumia antes de a regra existir** — o salto
   que ela deixava na série era fabricado por nós; (b) a captura do ADN comprovadamente pulou
   documentos. O que a pergunta media era a nossa **cobertura de captura**, dita como acusação à
   empresa.

O ramo **REPETIDO** saiu junto: dava 0 achados, e a frase descrevia algo que o sistema nacional
**impede na origem** (a E0014 rejeita a segunda DPS com a mesma chave de quatro componentes). Manter
na tela uma pergunta que só pode responder "não" é gastar atenção com uma certeza.

⚠ **Se algum dia voltar, tem de voltar como MEDIÇÃO DA NOSSA CAPTURA** (painel de operação), com as
quatro componentes da E0014 — nunca como pergunta na tela do contador. O argumento inteiro está
repetido em comentário dentro de `auditoriaNotas.js`, e travado por teste nos dois lados
(`PERGUNTAS.NUMERACAO_DA_DPS` e `FRASE_ESPECIE.NUMERO_PULADO` têm de continuar `undefined`).

⚠ **COMO LER O `anexo_i-….xlsx` se precisar reconferir:** **NÃO leia por `xl/sharedStrings.xml`** —
é um pool deduplicado, sem linha, e parear por vizinhança desloca uma linha inteira. Leia pela
`<row>` do worksheet, cruzando colunas da MESMA linha.

##### O que a aba passa a responder

| # | pergunta | população | medido em produção |
|---|---|---|---|
| 1 | atividade fora do cadastro (`cTribNac` × `codigosServicoNacional`) | EMIT autorizada | **0 achados; 33/33 empresas `NAO_CONFERIVEL`** |
| 2 | emissão **DOIS ou mais meses** distante da competência | EMIT autorizada | **11 linhas** (as 1.727 de um mês viram a contagem `viradaDeMes`) |
| 3 | ISS zerado onde a atividade tributa | EMIT autorizada | **7 notas** (BC > 0, valor 0) |
| + | **pendências pós-fechamento** (`PendenciaPosFechamento`, por EMPRESA) | — | *"entrou nota depois que eu fechei o mês?"* |
| + | **notas fora de qualquer conferência mensal** (`competencia` NULA) | EMIT | ver `foraDaConferencia` |

O payload tem **três compartimentos que não se misturam**: `perguntas` (o que o contador responde),
`manutencao` (o que NÓS temos de consertar — a leitura do XML) e `foraDaConferencia` (o que a
conferência mensal não alcança, com o motivo). **Só `perguntas` conta em `totalAchados`.**

⚠ **A AUDITORIA NÃO ESCREVE NADA** — não marca nota, não classifica, não cria pendência, não altera
apuração, e não chama ADN/SEFAZ/SERPRO. Provado em `auditoria/__tests__/auditoriaNaoEscreve.test.js`
(molde de `dadosPlanejamento.test.js`: os métodos de escrita **lançam** e um teste final varre
`Object.values(prisma)`), mais uma varredura textual do serviço atrás de `.update(`/`$transaction`.
⚠ Isso vale inclusive para o bloco novo de pendências: a tela **lista** e não oferece "Reabrir" nem
"Ignorar" (as ações existem em `PendenciasList` e ficam para a tela que as tiver).

⚠ **ZERO ACHADOS E "NÃO DÁ PARA CONFERIR" SÃO RESPOSTAS DIFERENTES**, e é o eixo do módulo. Cada
pergunta devolve `situacao: CONFERIDA | NAO_CONFERIVEL`; a segunda vem com `motivo` de vocabulário
fechado. Medido em produção (17/08/2026): **0 de 33 empresas** tem um único código em
`Company.codigosServicoNacional` — se a pergunta 1 respondesse "0 achados", a tela afirmaria
"nenhuma nota fora da atividade cadastrada" sobre um cadastro que não existe, em toda a carteira. A
resposta certa é `EMPRESA_SEM_CODIGOS_CADASTRADOS`: *"cadastre os códigos"*. Ausência de critério não
vira acusação **nem aprovação** — e a segunda é a mais perigosa, porque passa despercebida.
A mesma disciplina desce à NOTA: sem o campo que a pergunta lê, ela sai em `naoAvaliadas`, nomeada.

##### ⚠⚠ A CONSULTA QUE FABRICAVA BURACO — consertada em 21/08/2026

`AuditoriaNotasService` filtrava por `competencia: { gte, lt }`, e em SQL **`NULL` não satisfaz um
intervalo**: nota sem competência **nunca chegava à regra**. Ela não entrava em pergunta nenhuma
**e não aparecia nem em "notas fora desta conferência"** — a regra sequer sabia que ela existia,
enquanto a aba prometia, na cara, *"nada some em silêncio"*.

**A decisão foi APARECER SEPARADA, não entrar na conferência**, e o motivo é fiscal: a competência é
o eixo da aba, e atribuir a nota a um mês pela data de emissão seria o sistema **inventando a
competência dela** — o dado que decide em qual apuração a receita entra. Então:

- o bloco `foraDaConferencia` traz `motivo: SEM_COMPETENCIA_GRAVADA`, o **total contado no banco**,
  uma amostra (`LIMITE_NOTAS_SEM_COMPETENCIA = 50`) e `truncada`;
- ⚠ **o total vem de um `count` separado, nunca de `notas.length`** — lista truncada como total
  mentiria exatamente na empresa em que o problema é grande;
- ⚠ **`total == null` cai no tamanho da lista, nunca em zero**: `Number(null)` é `0`, e um zero aqui
  afirmaria "conferi, não há nenhuma". Mesma família de `folhaAusenteNaoEZero.test.js`;
- a frase de tela diz a consequência (*"não entram em apuração"*), não um veredito.

⚠ **A JANELA DE 12 MESES SUMIU JUNTO COM A NUMERAÇÃO.** `MESES_DA_JANELA_DA_SERIE` existia só para
aquela pergunta; hoje a auditoria lê **exatamente o mês que audita** — 1/12 do volume, mesma resposta.

##### As invariantes que o corte NÃO podia levar junto (todas travadas em teste)

- ⚠ **CADA ACHADO É UMA PERGUNTA, NUNCA UM VEREDITO.** O texto mora em `PERGUNTAS` (backend) e desce
  pronto para a tela; escrito no componente, a próxima tela a consumir a rota escreveria o seu e um
  dos dois diria "nota errada". Teste recusando `errad|inválid|irregular|incorret|ilegal`.
- ⚠ **NUNCA `--state-danger` na tela.** Vermelho, neste projeto, **bloqueia o fechamento**; achado de
  auditoria não bloqueia nada. ⚠ `PendenciasList` era **vermelha** (`#FF4757`) enquanto o comentário
  dentro dela dizia "o âmbar da caixa fica" — passou para `--state-warn` ao entrar nesta aba.
- ⚠ **A NOTA QUE FICOU DE FORA APARECE, COM O MOTIVO** — por pergunta (`naoAvaliadas`) e agora também
  no nível da empresa (`foraDaConferencia`).
- ⚠ **A CONTAGEM DA VIRADA DE MÊS É OBRIGATÓRIA.** As 1.727 notas de um mês deixaram de ser linha; se
  também deixassem de ser NÚMERO, a pergunta passaria a esconder o que de fato conferiu. Sobe como
  `viradaDeMes` (**sempre**, mesmo zerado — campo que só existe quando ≠ 0 obriga o consumidor a
  adivinhar o que a ausência quer dizer) + `mesesDeDesvioMinimo`.
- ⚠ **Desvio que não deu para calcular (`null`) NÃO cai na contagem** — vira linha. O que não sabemos
  medir nunca vira "caso normal".
- ⚠ **A NOTA CANCELADA continua fora das perguntas de apuração** (não entra em apuração nenhuma) e
  **dentro** da leitura de manutenção e de `foraDaConferencia` (é documento que existe).
- ⚠ **ISS: nota sem base, sem alíquota E sem valor NÃO é achado** (`SEM_ISSQN_NO_XML`) — é o desenho
  de nota imune/isenta/retida. Medido: 202 das 209 notas sem alíquota também não têm base nem valor.
- ⚠ **`NUNCA_EXTRAIDA` continua sendo calculada** (`camposFiscaisExtraidosEm` NULO = "o extrator
  nunca passou por esta linha", que é o que aquela coluna existe para desfazer) — só mudou de lugar,
  para `manutencao`. **Nada se esconde do contador por isso:** a nota ilegível continua saindo em
  `naoAvaliadas` das perguntas que dependem do campo que faltou, nomeada. É isso que autoriza o corte.
- `"autorizada"` é o MESMO valor de `FechamentoService.whereFaturamentoEmit()` (a definição única de
  faturamento). Ela não é importável pela regra pura (aquele módulo carrega o prisma no topo), então
  a amarração é **textual**, num teste que lê o arquivo — muda lá, cai aqui.
- Medição em produção: **`scripts/diag-auditoria-notas.mjs`** (só leitura, zero chamada externa, sem
  `--aplicar`). Ele itera `r.perguntas` e chama a MESMA regra pura da rota.
- Regressão: `auditoria/__tests__/auditoriaNotas.test.js` (42) + `auditoriaNaoEscreve.test.js` (14)
  + `routes/firm/__tests__/auditoriaNotasRota.test.js` (6) + web
  `notas/lib/__tests__/auditoriaTela.test.js` (25) e `components/__tests__/auditoriaTab.test.jsx` (16).

## ⚠ A RECAPTURA NÃO PODE APAGAR A CLASSIFICAÇÃO

`AdnNotasService` e `DfeSyncService` faziam `notaItem.deleteMany` + recriação seca. Isso apagava
`tipoReceita`, `anexoResolvido`, `classificadoEm`, `sujeitoFatorR` e zerava `flagExportacao` — **a
recaptura destruía a classificação em silêncio**. Urgente porque a classificação retroativa está
para rodar (`tipoReceita` nulo em 16.153/16.153 itens): classificar hoje e recapturar amanhã
desfazia tudo, sem aviso.

O casamento item-antigo × item-novo vive em **`application/notas/notaItens.js`**, e a assinatura é
**`codigoServico | ncm | cfop | valor`**:

- **os três códigos** porque são *exatamente* o que `ClassificadorService.classifyItem` lê — item de
  códigos iguais recebe, por construção, a mesma classificação;
- **`valor`** porque nota corrigida com valor diferente **é outro item**: ele não muda o resultado
  do classificador, mas é o sinal de que o documento mudou de verdade. Item alterado nasce
  `tipoReceita: null` e volta para a fila — que é o desejado;
- **`descricao` NÃO entra**: texto livre, não classifica nada, e um espaço a mais derrubaria a
  classificação de itens idênticos.

⚠ **`flagExportacao` é preservada por OU, e só ela.** Dentro de uma assinatura igual o CFOP é o
mesmo, então o valor derivado pelo parser de NF-e (CFOP 7xxx) é idêntico dos dois lados — o OU só
recupera um `true` que **nenhum** caminho de ingestão escreve (a criação do item de NFS-e nunca toca
o campo). Ver "o MERCADO é o campo que só existe aqui".

Custo assimétrico, e é o que justifica a chave estreita: perder o casamento custa uma
reclassificação (o classificador varre `tipoReceita: null` sozinho, e o que foi aprendido sobrevive
em `RegraClassificacao`); carregar classificação para um item que mudou poria receita no anexo
errado, sem ninguém ver.

## Robustez NFS-e/ADN — ledger append-only (Fase 1)

Roadmap completo em **`docs/robustez-nfse-adn.md`** (raiz do repo). Captura deve virar *fluxo de
eventos por NSU*, não *snapshot por data*. Fase 1 (fundação) já no código, **ainda NÃO ligada à captura**:
- Modelos `documentos`/`eventos` (imutáveis), `nsu_watermark`, `nsu_gaps` — migration `20260717120000_add_notas_ledger`.
- Primitivas em `src/application/notas/ledger/`: `LedgerService` (append idempotente + watermark atômico),
  `LedgerProjectionService` (`computeSituacao` — status é **projeção recalculável**, nunca coluna gravada),
  `NsuGapService` (detecta/resolve lacunas de NSU).
- **Nunca** dar UPDATE em `documentos`/`eventos` (correção = novo registro). A captura atual (`PortalInvoice`)
  segue intacta. Fase 0 (forense 28 vs 27) depende de dados de produção — pendente do dono.
- **Camada 2 (conferência ADN):** `ConferenciaAdnService` compara o conjunto de chaves que temos
  (EMIT/autorizada da competência = mesma população do faturamento) com o **conjunto autoritativo do ADN**
  (scan read-only por NSU, reusa `fetchDfeNFSe` sem mover cursor). Divergência → grava
  `ApuracaoSnapshot.conferenciaStatus="divergente"` e **`salvarFechamento` TRAVA** (`DIVERGENCIA_CONFERENCIA`).
  Município fora do ADN / sem cert = `nao_conferivel` (não trava). Sob demanda:
  `POST /firm/companies/:id/fechamento/:competencia/conferencia`; ferramenta de prod: `scripts/conferir-adn.mjs`.
  O scan do ADN só é validável em produção (cert + ADN reais).

## ⚠ Parcela de parcelamento NÃO é o DAS do mês

A parcela é gravada como `tipo:"SIMPLES"` (`CaptureSerproParcelaService`), **igual ao DAS**, e o que
separa as duas é o **`parcelamentoId`** (carimbado por `ParcelamentoV2Service`). Sem esse filtro a
parcela satisfazia o nó `das` do compliance: a empresa aparecia com "DAS gerada" sem nunca ter
gerado o DAS. Aconteceu em **duas telas ao mesmo tempo** (dashboard e `GET /guides/batch-report`),
porque cada uma tinha a sua leitura.

A regra mora em **`isGuiaDeParcelamento` / `colunaMatrizDaGuia`** (`guides/guideContract.js`) e é
consumida pelos dois lados. Não reescrever no consumidor — foi assim que divergiram.

- `guideCompliance` exclui a parcela da query principal (`parcelamentoId: null`) e a resolve num nó
  **próprio** (`parcDas`), com o mesmo ciclo de vida dos outros (`missing → gerada → enviada`).
- ⚠ **`vazio` e `semFaturamento` não valem para parcela.** Não se declara ausência de parcela
  contratada, e mês sem receita não suspende parcelamento.
- ⚠ **A pré-query de `AccountingEntry` com `subtipo:"PARC_DAS"` FOI REMOVIDA** (decisão do dono).
  Restou **UMA** pré-query alimentando o nó `parcDas`: a **GUIA** da parcela. Esse é o caminho de
  hoje — `CaptureSerproParcelaService` grava a Guide, `ParcelamentoV2Service` carimba o
  `parcelamentoId`, e é ela que tem PDF, e-mail e vencimento.
  - **Por que sair:** era **inalcançável**, não "quase nunca casava". O único escritor de
    `subtipo:"PARC_DAS"` era o modal manual antigo (`POST /entries/parcelamento`), removido na
    F2.3 — produção tinha ZERO lançamentos com ele. Nenhum caminho vivo grava esse valor: o **V1**
    (`ParcelamentoService.createParcelamento`) grava `PARC_<kind>` com kind ∈
    `SIMPLES|INSS|DARF|OUTRO`; o **V2** grava `PARC_<TIPO>` com TIPO ∈ `TIPOS_PARCELAMENTO`
    (`PARCSN`, `RELP_SN`, …), e só na competência de ABERTURA; os seeds usam
    `PARC_DAS_ABERTURA`/`PARC_DAS_RESCISAO`, que a igualdade exata da query não alcançava.
    Custava uma varredura de `accounting_entries` sobre a **carteira inteira**, a cada montagem do
    dashboard, para devolver sempre vazio.
  - **O que NÃO mudou:** o nó `parcDas` continua com o mesmo ciclo (`missing → gerada → enviada`),
    alimentado pela guia — que já era a única fonte com efeito prático.
  - Regressão: `guides/__tests__/guideComplianceParcelamento.test.js` trava as duas metades (um
    lançamento legado não acende o nó, **e** `accountingEntry.findMany` não é mais chamado).
- O rótulo na UI é **"Parcelamento"**, não "PARC DAS": uma parcela de **INSS** parcelado também cai
  nesse nó, e chamá-la de DAS seria trocar um erro por outro.
- Efeito de virada: empresa do Simples com parcela no mês passa a mostrar **DAS faltando** de
  verdade. É o comportamento correto, mas acende vermelho onde antes havia silêncio.

## Consulta de NOTAS em lote ≠ Download de notas

| | O que faz | Onde |
|---|---|---|
| **`/firm/notas-captura`** | **CONSULTA** ADN/SEFAZ e traz nota nova | `notas/captura/NotasCapturaService.js` |
| `/firm/notas-download` | zipa o `PortalInvoice.xmlRaw` que **já está** no banco | `notas/download/NotasDownloadService.js` |

⚠ **Foi essa confusão que escondeu a rotina automática quebrada.** Empresa sem captura gera pasta
vazia no ZIP e o job de download termina **"concluído" com zero notas** — a tela dizia que deu certo
justamente quando não tinha dado, e o contador acabou consultando as trinta empresas na mão.

O lote de captura **não tem lógica nova**: chama `syncAdnNotasForCompany` / `syncDfeForCompany`, as
mesmas dos botões por empresa e do worker. O que ele acrescenta é **`NotasCapturaItem`: uma linha por
empresa × alvo, inclusive para a empresa PULADA, com o motivo**. Essa é a razão de existir do
modelo — `dfeNotasWorker.listEligibleCompanies` descarta empresa sem cert dentro de um `filter` e
não deixa rastro, então "10 processadas" nunca disse quantas nem foram tentadas.

Pré-condições, todas viram item visível: sem A1 da empresa (NFS-e) · A1 vencido · sem inscrição
estadual (NF-e) · backoff ativo · empresa suspensa · **consultada há < 1h (NF-e)**.

⚠ **O intervalo de 1h é a NT 2014.002**, e é regra externa: estourar devolve "Consumo Indevido"
(cStat 656) e **bloqueia aquele CNPJ por uma hora** na SEFAZ — o oposto do que o lote quer. Mesmo
número do worker (`DFE_NOTAS_WORKER_INTERVAL_MIN`) de propósito; duas janelas para a mesma regra
dariam no bloqueio que ambas evitam.

⚠ **"O ADN não tem regra equivalente, lá o espaçamento de 1,1s já protege" ERA FALSO** — esta linha
morava aqui e custou uma investigação inteira. O delay de 1,1s de `AdnNotasService` é **interno a
uma sync**: separa a 2ª iteração da 1ª, dentro da MESMA empresa. A **primeira chamada de cada
empresa não era espaçada por nada**, e como toda varredura de carteira é um laço de *empresas*, a
maioria absoluta das chamadas caía no caso não coberto. O ADN **é** limitado por taxa (HTTP 429) e
hoje o espaçamento existe nos três caminhos: `AdnNotasService` (entre iterações),
`NotasCapturaService` (400 ms entre empresas), `dfeNotasWorker` e `conferenciaAdnWorker`
(`ADN_DELAY_MS`, 1100 ms entre empresas).

**Quando "a rotina não trouxe nada":** `scripts/diag-captura-notas.mjs` (só leitura, zero chamada
externa) mostra por empresa o certificado, o cursor NSU, a última sincronização e o último erro, com
um veredito por linha. **Antes dele, confira `DFE_NOTAS_WORKER_ENABLED=1` no ambiente** — se a flag
estiver desligada a rotina nunca rodou, e nenhum dado do script explica coisa alguma. O worker
também **não grava log de execução** no banco (diferente dos workers SERPRO, que gravam
`SerproExecutionLog`), então o estado por empresa é a única evidência que sobra.

## Extrato do Simples: salvo, visível, e o zerado marca o mês

Os PDFs da declaração e do recibo do PGDAS-D **sempre foram salvos** (`saveBase64Pdf` →
`GuideStorageService`, ids em `CompanyMonthlyCircular.pgdasDeclaracaoFileId`/`pgdasReciboFileId`) e o
payload bruto fica em `metadata`. O que não existia era **rota que os servisse** — ficavam guardados
e invisíveis, e por isso pareciam não estar sendo salvos.

- `GET /firm/companies/:id/pgdas/:competencia/pdf?tipo=declaracao|recibo` — molde do SITFIS,
  inclusive no tratamento de arquivo ausente (sem volume no Railway, "registro existe, arquivo não"
  é caso real).
- ⚠ **Sempre pelo `*FileId`, nunca pelo `*FileUrl`**: com provider LOCAL a URL é `file:///…`.
- O front lia `files.declaracaoUrl` e o backend devolve `files.declaracaoFileId` — o botão
  "Declaração (PDF)" da Apuração existia e **nunca renderizava**.

**Declaração ZERADA marca "Mês sem faturamento".** `generateEntriesFromCircular` só gera evento com
`amount > 0`, então um extrato zerado produzia zero lançamento e deixava a aba Lançamentos idêntica
a "ninguém buscou nada". A declaração transmitida à Receita é prova mais forte que o checkbox do
contador, então ela marca sozinha — passando pelo `marcarSemFaturamento`, com as **mesmas duas
travas** do caminho manual (ver `application/accounting/CLAUDE.md`).

⚠ **Só o zerado TRANSMITIDO marca.** O caminho `NOT_FOUND` (nenhuma declaração no período) não
marca: ali não existe declaração, e não há o que afirmar. Recusa não é erro do sync — grava o
conflito em `metadata.semFaturamentoRecusado` e a captura segue.

## ⚠ Armazenamento de PDFs — exige Volume no Railway

Provider default = **LOCAL** (`GUIDE_LOCAL_STORAGE_DIR`, default `./storage/guides` → `/app/storage/guides`).
O filesystem do container no Railway é **efêmero**: sem um Volume montado, **todo deploy apaga os
PDFs** (guias capturadas e relatórios SITFIS). O sintoma é o registro existir no banco
(`relatorioPdfFileId` / guia) mas o arquivo dar **ENOENT** na leitura.

⚠ **O caminho default é RELATIVO e o processo NÃO roda em `/app`.** O start é
`npm run start:prod -w @contabilidade/api`, e o npm executa o script com o CWD do **workspace** →
`./storage/guides` resolve para **`/app/apps/api/storage/guides`**. Um volume montado em
`/app/storage` **não captura nada** (erro cometido na 1ª configuração — o PDF continuava sumindo
mesmo com o volume criado).

**Config correta em produção — escolha uma:**
- **(recomendado)** Volume em `/app/storage` + env **`GUIDE_LOCAL_STORAGE_DIR=/app/storage/guides`**
  (absoluto, imune a mudança de CWD);
- ou Volume montado direto em `/app/apps/api/storage` (aí o default relativo funciona).

Alternativa sem volume: `GUIDE_STORAGE_PROVIDER=S3|R2` + bucket/credenciais (`GUIDE_STORAGE_*`).
O código já suporta os três providers (`GuideStorageService`).

Pra conferir onde está gravando de fato, o erro de leitura mostra o caminho absoluto
(`scripts/dump-sitfis-texto.mjs` imprime o ENOENT com o path completo).

A UI trata o arquivo ausente sem quebrar: a aba Situação Fiscal mostra "o arquivo não está mais no
armazenamento" e mantém situação/data (que vivem no banco).

## Fator R — conferência da folha de 12 meses

O Fator R decide **Anexo III ou V** (diferença tributária grande) e sai de
`CompanyMonthlyCircular.fs12Manual` — um número **digitado à mão**, com o mês anterior sugerido
(`FatorRService.resolverFolha12m`). Um dígito a menos ali muda o anexo da empresa: não há erro, não
há alerta, só um imposto diferente. Até aqui esse número não tinha **nenhuma segunda fonte**.

`FolhaDerivadaService.derivarFolha12m` soma os lançamentos de folha já existentes e devolve um
segundo número, para comparar. Entra no `getDadosFechamento` como `folhaDerivada`, e o
`FechamentoModal` mostra os dois lado a lado — total e **por competência**, destacando a célula do
mês que diverge.

**O que é somado:** o débito na **conta de despesa** de folha/pró-labore (`role: "salary"` dos
templates), nas 12 competências **anteriores** à de referência.

⚠ **Já foi "todo débito de todo lançamento `tipo:"FOLHA"`", e estava errado por três motivos que se
somavam no mesmo número:**

| # | Defeito | Efeito na tela |
|---|---|---|
| 1 | **A janela vinha um mês à frente.** `competenciasDe12Meses` terminava NA competência; a grade do modal (`pasAnteriores`) usa os 12 meses **anteriores** — que é a janela do Fator-R e do RBT12 | o mês do PA entrava no total e na contagem **sem ter célula**: "há folha lançada em 3 dos 12 meses" com só 2 rótulos. E o mês mais antigo da grade nunca era conferido — ficava sem rótulo, indistinguível de "confere" |
| 2 | **O lançamento de PAGAMENTO é `tipo:"FOLHA"`.** Desde a Q52 a rota `/entries/folha` grava a baixa no mesmo lote (D "Salários a Pagar" / C caixa) | o mês contava o bruto **e depois contava de novo a parte dele que foi paga** |
| 3 | **A regra ignorava a conta.** Débito em despesa é folha; débito em passivo é quitação de folha | o valor por mês saía inflado exatamente nos meses com pagamento lançado |

O comentário antigo do serviço ("a ÚNICA linha de débito é a despesa bruta") descrevia o lançamento
**composto** de antes da Q52 e ficou falso quando cada linha virou um lançamento de uma perna só.

As contas saem de **`resolverContasDespesaFolha`** (`payrollTemplate.js`) — a mesma fonte de
`accountHints` que o modal de folha usa para lançar. Duplicá-las faria a conferência somar conta
diferente da que o lançamento usa. Sem conta resolvida (plano de contas que não casa com nenhuma
dica), cai numa segunda regra: entry com D **e** C em duas pernas é pagamento e fica de fora — pela
rota, provisão tem exatamente uma perna e baixa tem exatamente duas. O retorno traz
`contasConsideradas` para distinguir "não tem folha" de "não achei a conta".

**Conferido contra a base real** com `scripts/diag-folha-derivada.mjs <cnpj> <competencia>` (só
leitura; imprime lançamento por lançamento o que a regra antiga somava e o que a nova soma, com as
contas). Na CHAYM 2026-07 o resultado foi exatamente o previsto: provisão `D 426 PRO LABORE
5.000,00` + pagamento `D 233 4.450,00` davam os **9.450,00** que apareciam na tela; a regra nova
fica nos **5.000,00** (o bruto, já com o INSS de 550 que sai no crédito). Use esse script sempre
que o número da tela for contestado — ele mostra o porquê, não só o total.

**O que NÃO é:** a base do Fator R. A base é regra fiscal (LC 123/06) e pode incluir ou excluir
parcelas que o sistema não separa. Isto é a soma do que foi LANÇADO, oferecida como conferência.

**Nunca escolhe por conta própria.** Mostra os dois valores e a diferença; `fs12Manual` continua do
contador. Numa empresa recém-migrada os lançamentos podem estar incompletos, e substituir o valor
digitado por um derivado incompleto trocaria um erro raro por um sistemático — por isso a caixa diz
em quantos dos 12 meses existe folha lançada.

Sem nenhum lançamento no período, `disponivel: false` e nada é mostrado: exibir "R$ 0,00" ao lado do
digitado sugeriria folha zero, quando o que há é ausência de dado.

⚠ **Formato de `pa`:** o modal usa `"YYYY-MM"` (string, de `pasAnteriores`) e é isso que ele envia
de volta; a série do PGDAS-D usa `AAAAMM` numérico. `folhaDerivada` traz os dois (`porMes` com
`competencia` string, `serie` com `pa` numérico) — a comparação na tela usa o **string**, senão o
`Map` não casa e a conferência por mês fica silenciosamente vazia.

## Situação Fiscal — tabelas do relatório + PDF opcional

A aba mostra as **TABELAS** do relatório; o PDF oficial fica atrás do botão "Ver PDF oficial".

### O relatório tem duas caras — e supor uma só foi o erro

Empresa **sem débito** traz apenas um laudo textual por órgão. Empresa **com pendência** traz
tabelas de verdade, com colunas (`Receita · PA/Exerc. · Dt. Vcto · Vl. Original · Sdo. Devedor ·
Multa · Juros · Sdo. Dev. Cons. · Situação`). Um parser escrito só contra o primeiro caso produz
lixo no segundo — foi exatamente o que aconteceu.

### Como o texto extraído realmente é

O PDF alinha colunas, mas o texto extraído põe **cada célula em uma linha**. Então a leitura é:
contar as colunas pelo cabeçalho e agrupar as linhas de dados de N em N. `COLUNAS_CONHECIDAS` é
uma lista **fechada** — é ela que separa cabeçalho de dado.

### As armadilhas do texto (todas reais, todas custaram um ciclo)

| # | Armadilha | Efeito se ignorada |
|---|---|---|
| 1 | CNPJ **colado** na 1ª célula do cabeçalho: `______CNPJ: 60.666.777/0001-92Receita` | a coluna some |
| 2 | **Cabeçalho da página 2** cortando a tabela no meio | desalinha tudo dali em diante |
| 3 | `Notificação de lançamento: 606667772026010011099-01 - CP-SEGUR.` — o próximo registro vem colado | perde um registro |
| 4 | Régua (`______`) como linha solta | entra como célula e quebra a contagem |
| 5 | Número da página em linha própria | filtrar todo número solto comia o `4` de "Parcelas em atraso" — o descarte é **posicional** |
| 6 | Bloco nem sempre começa com "Pendência -" | marcador é **título + régua na MESMA linha** (`[ 	]*`, nunca `\s*`, senão a régua final rouba a linha anterior como título) |
| 7 | **Uma célula pode vir PARTIDA em duas linhas** — o PA trimestral sai `2º` + `TRIM/2026` quando não cabe na largura da coluna | o registro fica com uma célula **a mais** que os outros, a divisão não fecha e o **bloco inteiro** é recusado por causa de um registro |
| 8 | **O mesmo cabeçalho tem duas grafias**: `Vl. Original`/`Sdo. Devedor` em "Pendência - Débito", `Vl.Original`/`Sdo.Devedor` (colados) em "Débito com Exigibilidade Suspensa" | a varredura do cabeçalho para cedo, o resto do cabeçalho entra como dado — e a contagem pode fechar assim mesmo |

### A remontagem de célula partida (armadilha 7)

`fundirCelulasPartidas` + `CELULAS_PARTIDAS`. Lista **fechada**, pelo mesmo motivo de
`COLUNAS_CONHECIDAS`: funde só o par de formatos já visto no texto real (`^[1-4][ºo°]$` seguido de
`^TRIM/\d{4}$`), só quando os **dois** pedaços aparecem colados, nessa ordem. Meia regra não funde
nada; quebra de formato desconhecido continua desalinhando a contagem — que é o desejado.

⚠ **O valor remontado não é inventado:** `2º TRIM/2026` é literalmente o que o relatório imprime
quando a linha **não** quebra (texto real de 20.222.333/0001-53). A regra faz as duas formas
convergirem para a que já existe.

### A validação

`linhasDeDados.length % colunas.length === 0`. Não fechando, o bloco **não vira tabela**: sai como
`naoInterpretado`, com as linhas cruas visíveis. É isso que impede a volta do defeito antigo — o
parser original extraía valores e chegou a mostrar **"R$ 100,00" de débito numa empresa sem débito**,
lendo o `100,00%` de participação do quadro societário.

⚠ **A rede é ARITMÉTICA, e isso é um limite, não um detalhe.** Desalinhamento cujo tamanho seja
múltiplo do número de colunas **fecha a divisão e passa**. Foi o que aconteceu com a armadilha 8:
duas colunas não reconhecidas viravam dado, 24 linhas dividiam por 3 sem sobra, e a tela mostrava
`30,65` debaixo de **"Receita"** — o defeito antigo, vivo em produção até 10/08/2026. Bloco novo se
confere pela **coluna do valor** no texto real, nunca só pelo `naoInterpretado` vazio.

### Regra de exibição

**A tabela nunca some.** Bloco ilegível aparece com as linhas cruas e o aviso de conferir no PDF —
esconder passaria a impressão de "nada consta", o oposto do que se sabe.

Verificado contra os textos reais gravados em produção (leitura de 10/08/2026): 60.666.777/0001-92
com 3 blocos e 11 registros; 10.111.222/0001-58 com os 6 registros do Presumido (2 trimestrais);
20.222.333/0001-53 com o bloco suspenso; e uma empresa só com parcelamento. Regressão em
`serpro/__tests__/parseSitfisRelatorio.test.js` — as fixtures são **excertos do texto real**, não
transcrição.

⚠ **Os CNPJs, razões sociais, números de parcelamento e inscrições citados nesta seção são
ANONIMIZADOS** — formato, pontuação e comprimento idênticos aos reais, dígitos fabricados, iguais
aos das fixtures do teste. As observações e as medições são de produção; só os identificadores
foram trocados, porque fixture entra no histórico do git para sempre. **Não traga os
identificadores reais de volta.** Valores monetários, datas e códigos de receita **não** foram
tocados: são estrutura (e os códigos são tabela pública da Receita).

⚠ **Um bloco continua ilegível de propósito:** 30.333.444/0001-03 repete o cabeçalho no meio da
tabela e cola `Situação: A ANALISAR-A VENCER` na linha seguinte. Cai em `naoInterpretado` com as
linhas cruas — que é a resposta honesta enquanto essa forma não for entendida.

### ✅ CONSERTADO em 2026-08-10 — o número do parcelamento (SIEFPAR) não é mais engolido

A regra de ruído era `/^[\d.]{10,}\s*-\s*.+$/`, escrita para descartar
`60.666.777 - BETA TECNOLOGIA LTDA` (o cabeçalho de página, que cai DENTRO dos blocos). Ela engolia
junto o **número do parcelamento**, que tem a mesma forma. O bloco aparecia com "Parcelamento:"
**sem valor** — perda de dado, não desalinhamento.

**O que separa os dois casos é a CAUDA depois do traço:** nome (tem letra) vs dígito verificador
(só número). A regra passou a exigir letra: `/^[\d.]{10,}\s*-\s*.*\p{L}/u`. É a formulação mais
estreita que cobre o ruído observado — nos 22 relatórios de produção, **toda** linha que precisa
sair tem nome depois do traço.

Medido rodando o parser sobre **os 22 `CompanyFiscalStatus.texto` de produção** (52 blocos). O diff
inteiro tem **três** mudanças:

| empresa | o que mudou |
|---|---|
| 10.111.222/0001-58 | `0211.00012.0011122233.26-69` volta ao bloco `Pendência – Parcelamento (SIEFPAR)` |
| 30.333.444/0001-03 | os **três** números voltam ao `Parcelamento com Exigibilidade Suspensa (SIEFPAR)` |
| 40.444.555/0001-64 | a **inscrição em dívida ativa** `70.4.24.100200-96` volta — e o bloco `Pendência - Inscrição (SIDA)` passa de TABELA a **cru** |

⚠ **O bloco do SIDA que "piorou" era o defeito antigo em pessoa.** Ele fechava por aritmética
(10 linhas ÷ 2 colunas) com as colunas deslocadas: imprimia `Inscrito em` debaixo de **"Inscrição"**
e a data debaixo de **"Receita"**, e o número da inscrição não aparecia em lugar nenhum. Com o
número de volta são 11 linhas, a divisão não fecha, e o bloco sai cru **com tudo visível** — a
resposta honesta. Não dá para consertá-lo só reconhecendo mais colunas: o registro real tem
`Ajuizado em` **vazio** (a linha em branco some) e um par `Situação:`/valor no fim, então nem 6
colunas fechariam.

⚠ **O SIEFPAR não virou tabela NESTE conserto** — ele é rótulo/valor intercalado, não
cabeçalho-e-dados; nenhum rótulo dele está em `COLUNAS_CONHECIDAS`, então o bloco inteiro saía em
`descricao`, na ordem impressa, com o número visualmente solto (o rótulo numa linha, o valor na
seguinte). Isto ficou registrado aqui como **decisão de produto**, e a decisão veio: ver a seção
seguinte.

### ✅ DECIDIDO em 17/08/2026 — o bloco do parcelamento (SIEFPAR) VIRA TABELA

O dono liberou a tabulação do bloco. O que o PDF imprime como **uma linha horizontal** —
`Parcelamento: <nº>   Parcelas em Atraso: 4   Valor em Atraso: 2.114,32`, com
`Parcelamento Simplificado` embaixo — virava **7 linhas âmbar empilhadas** na tela.

**A leitura é por PARES, e é uma segunda forma de bloco, não um remendo na primeira.**
`montarTabelaDePares` (`parseSitfisRelatorio.js`) só é tentada quando o cabeçalho **não** foi
reconhecido — é isso que garante que nenhum bloco que já virava tabela possa mudar de leitura.

- **Lista FECHADA de rótulos** (`ROTULOS_SIEFPAR`: `Parcelamento:` · `Parcelas em Atraso:` ·
  `Valor em Atraso:` · `Valor Suspenso:`), pelo mesmo motivo de `COLUNAS_CONHECIDAS`. Rótulo novo
  não vira coluna: fica fora do par e o bloco cai no aviso.
- ⚠ **O caso que decide o desenho é o RÓTULO COLADO.** Com 2+ parcelamentos o relatório não põe
  separador: a modalidade do anterior vem grudada no rótulo do seguinte
  (`"Parcelamento SimplificadoParcelamento:"`). O corte é no **rótulo inteiro, no fim da linha** —
  mesma disciplina das armadilhas 1 e 6. Quem tratar só o caso de um parcelamento deixa o bloco de
  três exatamente como estava.
- ⚠ **NÃO SE INVENTA PAR.** Rótulo só se emparelha com a linha seguinte, e só quando ela não é
  outro rótulo. Rótulo sem valor e **valor órfão** ficam FORA da tabela e voltam em
  `naoInterpretado`, com o aviso — nunca casados com o vizinho por proximidade. É o caso de
  `Parcelamento Simplificado`, que o relatório imprime **sem rótulo nenhum**: virar coluna exigiria
  inventar o cabeçalho (`Modalidade`), num documento fiscal.
- ⚠ **A PROTEÇÃO DA CONTAGEM NÃO AFROUXOU, mudou de forma.** Onde a tabela de colunas exige
  `dados % colunas === 0`, aqui se exige que **todos os registros tenham exatamente os mesmos
  rótulos, na mesma ordem**. Um parcelamento com um campo a mais derruba o bloco inteiro de volta
  ao estado anterior, com as linhas cruas visíveis.
- **Medido nos 22 relatórios reais** (`scripts/diag-sitfis-tabelas.mjs`, só leitura), antes → depois:
  blocos "só descrição" **5 → 3**; tabelas **25 → 27**; `tabela, forma NÃO BATE` **0 → 0**; não
  interpretado **1 → 1**. Nenhum bloco que já era tabela mudou.
- ⚠ **OS OUTROS TRÊS "SÓ DESCRIÇÃO" CONTINUAM COMO ESTÃO**, e isso é resposta, não pendência: são
  blocos `Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)` cuja **única** linha é
  `SIMPLES NACIONAL - EM PARCELAMENTO` — descrição livre, sem rótulo. Sem rótulo não há par, e
  forçar tabela ali seria inventar o layout. Seguem com o aviso âmbar de não-interpretado.
- ⚠ **O teste que travava o oposto foi INVERTIDO, não apagado.**
  `apps/web/.../__tests__/colunasNuncaSomem.test.jsx` tinha
  *"⚠ NÃO vira tabela — tabular o SIEFPAR é decisão do dono, ainda não respondida"*, com
  `expect(container.querySelector("table")).toBeNull()`. Ele existia para ninguém "consertar" por
  conta própria uma decisão de produto. A trava mudou de lado: hoje ela prende o desenho novo (os
  pares, o caso colado, e a recusa de inventar rótulo). O mesmo no backend, em
  `serpro/__tests__/parseSitfisRelatorio.test.js`.
- `Valor em Atraso`/`Valor Suspenso` entraram em `COLUNAS_VALOR` na tela e no diagnóstico — são as
  colunas de dinheiro do bloco. **Não há linha de total**: somar o valor de parcelamentos distintos
  produziria um número que o relatório não afirma.

### ✅ 23/08/2026 — A LEITURA POSICIONAL FOI LIGADA. O parser de texto continua VIVO

⚠⚠ **ESTE BLOCO DIZIA "NADA FOI LIGADO" ATÉ 23/08/2026** (a prova é de 21/08; a ligação é de 23/08).
O que **não** mudou, e é o eixo do desenho: **`parseSitfisRelatorio.js` continua INTACTO e continua
RODANDO EM PRODUÇÃO**. Ele deixou de ser importado direto por `routes/firm/index.js` porque quem o
chama agora é `montarRelatorioSitfis` — que o confronta com a leitura posicional a cada abertura da
aba. Ele é a **SEGUNDA OPINIÃO**, e o confronto é uma das três provas de fidelidade. Apagá-lo
apagaria a prova; ele é peça necessária, não legado.

#### O desenho: **posicional vence quando fecha, texto quando não fecha**

Regra em **`application/fiscal/serpro/lerRelatorioSitfis.js`** (`montarRelatorioSitfis` é PURA e é o
que os 16 testes exercem). O confronto é **por ÓRGÃO**, com o MESMO critério da prova
(`len(antes) != len(depois)` derruba o órgão):

| situação | o que a aba mostra |
|---|---|
| os dois órgãos concordam no nº de blocos | blocos da POSICIONAL (`leitura: "posicional"`) |
| um órgão discorda | aquele órgão fica com o TEXTO, o outro com a posicional (`"mista"`), motivo nomeado |
| pdf-reader fora do ar / forma inesperada / sem leitura gravada | TUDO do texto (`"texto"`) — exatamente o que a produção mostrava antes |
| relatório antigo, **sem `texto` salvo** | a posicional entra inteira: melhor tabela lida pela geometria que `relatorio: null` |

⚠ **O ENVELOPE (data de emissão, CNPJ/nome do contribuinte) CONTINUA VINDO DO TEXTO.** A leitura
posicional ignora de propósito tudo que vem antes do primeiro marco de órgão — dados cadastrais,
quadro societário, certidão. Só os `blocos` são substituídos.

#### Onde a leitura fica guardada — e por que NÃO há coluna nova

Em **`CompanyFiscalStatus.rawPayload.leituraPosicional`**, que já é `JSONB`. **Nenhuma DDL**: coluna
nova exigiria migration em produção, e produção é só leitura. O envelope do SERPRO fica intacto ao
lado — a chave é acrescentada, nunca substitui (`montarRawPayloadComLeitura`).

⚠ **Guarda-se a leitura POSICIONAL CRUA, nunca o relatório já fundido.** A fusão é determinística e
é refeita a cada leitura — é isso que mantém o parser de texto rodando em produção como segunda
opinião. Gravar o resultado fundido congelaria o confronto e aposentaria a prova.

⚠ **`rawPayload` entrou no `select` do `GET .../serpro/sitfis` e é DESMONTADO antes da resposta**
(`const { rawPayload, ...statusPublico } = status`). Deixá-lo no spread mandaria o PDF em base64
(~36 KB por relatório, medido nos 24 de produção) ao navegador a cada abertura da aba.

#### Quem chama o pdf-reader, e por onde

`POST /sitfis/posicional` (`apps/pdf-reader/app/routers/sitfis.py`), pelo **MESMO caminho HTTP das
guias**: `postSitfisPosicional` mora ao lado de `postExtract` em `modules/pdfReader/pdfReader.service.js`,
com o mesmo axios, o mesmo `X-Request-Id` e o mesmo `PDF_READER_TIMEOUT_MS`. ⚠ **Não escreva um
segundo cliente HTTP** — ele divergiria na primeira correção de timeout e o SITFIS passaria a falhar
por um motivo que ninguém consertou nas guias.

⚠ **`lerSitfisPosicional` NUNCA LANÇA.** Serviço fora do ar, timeout, 4xx/5xx, corpo torto: devolve
`null` e a aba mostra o que mostrava antes. Uma aba de situação fiscal não pode quebrar porque o
parser de PDF está reiniciando.

⚠ **ZERO CHAMADA AO SERPRO EM TODO ESTE CAMINHO.** A consulta é paga e o limite AV02 é por
CONTRATANTE. O PDF já está guardado; reler é local.

#### Reprocessar o acervo — **`scripts/reprocessar-sitfis-posicional.mjs`**

Relê os PDFs já guardados e grava só a chave `leituraPosicional`. **ENSAIO POR PADRÃO** (`--aplicar`
para gravar), e o **critério de aceite do dono é verificado a cada execução**: um só dos blocos que
hoje saem como tabela divergindo e o script **aborta a escrita inteira**, imprime a divergência e
sai com código 1 — inclusive com `--aplicar`. Ele não toca `texto`, `situacao`,
`relatorioPdfFileId`, `protocolo`, `checkedAt` nem `ultimoRelatorioEm`.

⚠ **Medido em ensaio contra produção, 23/08/2026, pela cadeia ligada inteira** (banco → PDF →
HTTP → posicional → confronto): 24 relatórios, 0 sem PDF, 0 falhas de leitura, **31 IDÊNTICOS, 0
DIVERGENTES**, **3 blocos passam a virar tabela** (as 15 inscrições em dívida ativa), 4 continuam
como estão. **Enquanto o script não for aplicado, os 24 relatórios do acervo continuam saindo pelo
parser de texto** — a leitura posicional só existe para quem for consultado a partir de agora.

#### ⚠ O PORTAL DO CLIENTE NÃO FOI LIGADO, e é decisão a tomar

`GET /client/companies/:id/situacao-fiscal` continua **só com o parser de texto**. Não é
esquecimento: `routes/client/__tests__/situacaoFiscalDoCliente.test.js` **trava o `select` daquela
rota nos quatro campos** (`situacao`, `texto`, `checkedAt`, `ultimoRelatorioEm`) e proíbe
`relatorioPdfFileId` ali — cada omissão tem motivo escrito. Ligar a posicional no lado do cliente
exige alterar essa trava, que é decisão de produto, não detalhe de implementação. Efeito hoje: o
cliente vê os blocos SIDA como linhas cruas; o contador vê a tabela.

#### O que mudou NA TELA (`apps/web/.../SitfisRelatorioTabela.jsx`)

- ⚠⚠ **O RÓTULO DA ANOTAÇÃO DEIXOU DE SER FIXO.** `anotacoes` só podia vir de
  `Notificação de lançamento:` (a única que o parser de texto reconhece) e a tela cravava esse
  rótulo. A posicional lê **qualquer** par `Rótulo: valor`, e o primeiro que trouxe foi `Situação:`
  (`ATIVA A SER COBRADA`, `AJUIZADA`, `NEGOCIADA NO SISPAR`). Mantido o rótulo fixo, a aba diria
  *"Notificação de lançamento: ATIVA A SER COBRADA"* — **rótulo falso sobre dado fiscal**. Hoje o
  rótulo sai de `anotacoesPorRegistro` (o que o PDF imprime) e **só quando ele cobre exatamente as
  anotações**; qualquer sobra volta ao rótulo de antes. Não se inventa e não se esconde.
- ⚠ **O `aviso` do bloco recusado aparece.** A posicional recusa o bloco nomeando o motivo
  (palavra fora da faixa da coluna, dinheiro em coluna de texto, colunas que se sobrepõem…). Sem o
  motivo na tela, a recusa vira aviso genérico e ninguém sabe se o relatório mudou de forma ou se o
  parser quebrou. Bloco sem `aviso` (parser de texto) fica exatamente como estava.
- ⚠ **`Situação` NÃO virou coluna da tabela** — é decisão de produto, ainda do dono.
- Regressão: `sitfis/components/__tests__/leituraPosicionalNaTela.test.jsx` (13). ⚠ O
  `colunasNuncaSomem.test.jsx` (a regressão do `f8768d10`) **não foi tocado e continua verde**.

### ⚠ 21/08/2026 — a prova da Fase 0 (a medição que autorizou tudo isto)

Uma segunda leitura em `apps/pdf-reader/app/extractors/sitfis_posicional.py`, que lê o PDF pela
**posição das palavras** em vez da fila de linhas achatada.

**Medido sobre os 24 relatórios REAIS guardados** (o PDF está em
`CompanyFiscalStatus.rawPayload.dados.pdf`, base64, **24 de 24** — reprocessar custa **zero chamada
ao SERPRO**): 38 blocos, **31 tabelas certas saíram IDÊNTICAS** (critério de aceite do dono, fixado
antes de rodar), **0 com coluna trocada**, e os **3 blocos SIDA** que hoje saem como linhas cruas
viraram tabela, expondo **15 inscrições em dívida ativa** (14 numa empresa) com número, receita,
data, processo, tipo de devedor e situação. Os outros 4 blocos que não fecham continuam como estão
— e **o do PARCSN/PARCMEI não é defeito**: é laudo em texto corrido, tabular exigiria inventar
cabeçalho.

⚠ **A razão de ser POR POSIÇÃO e não por contagem de linha está MEDIDA, não argumentada:** nos dois
blocos SIDA do mesmo PDF a célula vazia de `Ajuizado em` aparece como linha em branco num bloco e
some no outro — não há regra no texto que diga qual é qual. No PDF ela é um x sem palavra.
⚠ E a régua que separa colunas é a **largura de um espaço da Courier** (0,6 × corpo, medido em
2.028 de 2.043 folgas), não um limiar por "gap grande" — que erraria na folga de 7,00 pt entre
`Cons.` e `Situação`.

**Ler antes de mexer: `apps/pdf-reader/CLAUDE.md`**, seção "SITFIS — leitura POSICIONAL". Duas
formas de repetir a prova, e as duas custam **zero chamada ao SERPRO**:

- **fora do caminho ligado** (só o extrator): `apps/api/scripts/exportar-sitfis-prova.mjs` (só
  leitura, tira os PDFs do banco para uma pasta **fora do repo** — ⚠ eles trazem CNPJ, sócios e
  débitos reais; apague depois) + `apps/pdf-reader/prova_sitfis_posicional.py`;
- **pelo caminho ligado** (banco → HTTP → posicional → confronto):
  `apps/api/scripts/reprocessar-sitfis-posicional.mjs`, **em ensaio**, que imprime o mesmo placar.

**O relatório salvo nunca é apagado por uma consulta que falha.** A gravação só sobrescreve
`situacao`/`relatorioPdfFileId`/`texto` quando vem relatório NOVO.

## Situação Fiscal — trava de 4h (C11)

Abrir a aba **não** consulta o SERPRO: mostra o `CompanyFiscalStatus` salvo + o PDF gravado.
A consulta só acontece pelo **botão**, e `POST .../sitfis/relatorio` aplica uma janela mínima de
**4h por empresa** (`SITFIS_MIN_INTERVALO_MS`), respondendo `throttled:true` com o relatório salvo.
Motivo: a consulta é paga e o limite AV02 do `/Apoiar` é **por contratante** — consulta à toa de uma
empresa prejudica todas. `GET .../sitfis` devolve `podeConsultar` + `proximaConsultaEm` pra UI
desabilitar o botão. **A trava só vale quando já existe relatório salvo**: se a última tentativa
parou em "processando" (sem PDF), o contador pode tentar de novo — senão ficaria 4h sem situação
nenhuma. `?force=1` quebra a trava manualmente (não usado pela UI).

## Apuração — transmitir já traz extrato + guia (C12)

`transmitirFechamento` chama `sincronizarExtratoEGuia()` em **toda** transmissão (antes só na
retificação) e também nos **dois caminhos de "PA já declarado"** — que era justamente onde o
contador precisava rodar a busca na mão. Retorno: `posTransmissao { extrato, guia }`.
**Best-effort por definição:** quando o código chega ali a declaração JÁ foi transmitida, então
falha de rede/SERPRO não pode desfazer nada — volta como `skipped` no payload. Só a **retificação**
zera os flags de e-mail da guia DAS (`liberarReenvio`); numa transmissão normal a guia já nasce
`PENDING`.

## Envio de guias por e-mail — MANUAL, sem fila, e a falha precisa aparecer

O envio é 100% manual desde a **Q55** (`server.js`: *"nada roda sozinho"*). Isso tem duas
consequências que já produziram defeito, e as duas são sobre o sistema **dizer que fez**.

### 1. Não existe fila — e nenhuma mensagem pode dizer que existe

`POST /firm/guides/:guideId/liberar-cliente` e `POST /firm/guides/:guideId/resend-email` chamam
`runGuideEmailWorkerSelected` de forma **síncrona**, e esse worker toma o lock global
`guides_email_lock` (TTL **5 min**). Lock preso — envio de verdade em andamento **ou** processo
morto com o TTL ainda correndo — devolve `{ skipped: true, reason: "lock_active" }`.

A rota respondia **"Guia liberada; envio de e-mail ocupado no momento — ficará em fila."** Não há
fila: o laço foi removido e **nada drena `emailNextRetryAt`**. A guia não saía, e o contador ia
embora achando que o cliente ia receber.

As frases moram em **`application/guides/guideEmailCopy.js`** (`mensagemEnvioNaoFeitoPorLock`,
`mensagemEnvioFalhou`, `GUIA_AGUARDA_ENVIO_MANUAL`) — escrevê-las no lugar de uso foi como a
promessa ganhou **quatro** cópias. `__tests__/envioSemFila.test.js` trava o texto **e varre os
literais de `routes/firm/index.js`** atrás da reescrita à mão.

⚠ **`sent: false` não é sucesso.** A liberação ao app do cliente e o e-mail terminam separado; a
resposta traz `envio: { feito, motivo, podeTentarNovamente }` e o front mostra em **vermelho**
(`useManageCompaniesWorkspace.handleLiberarGuia`), não na caixa verde.

⚠ `resend-email` lia `result.guides[0]` — o worker devolve **`results`**. `sent` nunca era `true` e
o motivo nunca chegava à tela: reenvio bem-sucedido respondia "Tentativa de reenvio realizada.
Verifique o status."

### 2. A guia em `ERROR` fica em `ERROR` para sempre — então ela tem estado próprio na tela

`processOneGuide` grava `emailStatus:"ERROR"` + `emailLastError` + `emailNextRetryAt`. **Ninguém
drena o retry.** O que tornava isso invisível não era o banco — era a tela: `ERROR` e `PENDING`
caíam no mesmo visual, âmbar "gerada, falta enviar", o estado de quem **nunca foi tentado**.

A pergunta é uma só, **`envioDeEmailFalhou(guide)`** (`guideContract.js`), e alimenta três lugares:

| Onde | Antes | Agora |
|---|---|---|
| chip do dashboard (`renderGuiaChip`) | `state: "gerada"`, âmbar | `state: "falhou"`, vermelho `✖`, motivo e nº de tentativas no popover, botão **"Tentar enviar de novo"** |
| matriz do envio em lote | `📄 guia` | `✖ falhou` + motivo no `title` + **faixa no topo** contando as falhas, com botão que seleciona só elas |
| "Pendências de e-mail" | rótulo **"(debug)"** no menu | rótulo honesto; é a única tela com status/tentativas/`emailLastError` por guia |

⚠ **`falhou` NÃO mexe em `ok`.** A guia existe — o que falhou foi o envio. `ok` responde "a
obrigação está materializada?" e alimenta filtro de pendências e agregado de fechamento. A
visibilidade é assunto de `state`. E `falhou` **não é terminal**: `todasConcluidas` continua falsa,
senão o card condensaria em "✓ Guias concluídas" justamente na empresa que não recebeu.

⚠ **Enviada vence falhou.** Envio é terminal em QUALQUER canal; um `ERROR` de e-mail anterior a um
envio que deu certo é história, não pendência.

⚠ **A regra de exibição não mexe na elegibilidade.** `whereGuiaPendenteDeEnvio()` continua
alcançando `ERROR` — a linha segue selecionável e o mesmo clique tenta de novo.

⚠ `listPendingGuidesReport` tinha o **mesmo defeito do commit a61649d0 em uma quarta cópia**:
`{ OR: [PENDING, ERROR, SENDING] }` escrito à mão **não alcança `emailStatus` NULL**, e a DARF
consolidada do LP nasce NULL. A única tela que mostra o motivo da falha nunca listou as guias do
Lucro Presumido. Hoje reusa `whereGuiaPendenteDeEnvio()` e acrescenta `SENDING` **só ali** (é tela
de diagnóstico: guia presa em `SENDING` por processo morto é invisível para todo o resto).

### 3. O lote NÃO toma o lock — e isso é decisão medida, não esquecimento

`POST /guides/batch-send` é um laço **sequencial e bloqueante** sobre os itens que o front manda
(empresa × competência; "Todas pendentes" multiplica pelas competências em atraso). Ele **não**
toma `guides_email_lock`, e o envio por guia **toma** — então dois contadores podem, em teoria,
disparar envio concorrente sobre a mesma guia.

**Simetrizar seria trocar um risco estreito por um bug pior.** Medido:

- **O TTL não cobre o laço.** Ponto de ruptura = `300 s / N`: **10,0 s** por empresa com 30,
  **7,5 s** com 40, **2,5 s** se forem 3 competências pendentes de 40 empresas. O custo típico de
  um envio (1–3 s) cabe; o **pior caso não**: `EmailService` **não configura timeout nenhum**, e os
  defaults do nodemailer 6.10.1 (medidos em `node_modules/nodemailer/lib/smtp-connection/index.js`)
  são `connectionTimeout` **120 s** e `socketTimeout` **600 s**. **Uma única empresa pendurada
  estoura o TTL sozinha** — 10 min é o dobro dele. O custo determinístico (mkdtemp + anexos +
  limpeza) é ruído: **0,07–0,5 s** por empresa, medido.
- **Lock vencido é ROUBADO, não renovado.** `tryAcquireGuideLock` faz `updateMany` quando
  `lockedUntil <= now`. Estourar o TTL no meio do lote não "protege menos": dois processos passam a
  se achar donos, e o `finally` do primeiro chama `releaseGuideLock`, que zera `lockedUntil` **do
  segundo**. O lote longo quebraria a proteção que o envio por guia hoje tem.
- **A janela real é menor do que parece.** `sendCompanyGuidesEmail` marca as guias como `SENDING`
  num único `updateMany` **antes** de qualquer I/O, e `whereGuiaPendenteDeEnvio()` não casa com
  `SENDING`: um segundo lote sobre a mesma empresa não pega nada.
- **O que sobra:** `runGuideEmailWorkerSelected` **não** filtra por `emailStatus` — clicar "Liberar
  ao cliente" numa guia que um lote acabou de marcar `SENDING` manda um segundo e-mail. ⚠ **Não
  feche isso com uma guarda de `SENDING`:** guia presa em `SENDING` (processo morto) já é invisível
  para os dois caminhos de envio, e o clique direto é a **única** saída que resta. Recusá-lo trocaria
  um e-mail duplicado raro por um beco sem saída permanente e silencioso — o erro mais caro dos dois.

**Como medir de verdade quando quiser rever:** `sendCompanyGuidesEmail` já devolve `durationMs` por
empresa, e `batch-send` os repassa em `results[]`. Um lote real responde a pergunta com número.

## Guias na Circular — quem alimenta cada linha

- **DARF / PIS / COFINS / IRPJ / CSLL / ISS:** viram `AccountingEntry` PROVISAO de verdade, via
  `generateProvisionsFromGuide` no hook de `GuideService` (toda guia que vira PROCESSED, **inclusive
  upload**). Aparecem naturalmente na query `provisoes`.
- **INSS e SIMPLES/DAS:** `generateProvisionsFromGuide` **pula** os dois de propósito (INSS é manual;
  DAS vem do extrato PGDAS). A Circular os monta como **provisões sintéticas** no endpoint
  `GET /entries/circular` — não existem no banco.
  - INSS: sintética a partir da guia (`inssSynthetic`). Lê `guide.paymentStatus` direto, então o ✓
    do INSS **não** depende de `AccountingEntry.statusPagamento`.
  - DAS: normalmente vem do extrato; `dasSynthetic` só entra nos meses **sem** provisão de DAS
    (caso da guia subida à mão numa empresa sem extrato PGDAS).
  - Nos dois, havendo guia SERPRO **e** upload no mesmo mês, a do **SERPRO vence** (autoritativa) —
    senão a linha apareceria duplicada.

## Entrega por arquivo — o app NÃO gera e NÃO transmite (e são dois motivos diferentes)

`EntregaObrigacaoArquivo` + `GET/PUT /firm/companies/:id/entregas/:tipo[/:competencia]`
(`routes/firm/obrigacoes.js`). Serve EFD-Contribuições, ECD, ECF e EFD-Fiscal — o mesmo ciclo:
arquivo gerado fora → validado/assinado/transmitido no **PVA** → recibo.

Os dois limites não têm a mesma causa, e tratá-los como um só esconderia o segundo:

| | Por quê | Muda se…? |
|---|---|---|
| **não gera o arquivo** | o leiaute (Guia Prático da RFB, blocos 0/A/C/D/F/M/1/9) **não está no projeto**; deduzi-lo produz arquivo que o validador recusa — ou que ele **aceita com dado errado**, que é declaração falsa (regra 1) | sim, com o leiaute oficial em mãos |
| **não transmite** | validação, assinatura e transmissão são etapas do **programa oficial**, e não existe API | **não** — segue fora do app mesmo com o leiaute |

O que se guarda é o **rastro**: sem ele, "a EFD de março foi entregue?" só se responde abrindo o
PVA, empresa por empresa. `transmitidaEm` é **marca manual do contador**, nunca escrita por
automação, e `transmitida: false` **desfaz** (a EFD se retifica).

⚠ **O PUT só toca o que foi enviado.** Anexar o recibo não pode apagar o arquivo, e vice-versa —
são passos separados, feitos em momentos diferentes. O mock repete a mesma regra parcial de
propósito: zerar os outros campos lá quebraria o fluxo no mock e não em produção.

⚠ **`tipo` é string livre e `competencia` aceita `"YYYY-MM"` e `"YYYY"`** — as anuais (ECD/ECF)
usam o ano. Uma tabela por obrigação seria a mesma estrutura copiada quatro vezes, e a quarta
divergiria.

### Guarda de obrigatoriedade — e por que ela só recusa COM CERTEZA

Optante do Simples Nacional **não entrega EFD-Contribuições** (IN RFB 1.252/2012; Guia Prático
v1.35, Cap. I, Seção 3). O PUT recusa com **409 `OBRIGACAO_NAO_DEVIDA`** — a tela já não oferece o
fluxo, mas aba aberta antes de a empresa migrar ainda envia, e um "entregue" gravado numa empresa
dispensada responde a pergunta errada com confiança.

⚠⚠ **ATUALIZADO EM 01/09/2026 — `mapRegime` NÃO ASSUME MAIS NADA** (termina em `return null`; ver
"O REGIME DEIXOU DE SER CHUTADO", abaixo). **Esta guarda não foi tocada e não muda de comportamento**,
e o motivo é que ela **nunca chamou `mapRegime`**: `dispensadaPorRegime` (`obrigacoes.js`) tem cascata
PRÓPRIA sobre `company.regimeTributario` e já terminava em `return null` — o parágrafo abaixo cita o
`mapRegime` como analogia, não como dependência. O argumento dele continua valendo inteiro:

⚠ **Regime ausente ou desconhecido PASSA.** `mapRegime` (`apuracaoV2.js`) assume Simples por
default porque lá o default é inofensivo; copiá-lo aqui bloquearia trabalho legítimo de toda
empresa sem regime cadastrado. Nesta direção, bloquear por falta de dado é o erro caro — o oposto
da regra do front, onde ausência de regime vira o terceiro estado (`indefinida`) e não afirma nada.

A guarda vale **só para `EFD_CONTRIBUICOES`**: ECD e ECF têm outro rol de obrigados, e a dispensa
do Simples é específica desta obrigação.

## ⚠⚠ O REGIME DEIXOU DE SER CHUTADO — e o que fabricava o dado era o caminho de ESCRITA (01/09/2026)

`mapRegime` (`routes/firm/apuracaoV2.js`) terminava em `return "SIMPLES_NACIONAL"`, com o comentário
*"default (a maioria das empresas do app é SN)"*. Isso seria inofensivo se ele só alimentasse tela.
**Ele alimentava um `create`:**

```js
const cadastro = await prisma.cadastroFiscal.create({
  data: { portalClientId, regime: mapRegime(company), … },   // ← apuracaoV2.js:208
});
```

⚠⚠ **A PARTIR DAÍ O CHUTE ERA INDISTINGUÍVEL DE UMA AFIRMAÇÃO DO CONTADOR.**
`NfseService.carregarRegimeDaEmpresa` trata `CadastroFiscal` como **autoridade** e devolve Simples
Nacional com confiança total — sem o `prefill: true` que fazia a tela pintar âmbar. E mais **seis**
serviços leem a mesma linha como autoridade: `ClassificadorService`, `CnaesDaEmpresaService`,
`DisparidadeService`, `FechamentoService`, `MotorApuracaoService`, `PerfilFiscalService`.

⚠⚠ **O QUE TORNA ESTE CASO INSTRUTIVO: A VALIDAÇÃO EXISTIA E FOI ESCRITA DE PROPÓSITO.**
`dpsCodigos.resolverOpSimpNac` recusa regime desconhecido (`NFSE_REGIME_INDEFINIDO`) e o cabeçalho
dele registra que **NÃO reusa** o `mapRegime`, com o motivo: *"na apuração o default é inofensivo;
numa DPS ele declararia o regime da empresa por suposição"*. O autor **viu** a função, **recusou-a**
e **escreveu por quê** — e o `create` gravava o resultado dela assim mesmo.
**Guarda nenhuma resiste a um caminho de escrita que fabrica exatamente o dado que a satisfaz.**
Por isso o conserto é no ESCRITOR, não em mais uma validação.

**O que mudou, em três peças:**

| onde | antes | agora |
|---|---|---|
| `apuracaoV2.js` `mapRegime` | `return "SIMPLES_NACIONAL"` | **`return null`** |
| `apuracaoV2.js` `PUT /perfil-fiscal` | `create({ regime: mapRegime(company) })` | **409 `regime_nao_confirmado`**, na forma do `cadastro_fiscal_required` que já estava três linhas acima |
| `PerfilFiscalService.js:72-78` | cascata **duplicada** terminando em `"SIMPLES_NACIONAL"` | termina em `null` — e ganhou o `optanteSimples` que só a outra cópia tinha |

⚠ **AS DUAS CÓPIAS JÁ DIVERGIAM.** `mapRegime` consultava `company.optanteSimples`; a de
`PerfilFiscalService` não. A mesma empresa tinha duas respostas possíveis conforme o caminho que a
alcançasse — e o defeito ficava escondido porque as duas terminavam no mesmo default.

⚠ **RECUSAR É MAIS BARATO QUE UM ESTADO NOVO.** `CadastroFiscal.regime` é `String` NOT NULL, e
torná-lo anulável só empurraria o problema: `carregarRegimeDaEmpresa` continuaria vendo uma linha e
`temCadastro` continuaria `true`. **Sem regime, não há cadastro fiscal.**

⚠ **`null` NÃO SOBREPÕE regime salvo.** No `GET /cadastro-fiscal` a ficha da empresa continua sendo
a fonte *quando ela responde*; respondendo "não sei", o `regime` sai do spread (`delete
doCompany.regime`). Sem isso, a tela diria "não cadastrado" sobre empresa cadastrada — trocar um
defeito por outro.

⚠ **A APURAÇÃO CONTINUA TOLERANTE.** `apps/api/CLAUDE.md` já registrava que ali *"bloquear por falta
de dado é o erro caro"*, e isso não mudou: quem trata o `null` é cada chamador, e a tela já tinha o
ramo (`perfilFiscalTela.estadoDoRegime` → `AUSENTE`, com a frase certa). **Só a ESCRITA recusa.**
Tolerar em memória ≠ gravar.

⚠ **A guarda da EFD (`obrigacoes.js`) não foi tocada** — ela tem cascata própria e nunca chamou o
`mapRegime`.

- **Medido antes de mexer:** 28 das 34 empresas ainda **não têm linha** em `cadastros_fiscais` — o
  estrago em massa não aconteceu, mas cada salvamento de perfil fiscal o produzia. As 6 existentes
  se auditam com `scripts/diag-cadastro-fiscal-vs-perfil.mjs` (só leitura); **decidir se aquele
  `SIMPLES_NACIONAL` é verdade é do contador**, não de um backfill.
- **Regressão:** `apuracao/v2/__tests__/regimeNaoSeChuta.test.js` (8) — os quatro regimes que
  continuam sendo reconhecidos, os dois que viram `null`, o `optanteSimples` que voltou a contar, o
  cadastro salvo vencendo a ficha, e **a varredura textual** que recusa o default de volta em
  qualquer um dos dois arquivos (o `create` também não pode voltar a chamar `mapRegime` direto no
  `data`). ⚠ Experimento executado: reintroduzindo o `return "SIMPLES_NACIONAL"`, **1 vermelho**.
- ⚠ **Não verificado no navegador**, e o motivo é estrutural: `apps/web` em modo `mock` não alcança
  esta rota, e **não há banco alcançável nesta máquina**. O que prova o comportamento são os testes
  e a leitura; a conferência na tela é do dono, com o banco no ar.

## ⚠⚠ O ORÁCULO DO XSD PASSOU A SEGUIR `DPS_VERSAO` — era um falso-verde vivo (01/09/2026)

`dpsContraXsd.test.js` fixava `"1.01"` no caminho e nos nomes dos arquivos, enquanto
`NfseService.js` emitia `versao="1.00"`. **O único teste escrito para impedir a classe do E1235
validava o documento contra o esquema de OUTRA VERSÃO.**

Hoje `DPS_VERSAO` é **exportado** e o teste deriva dele o diretório (`Schemas/${DPS_VERSAO}`) e os
nomes (`tiposComplexos_v${DPS_VERSAO}.xsd`). Trocar a constante troca o esquema conferido, por
construção.

⚠⚠ **POR QUE ISSO IMPORTA, medido na fonte: `TCTribMunicipal` REORDENOU entre as versões.**

```
1.00: tribISSQN · cPaisResult? · BM? · exigSusp? · tpImunidade? · pAliq? · tpRetISSQN
1.01: tribISSQN · cPaisResult? · tpImunidade? · exigSusp? · BM? · tpRetISSQN · pAliq?
```

`xs:sequence` faz a ordem ser contrato. O gerador escreve só `tribISSQN` + `tpRetISSQN`, e esse par
mantém a ordem relativa nas duas — **por isso o desalinhamento não doía**. No instante em que
`pAliq` ou `BM` entrarem, a ordem passa a depender da versão declarada, e um oráculo apontado para o
esquema errado **aprovaria a ordem trocada**. É a classe exata do E1235, com o agravante de que o
teste que existe para impedi-la seria o que diria estar tudo bem.

⚠ **Consequência de ordem para quem for montar o `tribMun` completo: a subida de versão vem ANTES.**

**Os dois testes fazem perguntas OPOSTAS, e as duas precisam existir:**

| teste | segue `DPS_VERSAO`? | papel |
|---|---|---|
| `dpsContraXsd.test.js` | **sim** | conferir contra o esquema certo |
| `emissaoDps.test.js` › *"versão do leiaute sai da constante única"* | **NÃO — literal `1.00` fixo** | **anunciar** a troca. Derivando da constante ele passaria sempre, e a versão do documento fiscal mudaria sem nada ficar vermelho |

### ⚠⚠ A MEDIÇÃO DE INÉRCIA — e a SUBIDA, que aconteceu em 01/09/2026

⚠⚠ **ESTE BLOCO DESCREVIA UM EXPERIMENTO ("virando `DPS_VERSAO` para 1.01…"). A versão SUBIU.**
Ele fica porque o método continua valendo, e porque o achado dele foi corrigido logo depois.

O experimento (01/09/2026, com a constante ainda em 1.00) devolveu **852 de 853 testes passando**,
com o único vermelho sendo o caso de anúncio. Isso autorizou a troca — que foi feita **em commit
próprio**, para que "a versão quebrou" e "o bloco novo quebrou" continuem distinguíveis em produção.

⚠⚠ **MAS A LEITURA QUE ACOMPANHAVA ESTE BLOCO ESTAVA ERRADA, e foi corrigida no mesmo dia.** Ela
dizia que *"os tipos que emitimos são idênticos nas duas versões"* e que só o `TCTribMunicipal`
havia mudado. Medido depois, comparando os dois XSD inteiros: **DOZE tipos complexos mudaram, e
CINCO deles o gerador escreve** — `TCInfDPS`, `TCServ`, `TCInfoCompl`, `TCLocPrest` e `TCEndereco`.
O primeiro diff que produzi era por REGEX e não enxergava `xs:choice`; a fonte desmentiu.

⚠⚠ **DOIS DELES SÃO INERTES POR ACIDENTE FELIZ, NÃO POR CONSTRUÇÃO:** em `TCLocPrest` e
`TCEndereco` o grupo casava com o VAZIO no 1.00 e passou a exigir UMA opção no 1.01. Passamos
porque `buildDpsXml` **sempre** escreve `<cLocPrestacao>` e `<endNac>`. Quem tornar qualquer um dos
dois condicional precisa escrever o irmão (`cPaisPrestacao` / `endExt`) — deixar os dois de fora é
DPS **recusada no 1.01 e ACEITA no 1.00**, ou seja, um defeito que não apareceria antes da troca.
⚠ E o aperto está codificado de DUAS formas para o mesmo efeito: num sumiu o `minOccurs="0"` das
OPÇÕES, no outro o do próprio `xs:choice`. Ler só um lugar dá a resposta errada sobre o outro.

**A prova que ficou no lugar do experimento:** `dpsContraXsd.test.js` › *"o MESMO XML emitido cabe
nas DUAS versões do esquema"* — a checagem inteira (existência, ordem do `xs:sequence`,
obrigatórios, `xs:choice`, facetas) contra 1.00 **e** 1.01, em três cenários. Não é "gerar duas
vezes e comparar": é o documento que sai hoje cabendo nas duas.

⚠ **Limite declarado:** o oráculo é mais ESTRITO que o 1.00 no `xs:choice` — ele exige uma opção
sempre que o grupo é obrigatório, sem olhar o `minOccurs` das opções. Desvio na direção segura
(recusa o que o 1.00 aceitaria, nunca o contrário), mas quem for medir diferença entre versões
precisa saber. ⚠ E ele **não confere as Regras de Negócio (`E####`)** — a expiração de versão é
uma delas. **A primeira emissão real em 1.01 precisa ser acompanhada.**

### As duas frases falsas que foram corrigidas junto

*"O XSD do leiaute NÃO está versionado neste repositório — não há um único `.xsd` na árvore"* vivia
em **`NfseService.js`** (como justificativa para não migrar) e em **`dpsCodigos.js`** (como
justificativa para os `verificadoNoLeiaute: false`). É falsa desde 19/08/2026 — as duas ficaram
penduradas porque ninguém voltou aos arquivos depois de versionar o leiaute.

⚠ **Os `verificadoNoLeiaute: false` de `dpsCodigos.js` CONTINUAM `false`.** A frase antiga
justificava a ausência de FONTE; os campos declaram que **ninguém conferiu aquelas entradas contra o
schema**. São coisas diferentes, e a segunda segue verdadeira. Promovê-los é conferência a fazer,
entrada por entrada — e o caso do **MEI** depende disso, com decisão do dono junto.

- **Regressão:** o bloco `⚠⚠ o oráculo confere a versão que a gente EMITE` (5 casos) —
  o esquema carregado bate com a constante · **varredura textual** proibindo versão fixada no
  arquivo · os dois pacotes de esquema existem · o reordenamento do `TCTribMunicipal` medido nos
  dois XSD · e a razão de o par atual sobreviver às duas ordens.
- ⚠ **Experimento executado** (a regressão realista: alguém restaura os dois literais juntos):
  **2 vermelhos**, e **os outros 12 continuam verdes** — que é precisamente a prova de que, sem esta
  guarda, o defeito é silencioso.

## ⚠⚠ RETENÇÃO NA FONTE — as normas versionadas, e o que NÃO foi provado (01/09/2026)

`docs/retencao-fonte/` + `application/fiscal/retencao/`. Pré-requisito da fase que vai dar produtor
ao grupo `tribFed` da DPS — hoje ele é `return ""` em 100% das emissões e retenção declarada é
RECUSADA (`NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA`).

⚠ **Medido antes de começar: o repositório não tinha UMA LINHA sobre retenção na fonte.** Varredura
por `4,65`, `10.833`, `459/2004`, `765/2007` e `13.137` em `apps/` e `docs/` devolvia **uma única
ocorrência** — a COFINS **não cumulativa de 7,6%** do Lucro Real (`docs/fontes-fiscais.md:506`), que
é **apuração, não retenção**. Terreno novo por inteiro.

### O que ficou provado, com o dispositivo

| regra | dispositivo |
|---|---|
| retenção de CSLL+COFINS+PIS sobre serviços | **Lei 10.833/2003, art. 30, caput** |
| **4,65%** = 1% + 3% + 0,65% | **art. 31, caput** |
| dispensa **≤ R$ 10,00**, exceto DARF eletrônico via Siafi | **art. 31, § 3º** (Lei 13.137/2015) |
| a soma mensal para o antigo limite de R$ 5.000 foi **REVOGADA** | **art. 31, § 4º — "(Revogado)"** |
| **optante do Simples NÃO sofre** essa retenção | **art. 32, III** + IN SRF 459/2004, art. 3º, II |
| a optante **entrega declaração** ao tomador (Anexo I, 2 vias) | **IN SRF 459/2004, art. 11** |
| **IRRF dispensado** para o Simples (exceto aplicações) | **IN RFB 765/2007, art. 1º e § único** |

⚠⚠ **A DISPENSA DO SIMPLES ESTÁ NA LEI, NÃO SÓ NA IN.** Uma primeira pesquisa deste projeto
atribuiu a regra apenas à IN 459 — está corrigido: é o **art. 32, III** da própria Lei 10.833.
⚠ **Não confunda com o art. 30, § 2º:** aquele fala de quem **PAGA** (fonte pagadora optante não é
obrigada a reter); o art. 32, III fala de quem **RECEBE**. Para a NFS-e vale o segundo — nosso
cliente é o prestador.

⚠⚠ **O ANTIGO LIMITE DE R$ 5.000 NÃO EXISTE MAIS**, e é o item que mais se reintroduz de memória
(muita literatura de 2010 ainda o ensina). Sistema que ainda o aplique **deixa de reter o devido**.

### ⚠⚠ O que NÃO virou dado — regra 1, nomeado em `NAO_VERSIONADO`

**alíquota do IRRF sobre serviços** (não está na Lei 10.833 — vive na legislação do IR, não
versionada) · **retenção previdenciária de 11%** (Lei 8.212/1991, art. 31, e a interação com o
Anexo IV: `vRetCP` fica **sem produtor**) · **a lista fechada dos "serviços profissionais"** do art. 30
(quem declara é o **contador, por perfil** — derivar do CNAE erraria nos dois sentidos) ·
**IN RFB 1.234/2012** (órgãos públicos, outro regime) · **ISS retido no Simples** (LC 123, arts. 13
§ 1º, 18 § 6º e 21 § 4º — retenção MUNICIPAL, e a LC 123 não está versionada aqui).

### As quatro armadilhas das fontes — todas custaram uma tentativa

1. **O Planalto recusa `curl` sem `User-Agent`** (já escrito em `docs/lc116/README.md`).
2. ⚠⚠ **`normas.receita.fazenda.gov.br` é REDIRECIONADOR para uma SPA.** `link.action?idAto=N`
   responde **200 com 2.639 bytes de JavaScript**; o fragmento `#` nunca chega ao servidor. Quem
   serve o texto é a API da SPA — `…/api/consulta-externa/ato/<idAto>/visao/vigente` —, **e ela
   exige `Referer`** (sem ele, 403). Descoberta lendo as requisições da página no navegador.
3. ⚠⚠ **O JSON traz AS DUAS REDAÇÕES do mesmo dispositivo** — a mesma armadilha que a LC 116 paga no
   HTML. O art. 3º, II da IN 459 aparece duas vezes, e a antiga tem `omitir: true`/`compilado: false`.
   Lido cru, sai a **revogada**. Filtro: `compilado === true && omitir !== true` (70 de 76 segmentos).
4. O Planalto mistura `&#150;` com hífen e é **ISO-8859-1 com CRLF**.

⚠ `.gitattributes` já cobre `docs/** -text` desde 25/08/2026 — os hashes continuam conferindo.

### O gerador e os gates

`node apps/api/scripts/gerar-tabelas-retencao.mjs` → `fiscal/retencao/retencao.data.js`.
**Zero rede.** Confere o SHA-256 dos três artefatos e exige, **literalmente**, a frase que institui
cada valor. ⚠ Não há o que contar aqui (são poucos números), então o gate é de **conteúdo**, não de
contagem.

⚠ **Contraprova embutida:** o gerador **aborta** se o texto da IN 459 contiver a redação revogada —
é o que prova que o filtro está de fato cortando, em vez de o gate passar sobre o documento inteiro.

**Experimentos executados:** (1) um byte a mais num artefato ⇒ aborta pelo hash, nomeando esperado
× obtido; (2) filtro `compilado && !omitir` desligado ⇒ aborta acusando a redação revogada.

### ⚠⚠ ELA NASCE INERTE, no molde da NBS

Nenhum arquivo de `application/nfse/` a importa, e **há teste varrendo o diretório para garantir**.
Montar `tribFed` **muda o XML de nota fiscal em produção** — é ato do dono, não consequência de a
tabela existir. Quem ligar faz o teste cair, e a decisão fica à vista.

⚠ **`retencaoFederalPeloRegime` responde SÓ pela metade do regime.** `DEVIDA` significa *"o regime
não dispensa"*, **não** *"retenha"*: faltam o serviço estar na lista do art. 30 (declarado pelo
contador) e o tomador ser **PJ** (derivado do documento — CPF não retém). Três respostas, e o
**MEI fica `INDEFINIDA`** de propósito, pelo mesmo motivo de `MEI_NAO_MAPEADO`.

⚠⚠ **DEFEITO MEU, ACHADO PELO PRÓPRIO TESTE — vale mais que a tabela.** `dispensadaPeloPiso(null)`
respondia **dispensada**: `Number(null)` é `0`, `0 <= 10`, e a função deixava de reter numa nota cujo
valor ninguém informou. A primeira correção enumerava as ausências (`null`/`undefined`/`""`) e
**`[]` passou** — `Number([])` também é `0`. A guarda final é por **TIPO ACEITO**, não por lista de
recusas: enumerar o que se recusa deixa sempre um caso de fora. Mesma família de
`folhaAusenteNaoEZero`, aqui com desfecho pior. ⚠ **Zero INFORMADO continua dispensando** — a
distinção é `null` × `0`.

- Regressão: `fiscal/retencao/__tests__/retencao.test.js` (21) — as alíquotas e **a soma que elas
  têm de fechar**, o piso e a revogação do § 4º, as duas grafias do regime, o terceiro estado, a
  inércia, e **a ausência do 1,5% e do 11%** (⚠ o primeiro regex usava `\b11\b` e acusava a citação
  legítima do **art. 11** da IN 459 — teste que acusa a fonte certa é teste que alguém desliga).

## ⚠⚠ PERFIL DE EMISSÃO DE NFS-e — fase 1: o painel, com a integração DESLIGADA (01/09/2026)

O contador configura uma vez; o cliente deixa de responder por nota. Modelo `PerfilEmissaoNfse`
(`perfis_emissao_nfse`, migration `20260901120000` — **NÃO APLICADA**), regra em
`application/nfse/perfilEmissao/`, porta em `routes/firm/perfisEmissao.js`, tela em
`apps/web/.../PainelProximaDps.jsx`.

⚠⚠ **NADA MUDA NO XML NESTA FASE.** `INTEGRACAO_PERFIL_EMISSAO_NFSE` nasce OFF e `buildDpsXml` não
consulta o perfil. Quem consulta é a TELA.

### Por que ela vale sozinha assim

Hoje `regApTribSN` (`NfseService.js:826`) e `tribISSQN` (`:887`) são **CONSTANTES dentro do
gerador** — e constante em código é invisível até a nota sair. O contador nunca teve como ver o que
a empresa dele emite **antes** de emitir. O painel mostra os seis campos com valor, **tag do XML** e
**procedência** (`PERFIL` · `COMPANY` · `CRAVADO` · `INDEFINIDO`), e nomeia os cravados.

⚠ E é assim que se descobre um defeito que já estava lá: `CadastroFiscal.sublimiteICMSISS` é
literalmente o cadastro do caso `regApTribSN = 2`. **Empresa do Simples acima do sublimite declara
hoje o regime de apuração errado**, com o dado que provaria isso já no banco.

### ⚠⚠ SEIS CAMPOS, E NÃO OS TRINTA DO LEIAUTE — a regra que impede o campo morto

`codigoServicoNacional` · `codigoServicoMunicipal` · `cLocPrestacao` · `regEspTrib` · `regApTribSN` ·
`tribISSQN`. São exatamente os que **`buildDpsXml` já escreve**: o resolvedor tem o que resolver e o
painel tem contra o que comparar.

**Coluna só nasce com o código que a lê, no mesmo commit.** É o mecanismo que
`CadastroFiscal.perfilAtividades` não teve — lá, **3 de 8 campos são write-only** e um nem input
tem. `perfilEmissao/campos.js` é o registro executável: cada campo declara `leitores`, `tag` e
`caminhoNoXml`, e **há teste que lê o `schema.prisma`** e cai se existir coluna fora da lista ou
campo da lista sem leitor. ⚠ Experimento executado: coluna `campoFantasma` no model ⇒ **1 vermelho**,
nomeando-a.

O que ficou de fora está em `FORA_DESTA_FASE`, com o motivo — `pAliq`, `BM`, `exigSusp`,
`tpImunidade`, `comExt`, `obra`, `tribFed`. ⚠ E `tpRetISSQN` **não é campo de perfil**: a retenção
do ISS depende do TOMADOR daquela nota, e o cliente marca a caixa (decisão do dono, 01/09/2026).

### A precedência é POR CAMPO, nunca por objeto

`{...cadastro, ...perfil}` faria um perfil com campo em branco **APAGAR** o que a empresa já emite —
o mesmo defeito do `{...cadastro, ...doCompany}` do `GET /cadastro-fiscal`, consertado no mesmo dia.
Cada campo carrega `valor`, `fonte`, `valorHoje` e **`mudariaComPerfil`**, que é o que responde
*"ligar a flag muda o quê?"*.

⚠ **Com 2+ perfis ativos e nenhum padrão, NADA do perfil entra** e a tela diz por quê. Cair no
primeiro faria a ordenação decidir a tributação.

⚠ **Nada é gravado por leitura.** `perfilDerivadoDoCadastro` calcula o ponto de partida e **não
grava**: materializar 34 perfis num backfill criaria configuração que ninguém afirmou.

### A porta

`GET/POST/PATCH /firm/companies/:companyId/perfis-emissao`, gate `ACCOUNTANT`. Lista fechada de
campos com **recusa nomeando** (`campos_nao_aceitos`), `undefined` = não mexer / `null` = apagar,
409 sem `Company` legada, 409 no nome duplicado, e **o escopo no `where`** — perfil de outra empresa
não é alcançado pelo id (o furo que a F1 do WhatsApp pagou em `salvarContato`).

⚠ A **autoridade do código de serviço continua sendo o cadastro**: o perfil não grava código fora de
`Company.codigosServicoNacional`. Lista vazia não é "pode tudo" — é o estado de 33 de 33 empresas.

### O que a fase 1 achou de defeito no caminho

- ⚠⚠ **`REFERENCES "portal_clients"` na primeira versão da migration.** A tabela é `"PortalClient"`
  (o model não tem `@@map`), e isso **já derrubou a produção** — está escrito em duas migrations
  anteriores, e foi o aviso delas que pegou. `npm test`, `npm run build` e `prisma validate` **não
  executam SQL de migration**.
- ⚠⚠ **`company?.id` não existe na tela: a chave é `companyId`.** Com o id errado o painel não
  estourava — ficava eternamente em "não recebida", porque a carga sai cedo com id nulo. A tela
  funcionava e só não mostrava. Terceira família do `legacyCompanySelect`.
- ⚠ **Não existe `src/api/index.js` em `apps/web`** — o `CLAUDE.md` de lá o descreve e ele nunca
  existiu; o objeto sai de `createApiClient()`. O import errado derrubou a suíte inteira.
- ⚠ **O tempo verbal do cabeçalho da tabela é parte do comportamento.** Com a flag OFF ele diz
  *"De onde viria"*; ligada, *"De onde vem"*. "Vem" numa linha que diz "do perfil de emissão"
  afirmaria que a próxima nota já sai assim — e não sai.

### Regressão

`nfse/perfilEmissao/__tests__/perfilEmissao.test.js` (30) · `routes/firm/__tests__/perfisEmissaoRota.test.js` (25)
· web `lib/nfse/__tests__/perfilEmissao.test.js` (21, **com o amarre**: importa a lista do backend e
exige mesmos ids, ordem, tags, caminhos e enumerações) · web
`__tests__/painelProximaDpsNaTela.test.jsx` (15).

⚠ **Verificado no navegador** (mock, porta própria): as seis linhas com a tag, os dois cravados em
âmbar, criar o perfil derivado e a coluna virando "do perfil de emissão" — **com o rodapé mantendo
"nada sairia diferente"**, que é a inércia esperada de um perfil derivado do próprio cadastro.

## ⚠⚠ PERFIL DE EMISSÃO — fase 2: o perfil manda no XML, e a tela do cliente encolhe (01/09/2026)

`INTEGRACAO_PERFIL_EMISSAO_NFSE` continua **OFF**. O que a fase 2 acrescenta é o CAMINHO: com ela
ligada, `buildDpsXml` passa a ler o perfil nos seis campos; e a tela do cliente já deixou de
perguntar o que o perfil responde.

### ⚠⚠ A PROVA DE ACEITE — executada, não prometida

**Perfil derivado do cadastro + flag LIGADA ⇒ XML byte-idêntico ao da flag desligada.**
`nfse/__tests__/perfilNaEmissao.test.js` emite duas vezes, em registries isolados, e compara o
**corpo real enviado** (gzip+base64 desempacotado). Também prova que a flag OFF **ignora** um perfil
que mudaria tudo, e que a flag ON **sem perfil** não muda nada — o caso de 33 das 34 empresas no dia
em que ela for ligada.

⚠ Experimento: com o perfil derivado divergindo em um campo, o teste fica vermelho **mostrando a
linha do XML** (`<regApTribSN>1</regApTribSN>` × `2`).

### Dois campos deixaram de ser constante

`regApTribSN` e `tribISSQN` saíam cravados de `buildDpsXml`. Agora vêm do perfil quando ele responde
— e **sem perfil continuam "1"**. A mudança é de FONTE, não de valor padrão. É o que destrava a
**exportação de serviço** (`tribISSQN = 3`) e o **sublimite** (`regApTribSN = 2`).

⚠ **Precedência POR CAMPO, e o perfil vence o payload.** Campo nulo/vazio no perfil **não apaga** o
cadastro — há dois casos travando exatamente isso, porque `{...cadastro, ...perfil}` sairia numa
nota fiscal.

⚠ **O cadastro continua sendo a autoridade do `cTribNac`**: o código do perfil passa pela MESMA
trava (`escolherCodigoServicoNacional`) no pré-voo, **antes de reservar numeração**.

⚠ **`carregarPerfilDeEmissao` nunca lança.** Tabela não criada, banco fora, empresa sem
`PortalClient` — em todos, `null`, que é o comportamento de hoje.

### O `perfilId` viaja; os VALORES não

`validateNfsePayload` aceita `perfilId` (whitelist). É a mesma razão pela qual `pTotTribFed/Est/Mun`
nunca viajam: valor no corpo faz um valor velho preso no formulário sobrescrever, em silêncio, a
correção do contador. Com o id, quem lê a configuração é o servidor, sempre a atual.

### A tela do cliente

`GET /client/companies/:id/nfse/perfis` — **só leitura**, devolve **id, nome e padrão** e nada mais.
Regra em `portal-cliente-web/.../lib/perfilDaNota.js`; a tela só liga.

| | sem perfil | 1 perfil | 2+ perfis |
|---|---|---|---|
| seletor | não | não | **sim**, sem pré-seleção |
| código de serviço | como era | **some** | **some** |
| município da prestação | como era | **some** | **some** |
| `perfilId` no corpo | — | **não viaja** | viaja |

⚠⚠ **COM VÁRIOS E NENHUM ESCOLHIDO, A TELA RECUSA** — e não cai no `padrao`. Os perfis existem
porque a empresa tem operações com tributação diferente; cair no padrão faria o padrão virar a
resposta de quem não respondeu, numa nota irreversível.

⚠ **Campo que sai da tela sai do CORPO** — teste varrendo o `JSON.stringify` do payload inteiro.

### ⚠⚠ TRÊS CAMPOS NÃO SAÍRAM DA TELA, e um deles corrige o plano

| campo | por quê |
|---|---|
| **Alíquota efetiva do Simples** | ⚠⚠ Ela é `DAS ÷ faturamento` **da competência** e muda TODO MÊS com o RBT12. Um perfil é estático: guardá-la ali congelaria uma alíquota variável e declararia ao tomador um percentual velho, **impresso na nota** (Lei 12.741/2012). **O plano dizia que ela viria do perfil — está errado, e por isso ela fica.** Ela já não é digitada: o portal a preenche da rota `/aliquotas`. |
| **Alíquota do ISS** | `pAliq` ainda não existe no perfil (o gerador não monta `tribMun/pAliq`). Fica, e só aparece com a caixa marcada. |
| **Caixa "ISS retido"** | Decisão do dono: depende do TOMADOR daquela nota. |

⚠⚠ **PENDENTE E NOMEADO: a caixa de ISS retido ainda NÃO aparece no Simples.** A decisão do dono de
01/09/2026 (*"o cliente na tela dele deve poder selecionar se é retido ou não"*) exige mexer em
`impostosDaNota.js`, que hoje esconde o bloco de ISS inteiro no Simples por decisão de 18/08/2026 e
tem suíte própria travando isso. **Não foi feito nesta fase** — é mudança de uma decisão registrada,
e vale a pena fazê-la junto do `pAliq`, que é a outra metade da mesma regra (**E0621**).

### Regressão

`nfse/__tests__/perfilNaEmissao.test.js` (11) · client `lib/__tests__/perfilDaNota.test.js` (23) ·
client `__tests__/perfilNaTela.ligacao.test.jsx` (11).

⚠ **Verificado no navegador** (mock, `pc-001` com dois perfis): o seletor aparece com "Escolha…" e
**sem pré-seleção**, o seletor de código de serviço e o município da prestação **sumiram**, e a
alíquota efetiva do Simples **continua**, com o selo "preenchido pelo portal".

⚠ **Duas armadilhas do harness de teste, para quem for escrever o próximo:** o certificado é
`pfxBuffer`/`password` (não `pfx`/`passphrase`) e o cliente axios precisa de `defaults.baseURL` —
com qualquer um errado a emissão morre ANTES do POST, o XML sai vazio, e **comparações
"byte-idêntico" passam comparando `""` com `""`**. Foi um `expect(hoje).toBeTruthy()` que denunciou.

⚠⚠ **E NUNCA escreva comentário XML (`<!-- -->`) dentro do template de `buildDpsXml`**: ele iria
para dentro do documento fiscal assinado. A primeira versão desta fase fez isso — e só não passou
porque o backtick de dentro do comentário fechou o template e derrubou seis suítes.

## Endpoints agregados do dashboard (Lote C)

- `GET /firm/companies/annual?ano=` — grade 12 meses × empresas: fechamento contábil
  (`CompanyMonthlyCircular.fechadoContabilEm`) + apuração (`ApuracaoSnapshot.estado`). **Duas
  queries pro ano inteiro**, não 12 por empresa. Registrada **antes** de `/companies/:companyId`
  pra "annual" não ser lido como id.
- `GET /firm/companies/fechamento?competencia=` — **o que trava a carteira** naquele mês: por
  empresa, `{podeFechar, fechado, checklistPendentes[], blockers[], totalLancamentos}`. Substitui
  abrir quarenta abas para descobrir quais já dá para fechar. **Duas queries** para a carteira
  inteira, como a anual — mas esta é por UMA competência, e não por ano: o balanço D≠C não sai de
  agregado, precisa das LINHAS dos lançamentos do mês (por isso o `select` enxuto de
  `SELECT_PARA_BLOQUEIOS`). Registrada **antes** de `/companies/:companyId`. `podeFechar` é falso
  para empresa já fechada — ela não "pode fechar", ela ESTÁ fechada.
  ⚠ A regra de bloqueio **não é reescrita aqui**: vem de
  `application/accounting/fechamentoBlockers.js`, o mesmo módulo que o cadeado da aba Lançamentos
  usa (`validateFechamentoContabil` virou uma query + uma chamada). O check-list idem
  (`CHECKLIST_FECHAMENTO`/`checklistPendentes`, que moravam dentro da fábrica de rotas). Duas cópias
  fariam as duas telas discordarem sobre a mesma empresa, com o contador no meio.
- `GET /firm/jobs/ativos` — contagem dos downloads em lote com `status:"processando"` (notas +
  SITFIS), pro selo do dashboard. Só contagem/progresso, feito pra polling barato; em erro devolve
  vazio (nunca derruba o dashboard). Envio de e-mail em lote **não** entra: é chamada bloqueante.
- `GET /firm/companies` ganhou `guidesEnvio` (total/enviadas/todasEnviadas), `fiscalSituacao` e
  `temParcelamento` — ver `apps/web/src/features/companies/CLAUDE.md` para o efeito no card.

## Variáveis de Ambiente Obrigatórias

```
DATABASE_URL
JWT_SECRET
GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET  (ou SMTP_*)
PDF_READER_URL   (URL do serviço FastAPI)
PORT             (default 3000)
```

⚠⚠ **`INTEGRACAO_LANCAMENTO_POR_REGRA`** (30/08/2026) — o **lançamento contábil que nasce sem
ninguém clicar**. Nasce OFF, e com ela desligada o SERVIDOR recusa (`podeLancarSozinho` devolve
`automatico_desligado` e `AccountingEntry.create` não é chamado), não só a tela. ⚠⚠ **Ela é UMA das
DUAS chaves**: a outra é `RegraContabilizacao.lancaSozinha`, fornecedor a fornecedor, e a nota ainda
precisa cair na FAIXA de valor da regra. Ligada no `.env` LOCAL; **em produção é ato do dono**.
⚠ O que a torna reversível, e existe junto: `ORIGEM_PAGAMENTO.PRESUMIDO_POR_REGRA` (a data é
presunção, não prova), o extrato mensal *"lançados por regra"* com desfazer em lote, e o débito do
OFX que **corrige** a data presumida sem criar um segundo lançamento. Ver
`src/application/declarados/CLAUDE.md`, seção "FASE 6".

⚠⚠ **`INTEGRACAO_IA_CLASSIFICACAO`** (02/09/2026) — o botão **«Sugerir contas com IA»** da
Conferência. Nasce OFF, e com ela desligada o SERVIDOR recusa (`POST .../conferencia/classificar-ia`
→ 503 `ia_classificacao_desligada`), não só a tela. Ligada, cada clique chama o modelo (Anthropic,
`IA_MODELO`) em lotes de até 40 linhas, cada lote autorizado pela guarda de custo (`GuardaIaService`,
falha fechado, `finalidade: classificacao_lancamentos`), e grava **PROPOSTAS** nas colunas
`contaSugeridaIa`/`creditoSugeridoIa`/`justificativaIa` — **nunca `contaAplicada`, nunca `estado`**.
Só as linhas **sem regra e sem histórico** são enviadas (regra > histórico > IA). Exige
`ANTHROPIC_API_KEY`; `IA_MAX_TOKENS_CLASSIFICACAO` (6000) é o teto próprio do lote. Ver
`src/application/declarados/CLAUDE.md`, seção "A IA NA CONFERÊNCIA".

⚠⚠ **`INTEGRACAO_NFSE_LOTE`** — a emissão de NFS-e **em lote**. Nasce OFF, e com ela desligada o
SERVIDOR recusa (503 `emissao_lote_desligada`), não só a tela. Ligar é ato do dono, acompanhando o
primeiro lote real: cada linha de planilha vira nota fiscal real e irreversível.

Workers opt-in (default desligados):
`SERPRO_PGDASD_WORKER_ENABLED`, `SERPRO_DCTFWEB_WORKER_ENABLED`,
`DFE_NOTAS_WORKER_ENABLED`, `APURACAO_BATCH_WORKER_ENABLED`,
`SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED`, `CONFERENCIA_ADN_WORKER_ENABLED`.

### ⚠ Flags de integração: o DEFAULT do código não é o ESTADO da produção

Todas exigem **`=== "1"` exato**, e o default de `config.js` é OFF. Isso quer dizer que
`config.js`, `.env.example` e este arquivo dizem só qual é o **ponto de partida** — nenhum dos três
sabe o que está ligado no ar. **Leia o ambiente** (sem imprimir segredo):

```
railway variables --service api-app-contabilidade --kv | grep -E "^INTEGRACAO_|_WORKER_ENABLED="
```

Medido em **produção** (`perfect-upliftment` / `production`) em **2026-08-08**:

| flag | produção | observação |
|---|---|---|
| `INTEGRACAO_SERPRO_SITFIS` | **1** | validada end-to-end |
| `INTEGRACAO_SERPRO_PAGTOWEB` | **1** | `COMPARRECADACAO72` validado em produção real (2026-07-28) — ver a seção do PAGTOWEB acima |
| `INTEGRACAO_SERPRO_DCTFWEB_LP` | **1** | ⚠ ligada, mas o `CONSDECCOMPLETA33` segue `verificadoTrial:false` |
| `INTEGRACAO_SERPRO_PARCELAMENTO` | **não definida → OFF** | logo, a captura automática de parcela (`CaptureSerproParcelaService`) **não roda** |
| `SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED` | **não definida → OFF** | a integração está ligada, mas o cron não sobe (`server.js:184`): a confirmação só acontece por clique |

⚠ **Este quadro envelhece.** Ele registra uma medição datada, não uma verdade permanente — antes de
dimensionar qualquer coisa que dependa de uma flag, **rode o comando acima**. A linha anterior deste
arquivo dizia "PAGTOWEB OFF — não validado" enquanto a produção o tinha ligado e a seção logo acima
descrevia a validação em produção real; acreditar no rótulo custou o dimensionamento errado de uma
fase inteira.

Ver `config.js` para os idServiço/versão.

## Guarda de custo do SERPRO — registro + duas travas

As chamadas do Integra Contador são **pagas**, e até aqui não havia nem registro nem teto. Dois
episódios reais: o ajuste de "período desnecessário" da folha removia da lista errada e nunca
convergia, queimando **até 14 consultas por clique sem entregar nada**; e as buscas manuais
repetiam a cobrança a cada clique (só o worker se protegia).

**Tudo passa por `SerproHttpClient.request`** — é lá que a guarda vive, e a identificação da chamada
sai do **próprio envelope `pedidoDados`** (contribuinte + idServiço), não de um parâmetro do
chamador. Isso é o que a torna infalível: uma chamada nova escrita amanhã já nasce registrada e
travada, sem ninguém precisar lembrar de nada. Os 21 pontos de chamada não foram tocados.

| Trava | Regra | Por quê |
|---|---|---|
| **Cooldown** (`SERPRO_COOLDOWN_SEGUNDOS`, 300s) | mesma empresa + serviço + **mesmo payload** dentro da janela → recusa | mata duplo clique e laço que reenvia o idêntico. O payload entra no hash **de propósito**: corrigir um valor e recalcular não é repetição, é trabalho |
| **Teto diário por empresa** (`SERPRO_TETO_DIARIO_EMPRESA`, 60) | chamadas por CNPJ no dia civil de São Paulo | pega laço defeituoso concentrado numa empresa |
| **Teto mensal do escritório** | `empresas ativas × SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA` (40), com piso `SERPRO_TETO_MENSAL_MINIMO` (500) e trava absoluta opcional | é o que protege a fatura de um lote fora de controle, que o teto por empresa não enxerga |

⚠ **O teto global é DERIVADO da carteira, nunca um número fixo.** Número fixo vira armadilha
exatamente quando o escritório cresce: a carteira dobra, o consumo legítimo dobra, e o teto de
ontem passa a barrar trabalho normal — no fim do mês, que é o pior momento possível. Derivado, ele
acompanha sozinho. O orçamento por empresa é folgado: um mês pesado de UMA empresa custa ~15–20
chamadas (extrato 2 + guia 1 + calcular 1–3 + transmitir 1 + pós 3 + INSS/DCTFWeb 2–3 + SITFIS 2 +
pagamento 1–2), e o default dobra isso para absorver correção e retentativa.

Ele é o **último** a ser checado (o mais caro) e **falha ABERTO**: se a contagem der erro, a chamada
passa. Uma guarda de orçamento que derruba o fechamento por problema no próprio contador de
orçamento seria pior que o gasto que evita. Em `SERPRO_ALERTA_FRACAO` (80%) começa a **avisar** sem
bloquear — `GET /firm/serpro/consumo` devolve `{usadas, teto, restantes, fracao, alerta, estourado}`
para a tela mostrar o teto chegando. Bloqueio que aparece de surpresa é o mesmo que travar o app.

⚠ O teto conta **`ok` e `erro`**: chamada que chegou ao SERPRO e voltou com rejeição de negócio foi
cobrada igual. Contar só o sucesso deixaria de fora exatamente o laço que o teto existe para pegar —
ele falhava 14 vezes seguidas. O cooldown, esse, só olha `ok`, para não bloquear retry de falha
transitória.

**Os números NÃO são limite do SERPRO** (isso é contrato, não se inventa) — são o orçamento que nós
impomos, folgados por padrão. Ajuste com o consumo real: `scripts/diag-consumo-serpro.mjs [dias]`
mostra gasto por serviço, por origem, por empresa, os **erros por motivo** e o **pico por
empresa/dia**, que é o número a comparar com o teto.

### ⚠ O laço de convergência do PGDAS-D era 35% do orçamento

Medido em produção (30 dias): **214 chamadas cobradas, 77 delas erro — e 75 desses erros eram
`TRANSDECLARACAO11`**. Agrupando por minuto, o padrão era inequívoco:

```
CHAYM   03/08 18:34 → 18 erros + 1 ok
CHAYM   04/08 17:01 → 18 erros + 1 ok    ← mesmo custo no dia seguinte
IOHANNA 03/08 20:18 → 16 erros + 1 ok
LENTE   04/08 16:15 →  0 erros + 2 ok    ← lista já batia
```

`executarComAjusteDePeriodos` descobre por tentativa e erro quais PAs a RFB aceita, e **cada
tentativa é cobrada**. A lista aceita sempre foi calculada e devolvida pelo laço — só que a gravação
estava atrás de **`if (resultado.rbt12 != null)`**, e `PgdasSimulacaoService` devolve `rbt12: null`
SEMPRE (a RFB não retorna esse número). Guarda que nunca podia ser verdadeira: 19 chamadas para
produzir 1 resultado, repetidas do zero no dia seguinte.

Hoje `gravarPeriodosAceitos`/`lerPeriodosAceitos` (`RbtExtratoService`) guardam as **duas** listas em
`RbtExtratoCache.periodosAceitos`, e o `calcularFechamento` parte delas.

- ⚠ **Sem tocar em `rbt12` nem em `origem`.** A RFB não devolve RBT12 — o número é NOSSO. Gravá-lo
  como `origem: "SIMULACAO"` promoveria a confiabilidade de um dado que nós calculamos. Já *quais
  períodos ela aceita* é informação dela, e essa sim se guarda.
- ⚠ **As DUAS listas.** `gravarDaSimulacao` (agora sem chamadores) só cobria receitas — e é a
  **folha** que precisa ser podada nas empresas de Fator-R, exatamente as que mais gastavam.
- É **palpite bom, não verdade**: declaração retroativa muda o conjunto, a lista envelhece, a RFB
  rejeita e o laço reconverge e regrava. Pior caso volta a ser o de antes.
- Regressão em `apuracao/v2/__tests__/periodosAceitos.test.js`.

⚠ **`erroCodigo` do SERPRO é genérico** (`SERPRO_BUSINESS_ERROR` para tudo). Sem `erroMensagem` o log
registra que a chamada foi cobrada sem registrar por quê — descobrir o laço exigiu cruzar contagem
por serviço com agrupamento por minuto. A coluna existe agora; o diagnóstico agrupa por motivo.

**Escape:** `podeForcarSerpro` exige **ADMIN e `?forcar=1`** — as duas coisas. ADMIN sem pedir não
fura (senão o teto não avisaria ninguém); pedir sem ser ADMIN não fura (senão a guarda seria
contornável pela URL). Fica gravado em `serpro_chamadas.forcado` com o usuário.

O contexto (origem, usuário, `forcar`) viaja por **AsyncLocalStorage** (`serproCallContext.js`), não
por parâmetro: o client está a 3–4 saltos de quem sabe essas coisas, e uma guarda que depende de
alguém repassar um argumento morre na primeira chamada nova.

## Buscar impostos pela aba Lançamentos — as duas chamadas são PAGAS

O contador busca extrato do Simples e tributos do Presumido de dentro de Lançamentos, na
competência que está na tela. **Nada disso é serviço novo** — só a rota existente ganhou guardas:

| | Rota | Chamadas pagas por clique |
|---|---|---|
| Simples | `POST .../circular/:competencia/sync-pgdas` | 2 (`CONSDECLARACAO13` + `CONSULTIMADECREC14`) |
| Presumido | `POST .../serpro/lp/capture` | 2 (`CONSDECCOMPLETA33` + `GERARGUIA31`) |

⚠ **Nenhuma das duas tinha trava.** Só o worker se protegia (`serproSyncStatus === "SUCCESS"` /
guia LP existente); o caminho manual repetia a cobrança a cada clique. Hoje:

- **Pré-voo no GET `.../fechamento-contabil/:competencia`** (bloco `serpro`): a tela lê o que já foi
  buscado **antes** do POST e confirma com o contador. A resposta do POST chegaria tarde demais.
  **`NOT_FOUND` conta como buscado** — a chamada saiu e foi cobrada igual.
- A marca do LP é a guia com `sourceFileId = serpro:dctfweb:lp:<cnpj>:<competencia>` — o mesmo
  campo em que o worker se apoia, e `updatedAt` dá a data da mensagem.
- **Mês fechado → 409 `MES_FECHADO`** nas duas. Elas gravam `AccountingEntry`, e sem a guarda o
  botão vira o caminho fácil de escrever num mês fechado sem rastro de reabertura. A guarda fica na
  **rota**, não no serviço: o worker segue livre.

⚠ A busca também **cria guia** (DAS no Simples, DARF consolidada no Presumido) e **gera
lançamento**. Ao mover o botão de lugar, os pontos de refresh ficaram para trás: `onPgdasSynced`
recarregava só a Circular, e o contador buscava sem ver nada aparecer. Hoje recarrega Circular +
lançamentos + guias.

## Mês sem faturamento (`CompanyMonthlyCircular.semFaturamento`)

Afirmação **por competência** de que o mês não teve receita. Tri-estado (`null` = ninguém disse
nada, diferente de "disseram que teve"), com `semFaturamentoEm`/`Por` gravados — é afirmação
fiscal, não preferência de tela.

**Afirma SÓ receita zero.** Folha, despesas e parcelas seguem normais e continuam exigidas. O nome
e a verificação batem: o que a recusa mede é nota EMIT autorizada.

**A recusa é o coração.** `POST .../fechamento-contabil/:competencia/sem-faturamento` devolve
**409 `SEM_FATURAMENTO_COM_RECEITA`** (com o valor) quando há faturamento na competência —
importando `faturamentoEmitDaCompetencia` de `v2/FechamentoService.js`, a **mesma** função da
apuração. Duas cópias dessa query divergiriam, e aí apuração e fechamento discordariam sobre se o
mês teve receita, com o contador no meio. O `GET` do fechamento devolve `faturamentoEmit`, então o
alternador já nasce desabilitado com o motivo — ninguém descobre a recusa clicando.

**A segunda recusa: conferência do ADN.** Faturamento zero e "não conseguimos ver o faturamento"
são a **mesma leitura** — município fora do ADN, A1 vencido ou cursor NSU travado devolvem zero sem
que ninguém tenha provado ausência de receita. Então a rota também lê
`ApuracaoSnapshot.conferenciaStatus`:

| status | efeito |
|---|---|
| `divergente` (o ADN tem chave que nós não temos) | **409 `SEM_FATURAMENTO_CONFERENCIA_DIVERGENTE`**, com a contagem de faltantes. Não é falta de informação, é PROVA de nota faltando — mesma trava que `salvarFechamento` já aplica |
| `ok` | aceita, grava `semFaturamentoConferencia = "ok"` |
| `nao_conferivel` | aceita, grava `"nao_conferivel"` |
| nunca conferida (sem snapshot) | aceita, grava `"sem_conferencia"` |

Exigir conferência `"ok"` inutilizaria o campo em **toda** empresa de município fora do ADN —
justamente onde ele mais serve (decisão do dono). Por isso o sistema aceita e **registra que
aceitou sem conferir**: a coluna existe para dar para auditar depois. O GET devolve
`conferenciaAdn { status, em }`, então a tela avisa "· sem conferência do ADN" **antes** do clique e
desabilita o alternador na divergência (mesmo tratamento do faturamento > 0: nos dois há evidência
contra a afirmação).

**Efeito:** o nó `das` passa a resolver como **ausência confirmada**, e não como pendência.

⚠⚠ **ESTA LINHA DIZIA "a tag SOME, não fica amarela como o `VAZIO`" — E O CÓDIGO FAZ O CONTRÁRIO
HOJE.** Medido em 28/08/2026: `resolveNode` (`guideCompliance.js`) devolve
`state: "vazio", origem: "sem_faturamento"` — ou seja, **exatamente o mesmo estado do marcador
`VAZIO`**, distinguido só pela `origem`. O desenho antigo (zerar `required` e curto-circuitar) foi
abandonado de propósito, e o motivo está escrito no cabeçalho daquele arquivo: com ele, um marcador
`VAZIO` de SIMPLES na mesma competência ficava **órfão** — ignorado pelo compliance, invisível na
matriz, e visível na tabela de guias. Dois estados coexistiam no banco e um vencia o outro em
silêncio.

⚠ **E ganhou um terceiro desfecho que a frase antiga não previa:** afirmado "sem movimento" e
entrando nota emitida depois, o nó vira **`state: "conflito"`**, com `ok: false` e o faturamento
junto. A afirmação envelheceu e volta a exigir ação — o oposto de deixá-la calada.

Pré-query simétrica à do `parcDasAtivoSet` — uma query
para a carteira, não uma por empresa. O lembrete de transmitir a declaração zerada **não se perde**:
segue na pendência de apuração do calendário, que não foi tocada.

**Não decide ato fiscal.** No `FechamentoModal` ele apenas **pré-marca** a caixa "sem movimento",
igual `empresaZerada` já fazia; quem transmite continua sendo o contador (regra 5).

## ⚠ Declaração ZERADA (sem movimento) — a RFB recusa o formato que enviamos hoje

Empresa sem faturamento também tem de declarar o PGDAS-D, zerado. **Isso nunca funcionou nesta
base.** Medido em produção (leitura, `scripts/diag-empresa-zerada.mjs`): **190** células
empresa×competência com faturamento EMIT = 0 nos últimos 12 meses e **zero** `ApuracaoSnapshot` —
nenhuma delas passou nem do Calcular. Dos 22 snapshots existentes, **nenhum** tem atividades
zeradas.

**A recusa é da Receita, não nossa.** `serpro_chamadas`, 10/08/2026, PHAOS CONSULTORIA LTDA
(competência sem uma única nota), duas chamadas PAGAS seguidas, `origem: fechamento:calcular`:

```
HTTP 400 — "SN-Entregar: O valor da atividade deve ser maior que zero."
```

`buildDeclaracaoPayload` monta a zerada como `estabelecimentos[0].atividades: []` +
`receitaPaCompetencia*: 0`, e é isso que a RFB rejeita. ⚠ **Qual é o formato oficial do PGDAS-D sem
movimento no Integra Contador NÃO está confirmado** — regra 1/4, ninguém adivinha aqui. É a decisão
que falta para a empresa zerada ser apurada pelo portal.

**A caixa "Declarar SEM MOVIMENTO" era INALCANÇÁVEL, e por isso o modo nunca foi exercido.** Ela
vivia dentro do ramo `atividades.length === 0` do `FechamentoModal` — e `getDadosFechamento` enche
a lista **sem depender de receita**: pela memória da última competência, ou por
`montarAtividadesDoCnae`, que emite a linha "mesmo com faturamento 0, só pra TRAZER o ANEXO". Em
produção, **166 das 190** competências zeradas chegam ao modal com UMA atividade de R$ 0,00: tabela
na tela, caixa nenhuma.

**Hoje quem decide é a SOMA, não o comprimento da lista** — nos dois lados, porque é o que o payload
de fato leva (`buildDeclaracaoPayload` descarta a linha de valor 0):

| | antes | agora |
|---|---|---|
| caixa "sem movimento" no modal | só com lista vazia | sempre que a soma é 0 (e `semMovimentoDisponivel`) |
| `semMovimento` enviado pelo front | `&& atividades.length === 0` | `&& soma === 0` |
| gate de `calcularFechamento` | `atividades.length === 0` | `somaAtividades(atividades) === 0` |

⚠ **Isso APERTA a trava anti-zero, não afrouxa.** A linha de R$ 0,00 escapava de
`SEM_MOVIMENTO_COM_FATURAMENTO` por completo: com faturamento na competência ela ia ao SERPRO
(pago) e só era pega **depois** da chamada. Agora a recusa vem antes. O botão Calcular também
deixou de nascer desabilitado **mudo**: `title` nomeia o motivo.

⚠ **`APURACAO_ZERADA_COM_FATURAMENTO` (Q55) SUBIU para o gate do topo, e isso não é arrumação.**
Ela vivia depois da simulação, e `atividades` não é reatribuída no meio — então, com a decisão
passando a ser pela soma, **nenhuma execução chegava mais nela**: soma 0 já lançava lá em cima e
soma > 0 nunca satisfaz a condição. Era um cinto que não apertava, com o comentário ainda
anunciando que apertava — a mesma classe de defeito que o gate por comprimento. No topo ela volta
a morder **e** economiza a chamada paga.

Consequência: com a soma em zero, o faturamento é consultado **antes de escolher a mensagem**.
Quem tem nota na competência recebe `APURACAO_ZERADA_COM_FATURAMENTO` (ou
`SEM_MOVIMENTO_COM_FATURAMENTO`, se marcou a caixa) — nunca o convite genérico a "declarar sem
movimento", que apontaria para uma ação que a trava seguinte recusa.

**A recusa da RFB é CITADA, não reescrita** (`traduzirRecusaDeclaracaoZerada`): só quando a
declaração é zerada, a frase da Receita entra entre aspas dentro de um
`DECLARACAO_ZERADA_RECUSADA_RFB` que diz que nada foi transmitido e qual é a saída enquanto o
formato não for confirmado. Qualquer outra rejeição propaga intacta — não se mascara recusa real.
Regressão: `apuracao/v2/__tests__/declaracaoZerada.test.js` (8).

⚠ **O que NÃO é o bloqueio** (medido, para não ser reinvestigado): não é a
`DIVERGENCIA_CONFERENCIA` do `salvarFechamento` — as 190 competências zeradas têm
`conferenciaStatus` nulo, o worker do ADN nunca as alcançou; e não é o fechamento CONTÁBIL — 11
delas já estão fechadas. O `salvarFechamento` sequer é alcançado: sem snapshot ele responde
`NAO_CALCULADA`, e o botão Salvar nasce desabilitado.

## ⚠ A memória da apuração guarda a FORMA, nunca o VALOR — e o MERCADO é o que não pode se perder

`ApuracaoConfigMemory` tem chave **`portalClientId`** e **nenhuma competência**: um registro por
empresa, reaberto em TODO mês seguinte. Enquanto `atividadesEscolhidas` guardava
`valorInterno`/`valorExterno`, o valor de um mês era carregado para dentro de outro.

Medido em produção (12 memórias; 95 pares empresa×competência, 02/2026→07/2026):

| | |
|---|---|
| origem do pré-preenchimento | **memória 72** · cnae 20 · notas 0 · vazio 3 |
| com faturamento real (85) | bate 37 · **DIVERGE 48** |
| sem faturamento real (10) | **prefill > 0 em 10 de 10** |

O faturamento de 07/2026 da ARAUJO (R$ 20.301,21) aparecia em fevereiro, março, abril, maio e junho.

⚠ **E isso derrotava o GATE POR SOMA em produção.** Com `somaAtividades > 0` a declaração não é lida
como zerada, a caixa "Declarar SEM MOVIMENTO" **não renderiza** e o Calcular fica habilitado —
chamada PAGA ao SERPRO declarando receita que não existe naquele mês. Casos vivos: IOHANNA
R$ 3.680,00 (4 competências), CHAYM R$ 17.640,00 (3), PRISMA R$ 12.000,00 (2).

**Hoje:** `salvarConfigMemory` grava só `CAMPOS_DA_FORMA` (`idAtividade`, `descricao`,
`anexoImplicito`, **`mercado`**, `sujeitoFatorR`, `tipoReceita`), e o valor pré-preenchido vem do
faturamento da **própria competência** (`aplicarFaturamentoNaForma`, em `FechamentoService`).

⚠ **`lerConfigMemory` normaliza na LEITURA também.** As 12 memórias de produção ainda têm valor
gravado e o script de limpeza é rodado pelo dono — quem lê não pode depender disso ter acontecido.

⚠ **O MERCADO É O CAMPO QUE SÓ EXISTE AQUI, e perdê-lo chega na declaração.**
`NotaItem.flagExportacao` é `false` em **16.153 de 16.153** itens: o único escritor é o parser de
NF-e (`notas/dfe/DfeParser.js`, CFOP 7xxx), e a criação do item da NFS-e nunca o toca. Ou seja, todo
faturamento de NFS-e chega ao fechamento como se fosse **interno** — inclusive o da CDA MARKETING,
que presta serviço ao exterior. As duas declarações dela (`65227792202606001`, `65227792202607001`)
saíram com receita **EXTERNA** por causa do `mercado` gravado nesta memória. Por isso o total vai
para `valorInterno` **ou** `valorExterno` conforme a forma manda, nunca sempre no interno.
Memória sem `mercado` é completada pelo **catálogo** (`AtividadePgdasd.mercado`, pelo `idAtividade`),
nunca por suposição.

⚠ **Com 2+ atividades na forma, o valor fica VAZIO (`null`), com o motivo na tela.** Não existe
regra de rateio — nem no cadastro, nem nas notas (a classificação v2 nunca rodou: `tipoReceita` é
nulo em 16.153/16.153 itens). Dividir por conta própria seria o portal chutando o que vai numa
declaração. Vale também para receita interna **e** externa com uma atividade só: a atividade do
PGDAS-D é mercado-específica, não há linha onde pôr a outra metade.

⚠ **`null`, não `0`.** Zero é uma afirmação ("conferi, é zero"); ausência não é. E no front isso
depende de **`value={a.valorInterno ?? ""}`** — com `|| 0` o campo renderiza **0** para `null` e a
mudança inteira fica invisível, com um zero fabricado no lugar do branco (`FechamentoModal.jsx`).
`setAtvValor` também preserva o vazio: campo apagado vira `null`, não `0`.

⚠ **A FOLHA continua com valor**, de propósito: ela é `[{ pa, valor }]` de 12 meses ANTERIORES e o
modal só reusa a célula do `pa` que bate — não há como um valor de julho aparecer como de março.
A atividade, que não tem competência nenhuma, tinha.

**Limpeza das memórias existentes:** `scripts/limpar-memoria-valor-apuracao.mjs`, **dry-run por
padrão**, imprime a forma ANTES × DEPOIS por empresa e **aborta a escrita** se qualquer campo da
forma mudar (com `--aplicar`, relê do banco e confere). Ela **não é pré-requisito** do conserto —
a leitura já normaliza; o script só torna o banco consistente. Dry-run em produção (10/08/2026): 12
memórias, 12 com valor, **0 formas mudariam, 0 sem `mercado`**, CDA MARKETING com
`idAtividade=30 mercado=EXTERNO` idêntica antes e depois.

Regressões: `apuracao/v2/__tests__/memoriaGuardaForma.test.js` (20, inclusive o gate por soma e o
payload de `e0d13e3b`) e `web: features/apuracao/components/__tests__/fechamentoValorVazio.test.jsx`
(8, inclusive o `?? ""`).

### "Empresa zerada" — o botão registra o que já foi feito; ele NÃO entrega nada

⚠ **A premissa mudou no meio da investigação, e a versão final é esta** (dono, 10/08/2026):
*"os meses estão entregues sim, foram entregues à mão"*. As ~190 competências zeradas **já foram
declaradas** no portal do gov.br. O que faltava não era a entrega — era o portal **saber** dela: ele
exibia pendência que não existe.

O botão vive no `FechamentoModal` (`features/apuracao/components/EmpresaZeradaPanel.jsx`) e alimenta
**duas peças que já existiam**, nenhuma delas nova:

| afirmação | onde mora | quem escreve |
|---|---|---|
| "o mês não teve receita" | `CompanyMonthlyCircular.semFaturamento` (tri-estado, com as duas travas) | `marcarSemFaturamento` — **o mesmo** serviço da aba Lançamentos, com as recusas intactas |
| "a declaração foi entregue FORA do portal" | `EntregaObrigacaoArquivo`, tipo **`PGDAS_D`** | `registrarEntregaExternaPgdas` (`FechamentoService`), rota `POST .../fechamento/:comp/entrega-externa` |

⚠ **Por que `EntregaObrigacaoArquivo` e não coluna nova.** Ela já é, letra por letra, "obrigação
entregue no programa/portal oficial, marcada À MÃO, nunca escrita por automação, com recibo e
observação", chaveada por (empresa, tipo, competência) — o mesmo desenho da DEFIS. Uma coluna em
`ApuracaoSnapshot` seria pior: as 190 competências **não têm snapshot**, e criar um só para guardar
a marca exigiria inventar `rbt12`/`receitaPorTipo` (NOT NULL) — dado fiscal fabricado num registro
auditável. `empresaZerada` (PortalClient) não serve: é da EMPRESA inteira, não da competência.

⚠ **A flag `ENTREGA_ARQUIVO_LIBERADA = false` (`routes/firm/obrigacoes.js`) NÃO foi tocada.** Ela
desliga o fluxo de entrega por **arquivo** (EFD, upload/PVA), que é outra frente; o PGDAS-D não tem
arquivo a subir e entra pela rota da apuração.

**As CINCO respostas para "onde está a declaração desta competência?"** vivem numa leitura só,
`apps/web/src/features/apuracao/lib/entregaPgdas.js` (16 testes), e a procedência é o que as separa:

| estado | de onde vem | cor |
|---|---|---|
| transmitida pelo portal | `ApuracaoSnapshot.estado="transmitida"` **com** `numeroDeclaracao` | verde |
| **capturada da RFB** (entregue à mão) | `CompanyMonthlyCircular.pgdasNumeroDeclaracao` — extrato do PGDAS-D | verde |
| declarada pelo contador | `EntregaObrigacaoArquivo(PGDAS_D).transmitidaEm` | **neutro** |
| **entrega desconhecida** | extrato nunca consultado (`serproSyncStatus` nulo) | âmbar |
| não entregue | extrato consultado e `NOT_FOUND` | vermelho |

- ⚠ **"Não sabemos" não pode se parecer com "está devendo".** Vermelho só depois de a Receita ter
  sido perguntada e ter respondido que não há declaração; sem consulta, a resposta honesta é
  "desconhecida" (âmbar = ação rápida disponível: buscar o extrato).
- ⚠ **A âncora da prova é a COLUNA `pgdasNumeroDeclaracao`, nunca o PDF do `metadata`.** 20 das 102
  circulares com marca de PGDAS-D já perderam o bloco do `metadata` (sync posterior sobrescreveu,
  ou é formato antigo); a coluna sobreviveu. Perder o PDF não pode virar "não foi entregue".
- ⚠ **Afirmação não vira prova.** O campo de recibo é livre, opcional e **nunca preenchido por
  padrão**; a tela diz "declarado pelo contador" e nomeia o caminho para comprovar (buscar o
  extrato). E quando a prova JÁ existe, a confirmação **não pergunta** — trocar a prova capturada
  por uma palavra seria perder procedência, o mesmo defeito que impede gravar o RBT12 como
  "veio da simulação".
- ⚠ **Evidência CONTRA a afirmação aparece**: registro de entrega + extrato `NOT_FOUND` consultado
  **depois** dele → `declarada_fora_desmentida`, em vermelho. Extrato anterior ao registro não
  desmente nada (a foto é mais velha que o fato).
- ⚠ `registrarEntregaExternaPgdas` **recusa** (`ENTREGA_EXTERNA_JA_TRANSMITIDA`, 409) quando a
  competência já consta transmitida pelo portal: seriam duas histórias sobre a mesma declaração.
- **Nada disto transmite**, e nenhum estado daqui autoriza transmitir. Fechar como empresa zerada
  resolve o mês **do nosso lado**; a obrigação perante a Receita continua sendo outra pergunta — e é
  exatamente por isso que ela tem um bloco próprio, visível, na aba Apuração da empresa (não só
  dentro do modal).

## ⚠⚠ SUBIDA PARA O LEIAUTE 1.01 + IBS/CBS — fase 3 (01–02/09/2026)

Decisão do dono: *"migrar para 1.01 e construir IBS/CBS junto"*. Foram **dois commits dentro da
mesma entrega** — a versão sozinha, depois o resto —, para que o diagnóstico continue possível se
algo for recusado em produção.

`DPS_VERSAO = "1.01"`. A inércia está medida (ver "A MEDIÇÃO DE INÉRCIA", acima), inclusive os
**cinco** tipos que o gerador escreve e que mudaram entre as versões.

### O ANEXO VIII — **um CATÁLOGO de opções, não um de-para**

`docs/leiaute-nfse/documentacao-tecnica/anexoviii-…xlsx` → `scripts/gerar-anexo-viii.mjs` →
`application/fiscal/ibscbs/`. Zero rede, SHA-256 conferido, gates de contagem **e** de conteúdo.

⚠⚠ **O PLANO DESTA ENTREGA O DESCREVIA COMO `Item LC116 → NBS → cIndOp → cClassTrib`, E ISSO ESTÁ
ERRADO.** Medido: **208 itens, 400 combinações**. Só **89** itens têm UMA combinação; nos outros
**118** a norma oferece de duas a quatro, e escolher entre "situações tributadas integralmente" e
"fornecimento à administração pública" depende de **quem é o tomador daquela nota**, não do serviço.
**O módulo OFERECE e nunca ELEGE** — quem declara é o contador, no perfil.

⚠⚠ **O REGISTRO É O PAR `(cIndOp, cClassTrib)`, NUNCA DUAS LISTAS.** Em **7 itens** o produto
cartesiano contém combinações que a fonte não autoriza. O `10.05` traz só `(020301,200046)` e
`(100301,000001)`; achatado, ofereceria `(020301,000001)`, que ninguém escreveu. Gate no gerador
(`itensQueAchatarInventaria: 7`) e teste no módulo.

⚠⚠ **A ARMADILHA SÃO AS 2.258 CÉLULAS MESCLADAS**, e o experimento é o argumento: **sem expandi-las,
a leitura devolve 207 combinações em vez de 400 e 156 NBS em vez de 731 — e faz TODO item parecer ter
uma resposta só.** É literalmente a ilusão de "de-para", com números plausíveis. `sheet_to_json` dá o
valor só na âncora do bloco. ⚠ A expansão é **não destrutiva**; destrutiva, perde 3 combinações
(medido) — sutil o bastante para passar sem gate.

⚠ **`99.01.01`** vem sem NBS, sem `cIndOp` e sem `cClassTrib`: é o guarda-chuva "não classificado",
a família do `990101` que a classificação de notas manda para a pendência.

### `nbsParaDps` — 918 cabem na DPS, 292 **não são "inválidos"**

`TSCodNBS` é `[0-9]{9}`; a tabela guarda a forma pontuada. Dos 1.210 códigos, **918 são terminais** e
**292 são níveis intermediários** da hierarquia.

⚠⚠ **"NÃO TERMINAL" NÃO É "INVÁLIDO".** `1.0101` é código publicado, descrito e correto — ele só
identifica uma FAMÍLIA. Chamá-lo de inválido manda o contador procurar erro de digitação onde falta
ESCOLHER. A recusa carrega os **descendentes terminais**, e está medido que **nenhum dos 292 fica sem
saída**: se um dia um nível ficar sem folha, a frase "escolha um mais específico" vira mentira para
aquele código e o teste cai.

⚠ Nenhum `padStart`, em nenhuma direção. ⚠ A **tabela é a autoridade**: nove dígitos bem formados
fora da lista são recusados — o `[0-9]{9}` do XSD é FORMA, a lista é CONTEÚDO. ⚠ Só STRING (guarda
por TIPO ACEITO — número perderia o zero à esquerda em silêncio).

⚠⚠ **CRUZAMENTO ENTRE DUAS TABELAS GERADAS EM SEPARADO:** os **731** NBS que o ANEXO VIII aponta
existem TODOS na NBS 2.0 e convertem TODOS. Se a correlação apontasse um nível intermediário, o
`cNBS` seria irrepresentável e o defeito só apareceria na emissão.

⚠ **`9.9999.99.99` converte e NÃO tem descrição** — é o "não classificado". Não é bloqueado (código
publicado; recusá-lo seria inventar regra), mas `descricao: null` viaja no sucesso para a tela poder
dizê-lo.

### O que o gerador passou a escrever

| tag | onde | ligado por |
|---|---|---|
| `cNBS` | `infDPS/serv/cServ/cNBS` | **pelo DADO** — a coluna `codigoNbs` do perfil, nula em todos hoje |
| `IBSCBS` (5 campos) | `infDPS/IBSCBS/…` | **por FLAG** — `INTEGRACAO_NFSE_IBSCBS`, que nasce OFF |

⚠ A assimetria é deliberada: o `cNBS` é campo próprio e opcional; o bloco IBS/CBS é estrutural e
**traz a E0322 junto**. Com a flag OFF, um perfil com os três campos preenchidos **não produz bloco
nenhum** — é o SERVIDOR que não escreve, não a tela que esconde. Há teste.

**As regras, lidas do ANEXO_I versionado (aba `RN DPS_NFS-e`):**

- **E0322** (linha 324) — bloco IBS/CBS informado ⇒ `cNBS` **obrigatório**. A emissão RECUSA no
  pré-voo, **antes de reservar numeração** (não existe inutilização na NFS-e).
- **E0318** (linha 322) — `cNBS` obrigatório na **exportação**. ⚠ A exportação ainda não é montada;
  quando for, esta guarda é o lugar.
- **E0901** (linha 546) — a tabela de `cIndOp` é o **ANEXO C**, ⚠⚠ **NÃO versionado aqui**.
  Conferimos contra o ANEXO VIII, que é SUBCONJUNTO: mais estrito que a norma exige, portanto
  **falha FECHADA**. Um código legítimo do ANEXO C fora do ANEXO VIII é recusado por nós.
- **E0910** (linha 554) — *"O destinatário só deve ser identificado quando `indDest` for 1."*

⚠⚠ **`indDest = "0"` NÃO É PALPITE — é FATO sobre o documento que emitimos.** Pela E0910, `dest` só
existe com `indDest = 1`, e `buildDpsXml` **nunca monta `dest`**. Há teste varrendo o XML atrás de
`<dest>`: se alguém passar a montá-lo, as duas coisas mudam juntas. ⚠ `finNFSe = "0"` é o único valor
de `TSRTCFinNFSe`.

### ⚠⚠ O `CST` do IBS/CBS **não tem lista versionada** — declarado, não escondido

O XSD define `TSRTCCodSitTrib` como `[0-9]{3}` e **não enumera**; o ANEXO_I descreve o campo e também
não traz lista. As regras E1540+ referenciam ATRIBUTOS de uma tabela oficial de `cClassTrib`
(redutores, exigência de grupo de tributação regular) que este projeto não tem.

Medido: os 28 `cClassTrib` do ANEXO VIII têm cinco prefixos de três dígitos — `000`, `011`, `200`,
`400`, `820` —, que **parecem** CSTs. **Parecer não é fonte.** `cstSugeridoPeloClassTrib` SUGERE com
`verificadoNaFonte: false`; quem declara é o contador. É a mesma decisão da categoria de presunção do
Lucro Presumido: *derivar* virou *sugerir*.

### ⚠⚠ A NBS DEIXOU DE SER INERTE — e a guarda mudou de FORMA, não foi apagada

A decisão de 25/08/2026 (*"ligar o `cNBS` é ato do dono"*) **cumpriu o papel**: o teste que exigia
zero importadores em `application/nfse/` **caiu no commit que a ligou**. Ela não foi revogada por
conveniência — foi superada por um requisito que a norma amarra (E0322: escolher IBS/CBS **é**
escolher ligar a NBS).

⚠ **O que substituiu a inércia não é nada: é uma porta ÚNICA.** Só `ibscbsDaDps.js` pode importar a
NBS dentro de `application/nfse/`; **`NfseService` não a importa** — ele recebe o valor decidido. Dois
testes travam isso. ⚠ E a varredura pergunta *"quem IMPORTA"*, não *"quem menciona"*: a primeira
versão acusou `campos.js`, que só cita o nome num comentário. **Guarda que acusa documentação correta
é guarda que alguém desliga.**

### ⚠⚠ DEFEITO REAL ACHADO PELO TESTE: recusa NOSSA chegava como TRANSPORTE

Os códigos novos não estavam em `CODIGOS_NOSSOS` (`desfechoEmissao.js`), então caíam no ramo do
**TRANSPORTE**. O `codigo` chegava certo e a `correcao` dizia *"não se sabe se a DPS chegou a ser
processada; NÃO reemita"* — **mandando o contador procurar no sistema nacional uma nota que nunca saiu
da máquina**, e marcando `numeroReutilizavel: false`. É a orientação exatamente invertida.

⚠ **Código nomeado novo tem de entrar naquele conjunto no mesmo commit.** Não é detalhe de
classificação: é a diferença entre "corrija e emita de novo" e "não reemita, vá consultar".

### As colunas, e a disciplina que elas seguiram

`codigoNbs` · `ibscbsCIndOp` · `ibscbsCst` · `ibscbsCClassTrib` — migration
`20260902120000_add_perfil_emissao_nbs_ibscbs`, **NÃO APLICADA**, aditiva e nullable, com CHECK de
FORMA (do XSD) e sem `DEFAULT`: NULO = "o contador não declarou", nunca "não se aplica".

⚠ **São os primeiros campos do perfil cujo ESCRITOR nasceu no mesmo commit da coluna** — e o
cabeçalho de `campos.js` foi corrigido para dizer isso (ele exigia "campo que `buildDpsXml` JÁ
escreve", formulação certa para a fase 1). O que continua proibido é a coluna que espera um leitor
futuro. ⚠ O registro executável mordeu ao vê-las: ele lê o `schema.prisma` e nomeou as quatro.

### Regressão

`fiscal/ibscbs/__tests__/anexoViii.test.js` (18) · `fiscal/nbs/__tests__/nbsParaDps.test.js` (16) ·
`nfse/__tests__/perfilNaEmissao.test.js` (24, com o bloco novo conferido contra o XSD lido do
arquivo) · `fiscal/nbs/__tests__/nbs.test.js` (a porta única).

⚠ **Não verificado no navegador**, e o motivo é o de sempre: não há banco alcançável nesta máquina e
as duas flags nascem OFF. O que prova o comportamento são os testes e a leitura da fonte.

## ⚠⚠ A ALÍQUOTA DO ISSQN CHEGA À DPS — fase 4 (02/09/2026)

`tribMun/pAliq` era **coletado, validado e jogado fora**: o serviço exigia alíquota quando havia
retenção (`NFSE_ISS_RETIDO_SEM_ALIQUOTA`), gravava em `ServiceInvoice.aliquota`, e `tribMun`
escrevia só `tribISSQN` e `tpRetISSQN`. O número nunca chegou à nota.

### ⚠⚠ O ACHADO QUE TORNOU ISTO CONSTRUÍVEL — e que CORRIGE o plano desta entrega

O plano dizia que `pAliq` estava bloqueado pela lista de municípios "ATIVO no Sistema Nacional", que
de fato não está no repositório. **Isso vale só para parte dos cenários.** A tabela-verdade lida do
ANEXO_I (aba `RN DPS_NFS-e`, linhas 509-516), para o Simples ME/EPP:

| `regApTribSN` | convênio | ISS retido | `pAliq` | regra |
|---|---|---|---|---|
| **1** | ativo | **sim** | **obrigatório**, mínimo 1,8% | E0621 |
| **1** | ativo | não | **proibido** | E0625 |
| **1** | não ativo | **sim** | **obrigatório**, mínimo 1,8% | E0628 |
| **1** | não ativo | não | **proibido** | E0631 |
| 2 ou 3 | ativo | — | proibido | E0635 |
| 2 ou 3 | não ativo | — | obrigatório | E0640 |
| (não optante) | ativo | — | proibido | E0617 |
| (não optante) | não ativo, `regEspTrib=0` | — | obrigatório | E0619 |

⚠⚠ **Com `regApTribSN = 1` — o que emitimos e o caso comum do Simples — o status do convênio NÃO
IMPORTA:** E0621 e E0628 dizem a MESMA coisa para os dois estados, e E0625 e E0631 também. O único
discriminante é a RETENÇÃO. É esse ramo que foi construído.

⚠ Nos outros, a resposta é o **terceiro estado — `NAO_DECIDIVEL`**, e ele não vira nem sim nem não:
o campo não sai (o comportamento de hoje, que funciona em produção) e o risco fica NOMEADO.
**Recusar ali quebraria a emissão do Lucro Presumido, que sai sem `pAliq` e é aceita.**

### ⚠⚠ A CAIXA DE ISS RETIDO PASSOU A EXISTIR NO SIMPLES — metade de uma decisão revertida

Decisão do dono, 01/09/2026: *"o contador declara a alíquota de ISS para reter, mas o cliente na
tela dele deve poder selecionar se é retido ou não"*.

| | Simples | não optante / indefinido |
|---|---|---|
| **caixa** de retenção | **aparece** (mudou) | aparece |
| **alíquota** | **aparece com a caixa marcada** (02/09/2026) | aparece, com a caixa marcada |

⚠⚠ **A LINHA DA ALÍQUOTA DIZIA "não aparece no Simples — vem do perfil" ATÉ 02/09/2026, E ISSO
ERA UMA ARMADILHA QUE NÓS MESMOS CRIAMOS.** Com a caixa existindo no Simples (01/09) e a alíquota
fora da tela, marcar a retenção produzia uma recusa **GARANTIDA** no servidor
(`NFSE_PALIQ_OBRIGATORIA_AUSENTE`) — e a correção que a mensagem sugeria (*"o contador declara no
perfil de emissão"*) era **impossível de executar**, porque `INTEGRACAO_PERFIL_EMISSAO_NFSE` nasce
OFF e o perfil não tem efeito nenhum com ela desligada. **Controle que só sabe falhar é pior que
controle ausente** — o mesmo argumento da janela de NF-e vazia, registrado no `CLAUDE.md` da raiz.

Dono, 02/09/2026: *"ISS retido não tem alíquota obrigatória, pois ele pode nem reter (…) ISS retido
deve ser caixa de seleção, se selecionado preenche"*.

⚠ **A ALÍQUOTA SEGUE A CAIXA, NÃO O REGIME**, e é o que a norma diz: E0621/E0628 a **exigem** com
retenção; E0625/E0631 a **proíbem** sem. `pAliqDaDps` já decidia exatamente assim — quem discordava
era a TELA. `aliquotaNoFormulario` deixou de conferir o regime (`!ehSimples && issRetido`) e passou
a ser `issRetido === true`.

⚠ **E NÃO SÃO DUAS FONTES para o mesmo campo do XML:** ligado o perfil, ele **VENCE**
(`buildDpsXml`: `doPerfil("pAliq") ?? aliquota`). O que a tela oferece é o **fallback** enquanto o
perfil está desligado — e ele some sozinho com a caixa desmarcada, sem viajar no corpo.

⚠ **O portal do CONTADOR nunca teve essa armadilha**: o assistente oferece a alíquota sempre,
independente do regime.

⚠ **Isto destrava a E0621**: enquanto a caixa não existia no Simples, aquele cenário era
inalcançável pela tela — o defeito nº 7 que a validação do plano tinha nomeado.

⚠ **`issNoFormulario` virou `issRetidoNoFormulario`** (portal do cliente). O nome antigo dizia "o
bloco de ISS", e o bloco se partiu em dois com respostas diferentes. ⚠ E a marcação **passou a
viajar no corpo também no Simples**: antes ele forçava `issRetido: false`, o que era certo enquanto
a caixa não existia e seria o defeito ESPELHADO agora — caixa marcada, nota saindo sem retenção.

### ⚠⚠ A FORMA: `TSDec1V2` é `0|[0-9]{1}(\.[0-9]{2})?`

UM dígito inteiro e EXATAMENTE duas casas. Duas consequências que não são detalhe:

- **`1.8` não casa com o pattern** — tem de ser `1.80`. Uma alíquota "bonita" para olho humano é
  recusada por schema.
- **10% ou mais é INEXPRIMÍVEL** no campo. Não é limite nosso: é o leiaute. O ISS tem teto de 5%
  (LC 116, art. 8º-A), então na prática não morde — e quem não couber é **recusado nomeando**, nunca
  truncado (12,5% viraria 2,50% em silêncio).

⚠ **A ordem importa e é por isso que a versão subiu antes:** no **1.01** o `pAliq` é o **ÚLTIMO**
filho de `TCTribMunicipal`; no 1.00 ele vinha **antes** do `tpRetISSQN`. Escrever a ordem de uma
versão num documento que declara a outra é a classe do E1235.

### Onde cada peça mora

- regra pura: `application/nfse/pAliqDaDps.js` (a tabela-verdade, o mínimo de 1,8%, a formatação)
- coluna: `PerfilEmissaoNfse.pAliq` `Decimal(4,2)`, migration `20260902130000` — **NÃO APLICADA**
- gerador: `tribMun` ganhou o campo, na posição do 1.01
- pré-voo: recusa ANTES de reservar numeração — não existe inutilização na NFS-e
- tela do cliente: `impostosDaNota.js` (`issRetidoNoFormulario` × `aliquotaNoFormulario`)

⚠ **Uma variável só para o `regApTribSN`**: ela vai ao XML **e** decide o `pAliq`. Recalcular a
expressão nos dois lugares é como as duas respostas divergem — e aqui a divergência sairia como nota
rejeitada por E0621 (obrigatória e ausente) ou E0625 (proibida e presente).

### ⚠ A guarda antiga mudou de leitura, e deixou de ser a primeira a falar

`NFSE_ISS_RETIDO_SEM_ALIQUOTA` continua no gerador, mas agora lê a alíquota **efetiva**
(perfil → payload): lendo só o payload, ela recusaria toda nota do Simples com ISS retido, e o
conserto ficaria fora do alcance de quem recebeu a recusa. E quem fala primeiro é o **pré-voo**, com
`NFSE_PALIQ_OBRIGATORIA_AUSENTE` — mais cedo (antes da numeração) e mais preciso (cita E0621/E0628,
o mínimo de 1,8% e diz que quem declara é o contador).
⚠ Nenhuma tela mapeia o código antigo — varrido nos dois portais, só há comentários.

### ⚠⚠ DEFEITO MEU, PEGO PELO PRÓPRIO TESTE — a terceira vez nesta entrega

`formatarPAliq(null)` devolvia **`"0.00"`**: `Number("")` é 0, que é finito e cabe na faixa. Ou seja,
alíquota que ninguém declarou virava **alíquota ZERO declarada** num campo de documento fiscal. A
guarda é por **TIPO ACEITO**, nunca por lista de recusas — a mesma lição de `dispensadaPeloPiso`
(`fiscal/retencao/`) e de `normalizarItemLc116` (`fiscal/ibscbs/`). Três vezes na mesma entrega.

### Regressão

`nfse/__tests__/pAliqDaDps.test.js` (14, a tabela-verdade inteira + a forma conferida contra o XSD)
· `nfse/__tests__/perfilNaEmissao.test.js` (31, com o `pAliq` no XML e as recusas medidas por
`serviceInvoice.create` **não** ter sido chamado) · client `emitir/lib/__tests__/impostosDaNota.test.js`
(34) e `__tests__/impostosNaTela.ligacao.test.jsx` (28, com a prova do CORPO no Simples).

⚠ **Não verificado no navegador** — não há banco alcançável nesta máquina e a flag do perfil nasce
OFF. O que prova o comportamento são os testes e a leitura da fonte.

## ⚠⚠ A RETENÇÃO FEDERAL GANHA PRODUTOR — fase 5 (02/09/2026)

`trib/tribFed` era **`return ""` em 100% das emissões**, e toda retenção declarada era RECUSADA
(`NFSE_PIS_COFINS_RETENCAO_NAO_SUPORTADA`) porque o gerador não montava o `vRetCSLL` que a RN
**E0724** exige. As normas já estavam versionadas em `docs/retencao-fonte/` desde a fase 0c, e a
tabela `application/fiscal/retencao/` nasceu **inerte**. Agora ela tem consumidor.

### ⚠⚠ TRÊS COISAS DECIDEM A RETENÇÃO, E SÓ UMA É DO PERFIL

| # | o quê | de onde vem |
|---|---|---|
| 1 | **o REGIME** — optante do Simples **não sofre** (Lei 10.833/2003, **art. 32, III**; IN SRF 459/2004, art. 3º, II) | cadastro |
| 2 | **o SERVIÇO estar na lista do art. 30** | **declarado pelo contador**, no perfil |
| 3 | **o TOMADOR ser PJ** — a retenção é obrigação da fonte pagadora, PJ → PJ | derivado do documento da nota |

E uma quarta, que é dispensa e não condição: **o PISO de R$ 10,00** sobre o **valor retido**
(art. 31, § 3º). ⚠⚠ **O antigo limite de R$ 5.000 NÃO EXISTE MAIS** — a Lei 13.137/2015 revogou o
§ 4º, que era a regra de somar os pagamentos do mês. Sistema que ainda o aplique **deixa de reter**.

⚠ **Não confundir o art. 30, § 2º com o art. 32, III:** o primeiro fala de quem **PAGA** (fonte
pagadora optante não é obrigada a reter); o segundo fala de quem **RECEBE** — e nosso cliente é o
prestador.

⚠⚠ **O SISTEMA NÃO DERIVA A CONDIÇÃO 2 DO CNAE**, e a recusa é deliberada: errar aqui erra nos dois
sentidos — declarar retenção indevida, ou omitir a devida. A lista fechada dos "serviços
profissionais" do art. 30 remete ao rol do IRRF e **não está versionada** aqui.

### O que sai, e o que **não** sai

`piscofins`: CST (do perfil) · `vBCPisCofins` · `pAliqPis` **0,65** · `pAliqCofins` **3,00** ·
`vPis` · `vCofins` · `tpRetPisCofins` = **3**. Mais `vRetCSLL` = **1%**.
⚠ Os percentuais saem da tabela VERSIONADA, nunca de literal no gerador — há teste amarrando.

⚠⚠ **SÓ `tpRetPisCofins = 3` OU NADA.** A enumeração tem dez posições, e as parciais (5 = só PIS,
6 = só COFINS, 8 = só CSLL…) não têm fonte neste projeto. Os 4,65% do art. 31 são uma retenção
**única** das três contribuições.

⚠ **`vRetIRRF` e `vRetCP` continuam SEM PRODUTOR, de propósito:** a alíquota do IRRF vive na
legislação do IR e os 11% da Lei 8.212/1991 não foram confirmados em fonte primária. Emitir
percentual de memória é o que a regra 1 proíbe. Os dois estão em `FORA_DESTA_FASE`, nomeados.

⚠ **O CST é do contador.** `TSTipoCST` tem 34 valores e não existe de-para serviço → CST em fonte
versionada. Sem ele o grupo `piscofins` nem se monta (o XSD o exige) — a ausência é **recusa
nomeada**, nunca um `01` fabricado.

### As duas regras que são espelho uma da outra

- **E0724** — `tpRetPisCofins` ≠ 0 e ≠ 2 ⇒ `vRetCSLL` **obrigatório**;
- **E0720** — `tpRetPisCofins` = 0 ⇒ `vRetCSLL` **proibido**.

⚠ A recusa antiga dizia *"o gerador não monta `vRetCSLL`"* — verdade até aqui. Ela **mudou de
pergunta**, não sumiu: hoje recusa quem declara retenção **e não informa o valor da CSLL**, que é
exatamente o que o sistema nacional recusaria. E a E0720 passou a ser implementada também: só uma
das duas metades deixa a outra como rejeição do lado de lá.

### ⚠⚠ TRÊS DEFEITOS MEUS, TODOS PEGOS POR TESTE

1. ⚠⚠ **`if (dispensadaPeloPiso(x))` — a função devolve OBJETO, não booleano.** Objeto é truthy,
   então **toda retenção estava sendo dispensada**. Falha total e silenciosa. O mesmo valia para
   `retencaoFederalPeloRegime`, que devolve `{resposta, fonte, motivo}`.
2. ⚠⚠ **Regime INDEFINIDO RETINHA.** A regra tratava só `DISPENSADA` e deixava o resto passar —
   mas aquela função tem TRÊS respostas, e a terceira é *"não dá para afirmar"*. Reter sem saber o
   regime declara ao fisco uma retenção que talvez seja vedada. Hoje só `DEVIDA` prossegue.
3. ⚠ **O pré-voo lia `doc || cnpjCpf` e o gerador lê `doc`.** Duas leituras do documento fariam o
   pré-voo dizer PJ e o gerador dizer PF — e a nota sairia sem a retenção que o pré-voo aprovou.

### ⚠⚠ E DOIS DEFEITOS DE *TESTE*, que valem tanto quanto

- **A varredura acusava a própria explicação.** O caso que impede a volta do limite de R$ 5.000
  varria o texto por `5.000` — e a mensagem que EXPLICA que ele foi revogado contém "R$ 5.000".
  **Segunda vez** que isto acontece na entrega (a primeira foi um `\b11\b` acusando a citação
  legítima do art. 11 da IN 459). Hoje ela mira **código** (literal numérico, identificadores de
  acumulação) e faz a prova ESTRUTURAL que nenhuma varredura dá: **a função não recebe histórico**.
- ⚠⚠ **O removedor de comentários de `perfisEmissaoRota.test.js` quebrava em CRLF.** Em JS o `.`
  não casa terminadores de linha e `\r` é um deles; com `$` sem a flag `m`, `replace(/\/\/.*$/, "")`
  **não remove nada** num arquivo CRLF — e a varredura passa a acusar os próprios comentários. O
  desvio é na direção segura (falso positivo), e ainda assim: **guarda cujo veredito depende do fim
  de linha do checkout é guarda que alguém desliga.**

### Regressão

`nfse/__tests__/retencaoFederalDaDps.test.js` (19) · `nfse/__tests__/perfilNaEmissao.test.js` (37,
com o grupo no XML e as recusas medidas por `serviceInvoice.create` **não** ter sido chamado) ·
`nfse/perfilEmissao/__tests__/perfilEmissao.test.js` (33, incluindo as **enumerações transcritas
conferidas contra o XSD** — a amarração que um comentário meu prometia e que não existia).

Migration `20260902140000_add_perfil_emissao_retencao_federal` — **NÃO APLICADA**, aditiva,
nullable, **sem DEFAULT** (a lição do `usaFatorR`).

## Recuperação de senha ("esqueci minha senha") — 18/08/2026

Antes desta entrega **não havia nada**: `grep -iE "forgot|reset|recuperar|esqueci" src/routes/auth.js`
não achava uma linha, e o cliente que esquecia a senha dependia de o escritório mexer no banco à mão.
Com `apps/portal-cliente-web` no ar, isso apareceria no primeiro usuário real.

- **Rotas:** `POST /auth/forgot-password` e `POST /auth/reset-password` (`routes/auth.js`).
  Regra pura + banco em **`application/auth/PasswordResetService.js`**.
  Testes: **`routes/__tests__/recuperacaoSenha.test.js`** (20).
- **Model `PasswordResetToken`** → tabela **`password_reset_tokens`** (`@@map` explícito).
  Migration **`20260818140000_add_password_reset_token`**. ⚠⚠ **APLICADA no banco de DEV** — medido em 01/09/2026 (`_prisma_migrations`); **produção é outra pergunta**, e esta máquina não a responde. Ver *"O ESTADO DAS MIGRAÇÕES"*.
  A única FK é para **`"User"`** (sem `@@map`, conferido contra DDL real, não contra o `schema.prisma`).
- **Forma copiada de `ClientSession`:** token opaco de `crypto.randomBytes(32)`, guardado só como
  **SHA-256** (`tokenHash`). O claro existe dentro da requisição, vai para o e-mail e morre ali.
  A coluna que `ClientSession` **não** tem e esta exige é **`usedAt`** — é ela que faz o uso único.
- ⚠⚠ **NÃO REVELAR SE O E-MAIL EXISTE** é a regra que sustenta o resto: um portal contábil que
  responde "este e-mail não existe" deixa qualquer um descobrir **quem é cliente de qual escritório**.
  Quatro desfechos respondem 200 idêntico (conta inexistente · conta ativa · conta pendente/bloqueada ·
  falha de envio). Só o **503 `mail_not_configured`** difere — e é decidido **antes de tocar no banco**,
  então vale igual para todo endereço.
  - ⚠ **A resposta sai ANTES de criar o token e mandar o e-mail**, e isso não é otimização: é o que
    fecha o **oráculo de tempo**. Com o envio no caminho, "existe" custaria uma escrita + uma ida ao
    Gmail e "não existe" um SELECT indexado — bastaria CRONOMETRAR para enumerar a carteira.
  - ⚠ Por isso **falha de envio não vira erro HTTP** (viraria oráculo: só quem existe pode falhar).
    Ela vira log de erro. **Pendente do dono:** alerta ao escritório ou retry, como o `guideEmailWorker`.
- ⚠ **Recusa única** para token inexistente, adulterado, **vencido** e **já usado**:
  `invalid_reset_token` (400). "Este link já foi usado" contaria ao atacante que ele existiu.
  - ⚠ **Código PRÓPRIO, não o `invalid_token` genérico** — aquele já significa "sua sessão expirou"
    no portal do cliente (`lib/mensagens.js`), e reusá-lo mandaria um usuário **deslogado** "entrar
    novamente" numa tela cujo problema é o link do e-mail.
  - ⚠ **Senha fraca é conferida ANTES do token**: ao contrário, `weak_password` × `invalid_reset_token`
    revelaria que o token chutado era válido.
- ⚠ **REDEFINIR REVOGA TODAS AS SESSÕES**, no MESMO commit da troca (`ClientSession.revokedAt`).
  Sem isso, quem redefine a senha por desconfiar de invasão continuaria com o invasor logado — o
  refresh opaco sobrevive à troca de senha. Mesma garantia do `POST /auth/change-password`, que já a
  dava; escrita à mão (e não via `revokeAllForUser`) só porque aquela roda **fora** de transação.
- **Prazo: 60 minutos** (`PASSWORD_RESET_TTL_MINUTES`). Não menos porque o cliente não fica sentado
  na caixa de entrada — token que vence antes o devolve ao trabalho manual que isto eliminou. Não
  mais porque **o e-mail do cliente não é necessariamente pessoal**: o projeto já mede isso em
  `PortalClient.guideNotificationEmail` (caixa `financeiro@…`, separada do dono), e um link vivo por
  24 h numa caixa compartilhada é uma senha esperando ser achada.
- **Link:** `PORTAL_CLIENTE_WEB_URL` em `config.js`, **sem default** e **nunca lido do header `Host`**
  (seria o atacante escolhendo para onde o token da vítima vai). Ausente ⇒ 503.
- **Rate limit:** `/reset-password` reusa o `authStrictLimiter`; `/forgot-password` tem um **mais
  estrito (5 / 15 min)** por ser a única rota que faz o servidor **mandar e-mail para um endereço
  escolhido por quem chama** — abuso aqui é mail-bomb na vítima e reputação de envio do domínio.
- **Front** (`apps/portal-cliente-web`): `features/auth/EsqueciSenhaPage.jsx` +
  `RedefinirSenhaPage.jsx`; despacho por URL em `App.jsx` (sem router). ⚠ O **mock não aceita
  qualquer token** — `token-valido` · `token-expirado` · `token-usado` exercem os três desfechos
  offline, e os dois últimos produzem a **mesma** recusa do válido-porém-recusado.

## ⚠⚠ WHATSAPP — ENTREGA 2 (02–03/09/2026): canal ligável, guias na tela, assistente com IA, conversas

> Dono, 02/09/2026: *"Meta liberou para aprovar a empresa, e estou com o template de envio de guia
> aprovado também, vamos planejar como implementar o whatsapp, inclusive com uso de IA, resposta de
> documentos, emissão de notas, recálculo, etc."* Plano aprovado em
> `~/.claude/plans/avaliei-as-tr-s-telas-dapper-nest.md` (fases F0–F6). Decisões dele: **Anthropic/
> Claude** (`@anthropic-ai/sdk`, `claude-opus-5`, custo registrado com teto) · **"IA monta, cliente
> confirma"** com a declaração inteira · **CNPJ consultado no servidor** (BrasilAPI, ajuda nunca
> portão; CPF nunca) · **tela mínima de conversas** nesta entrega.

⚠⚠ **NADA DISTO FOI EXERCIDO CONTRA A META NEM CONTRA A ANTHROPIC.** Não há credencial nesta máquina
e as duas flags nascem OFF. O que está provado é o que os testes provam (rede travada por
construção); o que só se prova com a chave está nomeado em "Não verificado", abaixo.

### Medido em produção ANTES de escrever (02/09/2026, só leitura)

| | valor |
|---|---|
| `prisma migrate status` | **145/145 aplicadas** — inclusive `20260814160000` e `20260814180000`, que o doc da Entrega 1 dizia "não aplicadas" |
| `templates_whatsapp` | 5 chaves, todas `DECLARADO`, `nomeMeta` **null** |
| `contatos_whatsapp` · `conversas_whatsapp` · `mensagens_whatsapp` · `envios_guia` | **0 · 0 · 0 · 0** |
| `Guide.emailStatus` | null 110 · SENT 83 · PENDING 62 |
| tabela do `PortalClient` | **`"PortalClient"`** (PascalCase, sem `@@map`) — ⚠ FK escrita como `portal_clients` já rendeu um P3009 |

### O que entrou, por fase

**F0 — ligar o canal (sem código de produto).** `application/whatsapp/templateAprovado.js`
(`conferirCorpoAprovado` compara o corpo aprovado com as **5 variáveis na ordem do código**;
`decidirRegistroDeAprovacao` exige `conferidoPorPessoa`) + `scripts/registrar-template-whatsapp.mjs`
(ensaio por padrão; `--chave --nome-meta --idioma --corpo-arquivo --conferido --aplicar`). ⚠ Se o
corpo aprovado tem outra ordem/quantidade de `{{n}}`, **muda o código, não o template**.
`scripts/diag-canal-whatsapp.mjs` (só leitura) mede flag + templates + tabelas.
`scripts/diag-vinculo-whatsapp.mjs` consertado (importava `TOLERANCIAS`, que não existe; é `LEITURAS`).

**F1/F2 — as telas** vivem em `apps/web` (ver `apps/web/src/features/guides/CLAUDE.md`). Do lado da
api: `GET /companies/:id/contatos-whatsapp` passou a devolver `canalPadraoEnvio`;
`errosMeta.podeTentarDeNovoPeloCodigo`; `guideCompliance` lê `envioStatus === "falhou"` e carimba
`envioErroCodigo`/`envioPodeTentarDeNovo`; o relatório do lote lê `enviosPorGuia`.

**F3 — CNPJ no servidor.** `application/tomador/consultaCnpj.js` (`fetch` injetável, timeout
8 s, **nunca lança**, `MOTIVOS` nomeados, log só com CNPJ mascarado) + `consultaTomador.js`, o
**terceiro** leitor da mesma regra dos dois portais — o teste importa as funções do `apps/web` e
exige o mesmo veredito. ⚠ O `cMun` da consulta passa pela prova tripla do IBGE.

**F4 — o assistente.** `application/assistente/`:

| arquivo | o que decide |
|---|---|
| `precosIa.js` | preço por token, versionado com data e fonte; **estimativa** |
| `sessaoDoContato.js` | `contato.userId` → `CompanyClientUser.role` → `{portalClientId, userId, papel}`. **Papel nunca é presumido**: sem vínculo ativo, papel nulo e nada de guia |
| `confirmacaoPendente.js` | `^confirmar\s+([a-z0-9]{4})$` reconhecido **antes** do modelo; `EXECUTAR · CODIGO_ERRADO · EXPIRADA · CANCELAR · SEM_PENDENCIA · SEGUE_PARA_IA`; TTL 10 min |
| `GuardaIaService.js` | `autorizarChamadaIa` **FALHA FECHADO** (o SERPRO falha aberto porque derrubar o fechamento seria pior que o gasto; a IA é conveniência e um laço gasta em silêncio); `concluirChamadaIa` grava `chamadas_ia`; `consumoIaDoMes` |
| `promptDoAssistente.js` | `SYSTEM_ESTAVEL` cacheado (**sem data/empresa** — teste trava), `contextoDoTurno` depois do cache, `MENSAGENS_FIXAS` |
| `AssistenteClient.js` | loop manual `stop_reason === "tool_use"`, máx. 6 iterações, `tool_result` de uma rodada numa única mensagem `user`, `is_error`, `refusal`, erros tipados → frase fixa |
| `AcoesPendentesService.js` | `criarPendencia`, `confirmarEExecutar` com reserva atômica (`updateMany` + `count`); executores chamam **as mesmas funções das rotas**: `NfseService.issue`, `sendEvent` e101101, recálculo dentro de `comContextoSerpro({origem:"whatsapp:recalcular", forcar:false})` com `traduzirRecusaParaCliente` |
| `ferramentas/index.js` | 12 ferramentas `strict`; toda query leva `ctx.sessao.portalClientId` no `where` |
| `AssistenteService.js` | `responderMensagem`: reserva `respondidaPelaIaEm` → lock `ia:<conversaId>` → sessão → pendência (regex) → mídia fixa → guarda → modelo → registra `autor` |

Entrada: `ProcessarEventoWhatsappService.decidirRespostaDaIa` — a IA só responde com flag ON **e**
empresa no piloto **e** `VINCULADO` **e** não assumida por humano **e** texto; recusas nomeadas
(`FLAG_OFF · DUPLICADA · NAO_VINCULADA · FORA_DO_PILOTO · ASSUMIDA_POR_HUMANO`).
`WhatsappCloudClient.enviarDocumento` (`type: "document"`, `document.id`, nunca `link`).
`packages/shared/src/nfse/declaracaoNfse.js` (`./declaracao-nfse`): as 11 linhas de
`linhasDoEspelho` que o cliente confirma.

**F5 — conversas.** `routes/firm/whatsappConversas.js` (admin|contador; escopo por
`empresasVisiveis`; fio de fora da carteira é **404**): `GET /whatsapp/conversas?filtro=`,
`GET .../:id/mensagens` (marca `lidaAteEm`), `POST .../assumir|devolver`, `POST .../responder`
(**409 `FORA_DA_JANELA`** sem chamar a Meta; dentro, `autor: "HUMANO"`), `POST .../vincular`
(o telefone é o **do fio** — o corpo não escolhe o número). `GET /ia/consumo`.
⚠ `atendidaDesde` **sem** `atendidaPor` = "o assistente chamou o escritório" (a ferramenta
`chamar_escritorio`); a IA cala nos dois casos.

### Flags e variáveis (todas nascem OFF/vazias)

`INTEGRACAO_WHATSAPP_IA` · `IA_EMPRESAS_PILOTO` (CSV de `portalClientId`; **vazio = ninguém**) ·
`ANTHROPIC_API_KEY` · `IA_MODELO` (claude-opus-5) · `IA_ESFORCO` (medium) · `IA_MAX_TOKENS` 2000 ·
`IA_MAX_ITERACOES` 6 · `IA_TETO_MENSAL_EMPRESA_CENTAVOS` **400** · `IA_TETO_MENSAL_ESCRITORIO_CENTAVOS`
**6000** · `IA_ALERTA_FRACAO` 0.8 · `IA_HISTORICO_MENSAGENS` 20.
⚠ **Os tetos são em CENTAVOS DE DÓLAR** (a Anthropic cobra em USD e a tabela de preço é em USD) —
o plano dizia R$ 20 / R$ 300; os defaults são US$ 4 / US$ 60 e ficam como pergunta ao dono.

### Migrations (escritas à mão, aditivas) — ⚠ NÃO APLICADAS em lugar nenhum

`20260903100000_add_whatsapp_conversa_atendimento` (`atendidaPor`/`atendidaDesde`, `autor`,
`respondidaPelaIaEm`) · `20260903100100_add_whatsapp_acao_pendente` (`acoes_pendentes_whatsapp`) ·
`20260903100200_add_chamada_ia` (`chamadas_ia`, FK a `"PortalClient"`). O banco local está fora
(docker parado); validadas com `prisma validate` + `generate`. Em produção entram pelo
`start:prod` (`migrate deploy`) — **medir `migrate status` depois do deploy**.

### Não verificado (só a chave prova)

- nenhuma chamada real à Meta nem à Anthropic; `output_config.effort` e o payload de `document`
  seguem a documentação, não uma resposta real; `strict: true` nas tools idem;
- `usage.cache_read_input_tokens > 0` (o cache do prompt) só se mede com chamada real;
- o corpo aprovado do template (o dono ainda não o passou) — a F0 não fecha sem ele.

### ⚠⚠ A VERIFICAÇÃO MULTI-AGENTE (03/09/2026) — quatro furos achados, quatro fechados

Três agentes leram este código lado a lado com as rotas equivalentes de `routes/client/index.js`:
**A · guardas** (toda ferramenta × a guarda da rota), **B · multi-tenancy** (toda query × o escopo)
e **C · custo e idempotência** (experimentos por guarda, num worktree isolado). O veredito comum:
**nenhuma ferramenta alcança leitura ou ato sem sessão, papel e empresa do fio**, e nenhum ato
fiscal sai sem `CONFIRMAR <código>` fora do modelo. O que eles acharam foi o que segue.

| # | furo | conserto |
|---|---|---|
| 1 | **"nota recebida" lia só a coluna `papel`** — a rota tem DUAS fontes (a coluna E a comparação de CNPJ), porque a captura nem sempre traz `papel`. Nota recebida com `papel` nulo virava pendência de cancelamento | as duas fontes, com `papel: "EMIT"` encerrando a pergunta (a empresa que emite para si mesma tem tomador = ela) |
| 2 | ⚠⚠ **nada era reconferido na CONFIRMAÇÃO** — entre o pedido e o `CONFIRMAR` passam até 10 min, e a rota HTTP reconfere o portão a CADA POST. O escritório podia ter revogado `emissaoClienteLiberada`, a guia podia ter sido paga | `confirmarEExecutar` reconfere: EMITIR/CANCELAR passam de novo por `autorizarEmissaoDoCliente`, RECALCULAR refaz as **4 travas** da rota antes da chamada PAGA. Reconferência que LANÇA **recusa** |
| 3 | **o cancelamento não marcava a NOSSA `ServiceInvoice`** como `cancelled` (a rota marca) | `NfseRepository.updateByChaveAcesso` no executor. ⚠ Nunca `PortalInvoice`: aquela é projeção do ADN |
| 4 | **`GET /firm/ia/consumo?portalClientId=` sem carteira** — quem tem acesso restrito lia centavos, chamadas e `estourado` de QUALQUER empresa | `empresasVisiveis(req)`, 404 (nunca 403). O total do escritório continua aberto |

⚠ **A pendência também ficou presa ao FIO e à EMPRESA**: a reserva leva `conversaId` e
`portalClientId`. Sem isso, um fio re-vinculado a outra empresa dentro dos 10 min executaria o ato
no CNPJ em que a pendência nasceu.

#### Os experimentos, e os dois que voltaram VERDES

| experimento | vermelhos |
|---|---|
| reserva da resposta sem `respondidaPelaIaEm` | 1 |
| guarda de custo falhando ABERTO | 1 |
| sem registrar a chamada no caminho de erro | 1 |
| laço do modelo sem teto de iterações | 1 |
| **reserva de `confirmarEExecutar` sem `status: "pendente"`** | ⚠⚠ **0 → hoje 2** |
| **gancho do webhook ignorando `decidirRespostaDaIa`** | ⚠⚠ **0 → hoje 1** |
| **"nota recebida" só pela coluna `papel`** | ⚠⚠ **0 → hoje (as duas fontes têm teste)** |
| sem a reconferência do portão na confirmação | (novo) 2 |
| recálculo sem as 3 travas reconferidas | (novo) 3 |

⚠⚠ **OS TRÊS ZEROS SÃO O ACHADO, não os consertos.** Em dois deles o comentário do código
**afirmava** a cobertura: o do gancho dizia *"o teste mede que ele NÃO é chamado nos ramos
fechados"* e nenhum teste injetava `responder`; a reserva atômica era protegida por acidente
(`pendenciaAberta` já filtra `pendente`, então a corrida — o único caso que a cláusula existe para
pegar — não tinha teste). Hoje há `assistente/__tests__/acoesPendentes.test.js` (chamando
`confirmarEExecutar` DIRETO, com dois turnos concorrentes) e o bloco "o gancho da IA" em
`processarEventoWhatsapp.test.js`.

⚠ **Para o ramo "a IA responde" ser alcançável no teste, `processarEventoWhatsapp` passou a aceitar
`ia: {flag, piloto}` injetável** — a flag nasce OFF no ambiente de teste, e mock que esconde ramo é
defeito conhecido desta casa. Produção não passa nada e os defaults do `config.js` mandam.

⚠ **A varredura de escopo foi ALARGADA** (`promptEEscopo.test.js`): ela via só
`ctx.prisma.<model>.find*` e deixava passar `count`/`aggregate`/`groupBy` e o `prisma` importado
direto (sem `ctx.`), que é o mesmo banco sem o escopo do fio. `portalClient` é exceção nomeada — ela
**é** a raiz do tenant, e ali a chave da empresa é o próprio `id`.

#### O que os agentes NOMEARAM e não foi consertado

- `listar_notas` diverge da lista do portal (não esconde canceladas, filtra direção por `papel` em
  vez de CNPJ, não faz a união com as não confirmadas). É divergência de CONTEÚDO, não de escopo —
  só dado da própria empresa. **Decisão de produto.**
- O 404 de "fio fora da carteira" **não morde hoje**: o gate é `admin|contador`, e para esses dois
  `empresasVisiveis` devolve a carteira inteira. A guarda vale se o gate for afrouxado para STAFF.
- `registrar` engole falha de gravação de `chamadas_ia` com log — chamada feita e não contada. E a
  contagem do teto é lida ANTES da gravação, então turnos concorrentes em conversas diferentes
  passam todos pela mesma leitura. **Ordem de grandeza, e o cabeçalho do arquivo assume isso.**

### Guardas que NÃO se afrouxam

`liberadaCliente` em toda leitura de guia · o cliente nunca dispara SITFIS nem `forcar` · nenhum ato
fiscal sem pendência + código · `confirmar` por "sim" solto não existe · fora das pendências o turno
não escreve nada · `IA_EMPRESAS_PILOTO` vazio é ninguém, não todo mundo · **NUNCA rodar
`scripts/backfill-envio-guia.mjs`**.


## ⚠⚠ O DESTINATÁRIO DE ENVIO — e-mail e WhatsApp na mesma linha (05/09/2026)

> Dono, com a tela na frente: *"a tela de configuração de envio dentro de guias, lá deve ser o
> cadastro de emails e telefones para envio, e não em senha e acesso (…) o cadastro padrão da empresa
> digitamos o email 3 vezes, devemos digitar apenas duas (…) quando enviarmos, enviar para todos os
> canais cadastrados"*.

**`contatos_whatsapp` virou o cadastro de DESTINATÁRIOS**: ganhou `email`, e `telefoneE164` passou a
ser nulo. Um destinatário tem só e-mail, só WhatsApp, ou os dois. ⚠ **A tabela NÃO mudou de nome** —
renomeá-la arrastaria o módulo de conversas inteiro (vínculo por telefone, webhook, fila de não
vinculados) por causa de uma mudança de escopo da TELA.

| onde | o quê |
|---|---|
| `salvarContato` | aceita `email`, valida a forma, e exige **ao menos um canal** (`SEM_CANAL`) |
| `destinatariosDeEnvio` | `{emails, telefones, semOptIn}` — a lista por canal |
| `resolveCompanyNotificationEmails` | TODOS os e-mails, vírgula no `To:`; **a cascata antiga é a rede** |
| `POST .../enviar-whatsapp` | manda para TODOS os telefones com opt-in, um envio por destinatário |

⚠⚠ **O OPT-IN VALE SÓ PARA O WHATSAPP.** É exigência de política da Meta e é o que protege o número
contra denúncia; **e-mail nunca dependeu dele**. Foi por ignorar isso que a tela nasceu dizendo
*"sem opt-in — não recebe até registrar a autorização"* sobre um destinatário só de e-mail, que
recebe normalmente — mandando o contador procurar uma autorização que não faz falta. Hoje há um
quarto estado (`SO_EMAIL`), em tinta **neutra**: âmbar ali treinaria o olho a ignorar a cor da
pendência de verdade.

⚠⚠ **A CASCATA ANTIGA CONTINUA, e é o que impede a mudança de calar a carteira.** Sem NENHUM
destinatário cadastrado, o envio cai em `guideNotificationEmail` → `Company.email` → e-mail do sócio,
como sempre fez. A migration `20260905140000` faz o **backfill**: o e-mail que cada empresa já tinha
vira o primeiro destinatário da lista nova (decisão do dono). ⚠ O `nome` do backfill não é inventado
— *"E-mail cadastrado para guias"*: não sabemos de quem é o endereço, só que foi cadastrado para
receber guia.

### ⚠⚠ `envios_guia`: a chave passou a incluir o DESTINO

`@@unique(guideId, canal)` → **`@@unique(guideId, canal, destino)`** (migration `20260905150000`).
A idempotência do lote **não afrouxou**: continua um envio por (guia, canal, destino) — mandar para
OUTRO telefone não é repetir, é outro destinatário. Sem isso, o segundo telefone da empresa nunca
receberia: a linha do primeiro diria "já enviada".

⚠⚠ **SÃO DOIS ÍNDICES.** No Postgres NULL não colide com NULL, e a linha LEGADA do e-mail tem
`destino` nulo (o envio antigo não registrava para quem foi) — sem um índice **PARCIAL**
(`… WHERE destino IS NULL`) ela poderia ser materializada duas vezes, e `foiEnviadaComLegado`
passaria a ver duas linhas onde havia uma. O parcial **não é declarável no Prisma** e vive na
migration; o comentário do schema diz onde ele está. ⚠ Medido: `envios_guia` tem **zero** linhas em
produção — é por isso que a troca de chave é barata AGORA e não seria depois.

⚠ `registrarEnvio` deixou de usar `upsert` (chave composta com nulo não casa) e virou
`findFirst` + `create`/`update` por id: a MESMA linha volta a `pendente` na retentativa, nunca uma
segunda para o mesmo destino.

### Reenviar é decisão do contador

`registrarEnvio` ganhou `reenviar`; sem ele, guia enviada continua sendo recusa. A rota **por guia**
aceita `{reenviar: true}`; **o lote não tem essa porta**, e é o que impede a carteira inteira de sair
duas vezes num clique. Na tela, a recusa `GUIA_JA_ENVIADA` virou o AVISO: a frase carrega o motivo
que o servidor deu, e só com o sim o pedido é repetido.

### O `+55` já era opcional

`normalizarE164` aceita `21 99999-8888` e prefixa o 55 sozinha — no servidor e no espelho da tela,
desde agosto. O que mudou foi o **rótulo**: ele mandava digitar o `+`. O `+` continua aceito e
continua sendo o único desambiguador de DDI para número estrangeiro.

## Regras

- Nunca hardcodar credenciais ou URLs — usar `config.js`
- Toda rota nova de firma deve ficar em `routes/firm/`
- Isolamento multi-tenant é inegociável: sempre filtrar por `firmId`/`companyId`
- Não adicionar `console.log` de debug em produção — usar o logger existente
- Migrations novas devem ter nome descritivo em inglês (snake_case)
