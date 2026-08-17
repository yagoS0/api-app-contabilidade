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

## Emissor de NFS-e — Fase 1 (backend). ⚠ NADA FOI EMITIDO, EM NENHUM AMBIENTE

> Regra do dono, sem exceção: **não emitir, cancelar ou transmitir NFS-e** em ambiente nenhum —
> nem homologação. Esta fase torna o caminho *exercível*; ela não o exerce.

**Contexto que torna tudo isto seguro:** a emissão **nunca rodou em produção**. Nenhuma variável
`NFSE_*` está definida no Railway, `integrationReady()` sempre foi falso e toda emissão parava em
`status:"pending"`. Não há dado legado nem comportamento a preservar — e é por isso que os cinco
defeitos abaixo apareceriam **todos juntos** no dia em que a configuração ligasse.

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

### Leiaute 1.00 → 1.01: **não migrado**, e é decisão de risco

O publicado como Documentação Atual é o **1.01** (XSD de 11/02/2026), e há regra de expiração de
versão (**E0001**/**E1260**) — mas ⚠ **a data de corte não está publicada**, o acréscimo (`IBSCBS`,
reforma tributária) é **facultativo**, e o projeto **não tem o XSD versionado** (nenhum `.xsd` na
árvore). Subir sem schema para validar troca uma rejeição conhecida por uma desconhecida. Fica na
constante `DPS_VERSAO`, num lugar só, para virar em uma linha.

### O que precisou do dono e NÃO foi inventado

1. **Como `Company.codigoMunicipioIbge` será preenchido.** O município só existe como TEXTO em
   `PortalClient.municipio`/`uf` (33/33 preenchidos, 32 no Rio). O de-para nome→IBGE exige a tabela
   do IBGE, que não temos, e erra em homônimo. **Migration sem backfill**, de propósito.
   - ✅ **RESPONDIDO (2026-08-14): o contador ESCOLHE numa lista oficial embarcada.** A tabela do
     IBGE passou a existir no projeto (`apps/web/src/lib/municipios/municipiosIbge.data.js`, 5.571
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
   Passou a exigir os percentuais informados; a estrutura carece de confirmação sem o XSD.
4. **`cLocPrestacao` diferente do emissor.** Decide para qual município o ISSQN é devido, e **não se
   deduz do endereço do tomador** (LC 116/2003, art. 3º: `caput` + lista fechada de exceções). Virou
   campo informável; ausente aplica a regra geral **e registra a suposição no log**.

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
  rejeição. **Pendente de confirmação do dono.**
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
`desfechoEmissao`, `emissaoDps`) + `validators/__tests__/nfsePayload`. Medir antes da migration:
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
- ⚠ **A ESCOLHA POR EMISSÃO AINDA NÃO CHEGA AO XML, e isso está DITO na tela.** `buildDpsXml`
  (`NfseService.js:540`) monta o `cTribNac` a partir de `company.codigoServicoNacional` e de mais
  nada; não há campo de serviço em `validators/nfsePayload.js`. O assistente **mostra** os
  pré-cadastrados com a descrição oficial e **diz qual vai** na nota; trocar é uma marcação no
  cadastro. Ligar a escolha por emissão = o campo no validador + uma linha em `buildDpsXml`.
  **`NfseService.js` está travado para outra sessão** — por isso a ponte, e não um seletor que
  parecesse funcionar e emitisse o outro código (erro fiscal silencioso).
- **Migration `20260816120000_add_codigos_servico_nacional` — escrita, NÃO APLICADA.** Aditiva
  (`TEXT[] NOT NULL DEFAULT '{}'`, espelhando `cnaesSecundarios`), com backfill do valor singular
  quando ele já tiver a forma. ⚠ **Sem CHECK, de propósito**: conferir cada elemento de um array
  exige `unnest`, que é subquery — e o Postgres a proíbe em CHECK; a alternativa
  (`array_to_string`) não é IMMUTABLE. Migration que falha é P3009 e servidor que não sobe. A forma
  é guardada no normalizador, no Zod e na tela. Medido: `codigoServicoNacional` está
  **vazio nas 33 empresas** (o campo só ganhou porta em 14/08/2026), então o UPDATE toca zero linhas
  hoje — ele existe para o intervalo entre escrever a migration e aplicá-la.

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

### ⚠ O QUE ESTÁ BLOQUEADO E POR QUÊ (nada disto é esquecimento)

1. **As descrições dos códigos não existem no repo.** Em doze campos a NT manda "utilizar a
   descrição das opções previstas no leiaute", e **o leiaute (XSD/Anexo I) não está versionado** —
   a mesma ausência de `dpsCodigos.js`. A NT dá só *exemplos*, sem dizer a qual número cada um
   corresponde. `danfseDescricoes.js` nasce vazio, imprime-se o **código cru** (conteúdo do XML,
   art. 13 respeitado) e a pendência sai em `conformidade.descricoesPendentes`.
2. **O DANFSe é v2.0 (multitributário) e o nosso XML é 1.01.** Um bloco inteiro (Tributação
   IBS/CBS), mais `finNFSe`, o bloco DESTINATÁRIO e três totais saem dos grupos `IBSCBS`, que **não
   existem no leiaute 1.01**. Pela nota 12 saem com traço; a lista está em
   `CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01` e no relatório (`camposSemFonte`).
3. **`prest/xNome` e `prest/end` costumam vir vazios.** A NT aponta NOME e ENDEREÇO do prestador
   para `DPS/infDPS/prest/`, mas numa NFS-e devolvida esses dados vivem em `infNFSe/emit`. **Não
   caímos para `emit` por conta própria** — seria criar regra de leiaute. Sai traço, com aviso.
4. **Município do prestador/tomador é CÓDIGO IBGE e a NT manda imprimir o nome.** A tabela do IBGE
   não está no projeto (mesma falta do `Company.codigoMunicipioIbge`). Imprime-se o código;
   `conformidade.municipiosNaoResolvidos` nomeia quais.
5. **Fontes Arial e Microsoft Sans Serif (§2.4) não estão embutidas.** Sem os `.ttf` o render cai
   em Helvetica **e reporta** — substituir por "parecida" em silêncio é o defeito.
6. **Logomarca oficial não versionada** (a NT dá a URL). Sai placeholder + aviso; desenhar algo
   parecido seria marca fabricada num documento fiscal.

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
`dfeLastSyncAt` em **toda** execução, com ou sem documento — lá `sinceLast` já é idade da tentativa.
Por isso o gate do DFe ficou como estava.

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

⚠ **Regime ausente ou desconhecido PASSA.** `mapRegime` (`apuracaoV2.js`) assume Simples por
default porque lá o default é inofensivo; copiá-lo aqui bloquearia trabalho legítimo de toda
empresa sem regime cadastrado. Nesta direção, bloquear por falta de dado é o erro caro — o oposto
da regra do front, onde ausência de regime vira o terceiro estado (`indefinida`) e não afirma nada.

A guarda vale **só para `EFD_CONTRIBUICOES`**: ECD e ECF têm outro rol de obrigados, e a dispensa
do Simples é específica desta obrigação.

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

**Efeito:** `getRequirements` (`guideCompliance.js`) deixa de exigir o DAS (decisão do dono: a tag
**some**, não fica amarela como o `VAZIO`). Pré-query simétrica à do `parcDasAtivoSet` — uma query
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

## Regras

- Nunca hardcodar credenciais ou URLs — usar `config.js`
- Toda rota nova de firma deve ficar em `routes/firm/`
- Isolamento multi-tenant é inegociável: sempre filtrar por `firmId`/`companyId`
- Não adicionar `console.log` de debug em produção — usar o logger existente
- Migrations novas devem ter nome descritivo em inglês (snake_case)
