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
> `src/workers/`, `src/application/accounting/`, `src/application/guides/`.
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
- `ApuracaoConfigMemoryService.js` — memória da última config por empresa (reaparece).
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
| 1 | CNPJ **colado** na 1ª célula do cabeçalho: `______CNPJ: 52.682.158/0001-92Receita` | a coluna some |
| 2 | **Cabeçalho da página 2** cortando a tabela no meio | desalinha tudo dali em diante |
| 3 | `Notificação de lançamento: 526821582026010011099-01 - CP-SEGUR.` — o próximo registro vem colado | perde um registro |
| 4 | Régua (`______`) como linha solta | entra como célula e quebra a contagem |
| 5 | Número da página em linha própria | filtrar todo número solto comia o `4` de "Parcelas em atraso" — o descarte é **posicional** |
| 6 | Bloco nem sempre começa com "Pendência -" | marcador é **título + régua na MESMA linha** (`[ 	]*`, nunca `\s*`, senão a régua final rouba a linha anterior como título) |

### A validação

`linhasDeDados.length % colunas.length === 0`. Não fechando, o bloco **não vira tabela**: sai como
`naoInterpretado`, com as linhas cruas visíveis. É isso que impede a volta do defeito antigo — o
parser original extraía valores e chegou a mostrar **"R$ 100,00" de débito numa empresa sem débito**,
lendo o `100,00%` de participação do quadro societário.

### Regra de exibição

**A tabela nunca some.** Bloco ilegível aparece com as linhas cruas e o aviso de conferir no PDF —
esconder passaria a impressão de "nada consta", o oposto do que se sabe.

Verificado contra os dois textos reais (ATIM com 3 blocos e 6 registros; ERISANGELA só com
parcelamento): nenhum bloco ilegível.

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

Workers opt-in (default desligados): `GUIDE_EMAIL_WORKER_ENABLED`,
`SERPRO_PGDASD_WORKER_ENABLED`, `SERPRO_DCTFWEB_WORKER_ENABLED`,
`DFE_NOTAS_WORKER_ENABLED`, `APURACAO_BATCH_WORKER_ENABLED`,
`SERPRO_PAYMENT_CONFIRMATION_WORKER_ENABLED`, `CONFERENCIA_ADN_WORKER_ENABLED`.

Flags de integração SERPRO (default OFF até validar no trial):
`INTEGRACAO_SERPRO_SITFIS` (ligada), `INTEGRACAO_SERPRO_PAGTOWEB` (OFF — não validado),
`INTEGRACAO_SERPRO_PARCELAMENTO`, `INTEGRACAO_SERPRO_DCTFWEB_LP` (OFF — `CONSDECCOMPLETA33` é
`verificadoTrial:false`). Ver `config.js` para os idServiço/versão.

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
mostra gasto por serviço, por origem, por empresa e o **pico por empresa/dia**, que é o número a
comparar com o teto.

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

**Efeito:** `getRequirements` (`guideCompliance.js`) deixa de exigir o DAS (decisão do dono: a tag
**some**, não fica amarela como o `VAZIO`). Pré-query simétrica à do `parcDasAtivoSet` — uma query
para a carteira, não uma por empresa. O lembrete de transmitir a declaração zerada **não se perde**:
segue na pendência de apuração do calendário, que não foi tocada.

**Não decide ato fiscal.** No `FechamentoModal` ele apenas **pré-marca** a caixa "sem movimento",
igual `empresaZerada` já fazia; quem transmite continua sendo o contador (regra 5).

## Regras

- Nunca hardcodar credenciais ou URLs — usar `config.js`
- Toda rota nova de firma deve ficar em `routes/firm/`
- Isolamento multi-tenant é inegociável: sempre filtrar por `firmId`/`companyId`
- Não adicionar `console.log` de debug em produção — usar o logger existente
- Migrations novas devem ter nome descritivo em inglês (snake_case)
