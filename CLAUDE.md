# CLAUDE.md — Portal Contábil

Instruções e contexto para o Claude Code neste projeto.

## Visão Geral

Portal contábil full-stack multi-tenant para gestão de documentos fiscais brasileiros (NFe, NFS-e, guias).

**Dois perfis de uso:**
- **Escritório:** gerencia carteira de empresas clientes
- **Cliente:** gerencia seus próprios documentos fiscais

## Monorepo — Estrutura

```
apps/api/                 - Backend Node.js/Express (porta 3000)
apps/web/                 - Frontend React/Vite — portal do ESCRITÓRIO (paleta escura)
apps/portal-cliente-web/  - Frontend React/Vite — portal do CLIENTE (paleta clara, porta 5210)
apps/pdf-reader/          - Serviço Python/FastAPI de parsing de PDF (porta 8000)
packages/shared/          - `@contabilidade/shared`. Contratos/tipos + a LISTA DO IBGE
                            (`municipios-ibge`, 5.571 linhas), que era cópia nos dois portais
                            até 20/08/2026. ⚠ Consumida por `import()` DINÂMICO nos dois —
                            import estático jogaria ~197 KB no bundle inicial
```

Cada app tem seu próprio `CLAUDE.md` com regras específicas.

⚠ **`apps/web` e `apps/portal-cliente-web` são dois frontends separados, sem código compartilhado.**
Vários módulos de regra fiscal existem **em cópia** nos dois (valor da nota, consulta do tomador,
reaproveitamento, código de serviço).
⚠ A **tabela do IBGE** saiu dessa lista em 20/08/2026: o DADO virou arquivo único em
`@contabilidade/shared/municipios-ibge`. A REGRA (`lib/municipios/municipioIbge.js`) continua uma
por portal, de propósito — a do escritório carrega textos de cadastro que não são do cliente.

A tabela "mudou lá, muda aqui" está em `apps/portal-cliente-web/CLAUDE.md` — duas leituras da mesma coluna divergem na primeira correção, e
aí as duas telas afirmam coisas diferentes sobre a MESMA empresa.

## Tech Stack

| Camada     | Tecnologia                              |
|------------|-----------------------------------------|
| Backend    | Node.js 20, Express.js, Prisma, PostgreSQL |
| Frontend   | React 19, Vite, CSS custom properties (`styles/tokens.css`) + estilo inline. **Sem Tailwind** |
| Parser     | Python 3.12, FastAPI, pdfplumber        |
| Auth       | JWT + RBAC                              |
| Email      | Gmail API (delegação) / Nodemailer SMTP |
| Deploy     | Railway / DigitalOcean + Docker + GitHub Actions |

## RBAC

- **FIRM:** `ADMIN`, `ACCOUNTANT`, `STAFF`
- **CLIENT (por empresa, `CompanyClientUser.role`):** `OWNER`, `CLIENT_ADMIN`, `FINANCEIRO`
  (`CLIENT_USER` = legado, não ofertado no app do cliente). Pesos: FINANCEIRO=1 < CLIENT_ADMIN=2 < OWNER=3.
  - **Gestão de usuários** (convidar/editar/remover membros) = **OWNER apenas**; OWNER é protegido.
  - **Pró-labore / certificado A1 / sócios** = `CLIENT_ADMIN`+; **notas/guias/alíquota/fluxo** = qualquer membro ativo.

Rotas protegidas pelo middleware `requireRole` (escritório) e `requireClientCompanyAccess(minRole)`
(cliente, em `apps/api/src/middlewares/`). Nunca bypassar sem motivo explícito.

## Progresso e Histórico de Mudanças

### Em andamento (branch `dev`)

- [x] Módulo de lançamentos contábeis — base completa (plano de contas, OFX,
  export CSV, baixa de provisões, circular anual, históricos persistentes,
  funções de lançamento, parcelamentos)
- [x] **Módulo de Notas Fiscais (Q12)** — captura NF-e (SEFAZ DFe) + NFS-e (ADN
  Nacional gov.br) com cert A1 por empresa; manifestação destinatário; workers
  automáticos com rate limit; alertas de cursor desatualizado.
- [x] **Apuração Simples Nacional — refundação (Q14)** — cadastro = autoridade,
  classificação como sinal, motor de cálculo local, Fator-R mensal, filas de
  pendência. Models: CadastroFiscal, ProdutoServico, RegraClassificacao,
  CnaeAnexo, AliquotaSimplesNacional, ApuracaoSnapshot, etc.
- [~] **Apuração — fluxo de fechamento + SERPRO (Q15)** — tabela global com
  seleção múltipla; FechamentoModal (atividades, folha 12m, disparidade);
  **simulação oficial PGDAS-D (TRANSDECLARACAO11) validada em produção real**;
  fila de transmissão em lote (consulta-antes-de-transmitir).
  - Pendente: validar os demais `idAtividade` (só o 11 exercido); transmissão
    real (`indicadorTransmissao:true`) ainda não testada; ligar worker da fila.
  - Detalhes técnicos do PGDAS-D: ver `apps/api/CLAUDE.md`.
- [x] **Parcelamento real (Q16)** — 1 provisão (abertura) + linhas leves de parcela +
  baixa por pagamento; contas D/C em branco com memória por linha (igual Simples);
  envio em lote com 3 estados; selo de e-mail no dashboard.
- [~] **Fluxo mensal do contador (Q17)** — cron busca **extrato** (gera lançamentos) além
  das guias; guia **"Vazio"** (ausência confirmada → amarelo); **circular com trimestre/anual**
  por linha; **fechamento contábil do mês** (bloqueia se houver lançamento em branco/D≠C);
  dashboard filtra por competência (mês anterior) + pendências; card muda de cor quando
  fechada; aba **Lançamentos** vira a primeira. Cada bloco de arquitetura tem seu `CLAUDE.md`.
  - Pendente: aplicar a migração `add_fechamento_contabil` (requer o banco no ar).
- [x] **UI do dashboard + aba Lançamentos (Q18)** — dashboard: botões reordenados
  (Nova empresa · Envio de e-mails · Apuração · Configurações-dropdown), "Atualizar" vira
  ícone, filtros compactos, cards menos coloridos (tags só com borda), CNPJ branco, card
  teal quando fechada. Lançamentos: **adicionar inline** (DraftEntryRow, auto-reabre até
  ESC/Sair), **filtros compactos**, **cadeado** de fechamento perto da tabela, colunas
  **Tipo/Status removidas**, títulos centralizados/brancos, e **carga automática** ao
  abrir a aba/mudar competência (effect em `useManageAccountingWorkspace`).
  **Mês fechado bloqueia** novo lançamento e upload/registro de guia manual + marcar Vazio
  (helper `isMonthClosed`; back retorna 409/`MES_FECHADO`; front desabilita os botões).
  Aba **Apuração V2 removida** do header da empresa.
- [x] **Guias — barra de ações única (Q57)** — ao selecionar 1 guia: **Recalcular** (um botão,
  detecta INSS→DCTFweb / DAS→PGDAS-D), **Confirmar pagamento**, **Liberar ao cliente** (envia SÓ a
  guia por e-mail; se já enviada, modal de reenvio), **Excluir** (hard-delete já revoga). Removidos
  Reenviar/Revogar/Parcelamento solto/Recalcular INSS. Liberar por-guia: `POST /firm/guides/:id/liberar-cliente`
  (o empacotamento DAS+INSS fica só no envio em lote da página principal).
- [x] **Notas Fiscais — aba enxuta (Q58)** — 2 janelas: **NFS-e** (ADN + import XML) e **NF-e**
  (SEFAZ). Sem stats/legendas/rodapé; captura compacta.
  - ⚠⚠ **ESTE ITEM DIZIA "a de NF-e SÓ COM INSCRIÇÃO ESTADUAL" ATÉ 23/08/2026 — e era um DEFEITO,
    não um recurso.** Medido em produção: as **3 — e únicas — empresas com NF-e na base**
    (SINTROPIA 34, LENTE 11, ALBATROZ 2) **não têm IE**, porque as notas delas são **compras**, e
    **receber** NF-e não exige inscrição estadual (quem precisa de IE é quem EMITE). A única
    empresa com IE (VAGALO) tem **zero** NF-e. A janela aparecia exatamente para quem não tinha
    nota e sumia exatamente para quem tinha: **as 47 notas de compra capturadas eram invisíveis na
    interface.** É o MESMO raciocínio já escrito no `apps/api/CLAUDE.md` para o worker do DFe
    (*"NÃO filtre o worker por `inscricaoEstadual`"*) — a regra existia, a tela é que não a seguia.
  - ⚠⚠ **E havia um SEGUNDO defeito, que sozinho manteria a janela inútil:** o filtro de papel
    nasce em `EMIT` e trocar de janela mexia só no `type`. Como **as 47 NF-e são `papel: "DEST"`**,
    a janela de NF-e — mesmo visível — listava **zero linhas**. Consertar só o primeiro teria
    trocado uma janela invisível por uma janela vazia, que é pior: vazio parece resposta.
  - **As duas espécies continuam SEPARADAS, por decisão do dono (23/08/2026):** *"vou corrigir algo
    que disse: as notas de compra devem ser separadas das notas recebidas de serviço"* — corrigindo,
    no mesmo dia, o pedido anterior de juntá-las numa aba só. ⚠ O fundamento reforça a decisão:
    **NF-e tem item/NCM/CFOP/quantidade e NFS-e tem código de serviço e ISS**; a coluna comum é
    pouca (data, emitente, valor, situação), e lista única mostraria o menor denominador das duas.
  - **O "total de notas recebidas" que ele pediu** não exigia lista única: conta as duas espécies
    **separadas**, mostra a soma e **diz que a soma é de espécies diferentes** — número sem esse
    rótulo soma nota de mercadoria com nota de serviço, que vão para contas diferentes. Cada caixa
    de espécie é botão e abre a janela dela já em "Recebidas", que é como o número se confere
    contra as linhas.
    - ⚠⚠ **ISSO VIVIA NUM BLOCO PRÓPRIO (`RecebidasResumo`) E FOI ABSORVIDO PELO `NotasResumo` em
      23/08/2026** — o componente foi APAGADO, não deixado sem chamador. Dono, com a tela na frente:
      *"isso aqui tá horrível, esse notas recebidas em cima tem que ser absorvido para junto das
      outras caixas; pode aparecer recebidas, ao lado recebidas NF-e e recebidas NFS-e"*. Eram DUAS
      faixas empilhadas, e duas caixas diziam o MESMO número com nomes diferentes ("Valor recebido"
      em cima, "Recebidas" embaixo).
    - ⚠⚠ **E AS DUAS FAIXAS NÃO FALAVAM DA MESMA POPULAÇÃO** — é a armadilha da fusão, e ela é
      invisível hoje. São duas chamadas a `/notas/summary`: `summary` leva o `type` da janela
      (**uma** espécie) e `recebidas` leva `papel: "DEST"` **sem** `type` (**as duas**). As três
      caixas de recebidas saem TODAS da segunda. Alimentar "Recebidas" com a primeira mostraria
      metade — e ninguém veria enquanto a empresa não tivesse NF-e recebida.
    - ⚠ **"Recebidas" não é clicável**, e a ausência é o que a mantém honesta: o valor é das duas
      espécies e a tabela mostra uma. Quem quer a lista clica na espécie. A ação antiga (filtrar a
      janela por `papel: DEST`) não se perdeu — "Recebidas NFS-e" na janela de NFS-e faz o mesmo.
  - ⚠ Detalhes, medições e as armadilhas: **`apps/web/CLAUDE.md`**, seção "A ABA NOTAS FISCAIS ENXUGOU", mais o
    cabeçalho de `apps/web/src/features/notas/components/renderNotasFiscaisTab.jsx`.
    ⚠ Esta linha apontava para `apps/web/src/features/notas/CLAUDE.md` até 24/08/2026 — **arquivo
    que nunca existiu**. Os `CLAUDE.md` de feature deste app são quatro: `accounting`, `companies`,
    `guides` e `onboarding`.
- [~] **Robustez NFS-e/ADN (Q59)** — captura deve virar *fluxo de eventos por NSU*, não *snapshot por data*.
  Roadmap em **`docs/robustez-nfse-adn.md`**. **Fase 1** (ledger append-only `documentos`/`eventos` +
  `nsu_watermark`/`nsu_gaps` + projeção recalculável) codada e **verificada offline** — ainda NÃO ligada
  à captura (`PortalInvoice` intacto). **Camada 2** (conferência de contagem por chave vs ADN) **trava o
  fechamento** no "28 vs 27" (`ConferenciaAdnService`; `POST .../fechamento/:comp/conferencia`;
  `scripts/conferir-adn.mjs` roda em prod). Fase 0 (forense) superada pela detecção automática.
- [x] **Auditoria pré-apuração das notas** — sub-aba **Auditoria** (grupo Fiscal, **antes** de
  Apuração), consumindo os campos fiscais extraídos do XML. **TRÊS perguntas com nome próprio**,
  regra PURA em `apps/api/src/application/notas/auditoria/auditoriaNotas.js`, rota literal
  `GET /firm/companies/:id/notas/auditoria`, tela em `apps/web/src/features/notas/`.
  - ⚠⚠ **ESTE ITEM DIZIA "CINCO PERGUNTAS" ATÉ 21/08/2026.** A aba mostrava **~1.799 "pontos a
    conferir"**, dos quais **~18** eram perguntas de verdade — e uma lista em que 99% é ruído treina
    o contador a não ler a lista, afogando a única que entregava (o ISS zerado). **O dono aprovou o
    corte.** O que a aba responde hoje: *atividade fora do cadastro* · *emissão DOIS ou mais meses
    distante da competência* · *ISS zerado onde a atividade tributa*, mais **pendências
    pós-fechamento** ("entrou nota depois que eu fechei o mês?") e as **notas sem competência**.
  - ⚠⚠ **A pergunta da NUMERAÇÃO DA DPS foi REMOVIDA — era falso positivo, provado na fonte.** A
    regra **E0014** (`ANEXO_I`, aba `RN DPS_NFS-e`, **linha 148**) define a unicidade da DPS por
    **QUATRO** componentes (Série + Número + Município Emissor + CNPJ/CPF) e a aba comparava **dois**;
    e nas **653 regras do `ANEXO_I` não existe nenhuma de numeração CONTÍNUA da DPS** — o único campo
    com regra de sequência é o `nNFSe`, gerado pela Receita. Medido: 0 repetidos e **54 "buracos"**,
    em boa parte **fabricados por nós** (a consulta perdia a nota sem competência; a captura do ADN
    pulou documentos). **Não reintroduzir sem norma** — o argumento está no código e travado por teste.
  - ⚠ **A pergunta 5 (nota que não pôde ser lida) saiu da TELA**, não do sistema: é manutenção do
    nosso extrator, não pergunta de contador. Continua calculada, em `auditoria.manutencao`.
  - ⚠ **CADA ACHADO É UMA PERGUNTA, NUNCA UM VEREDITO** — a tela diz "esta nota usa um código que
    não está no cadastro da empresa", não "nota errada". Quem julga é o contador, e a frase está
    **na tela**, não num comentário.
  - ⚠ **ZERO ACHADOS ≠ "NÃO DÁ PARA CONFERIR"**, com desenhos diferentes. Empresa sem código de
    serviço cadastrado responde *"cadastre os códigos"* — **não** "todas as notas erradas". Medido:
    33 de 33 empresas nesse estado hoje.
  - ⚠ **NADA SOME EM SILÊNCIO, e isso deixou de ser só promessa.** As 1.727 divergências de UM mês
    (a virada normal) viraram **uma contagem visível**, não silêncio; e a nota com `competencia`
    NULA — que a consulta perdia antes de a regra existir, sem aparecer nem em "notas fora desta
    conferência" — passou a ter bloco próprio, com o motivo. Ela **não** é atribuída a um mês:
    inventar a competência dela seria inventar em qual apuração a receita entra.
  - ⚠ **A AUDITORIA NÃO ESCREVE NADA** e não faz chamada externa — provado por teste. Vale para o
    bloco novo de pendências: ela **lista**, e não oferece "Reabrir competência" nem "Ignorar".
  - Detalhes, o corte com a fonte e os números de produção: `apps/api/CLAUDE.md`, seção "AUDITORIA
    PRÉ-APURAÇÃO". Medição: `apps/api/scripts/diag-auditoria-notas.mjs` (só leitura).
- [x] **Apuração dentro da empresa (Q60)** — aba Fiscal "Cadastro" → **"Apuração"**: faturamento +
  prévia (reusa `FechamentoModal`) + **extrato do Simples** (`syncPgdasCircular`) + fechar/transmitir/retificar
  por dentro da empresa. Cadastro enxuto (só regime + atividades permitidas). Tela de lote global vira
  **select-only** (só seleciona fechadas + apura em lote; o filtro `estado="fechada"` já é server-side).
- [x] **Reorganização do dashboard + fluxo fiscal (Lote C)** — ⚠⚠ **as "duas visões (Cards ⇄ Ano)"
  deste item DEIXARAM DE EXISTIR em 01/09/2026** (dono: *"retirar totalmente a visualização em
  Cards, colocar a visualização de Ano dentro do Calendário, e sempre que abrir abre no Calendário,
  sendo o modo Tabela selecionável"*). Hoje a carteira tem **Calendário** (padrão, sem memória) e
  **Tabela**; a grade anual continua existindo, como **granularidade dentro do Calendário** — mesma
  grade 12 meses × empresas, mesmo fechamento contábil + apuração por célula, mesmo clique abrindo
  a empresa naquela competência. Ver `apps/web/src/features/companies/CLAUDE.md`, seção
  "Dashboard — DUAS visões". O resto do item vale: **filtros recolhidos** (só busca + competência aparentes,
  com setas ‹ ›); **card redesenhado** (regime·SERPRO·A1 no mesmo design; tags de guia dão lugar a
  "Enviado" quando todas enviadas; ⚠ pendência fiscal; selo PARC); **selo de processos em segundo
  plano**. "Funções em lote" virou **Consultas** e absorveu **Pendências** (aba "Situação Fiscal").
  Abas fiscais da empresa reordenadas (Notas Fiscais → Apuração → Guias → Situação Fiscal), **LP
  sem aba Apuração** (ainda não apuramos Presumido), módulo fiscal centralizado, **resumo na aba
  Notas Fiscais**. Fiscal: guia do LP mostra os tributos (PIS/COFINS) em vez de "OUTRA";
  **transmitir já devolve extrato + guia**; SITFIS mostra o relatório salvo ao abrir e reconsulta
  só pelo botão, **1× a cada 4h**.
  - ⚠ **Exige Volume no Railway em `/app/storage`** — sem ele o filesystem é efêmero e **todo
    deploy apaga os PDFs** (guias e relatórios SITFIS). Ver `apps/api/CLAUDE.md`.
- [~] **PLANO MESTRE — entregas 1 a 8** (Bloco 8/chat é de outro agente; **Entrega 7,
  Departamento Pessoal, deixada de lado a pedido do dono**).
  - **Competência global da empresa** (`lib/competencia.js` + `CompetenciaSwitcher` no header):
    Lançamentos, Circular, Cadastro Fiscal, Guias e Notas Fiscais passaram a ler a MESMA
    competência. Antes eram duas, com defaults diferentes, discordando em silêncio.
  - **Regras de tela viraram lib com teste próprio:** `circular/lib/estadoGuia.js` (12),
    `obrigacoes/lib/cicloObrigacao.js` (15), `relatorios/lib/periodoRelatorio.js` (18),
    `notas/lib/cicloNotaTela.js` (14).
    - ⚠ **O detalhe da nota agora conta a SUBSTITUIÇÃO** (caso relatado pelo dono: *"cancelamos
      essa nota, emitimos outra e depois a substituímos"*; 22 notas com `chaveSubstituida` na
      base). O `NotaDetailModal` não lia `ciclo`/`eventos`/`chaveSubstituida`: a lista dizia
      "substituída" em âmbar e o detalhe da MESMA nota dizia "cancelada" em vermelho. A leitura
      agora é **uma só** (`notas/lib/cicloNotaTela.js`), consumida pelas duas telas; a REGRA
      continua no backend (`application/notas/cicloNota.js`, intocado). O bloco mostra os dois
      lados do vínculo (`chaveSubstituida` × `PortalInvoiceEvent.chaveSubstituta`), com motivo,
      data, eventos e **navegação** para a nota do outro lado — e, quando ela não está na base,
      diz isso em vez de sumir com o vínculo. O mapa de cor `statusEfetivo === "substituida"` do
      modal era **morto** (esse campo só vale `autorizada`/`cancelada`) e hoje é alimentado por
      `ciclo.situacao`.
  - **Espelho da DEFIS** (`obrigacoes/defis/`) — a especificação de campos como DADO
    (`defisSpec.js`, `DEFIS_FONTE.verificadoNoPortal: false`). **Não transmite**: a DEFIS é
    transmitida no portal, e `marcarDefisTransmitida` só registra o recibo do nosso lado.
    ⚠ `PERGUNTAS_MUNICIPIO` está **deliberadamente vazio** — o manual não traz lista fechada.
    - ⚠ **Quem NÃO é optante pelo Simples Nacional não entrega DEFIS.** A tela não perguntava o
      regime — oferecia o espelho a toda empresa, inclusive às do Lucro Presumido (defeito relatado
      pelo dono). A regra vive em `defis/lib/obrigatoriedadeDefis.js` (24 testes) e tem **três**
      respostas: `obrigada`, `dispensada` e **`indefinida`** — sem regime cadastrado não se afirma
      nem uma coisa nem outra. Mesma forma da `obrigatoriedadeEfd.js`, com o **sinal invertido**.
      - ⚠ **QUEM NÃO DEVE A DEFIS NÃO VÊ NADA SOBRE DEFIS — decisão do dono, 15/08/2026**, com a
        tela na frente dele: *"empresas do Presumido que não têm DEFIS estão aparecendo uma legenda
        explicando que elas não têm, isso é horrível, é apenas tirar isso de lá"*.
        **Isto REVERTE o desenho anterior**, que era o oposto e está registrado aqui porque o
        argumento continua valendo para a EFD (abaixo): a dispensa **aparecia com o motivo e a
        norma** (`DefisNaoDevida.jsx`) no lugar do fluxo, para que não sumisse da tela quem não deve
        nada — senão ninguém sabe se foi dispensa ou esquecimento. O que virou: no Lucro Presumido a
        dispensa é a **regra**, não a exceção, e um parágrafo fixo repetido em toda empresa
        não-optante é ruído, não informação.
        ⚠ **A REGRA NÃO SAIU** — `obrigatoriedadeDefis.js` (e seus 24 testes) segue intacta e segue
        decidindo. O ramo `dispensada`/`indefinida` continua **não oferecendo o fluxo**; só ficou
        **silencioso**. Trocar o `&&` de `defisDevida` em `renderCompanyDetailPage.jsx` por um
        render incondicional devolveria o espelho da DEFIS ao Presumido, que é o defeito fiscal que
        a regra existe para impedir.
        ⚠ Efeito colateral: `DefisNaoDevida.jsx` (e seu teste) ficou **sem consumidor**. Não foi
        apagado — apagar componente é decisão à parte.
    - ⚠ **A resposta é sobre o ANO-CALENDÁRIO, não sobre "hoje".** Empresa excluída do Simples
      continua devendo a DEFIS do ano em que foi optante ("em relação ao ano-calendário de exclusão
      (…) a DEFIS abrangerá o período em que esteve na condição de optante" — manual, item 9.2.2), e
      o sistema guarda só o regime atual. Por isso as hipóteses que derrubam a dispensa viajam
      NOMEADAS junto dela, em `obrigatoriedadesNaoAvaliadas`.
      - ⚠ **A SAÍDA "abrir o espelho mesmo assim" SAIU DA TELA junto com a legenda (15/08/2026).**
        Ela morava dentro de `DefisNaoDevida`, colada às hipóteses que a justificavam; tirado o
        painel, não há mais como abrir o espelho de uma empresa não-optante pela interface. As
        hipóteses continuam sendo devolvidas pela regra — o que não existe é consumidor delas.
        Se o caso do ano de exclusão aparecer de verdade, é assunto a levar ao dono, não a
        reintroduzir por conta própria: foi ele quem pediu o silêncio.
    - **Fonte conferida no documento oficial** (não copiada de terceiros): Manual do PGDAS-D e DEFIS
      (RFB), seção 9 — "deve ser prestada por contribuinte optante do Simples Nacional por pelo menos
      um período nela abrangido" (LC 123/2006, art. 25, caput); prazo e situação especial no item
      9.1.2, citando a **Res. CGSN 140/2018, art. 72, §§ 1º e 2º** — ou seja, o art. 72 É o
      dispositivo da DEFIS. Medido em produção (12/08/2026): 33 empresas (22 Simples, 11 Presumido) e
      **zero** espelhos gravados — o conserto é preventivo, não houve dado a preservar nem a apagar.
      Script de leitura: `apps/api/scripts/diag-defis-por-regime.mjs`.
  - **Relatórios** (sub-aba de Contabilidade) — intervalo PRÓPRIO, a única exceção à competência
    global. ⚠ **Balanço e balancete não aparecem nem desabilitados**: exigem saldo por conta com
    classificação patrimonial, e entregar isso a partir de lançamentos seria um demonstrativo com
    NOME DE PEÇA CONTÁBIL. Período anterior tem o **mesmo tamanho**; base zero **não vira
    percentual**; mês sem lançamento entra na série **com zero**, visualmente distinto.
  - **Planejamento tributário** (`features/planejamento/`) — motor local com as tabelas em
    `tabelasFiscais.js`, cada valor citando a lei; ⚠ **356 testes na feature** (a linha dizia 95 até
    01/09/2026), dos quais **32** são **casos dourados
    calculados à mão**. ⚠ A **recusa de calcular tem o mesmo peso visual do resultado**
    (`CardRegime.jsx`): número ausente diagramado em cinza vira ausência de dúvida. O PDF sai com
    a **data de vigência das tabelas e os avisos de escopo impressos**, porque circula sozinho.
    Início de atividade coberto — RBT12 proporcionalizado e **guarda do limite proporcional** de
    enquadramento (estouro pode excluir a empresa retroativamente): `docs/fontes-fiscais.md`
    §1.12 e §1.13.
    - **MODO CARTEIRA LIGADO (16/08/2026).** O efeito de pré-preenchimento já existia na página e
      **ninguém nunca passava a empresa** — o `App.jsx` renderizava `<PlanejamentoPage />` sem prop.
      Hoje há **seletor de empresa dentro da página** (a simulação livre continua sendo o estado
      inicial, de propósito) alimentado por `companiesState.companies` (`GET /firm/companies`, já
      escopado pela carteira); o backend reconfere o id com `requireFirmCompanyAccess`. Fonte dos
      campos: `application/planejamento/DadosPlanejamentoService.js` +
      `GET /firm/companies/:id/planejamento` — **só leitura, não grava nem cache** (por isso NÃO usa
      `RbtExtratoService.getRbt12`, que faz `upsertCache` no fallback).
    - ⚠⚠ **FOLHA AUSENTE NÃO É ZERO, e isso virou regra do motor.** `fatorR(null, rbt)` devolve
      `null` (era `0`, porque `Number(null) || 0`), `anexoPorFatorR` deixa de responder **"V"**, e
      `compararRegimes` devolve o Simples **`indisponivel`** quando a atividade é de Fator R e a
      folha não foi informada. Antes o caminho era silencioso e caro: Fator R 0% → Anexo V (a
      alíquota maior) → um vencedor eleito sobre um número que ninguém digitou, num PDF que vai ao
      cliente. Folha **zero informada** continua calculando — a distinção é `null` × `0`.
      Travado em `lib/__tests__/folhaAusenteNaoEZero.test.js` (11).
      - O zero não é hipotético: `CalculoFiscal.calcularApuracaoParaCompetencia` grava
        `fs12Manual: fs12` com `fs12 = … : 0`. Há **zeros fabricados no banco**, e por isso
        `campoComOrigem.valorMonetario` trata `0` como NÃO APURADO em toda base monetária.
      - Par disso: CPP que depende da folha (Anexo IV, Presumido, Real) **não vira zero por
        ausência** — sai da soma e vai declarada em `naoConsiderado`, no corpo do card.
    - **Cada campo mostra a ORIGEM, e ela sai IMPRESSA.** `lib/prefillDaEmpresa.js` traduz o payload
      em valores + procedência, com quatro estados (`da_empresa` · `digitado` (por cima, mostrando
      os dois) · `informado` · `ausente` com motivo). O PDF ganhou a tabela "Procedência dos dados
      usados nesta simulação" — dois PDFs da mesma empresa com números diferentes precisam se
      distinguir **no papel**.
    - ⚠ **A atividade do Lucro Presumido NÃO é derivada do CNAE, de propósito**: o projeto não tem
      de-para CNAE→presunção de IRPJ/CSLL (o `CnaeAnexo` mapeia para ANEXO DO SIMPLES, outra lei), e
      errar entre 8% e 32% inverteria a comparação. Sai ausente, com o motivo. **Pendente do dono.**
    - ⚠ **Regime atual sem default.** `apuracaoV2.mapRegime` e `PerfilFiscalService` terminam em
      `return "SIMPLES_NACIONAL"`; aqui texto irreconhecível devolve `null` e a tela diz que não
      sabe — o comparativo inteiro se lê a partir do "hoje você está no X".
    - ✅ **CONSERTOS DE TELA (01/09/2026)** — o dono avaliou como *"bem podre (…) está tudo muito
      bugado"*, e os quatro defeitos foram MEDIDOS no navegador antes de mexer:
      · **A RESPOSTA VINHA DEPOIS DE MIL PIXELS DE FORMULÁRIO** (página 2.806px, formulário até
      1.025px, primeiro resultado só aos 1.055px). O bloco de resultado subiu; hoje ele aparece aos
      **298px**. ⚠ Nenhum campo sumiu — o formulário desceu, não encolheu.
      · **10 campos, 10 SEM `id`**, e o `OrigemDoCampo` renderizava DENTRO do `<label>`: o nome
      acessível da receita era literalmente *"Receita anual (R$)da empresa · notas fiscais emitidas
      e autorizadas de 09/2025 a 08/2026…"*, e MUDAVA com o dado da empresa. Hoje há um componente
      `Campo` (rótulo com `htmlFor`, controle com `id`, descrição por **`aria-describedby`**).
      ⚠ A procedência não sumiu — mudou de canal.
      · ⚠⚠ **A IMPRESSÃO PERDIA O DETALHAMENTO POR TRIBUTO.** Ele é render CONDICIONAL do React
      (`{aberto && …}`), não `<details>` — **nenhuma regra de CSS salva**, o conteúdo não está no
      DOM. O efeito de impressão passou a ABRIR os cards antes do `print()` e a RESTAURAR depois,
      no molde do `imprimirListagem` da carteira.
      · ⚠ **A barra do Gauge saía VAZIA no papel**: ela é `background`, e o navegador descarta cor
      de fundo ao imprimir. Ganhou `print-color-adjust: exact`, como a `LogoAltan tom="papel"`.
      Travado em `hierarquiaEAcessibilidade.test.jsx` (8). Experimentos: devolvendo a procedência ao
      rótulo, 1 vermelho; tirando a abertura dos cards, 2.
    - **IBS/CBS: não construído, e a porta ficou aberta** — `tabelasFiscais.js` + um `custoAnual*`
      novo em `comparador.js` é tudo que o desenho pede. Ver o relatório da entrega; nada de
      alíquota/base/transição foi escrito (LC 214/2025 em transição).
  - **EFD-Contribuições / entrega por arquivo** (`obrigacoes/entregas/`, modelo genérico
    `EntregaObrigacaoArquivo`) — o **rastro** em três passos, com o "onde acontece" no rótulo de
    cada um. Serve também a ECD/ECF (`competencia` aceita "YYYY-MM" e "YYYY").
    - ⚠ **Optante do Simples Nacional NÃO entrega** (IN RFB 1.252/2012; Guia Prático v1.35, Cap. I,
      Seção 3). A regra vive em `entregas/lib/obrigatoriedadeEfd.js` (19 testes) e tem **três**
      respostas: `obrigada`, `dispensada` e **`indefinida`** — sem regime cadastrado não se afirma
      nem uma coisa nem outra. A tela mostra a dispensa **com a norma citada** no lugar do fluxo;
      isso não é o mesmo que sumir, e a distinção é o ponto: some da tela quem não deve nada, e aí
      ninguém sabe se foi dispensa ou esquecimento.
    - ⚠ Dispensas que dependem de dado que não temos (imunidade com contribuições ≤ R$ 10 mil, mês
      sem receita, inatividade) **não são aplicadas** — viajam nomeadas junto da obrigação.
      Dezembro traz aviso próprio: consolida no registro **0120** os meses dispensados do ano.
    - ⚠ **Ainda não gera o arquivo.** O leiaute oficial (Guia Prático v1.35) está versionado em
      `docs/leiaute-efd-contribuicoes/` com hash.
      ⚠⚠ **ESTA LINHA DIZIA "faltam as tabelas 4.3.x" E ERA FALSA.** Medido em 28/08/2026:
      `docs/leiaute-efd-contribuicoes/tabelas/tabelas-2026-08-07.json` traz **74 tabelas e 21.955
      linhas**, baixadas em 07/08/2026 da consulta oficial do SPED — o postback ASP.NET foi vencido.
      ⚠ **Duas** pedidas voltaram recusadas NA ORIGEM (*"A versão da tabela 211 não possui
      estrutura"*), e elas estão nomeadas no próprio manifesto, em `recusadas`.
      **O que falta é CONSUMIDOR, não tabela** — nenhum código as lê. O gate de aceite nº 1,
      **validar no PVA**, continua não sendo executável neste ambiente. Ler o README de lá antes de
      retomar.
    - **Não transmite**, e o motivo é outro: validação/assinatura/transmissão são do PVA, sem API —
      esse limite não muda nem com o gerador pronto.
  - **Não construído, e por quê:** NFS-e recorrentes (sem model/scheduler); motivo de rejeição da
    NFS-e na lista (`ServiceInvoice` não tem o campo); chip anual da DEFIS na listagem principal
    (falta agregação no backend); Bloco 3 (Apuração do Lucro Presumido) segue travado no probe do
    `CONSDECCOMPLETA33`.
- [~] **WhatsApp — Entrega 2: canal ligável, guias na tela, assistente com IA, conversas
  (02–03/09/2026)** — a Meta aprovou a empresa e o template de guia; o dono pediu o canal
  *"inclusive com uso de IA, resposta de documentos, emissão de notas, recálculo"*. Escrito na `dev`
  em F0–F5, **tudo DESLIGADO por flag** (`INTEGRACAO_WHATSAPP` e `INTEGRACAO_WHATSAPP_IA` OFF,
  `IA_EMPRESAS_PILOTO` vazio = ninguém). Detalhes, medições de produção e o que NÃO está verificado:
  `apps/api/CLAUDE.md`, seção "WHATSAPP — ENTREGA 2".
  - ⚠⚠ **A LINHA ABAIXO (Entrega 1) ENVELHECEU:** "F3–F6 não iniciadas" era falso já em 02/09 —
    Cloud API, webhook, envio em lote e recebimento existiam, testados e inertes; e as migrations
    `20260814160000`/`20260814180000` **estão aplicadas** em produção (145/145 medido).
  - **Telas** (`apps/web`): contatos com opt-in na aba Credenciais; "Liberar ao cliente" e o lote
    respeitam `canalPadraoEnvio` (EMAIL · WHATSAPP · PERGUNTAR) com prévia e motivos; página
    **WhatsApp** (`/whatsapp`) com a fila de números sem cadastro, o fio com autor por balão,
    Assumir/Devolver, responder só dentro da janela de 24h e Vincular.
  - **IA** (Anthropic, `claude-opus-5`): o cliente pergunta, o assistente responde **só com o que as
    ferramentas devolvem**; emitir/cancelar/recalcular viram **pendência com código de 4
    caracteres** e a confirmação nem passa pelo modelo. Custo registrado em `chamadas_ia`, teto
    **falha fechado**.
  - ⚠ Três migrations novas (`20260903100000/100/200`) **escritas e não aplicadas**; a
    `@anthropic-ai/sdk` entrou no `package.json` da api.
- [~] **WhatsApp — Entrega 1: envio de guias pelo canal** — **F1 a F5 escritas na `dev`, o canal
  DESLIGADO** (flag `INTEGRACAO_WHATSAPP` OFF; cadastro na Meta em verificação). Roadmap e estado
  completo em **`docs/whatsapp-entrega-1.md`**.
  - ⚠ **NADA SAI E NADA ENTRA HOJE, e isso é por construção, não por acaso:** com a flag OFF o
    cliente da Cloud API **recusa operar** e o webhook responde 503 nos dois verbos, mesmo com
    assinatura válida; e **nenhum template foi submetido à Meta** (`TemplateWhatsapp.statusAprovacao`
    nasce `DECLARADO`, nunca `APROVADO`), então o envio recusa por `TEMPLATE_NAO_APROVADO`. Ligar o
    canal é decisão do dono em **dado e variável de ambiente**, não em código.
  - **F1 e F2 prontas na `dev`** e seguras para subir junto de qualquer outra entrega: F1 é inerte
    (tabelas e rotas que ninguém chama ainda) e F2 preserva o comportamento (`foiEnviadaComLegado`).
  - ⚠ **O esqueleto que o dono trouxe (`whatsapp-module.zip`) foi CONFERIDO CONTRA O PROJETO, não
    copiado** — instrução dele: *"sempre verifique essas coisas, quem fez o plano não viu o
    projeto"*. Duas das seis tabelas dele já existiam aqui (`contato_whatsapp` = `contatos_whatsapp`;
    `evento_envio_guia` = `envios_guia`, e a `UNIQUE (guia_id, canal)` dele **brigaria com o
    retry**); ele mandava rodar `psql -f` num projeto gerido por **Prisma**; não tratava
    **ambiguidade** de número; e traduzia o erro `130472` com o texto documentado do `131050`.
    Cada decisão do código carrega a procedência: **fonte oficial** (URL + data) × **esqueleto** ×
    **código existente**.
  - **F2 é a mudança estrutural:** `Guide.emailStatus` deixou de ser o estado de envio. Quem
    responde "esta guia foi enviada?" agora é **`envios_guia`** (um registro por guia × canal) — um
    campo só não representa "enviada por WhatsApp e ainda não por e-mail". Enviada = terminal em
    QUALQUER canal.
  - ⚠ **NÃO RODE `scripts/backfill-envio-guia.mjs`. A F5 EXISTIR NÃO O LIBEROU — pelo contrário.**
    Esta linha já mandou o oposto duas vezes; seguir a instrução antiga quebra o dashboard de forma
    permanente. O que muda o estado do mundo não é a F5 ter sido escrita, é ela **gravar** — e hoje
    ela não grava (flag `INTEGRACAO_WHATSAPP` OFF, e `envios_guia` medida em produção: **0
    registros**, com o legado respondendo por todo mundo).
    - **O mecanismo:** `foiEnviadaComLegado` desliga a tolerância na **primeira linha que existir**
      (`if (envios && envios.length)`), **por guia**. O backfill converte **todos** os estados de
      uma vez (`PENDING`/`ERROR` viram `pendente`/`falhou`), então toda guia pendente naquele
      instante ficaria `enviada: false` **para sempre**: card eternamente aberto, "✓ Guias
      concluídas" que nunca condensa — com a aba Guias mostrando "✓ enviado" ao lado.
    - ⚠ **A F5 fecha essa porta pelo lado dela, e é por isso que ela não precisa do backfill:**
      antes de gravar a linha de WhatsApp, `materializarEnvioDeEmailLegado` cria a linha
      `EMAIL/enviado` da guia que o `emailStatus: SENT` já prova entregue. **Só `SENT` vira linha** —
      estado que não seja `SENT` não gera nada, porque a resposta do legado para ele já era "não
      enviada" e não há histórico a inventar. É exatamente a diferença para o backfill.
      Invariante travada em `guides/__tests__/complianceAposEnvioWhatsapp.test.js` sobre as 10
      combinações de (`emailStatus` × desfecho): **tocar uma guia nunca rebaixa o
      `guideCompliance`**. Desligando `linhaLegadoDoEmail`, 5 vermelhos.
    - O backfill só voltaria a fazer sentido para converter histórico em massa — e aí a conversão
      de `PENDING`/`ERROR` continua sendo o defeito. **Trate-o como script morto.**
  - **F1.5 — o VÍNCULO número → empresa (→ pessoa)**, feito **antes** da retomada porque é o pedaço
    que, deixado para depois, contamina todo o resto. Regra **pura** em
    `application/whatsapp/vinculoTelefone.js` (33 testes ao todo, com a ligação); a ligação com o banco em
    `ContatoWhatsappService.resolverVinculoPorTelefone`. **Reusou a tabela da F1** — a única coluna
    nova é `contatos_whatsapp.userId` (migration `20260814160000`, aditiva/nullable, ⚠ **NÃO
    APLICADA**). Quatro respostas com nome próprio: `TELEFONE_INVALIDO` · **`DESCONHECIDO`** (número
    não cadastrado **não vira empresa nenhuma** — nada de casar por CNPJ, nome, semelhança ou DDD) ·
    **`AMBIGUO`** (o sócio com três CNPJs; ambiguidade de `EMPRESA` **e** de `PESSOA`) ·
    `VINCULADO`.
    - ⚠ **Vínculo não é autorização.** O módulo devolve `papelRbac` (lido de
      `CompanyClientUser.role`) e para aí — sem peso, sem `podeEmitir`. Quem decide continua sendo
      `requireClientCompanyAccess(minRole)`. O campo `papel` do cadastro é **rótulo de tela** e sobe
      como `rotulo`.
    - ⚠ **O NÚMERO É O DO CADASTRO — decisão do dono, 14/08/2026:** *"os números são sempre com um
      nove na frente a partir de agora, mas você nunca deve pressupor o número, o número de
      comunicação com o cliente será o do cadastro"*. A comparação é **dígito a dígito** com
      `contatos_whatsapp`. `variantesE164` acrescenta o 9 a qualquer número de 8 dígitos, **inclusive
      a um fixo** (`552133334444` → `5521933334444`, que pode ser o celular de outra empresa) —
      casar por aí é pressupor o número, e a consequência é emitir no CNPJ de outro.
      - ⚠ **A tolerância NÃO é parâmetro** — `opcoes.tolerancia` foi **retirada da assinatura**.
        Enquanto existia, bastava um chamador futuro passar `NONO_DIGITO` para violar a regra em
        silêncio, sem saber que havia regra. A leitura tolerante continua **calculada**, mas só
        alimenta `divergemPeloNonoDigito` e `leituras[NONO_DIGITO]`; **não há caminho para ela virar
        a resposta**. Experimento (executado): trocando a resposta para a leitura tolerante, o
        contrato fica **5 vermelhos**; restaurado, 55 verdes.
      - ⚠ **O sinal mudou de significado**: `divergemPeloNonoDigito` não é mais "talvez devêssemos
        tolerar", é **"este cadastro está no formato antigo — conserte o CADASTRO"**. A query segue
        pescando as duas formas de propósito: fosse ela a estreitar, o aviso nunca poderia acender.
      - ⚠ **`acharContatoPorWaId` também era tolerante** e foi para o mesmo critério. Ela ainda era
        pior que a tolerância: um `findFirst` sem `orderBy` e sem escopo escolhia **um** contato
        entre os que casassem — possivelmente de outra empresa — como se não houvesse dúvida. Quem
        responde "de quem é esta mensagem?" é `resolverVinculoPorTelefone`.
      - Medido em produção (14/08/2026): **`contatos_whatsapp` tem 0 registros** — a F1 subiu sem
        tela e ninguém nunca cadastrou um número, então não há dado retroativo no formato antigo.
        `scripts/diag-vinculo-whatsapp.mjs` (só leitura) mede quando houver; hoje ele **para antes**,
        porque a migration `20260814160000` não foi aplicada.
    - ⚠ **Dois furos de multi-tenancy da F1 fechados de passagem**: `salvarContato({id})` e
      `removerContato` escolhiam o alvo **só pelo id** (contato de outra empresa caía dentro do
      acesso do chamador), e o `POST` fazia `{portalClientId: path, ...body}` — corpo sobrescrevendo
      o path. Hoje `portalClientId` viaja no `where` das duas e o spread vem antes.
      `removerContato` mudou de assinatura: `(portalClientId, id)`.
    - ⚠ **A F1 subiu sem tela nenhuma** — não há um chamador de `/contatos-whatsapp` em `apps/web`.
      Hoje o vínculo só é criável pela API. Detalhes em `docs/whatsapp-entrega-1.md`.
  - F3–F6 (Cloud API, webhook, envio em lote, recebimento) **não iniciadas**: dependem de
    credenciais reais. Escrevê-las sem poder exercê-las é o que a regra 1 proíbe — e o
    `CONSDECCOMPLETA33` do LP está OFF até hoje por exatamente isso.
- [~] **Onboarding de clientes — Fase 1 (lado do escritório)** — funil PRÉ-cadastro com tabela
  própria (`onboardings` + `onboarding_etapas`), que **aceita preenchimento parcial**, tem trilha de
  etapas por origem (`ABERTURA | TRANSFERENCIA | INATIVA`) e termina chamando o **mesmo**
  provisionamento do botão "Nova empresa". Detalhes e armadilhas em
  **`apps/web/src/features/onboarding/CLAUDE.md`**.
  - **Fase 0 (refator) veio primeiro e é o que sustenta o resto:** teste de caracterização de
    `POST /firm/companies` (a rota mais crítica do sistema **não tinha nenhum teste**), depois
    `getGlobalChartStatus` → `application/accounting/globalChartStatus.js`, depois a extração de
    `CompanyProvisioningService`. O teste roda **sem edição** contra o código extraído.
  - **Mudança de comportamento da rota antiga:** o pós-criação agora semeia as `CompanyRotina` da
    empresa nova. Antes elas só nasciam quando alguém abria a página Rotinas e o seed rodava.
  - **Fase 2 (link público com token de uso único) NÃO foi feita** — e não é reuso: o único token
    opaco do projeto não tem campo de consumo, então uso único exige modelo novo.
  - ⚠ **Migração `20260809120000_add_onboarding` escrita mas NUNCA APLICADA** — não há banco
    alcançável nesta máquina. Rodar `prisma:migrate:deploy` + `:status` antes de usar.
- [~] **Portal do CLIENTE na web (`apps/portal-cliente-web`)** — app novo (18–21/08/2026): login,
  casca, Painel, Notas, Guias, **Situação fiscal** e **emissão de NFS-e pelo cliente**. React 19 +
  Vite, **sem router** (hash, 4 destinos) e sem lib de estado; paleta CLARA própria;
  **807 testes / 44 suítes**.
  - ⚠ **A navegação é BARRA LATERAL DE ÍCONES** desde 21/08/2026 (SVG inline, `aria-hidden`, com o
    rótulo em `.sr-only` — o ícone nunca é a única marca do destino).
  - ⚠⚠ **A TELA INÍCIO FOI REFEITA DE NOVO EM 29/08/2026 (v4) — e a v3, de ONTEM, já é história.**
    Hoje o padrão é **dois meses LADO A LADO, dia a dia**; as setas andam **um mês**; a tabela de
    meses virou o **Horizonte**, transposta (categoria em linha, mês em coluna, nome do mês
    embaixo); a entrada da nota cai no **dia 1** do mês seguinte, promovida a FATO pela **apuração**;
    e o **cliente acrescenta saídas** ao próprio fluxo (avulsa com data ou recorrente com ciclo),
    que aparecem para o contador na Conferência. ⚠ Os três cards do topo passaram a falar todos do
    **mês seguinte**, com o rótulo dizendo qual é — conserto de defeito relatado. Ver
    `apps/portal-cliente-web/CLAUDE.md`, seção "A TELA INÍCIO v4".
  - ⚠⚠ **A TELA INÍCIO FOI REFEITA EM 28/08/2026 (v3, Fase 1)**, e a partir dela manda a
    **`CONSTITUICAO-do-produto.md`** — *"este documento manda em todos os outros"*. Hoje são: pop-up
    de guias em atraso · 3 cards (Receita · Imposto líquido · Resultado) · tabela de 12 meses
    (**4 passados + corrente + 7 futuros**) com `Mês | Entrada | Saída | Impostos | Folha |
    Resultado`, toggles `Fluxo⇄DRE` e `R$⇄%`, e drill-in de dias na MESMA tabela.
    - ⚠⚠ **A LEI 1 MUDOU O PAYLOAD, não só a tela:** *"dinheiro só confirma com pagamento"*. A guia
      **paga** entrou (ela **não existia** no payload, e era ela que deixaria o passado vazio) e a
      guia **em aberto** virou `COMPROMISSO` no **mês corrente**, saia ela quando sair. Daí sai
      sozinho o critério de aceite nº 12: **o passado só carrega o que foi pago**.
    - ⚠⚠ `PROCEDENCIA` ganhou **`COMPROMISSO`** e o sentido de **`FATO` mudou** (era "existe com
      data própria"; hoje é "foi pago"). ⚠ Os DOIS espelhos de `leituraDoFluxo.js` foram
      atualizados — sem isso, toda guia em aberto cairia em *"esta tela não conhece esta
      procedência"*, nas duas telas, sem erro nenhum.
    - ⚠ Tabela nova **`CienciaDeGuias`** (o "Estou ciente"), migration `20260828160000` **escrita e
      NÃO aplicada**. ⚠ Ela **não é** `Guide.clienteConfirmouEm`: Lei 5 — *Ciência nunca significa
      pagamento*.
    - ⚠ **Saldo** é Fase 3 (Lei 3: sem âncora não há acumulado) · **DRE gerencial** e **recorrência
      automática** são Fase 4. Ver `apps/portal-cliente-web/CLAUDE.md`.
    - ⚠⚠ **DUAS COISAS FORAM EXCLUÍDAS a pedido do dono, e as duas têm perda nomeada:**
      **"Declarar o que se repete"** inteira (tela, rota `.../recorrencia/declarar` e `declararSerie`)
      — com ela, `ORIGEM_DA_SERIE.DECLARADA` ficou **sem escritor**, e o vocabulário **fica** porque
      é leitura de dado que já existe; e o card **"Próximos vencimentos"** do Painel — o pop-up só
      acende a até 5 dias, então a guia que vence em 15 deixa de aparecer no Início.
  - ⚠⚠ **A tela padrão é o PAINEL: fluxo de caixa ⇄ DRE.** ⚠⚠ **ESTA LINHA DIZIA "MOCKADOS" ATÉ
    27/08/2026, e metade ficou falsa: o FLUXO DE CAIXA virou real** (Fase E) — `GET /client/.../fluxo-de-caixa`,
    com 12 meses e `fato`/`previsao` separados. ⚠⚠ **E ela dizia "o MESMO payload que o contador lê",
    o que ficou falso em 29/08/2026:** o dono removeu o fluxo de caixa do portal do contador
    (*"para o contador não vai existir fluxo de caixa"*), a rota `/firm/.../fluxo-de-caixa` saiu e
    `apps/web/src/features/fluxo/` foi apagada. O corpo compartilhado
    (`routes/fluxoDeCaixaHttp.js`) continua sendo o único que monta o fluxo — **com um consumidor
    só**. Ele responde
    `demonstracao: false` e **o selo some junto**. ⚠ O **DRE continua ficção**, com o selo, porque
    não existe rota de DRE. ⚠ *"Não há origem para ENTRADAS"* também caiu: a entrada é a **nota
    emitida**, e ela cai no **dia 1 do mês seguinte** (29/08/2026 — a metade "+ prazo de
    recebimento" desta frase morreu quando o prazo deixou de ser lido). ⚠⚠ E ela **deixou de ser
    sempre previsão**: com a **apuração transmitida** da competência da nota, ela vira FATO — decisão
    do dono, *"a apuração quer dizer que o dinheiro entrou"* —, e a prova é o índice da RFB, nunca a
    afirmação do contador. Sem apuração, PREVISÃO: a nota prova que foi faturado, não que foi
    recebido. ⚠ `GET /client/.../fluxo` (guias liberadas em aberto) **fica
    como está**: virou um CONTRIBUINTE do fluxo, não uma segunda definição dele; OFX e transações
    seguem stubs 501. O selo continua dirigido pelo DADO (`demonstracao !== false`), **nunca por
    `api.mode`**, que some no modo real.
  - ⚠⚠ **A Situação fiscal é SÓ LEITURA e o piso é `CLIENT_ADMIN`** — o relatório traz o quadro
    societário, e a consulta paga (limite AV02 **por contratante**) fica só com o contador.
  ⚠ **Ler `apps/portal-cliente-web/CLAUDE.md` antes de mexer** — quase toda decisão veio de defeito
  medido ou de instrução literal do dono. Os que mais custam se reintroduzidos:
  - ⚠⚠ **OS CAMPOS DE IMPOSTO TÊM GUARDA NOS DOIS LADOS** (`emitir/lib/impostosDaNota.js`,
    20/08/2026) — a tela **e** o payload saem da MESMA resposta. `pTotTribSN` só existe no Simples
    (o defeito relatado em produção: a empresa do Presumido via "Alíquota efetiva do Simples"), e o
    **regime indefinido também não o vê**; a alíquota de ISS só existe com a **retenção marcada**, e
    desmarcar tira o valor do CORPO, não só da tela. ⚠ Campo escondido que continua viajando é o
    defeito pior.
  - ⚠ **O fallback mock não engole recusa NOMEADA** (`src/api/index.js:42`). Antes caía para o mock
    em todo 5xx: o `503 danfse_sem_qrcode` virava PDF válido e o **502 de TRANSPORTE virava
    `status: "issued"`** na tela do cliente, com o desfecho real desconhecido.
  - ⚠ **A nota emitida aparece antes do ADN por UNIÃO NA LEITURA** — `PortalInvoice` é projeção de
    sistema externo e **não se escreve**; a dedup usa a tupla do **E0014** (série + nDPS). Regra em
    `apps/api/src/application/notas/notasEmitidasNaoConfirmadas.js`.
  - ⚠ **`legacyCompanySelect` (`routes/client/index.js:102`) já mordeu três vezes**: coluna fora do
    `select` volta `undefined` sem erro, a rota responde 200 e a tela "só não mostra". A trava é
    varredura do texto do `select`, não teste de comportamento.
  - ⚠⚠ **A PLANILHA DO LOTE TEM QUATRO COLUNAS** (20/08/2026) — `documento` · `descricao` · `valor` ·
    `competencia`, todas obrigatórias. Eram doze; o dono cortou as sete do tomador (*"não precisamos
    de nada do tomador, apenas o CNPJ ou CPF"*). Elas **não sumiram do fluxo**: viraram campos da
    tela de REVISÃO (`CAMPOS_DA_REVISAO`) e chegam do **cadastro de tomador** → da **consulta à
    Receita** → da **revisão**. ⚠⚠ CPF que nunca recebeu nota cai SEMPRE na revisão (CPF não se
    consulta) — é a regra, não um buraco. ⚠⚠ O município se ESCOLHE no `SeletorMunicipio` que já
    existia (nome + UF à vista, código junto da escolha) — **nada converte nome em código**: 240
    nomes cobrem 521 municípios, e o erro só aparece como nota emitida no município errado.
  - ⚠⚠ **O LOTE POR PLANILHA CONFERE E EMITE** (emissão em 20/08/2026) — `features/lote/` baixa o modelo,
    lê a planilha e **confere linha a linha**: quatro estados fechados vindos do backend
    (`nfse/lote/classificarLinhaLote.js`), consulta do CNPJ **saindo do navegador** em série e
    ajuste da linha que volta ao servidor para ser RECLASSIFICADO por lá. ⚠ Duas metades moram no
    front porque só ele as tem: a **conferência do código do IBGE** (que rebaixa a linha, nunca a
    promove) e a **consulta à Receita**. ⚠⚠ **A EMISSÃO EM LOTE EXISTE DESDE 20/08/2026** — e este item dizia o
    contrário. Ela é **persistida** (duas tabelas, migration NÃO aplicada), **sequencial**, para o
    lote inteiro na camada `TRANSPORTE` (desfecho DESCONHECIDO), retoma **depois** da linha
    indeterminada e é **idempotente** por impressão digital do conteúdo. ⚠ Nasce DESLIGADA
    (`INTEGRACAO_NFSE_LOTE`), com o **servidor** recusando — não é a tela que esconde o botão. `routes/nfseLoteRoutes.js` está montado em `routes/client/index.js`
    com `resolverCompanyId: resolveLegacyCompanyId` (sem ele a memória de tomadores volta vazia
    **sem erro**, e o *"se já teve antes, só preencher"* nunca acontece).
  - ⚠ **O SELETOR DE TOMADORES JÁ EMITIDOS** (20/08/2026) reusa o cadastro que a emissão já
    alimenta (`api/src/application/nfse/tomadorEmitido.js`) por uma rota nova **só de leitura**,
    `GET /client/companies/:id/nfse/tomadores` — com `resolveLegacyCompanyId`, a QUINTA vez que essa
    confusão de ids aparece. Encontra e nunca escolhe; o digitado vence e o que foi preservado é
    dito; sem tomadores o seletor não aparece e nada é falado.
  - **Fora de escopo, com motivo escrito:** substituição de NFS-e (**escopo fechado pelo dono**) e
    envio da nota por e-mail ao tomador. ⚠ A EMISSÃO em lote saiu desta lista em 20/08/2026 — ela
    foi construída.
- [~] **Módulo fiscal — os defeitos das três telas + as tabelas (25/08/2026)** — o dono avaliou
  Planejamento tributário, Fiscal→Apuração e Empresa→Perfil fiscal **como contador** e listou oito
  defeitos. **Todos medidos contra produção antes e depois**; dois tinham causa diferente da
  suposta, e é a mesma para os dois.
  - ⚠⚠ **UM PARSER DE NÚMERO EXPLICAVA TRÊS SINTOMAS AO MESMO TEMPO.** O prefill escrevia o número
    JS cru no input (`String(888286.09)`) e o parser da tela remove todo ponto como separador de
    milhar — o que é CERTO para digitação pt-BR. **Todo valor com centavos era multiplicado por
    100.** Receita > 78 mi ⇒ "não é elegível ao Lucro Presumido"; RBT12 > 4,8 mi ⇒ "Sem RBT12"; e o
    "ponto de equilíbrio" continuava cravando um número entre as duas recusas porque
    `pontoDeEquilibrio` varre com um RBT12 interno. **Medido: 12 de 18 empresas com dado apurado.**
    ⚠ O ISS também (3,5% virava 35%). O conserto NÃO foi afrouxar o parser — em pt-BR "1.234" é
    ambíguo e quem digita quer mil duzentos e trinta e quatro; quem errava era quem ESCREVIA.
    As duas metades passaram a morar juntas em `planejamento/lib/campoNumerico.js`, com o contrato
    sendo a IDA E VOLTA.
  - ⚠⚠ **A FOTO DO RELATÓRIO SE PASSAVA POR DIAGNÓSTICO DE AGORA.** "A empresa não tem Cadastro
    Fiscal preenchido" com o Perfil fiscal cheio: as duas telas leem a MESMA tabela com a MESMA
    chave, então "são tabelas diferentes" não explicava. Medido: o relatório da LENTE é de
    **12:26:57** e o `CadastroFiscal` foi criado às **12:55:24** — 28 minutos depois. O relatório é
    uma FOTO (`relatorios_faturamento`), e dentro dela viajava congelado o BLOQUEIO do motor, que
    não é número: é **diagnóstico de estado**. Hoje `lerRelatorioFaturamento` reconfere e a tela
    avisa ANTES do motivo. ⚠ **Três estados**: `aindaVale: null` é "não conferimos este" e nunca
    vira "já resolvido".
  - ⚠⚠ **"CLASSIFICAR COMPETÊNCIA" CLASSIFICAVA A EMPRESA INTEIRA** — a query não filtrava por
    competência, e com `force: true` reclassificaria todo o histórico, meses transmitidos inclusive.
    ⚠ Nota **sem competência** é contada e devolvida nomeada (em SQL, intervalo não casa com NULL —
    o defeito que a auditoria de notas já pagou).
  - ⚠⚠ **O FATOR R AGORA É DERIVADO DO PERFIL DE ATIVIDADES**, com override e divergência à vista
    (`planejamento/lib/sujeitoAoFatorR.js`, três respostas). O campo lia `CadastroFiscal.usaFatorR`
    cru — coluna com `@default(false)`, que **não distingue "o contador disse que não" de "ninguém
    nunca abriu essa tela"**. Com o RBT12 da LENTE: Anexo III ≈ 11,04% contra V ≈ 17,6%.
    ⚠ Consertou junto um defeito do `PerfilFiscalService`: o `temFatorR` era um `if` dentro do laço,
    ANTES de `cfg.ativo` ser lido — atividade DESATIVADA forçava o Fator R da empresa.
  - ⚠⚠ **A REGRA DOS R$ 120.000 EXISTIA COMO CONSTANTE E NUNCA ENTRAVA EM CONTA NENHUMA.**
    `PRESUNCAO_IRPJ.servicosAte120k = 0.16` só alimentava um aviso. **Medido: 10 das 18 empresas com
    dado têm receita abaixo do limite** — o simulador presumia o DOBRO do IRPJ na maioria da
    carteira. ⚠ A redução é **só do IRPJ**; a CSLL segue 32%. ⚠ E **não se liga sozinha**: o § 4º
    exclui hospitalares, transporte e profissão regulamentada (há caso concreto na carteira).
  - **As tabelas** (`docs/lc116/`, e a NBS da planilha já versionada) — ver `apps/api/CLAUDE.md`,
    seção "DUAS TABELAS FISCAIS NOVAS". ⚠ A **NBS nasce inerte por decisão do dono**.
  - ⚠⚠ **A CATEGORIA DE PRESUNÇÃO PASSOU A SER SUGERIDA PELO CNAE — e isso reverte, de forma
    controlada, uma decisão escrita.** O texto antigo ("a atividade do Presumido NÃO é derivada do
    CNAE") continua valendo: o que mudou é **derivar** (o sistema decide e calcula) virar **sugerir**
    (o sistema propõe, nomeia o que derrubaria a proposta, e nada entra na conta sem confirmação).
    ⚠ O campo continua `ausente`; a sugestão viaja separada. ⚠ CNAE fora do catálogo **não** cai em
    "serviços" — 18 dos 64 CNAEs da carteira estão fora. ⚠ Atividades que discordam ⇒ **nenhuma**
    sugestão, nem por maioria.
  - **A TELA DO PLANEJAMENTO GANHOU DUAS PEÇAS** (`comparativoDeRegimes.js` + `TabelaComparativa`,
    `proLabore.js` + `PainelProLabore`):
    - **comparativo de quatro colunas** (Simples III · Simples V · Presumido · Real) com composição
      por tributo. ⚠⚠ **A linha da CPP é a que responde à pergunta do dono** — no Simples ela está
      DENTRO do DAS, no Presumido é 20% da folha POR FORA, e é isso que faz "o Presumido compensa
      acima de X" não valer para quem tem folha. ⚠ **Célula vazia é proibida**: branco se lê como
      zero, e toda ausência sai nomeada ("dentro do DAS" · "não se aplica" · "não estimado").
    - **simulação de pró-labore** — quanto falta para o Fator R chegar a 28%, quanto custa ao sócio
      (INSS + IRRF **incrementais**) e quanto economiza no DAS. ⚠⚠ A premissa que decide o
      resultado vai IMPRESSA (a CPP dentro do DAS, art. 13, VI) e o **Anexo IV é RECUSADO**, porque
      lá ela fica fora e a conta muda de sinal.
    - **IRPF e teto do INSS** entraram como tabela versionada (`docs/irpf/`), com vigência à tela.
      ⚠ A recusa antiga continua valendo para **RAT/FAP e terceiros** — esses variam por EMPRESA.
      ⚠ O PDF da portaria do INSS é **digitalizado** (8 caracteres extraíveis) e **não** foi
      versionado: hash ao lado de arquivo ilegível dá aparência de prova.
  - **Fica NOMEADO, não consertado:** **28 das 34 empresas não têm linha em `cadastros_fiscais`** (o
    Perfil fiscal sintetiza da `Company`, e o `prefill: true` que o backend devolve **não é lido no
    front**) · `perfilAtividades.codigoServicoMunicipal`, `retencaoFonte` e `domicilioFiscal` são
    **write-only** · o catálogo de CNAE cobre ~10% da CNAE 2.3 · a conciliação DAS × SERPRO existe e
    é **inalcançável** enquanto o motor recusar por receita não classificada.
  - ⚠ **`serproParcelamentoContract` já estava vermelho no HEAD** (`parc.numeroDas` undefined) —
    conferido, não é destas entregas.
  - ⚠⚠ **TRÊS LIÇÕES DE MÉTODO, e elas valem mais que os consertos:** (1) um experimento voltou
    **zero vermelhos** — a regra pura tinha 17 testes e a **ligação** tinha nenhum; (2) o mock usava
    só valores **redondos** e tem faturamento **zero** em 6 de 6 empresas, então dois ramos inteiros
    nunca eram alcançáveis offline; (3) **terceira vez** que um identificador órfão passa pelo
    `npm run build` — só teste ou `no-undef` pega.

- [ ] **Cofre de certificados / hardening LGPD (Q13)** — planejado (AWS KMS
  envelope encryption); remover fallback JWT→CERT_SECRET_KEY. Não iniciado.

### Concluído (main)

- [x] Autenticação JWT com workflow de aprovação por admin
- [x] Sincronização NFe via XML (import + parsing)
- [x] Emissão e consulta de NFS-e com certificado A1
- [x] Integração ADN para sync de NFS-e
- [x] Upload e parsing automático de guias PDF
- [x] Envio em lote de guias por email (worker background)
- [x] Multi-tenant: `CompanyFirmAccess` vinculando empresas a escritórios
- [x] Rota `/firm` com gestão de clientes, guias, NFS-e
- [x] PDF reader Python integrado como serviço separado
- [x] Deploy Railway com Dockerfile e variáveis de ambiente

## ⚠⚠ A MARCA — ALTAN, e o que ela ainda NÃO é (23/08/2026)

O kit da Altan (`altan-logo-*`, `altan-icone-*`) entrou nos dois portais: favicon, `<title>`, tela
de login, barra do topo do cliente e o cabeçalho dos impressos do escritório. **Antes disto não
havia marca nenhuma no produto**: o favicon do escritório era o logo do **Vite** e a aba dizia
*"Portal Firm"*; o portal do cliente não declarava ícone nenhum (o navegador pedia `/favicon.ico` e
o `try_files` do Caddy devolvia o **`index.html` com 200 e `text/html`**).

- ⚠⚠ **A LOGO É SVG INLINE NO DOM, NUNCA `<img src="…svg">`.** O letreiro do kit é
  `<text font-family="Inter, …">`, e um SVG usado como imagem é documento isolado: **não enxerga as
  fontes da página**. Servido assim, "ALTAN" sairia em Segoe UI no Windows, Arial no macOS e Roboto
  no Android. Componente: `LogoAltan` (um por portal — está na tabela "mudou lá, muda aqui").
- ⚠ **A Inter é auto-hospedada** (`public/fonts/Inter-latin.woff2`, 48 KB, **variável**, eixo
  `wght` 100–900 conferido com fontTools; licença OFL ao lado). Decisão de 23/08/2026, contra o
  `<link>` do Google Fonts: os dois apps fazem **zero requisição externa** e o modo demonstração é
  offline — com host de terceiro a logo cairia para Segoe UI justamente ali. ⚠ **Ela NÃO é a fonte
  do app**: `--font`/`--font-sans` continuam sendo a pilha de sistema.
- ⚠ **"claro"/"escuro" no nome dos arquivos é o FUNDO, não o tema do arquivo.** As cores da logo são
  tokens (`--logo-sol`, `--logo-horizonte`, `--logo-tinta`, `--logo-subtitulo`), um par por portal.
  Medido: a linha do horizonte da variante escura (`#AEB6D3`) sobre o branco do portal do cliente dá
  **1,97:1** — some. E `tom="papel"` crava o par claro nos impressos, porque a tinta do portal
  escuro (`#F8F8F2`) sairia invisível no papel.
- ⚠ **O `viewBox` é recorte, não redesenho.** No arquivo oficial a marca ocupa 52% da largura e 34%
  da altura (tinta medida no PNG @2x: `x 77..722, y 128..243` de 1240×340). O `favicon.svg` é o
  ÚNICO arquivo autoral: mesma arte, mesma moldura, escalada 1,30× — no ícone oficial a marca ocupa
  **22% da altura**, e a 16px isso se lê como um quadrado escuro. Os PNGs de 180/192/512 ficam
  **intactos**: ali a margem generosa é o certo.
- ⚠ **O login do escritório só diz o modo quando é `mock`.** Ele imprimia `Modo da API: real` para o
  usuário final. A comparação é `=== "mock"`, nunca `!== "real"`: `real_with_mock_fallback` **fala
  com o backend de verdade**, e chamá-lo de demonstração diria que números de produção são fictícios.

### ✅ 30/08/2026 — a marca saiu do CÓDIGO, e o Workspace migrou para `altan.company`

⚠⚠ **ESTA SEÇÃO ERA UMA PENDÊNCIA ("o nome Belgen continua no código") E FOI RESOLVIDA.** O dono
decidiu migrar o Workspace inteiro — domínio novo **`altan.company`**, Workspace NOVO, e o antigo
(`belgencontabilidade.com`) **será encerrado**.

**O que mudou no código** (7 ocorrências, 5 arquivos, todas na api):

| onde | o quê |
|---|---|
| `PasswordResetService.js` · `GuideCompanyEmailService.js` · `guideEmailWorker.js` | a assinatura **"Equipe Altan Contabilidade"** — ⚠ os três CHEGAM AO CLIENTE |
| `EmailService.js` (`fromDomain`) | o domínio do `Message-ID`, agora `altan.company` |
| `EmailService.js` (`boundary`) · `EmailService.js` (msg de erro) · `config.js` (comentário) | técnicos/exemplo |

⚠⚠ **O `fromDomain` NÃO É COSMÉTICO.** `Message-ID` de um domínio diferente do que assina é sinal de
spoof para filtro de spam — e este e-mail leva **PDF de guia em anexo**, o perfil que mais cai em
spam. Ele é fallback (só morde com `From` malformado), mas tem de acompanhar o remetente.

### ⚠⚠ O QUE MUDA FORA DO CÓDIGO — e a ordem importa

⚠ **Trocar as variáveis antes de a caixa nova existir DERRUBA o envio de guias.** Ordem:
caixa criada e recebendo → delegação autorizada → variáveis → login.

| medido em 30/08/2026 | valor |
|---|---|
| `USE_GMAIL_API` | `1` (Gmail API com delegação domain-wide) |
| `GMAIL_DELEGATED_USER` | `contabilidade@belgencontabilidade.com` → **`contabilidade@altan.company`** |
| `SMTP_FROM` | idem — ⚠ ele **VENCE** `GMAIL_DELEGATED_USER` (`config.js`). Trocar só um faz o sistema impersonar uma caixa e assinar como outra |
| service account **de produção** | `enviodeguias@enviodeguias.iam.gserviceaccount.com`, projeto `enviodeguias`, client_id `101418586271467768722` |
| service account **nova** | `envio-de-guias@envio-de-guias-507214.iam.gserviceaccount.com`, projeto `envio-de-guias`, sob a organização `altan.company` |

⚠⚠ **SÃO DUAS SERVICE ACCOUNTS EM DOIS PROJETOS, e confundi-las é o erro caro:** autorizar no
Workspace novo o client_id da conta ERRADA produz `invalid_grant` no envio, com tudo "parecendo
configurado". A decisão do dono foi **migrar para a nova**, porque o projeto antigo está **fora** da
organização `altan.company` e encerrar o Workspace antigo pode arrastá-lo junto.

⚠ **A service account é do Google CLOUD, não do Workspace.** A delegação domain-wide é o *Workspace*
autorizando um client_id — por isso a conta antiga funcionaria com o domínio novo, se autorizada. O
que decide a migração é a **posse do projeto**, não a técnica.

⚠ **Existe um login de EMERGÊNCIA fora do banco:** `AUTH_USERS` traz o usuário **`YAGO`**, com
**`role: admin`**. Ele é a rede de segurança durante a troca do e-mail de login — e ⚠⚠ ele também
qualifica a frase *"zero usuários com role admin"* que a entrega da visita ao portal do cliente
mediu: aquela medição olhou a tabela `User`, e este usuário não está nela.

### O que ficou de fora, com motivo

- **O DANFSe**, e não é escolha: Res. CGNFS-e nº 3, art. 13 (citada em `danfse/danfseLeiaute.js:234`)
  proíbe imprimir informação que não conste do arquivo da NFS-e. A logomarca dele é a **oficial da
  NFS-e nacional**.
- **O espelho da DEFIS** (`EspelhoDefis.jsx`): o botão "Imprimir o espelho" chama `window.print()`
  **cru** — não liga `body.imprimindo` nem declara `data-print-area`, então ele não usa o mecanismo
  compartilhado e um `[data-print-only]` ali ficaria invisível. ⚠ É lacuna ANTERIOR a esta entrega;
  consertar o fluxo de impressão dele é trabalho à parte.
- **O app mobile** (`portal-cliente-mobile`, outro repositório) segue com os 6 ícones default do
  template Expo.
- **A paleta dos portais** não mudou. O ouro `#D9A32B` colidiria com `--warning`, que nesta casa
  significa *pendência*.

## Princípios de trabalho (INEGOCIÁVEIS)

> Definidos pelo dono do projeto. Valem pra qualquer tarefa, em qualquer arquivo.

1. **NÃO INVENTAR NADA.** Não chutar valores, IDs, nomes de campo, endpoints,
   regras fiscais, alíquotas, estruturas de payload de API, nem comportamento de
   integração. Se um dado é externo (SERPRO, SEFAZ, RFB, gov.br) e não está
   confirmado por documentação oficial ou pelo dono, **não preencher por suposição**.
2. **O QUE NÃO SOUBER, PERGUNTAR.** Diante de incerteza sobre um requisito, um
   dado fiscal, um ID de atividade, um campo de API ou o efeito de uma ação —
   **perguntar ao dono antes de codar/executar**, não adivinhar.
3. **MARCAR O NÃO-VERIFICADO.** Quando algo só puder ser confirmado em ambiente
   externo (ex: `idAtividade` do PGDAS-D no trial), deixar explícito no código
   (ex: flag `verificadoTrial: false`) e avisar — nunca tratar como certo.
4. **FONTE OFICIAL VENCE.** Documentação oficial (apicenter SERPRO, manuais RFB,
   LC 123/06) tem prioridade sobre memória, exemplos de terceiros ou inferência.
5. **NUNCA transmitir/gravar ato fiscal por suposição.** Transmissão PGDAS-D,
   manifestação, emissão — só com dados confirmados e confirmação explícita.

## Regras Gerais

- Sempre considerar o contexto fiscal brasileiro (NFe, NFS-e, SEFAZ)
- Respeitar multi-tenancy: nunca vazar dados entre escritórios/clientes
- Não remover validações de CNPJ, certificado A1, ou regras fiscais
- Preferir editar arquivos existentes a criar novos
- Não adicionar abstrações desnecessárias — três linhas duplicadas são melhores que uma abstração prematura
