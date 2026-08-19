# CLAUDE.md — Portal do Cliente na web (apps/portal-cliente-web)

React 19 + Vite, **sem router e sem biblioteca de estado**. Nasceu em 18/08/2026 e recebeu nove
commits em dois dias (`git log --oneline -- apps/portal-cliente-web`). Este documento existe porque
quase toda decisão aqui foi tomada **com a tela na frente do dono**, e a razão dela não cabe no
código que sobrou.

## ⚠⚠ QUEM LÊ ESTA TELA É O CLIENTE, NÃO O CONTADOR

É o critério que decide texto, cor e o que aparece. O contador tem o `apps/web`; aqui quem entra é
o dono da empresa (ou o financeiro dele), que **não edita o próprio cadastro** e não conhece nome de
campo de XML.

**O corte de legendas de 19/08/2026** (commits `98b594e8` e `e2cb154d`) veio disso. O critério, que
está escrito também no cabeçalho de `src/features/emitir/EmitirNotaPage.jsx`:

- **FICA** o texto que (a) muda uma decisão de quem emite, (b) avisa de consequência fiscal, ou
  (c) diz o que fazer quando algo falta.
- **SAI** o que explica a nossa mecânica interna ou nomeia peça de integração. Saíram, nomeados no
  commit: `dCompet`, a dedução de CNAE, a citação da LC 116 art. 3º.

⚠ E o critério literal que o dono deu para a segunda rodada: *"sem sugestão não precisa ser falado,
pois já está sem"* — **sai a frase que descreve uma ausência visível; fica a frase que impede uma
ausência de ser lida como afirmação.** Por isso o `"Não preenchemos: …"` do campo de alíquota vazio
FICOU (`aliquotaEfetiva.js:139`, `textoDaProcedencia`): ele não descreve o vazio, ele impede o vazio
de virar suspeita de defeito. E ficaram os motivos que pedem AÇÃO de quem emite.

⚠⚠ **A FRASE QUE DESCREVE UM COMPORTAMENTO É PARTE DO COMPORTAMENTO.** As duas legendas falsas
achadas em 19/08 (a que ensinava `1500.00` num campo que já não aceitava ponto, e a que dizia que o
não optante "provavelmente seria recusado" depois de o backend passar a ler o cadastro) ficaram
falsas **no dia em que o campo e o backend mudaram** e ninguém tocou no texto. Mudou comportamento:
procure a frase ao lado.

⚠ **Encurtar não é apagar a distinção.** Corta-se palavra, nunca significado — a procedência da
alíquota manteve o aviso de que é a ÚLTIMA competência apurada, e "a emissão é definitiva" ficou
inteiro.

## Estrutura

```
src/
  api/
    index.js            - escolhe mock | real | real_with_mock_fallback  ⚠ ver "O FALLBACK"
    ApiError.js         - status 0 = rede; `code` = recusa nomeada; `corpo` = a resposta inteira
    accountGate.js      - trava de PRODUTO: conta FIRM não entra aqui
    sessionStore.js     - token fora do React (useSyncExternalStore)
    mock/mockApi.js     - modo offline; contrato idêntico ao real
    real/realApi.js     - fetch + refresh; contrato LIDO das rotas, não deduzido
    real/brasilApi.js   - consulta de CNPJ, direto do browser (sem proxy)
  features/
    auth/               - Login, EsqueciSenha, RedefinirSenha
    shell/AppShell.jsx  - casca: empresa ativa, abas, e o estado que atravessa telas
    home/               - resumo do mês
    notas/              - lista + DANFSe + cancelamento + "usar como modelo"
    emitir/             - ⚠ a ÚNICA tela deste portal que pratica ato fiscal
    guias/              - guias + linha digitável
  lib/
    format.js  hooks.js  roles.js  mensagens.js  baixarBlob.js
    municipios/   - regra + dado (5.571 linhas, 191 KB) por `import()` dinâmico
    servicosNacionais/ - Anexo B gerado (335 códigos, 63 KB), idem
  styles/tokens.css  styles/app.css
```

⚠ **Regra de tela vive em `features/<x>/lib/`, com teste próprio**, e a tela só faz a LIGAÇÃO —
mesma disciplina de `apps/web` (`circular/lib/estadoGuia.js` e companhia). Não escreva regra dentro
do `.jsx`.

### Roteamento: hash, 3 destinos, nenhuma dependência

`lib/hooks.js` → `useRota`. `ROTAS = ["home","notas","guias"]`, padrão `home`; hash desconhecido cai
no padrão. `App.jsx` despacha por `if`, e a única entrada externa é `/redefinir-senha?token=…`, lida
**uma vez** na carga.

⚠ **A redefinição de senha vem ANTES da sessão** (`App.jsx:44`). Quem clica no link do e-mail pode
ter sessão velha guardada no navegador — inclusive a do invasor de quem está fugindo. Mandá-lo para
o app "porque já está logado" engoliria o link no caso em que ele mais precisa funcionar.

⚠ **"Emitir" NÃO é rota** — foi removida em 19/08/2026 a pedido do dono (virou botão dentro de
Notas). A remoção foi **inteira**: item de menu (`AppShell.jsx:24`), destino (`hooks.js`, `ROTAS`) e
estado. Meia remoção é o "filtro fantasma": `#/emitir` de um link antigo levaria a uma tela sem
saída, porque a aba que servia de saída deixou de existir.

## ⚠⚠ O FALLBACK — `src/api/index.js:39`

Três modos, por `VITE_API_MODE`: `mock` (padrão), `real`, `real_with_mock_fallback`.

```js
function deveCairParaMock(err) {
  const status = Number(err?.status);
  if (status === 0) return true;   // falha de rede: não houve resposta
  if (err?.code) return false;     // recusa NOMEADA: o servidor respondeu, e a resposta é essa
  return Number.isFinite(status) && status >= 500;
}
```

A linha 42 é de 19/08/2026. **Antes a regra era só `status >= 500`**, e há recusas DELIBERADAS do
backend nessa faixa. O que isso produzia no modo fallback (commit `fe04ac48`):

- **`503 danfse_sem_qrcode`** → o mock devolvia um **PDF válido** no lugar da recusa. Um DANFSe sem
  QR Code não é um DANFSe (NT 008 §2.2/§2.4.3): era exatamente o documento inválido servido em
  silêncio que aquele 503 existe para impedir.
- **`502` da camada TRANSPORTE da emissão** → o mock respondia **`status: "issued"`**. O desfecho
  real é DESCONHECIDO (a DPS pode ter sido processada), e a tela dizia ao cliente que a nota saiu.
  É assim que se duplica nota.
- **`503 mail_not_configured`** → o mock fingia que o e-mail de redefinição de senha foi enviado.

⚠ O que separa os dois casos é o **CORPO**, não o status: backend fora do ar não responde o nosso
JSON, logo não tem `code`. Fallback por rede e por 5xx sem corpo seguem intactos. 401/403 nunca
caem para o mock — senão o modo fallback vira bypass de login.

⚠ **`brasilApi.js` nunca lança `ApiError`** (`{ok:false, motivo}` sempre), e isso é deliberado: um
erro lançado dali entraria no wrapper acima e a queda da BrasilAPI viraria **dados de empresa do
mock** numa tela que emite nota fiscal de verdade.

⚠ **Toda função nova precisa existir nos DOIS** (`mockApi` e `realApi`), com o mesmo contrato. Um
mock que recusa o que o real aceita treina a tela errada — foi o caso do `emitirNfse` do mock, que
julgava só o payload e por isso recusava **todo** Lucro Presumido, inclusive o de cadastro completo
(consertado em `df520df3`).

## Estilo — paleta CLARA, própria

`src/styles/tokens.css`. **Não é a paleta de `apps/web`**: aquela é escura e é do portal do
ESCRITÓRIO. Esta foi copiada verbatim de `prototipos/emissor-notas/styles.css`, decisão do dono com
a tela na frente, para que os dois lados do cliente (esta web e o app `portal-cliente-mobile`)
contem a mesma história visual.

Cor nova entra em `tokens.css`, nunca em hex dentro de componente. ⚠ Todo estado tem par
`-surface` (`--danger-surface`, `--warning-surface-border`, …) pelo mesmo motivo já registrado em
`apps/web/CLAUDE.md`: derivar fundo com `` `${cor}22` `` quebra em silêncio assim que a cor vira
`var(--…)`.

## A EMISSÃO DE NFS-e (`src/features/emitir/`)

⚠⚠ **É a única tela deste portal que ESCREVE.** O que sai daqui vira nota fiscal de verdade, e a
NFS-e **não tem inutilização**: o conserto de uma nota errada é cancelamento, outro ato fiscal, com
prazo e motivo. Contrato: `POST /client/companies/:companyId/nfse`; corpo em
`apps/api/src/application/validators/nfsePayload.js`; desfechos em `routes/nfseEmissaoHttp.js`.

### O portão — `lib/portaoEmissao.js:44`

Espelho de `ensureEmissaoNfseAutorizada` (backend): empresa liberada pelo contador **E** papel ≥
`CLIENT_ADMIN`. Existe só para a tela não montar um formulário que já se sabe que vai ser recusado.

⚠⚠ **AUSENTE NÃO É `false`.** São quatro estados, e `DESCONHECIDO` é o que impede a tela de dizer
"peça a liberação ao seu contador" para uma empresa que talvez já esteja liberada — o cliente
ligaria para o escritório atrás de algo já feito, e o contador não acharia nada para consertar.
⚠ `bruto !== true`, nunca truthy: `Boolean("false")` é `true`, e portão que abre por coerção de tipo
é o que ninguém revisa.

### ⚠⚠ O valor — `lib/valorDaNota.js`

**Aqui o erro é de ordem de grandeza, não de estética.** O que este módulo substituiu era
`Number(String(v).replace(",", "."))` — um `replace` do PRIMEIRO caractere:

| grafia | resultado antigo | o que quis dizer |
|---|---|---|
| `1.500` | `1.5` | mil e quinhentos |
| `1.500,00` | `NaN` (campo preenchido, "vazio" para a regra) | mil e quinhentos |
| `1500.00` | `1500` (certo, por acaso) | mil e quinhentos |

A do meio emite a nota por **1/1000** do valor.

⚠ **A decisão: a ambiguidade não é resolvida, é impossível de escrever.** `mascararValorDigitado`
lê o teclado como FLUXO DE DÍGITOS em centavos e devolve sempre `1.234,56`. Digitar `1500.00` é
impossível — o ponto não entra. Ambiguidade que não pode ser escrita não precisa ser resolvida.

⚠⚠ **Colar é o caso perigoso, e tem gramática FECHADA** (`lerValorColado`, `:143`). Quem cola vem
de planilha, e planilha escreve `1500.00`, `R$ 1.500,00` ou `1,500.00` conforme a máquina. Aceitas:
`1500`, `1500,00`, `1.500,00`, `1,500.00`, `1500.00` (ponto com 1–2 casas nunca é milhar pt-BR).
Recusadas **com motivo próprio** (`:171-172`): `1.500` e `1,500` — as duas leituras são legítimas e
não dá para escolher. Campo intocado + frase dizendo o que houve é melhor que um número plausível e
errado.

⚠ **Zero digitado ≠ campo vazio.** `""` continua `""`; `lerValorDoCampo("")` devolve `null`, não
`0`. E `formatarValorParaCampo` devolve `""` para o que não é número positivo — campo pré-preenchido
com `0,00` afirmaria que a nota vale zero.

⚠ **Isto NÃO vale para percentual.** Alíquota e `pTotTribSN` continuam aceitando vírgula E ponto:
percentual de 0 a 100 não tem separador de milhar, logo não tem a ambiguidade. Reusar a máscara de
moeda lá transformaria `5` em `0,05`.

### ⚠⚠ A alíquota — `lib/aliquotaEfetiva.js`

**É `deReceita` (DAS ÷ receita da competência), NUNCA `efetiva`.** A rota
`GET /client/companies/:id/aliquotas` devolve as duas contas, e só uma serve aqui:

```
deReceita = dasExtrato    / faturamento × 100   ← ESTA (pTotTribSN)
efetiva   = impostosPagos / faturamento × 100   ← inclui INSS; NÃO usar aqui
```

O motivo é o NOME DO CAMPO: `pTotTribSN` é "total de tributos do **Simples Nacional**", e o INSS
recolhido em guia separada (CPP do Anexo IV) não está dentro do DAS. Decisão do dono, 18/08/2026:
*"a alíquota efetiva do Simples, ou seja apenas a DAS, o INSS não entraria."* Medido em produção e
registrado no cabeçalho do arquivo: onde não há INSS à parte as duas coincidem (6,00%); onde há,
divergem em mais de um ponto (6,00% × 7,26%; 6,00% × 7,83%; 6,24% × 7,01%).

⚠ **`efetiva` não é um campo errado — não a "conserte".** São duas perguntas diferentes, e o dono
fixou a distinção: o PAINEL responde *quanto esta empresa paga de imposto?* (tudo, INSS incluso — é
gestão); a NOTA responde *quanto desta nota é tributo do Simples?* (só o DAS — é documento fiscal).
Trocar uma pela outra estraga a tela de destino nos dois sentidos.

⚠⚠ **Zero nunca é fabricado.** O backend calcula `d > 0 ? n/d*100 : 0` — sem receita ou sem extrato
do PGDAS-D a resposta é `0`, indistinguível de uma alíquota de zero por cento, que numa nota fiscal
é uma AFIRMAÇÃO. Por isso `linhaTemProva` (`:45`) exige os DOIS insumos crus **e** o percentual
legível. E `percentualLegivel` (`:71`) não usa só `Number.isFinite(Number(x))`: **`Number(null)` é
`0`**, que é finito — a primeira versão da guarda errou nisso e a nota declarava 0%. É a mesma
armadilha do `fatorR` já registrada em `apps/web/CLAUDE.md`.

⚠ Sem a competência da nota, usa-se a **última apurada e diz-se qual foi** (`:110`) — nunca se
extrapola nem se repete o número anterior fingindo ser o do mês. A janela da consulta é de **6
meses, não 12** (`:159`): a rota faz um `aggregate` por competência, em série.

### ⚠⚠ O tomador — `lib/consultaTomador.js`

**CPF NÃO SE CONSULTA** (`:53`). Com 11 dígitos NADA acontece: sem chamada, sem "não encontrado",
sem piscar, sem botão. A BrasilAPI é base de CNPJ; perguntar por CPF devolveria uma recusa que não
significa nada, na tela de quem não errou nada.

⚠ **A consulta é AJUDA, nunca PORTÃO.** Nenhuma função devolve impedimento; falha de rede ou CNPJ
não encontrado não bloqueiam a emissão, e a recusa vem acompanhada de "a emissão segue normalmente".
⚠ Essa frase mora na TELA e o FATO mora em `brasilApi.js` — dividido assim em 19/08 porque as duas
metades apareciam uma embaixo da outra, e quem apagasse uma não saberia qual carregava o "segue
normalmente". Não reintroduza a instrução no `brasilApi.js`.

⚠ **O `cMun` entra por PROVA TRIPLA, nunca por confiança** (`codigoMunicipioVerificado`, `:124`):
7 dígitos + existe na lista oficial versionada + município **e** UF daquela linha batem com o
`municipio`/`uf` da MESMA resposta. O nome do campo na BrasilAPI não está confirmado por
documentação oficial neste repositório — é exatamente por isso que a aceitação é por verificação.
Falhou qualquer prova: `null` com motivo, e o endereço inteiro deixa de ser oferecido.

⚠ **Endereço é TUDO OU NADA** (`enderecoDaReceita`, `:161`). O validador do backend só aceita o
bloco completo (`cMun`, `CEP`, `xLgr`, `nro`, `xBairro`; `xCpl` é o único opcional) e descarta o
resto em silêncio, e o formulário marca os cinco como obrigatórios — preencher quatro dos cinco
transformaria uma consulta bem-sucedida em bloqueio da emissão.

⚠⚠ **O `"RUA"` sozinho passava por logradouro** (`:173`, commit `13f6f4f9`). Enquanto o campo era
`[tipo, logradouro].filter(Boolean).join(" ")`, uma resposta com
`descricao_tipo_de_logradouro: "RUA"` e `logradouro` vazio produzia a string **"RUA"** — não-vazia,
portanto **aprovada** pela checagem de tudo-ou-nada logo abaixo. Meio campo passando por inteiro, na
exata regra que existe para impedir isso: o endereço inteiro entrava no formulário com a palavra
"Rua" no lugar da rua, e ia para o XML. Hoje: sem `logradouro`, `xLgr` fica vazio e o bloco todo é
recusado.

⚠ **O que veio da API é SUGESTÃO; quem digitou manda** (`aplicarNome`/`aplicarEndereco`), e a tela
mostra a origem no rótulo.

### Município — `SeletorMunicipio.jsx` + `lib/municipios/municipioIbge.js`

⚠ **Não se converte NOME em código.** Há cinco "Bom Jesus" e cinco "São Domingos" no país; o erro
aparece só como nota emitida no município errado. A busca mostra as linhas da tabela oficial (5.571,
medidas) e **a escolha é de quem lê**: nada vem pré-selecionado, resultado único **não** se
autosseleciona, `Enter` sem item marcado não elege ninguém, e toda opção mostra município **e** UF.

### ⚠⚠ O código de serviço — `lib/codigoServicoDaNota.js`

**A autoridade é o backend** (`apps/api/src/application/nfse/codigoServicoDaNota.js`,
`escolherCodigoServicoNacional`). Este módulo é ESPELHO, e o teste do cliente **importa a função do
backend** e roda os mesmos cenários pelas duas implementações — senão "espelho" é intenção, não
fato.

Três ramos (`SITUACAO`):
- `SEM_CODIGO` — diz que não recebeu.
- `UNICO` — **o ramo que renderiza hoje**: medido na entrega (`57366057`), 33 de 33 empresas.
  ⚠ **Não manda o campo no payload** (`codigoParaOPayload`, `:99`): sem ele o servidor usa o
  cadastro, que é o caminho testado de sempre.
- `VARIOS` — seletor, **sem pré-seleção**.

⚠⚠ **A TELA NÃO ELEGE.** Com vários códigos e nenhum escolhido, o campo não era enviado e o servidor
caía no singular: a empresa que habilitou três serviços emitiria sob o primeiro **em silêncio** —
erro fiscal silencioso, que o backend descreve como pior que a ausência do seletor. Hoje
`conferirCodigoEscolhido` (`:109`) recusa o submit antes de sair e a tela diz o que falta.

⚠ **Forma, nunca conteúdo:** 6 dígitos, `length !== 6`, **sem `padStart`**. Padding fabricaria
código plausível a partir de um dígito a menos — a classe do `cLocEmi="0000000"`.
⚠ Código gravado fora da forma **não some**: aparece como INVÁLIDO (a coluna não tem CHECK no banco).

### A carga tributária do Presumido — `lib/cargaTributaria.js`

Os três percentuais da Lei 12.741/2012 viajam até o cliente (dono, 19/08: *"o portal do cliente deve
enxergar sim, no caso do presumido"*) porque saem **impressos ao tomador** na nota que ele mesmo
emite.

⚠⚠ **A tela MOSTRA; ela não MANDA.** `NfseService` resolve por campo, **payload → cadastro**, e o
payload VENCE — se esta tela passasse a enviá-los, um valor velho preso no formulário sobrescreveria
em silêncio a correção que o contador acabou de fazer. Há teste que submete o formulário e recusa
`pTotTribFed/Est/Mun` no JSON inteiro.

⚠ Três estados, e o terceiro não é "falta": `NAO_RECEBIDA` (a resposta não trouxe as chaves — fato
sobre a RESPOSTA) × `COMPLETA` × `PENDENTE`. `null` gravado ≠ chave ausente, distinguidos por
`hasOwnProperty`. Faltando algum, o espelho mostra **traço**, nunca `0,00%`.
⚠ `pTotTribMun` **não é a alíquota de ISS** — na NFS-e real versionada do projeto o ISS é 5,00% e o
`pTotTribMun` é 0,00%, no mesmo documento.

### A descrição

Duas fontes, e nenhuma inventa texto de documento fiscal:

- **`lib/descricaoSugerida.js`** — a partir de `Company.atividades` (medido em produção:
  33/33 empresas preenchidas, contra `codigosServicoNacional` em 2/33 — uma sugestão que só serve a
  2 de 33 não facilita nada). ⚠ **Código nu não vira texto**: não existe tabela CNAE→descrição neste
  repositório. ⚠ Dois ramos, por gramática: descrição que já começa com "Serviço(s)" perde o
  prefixo; qualquer outra recebe `"Serviço prestado: "` — os **dois pontos** introduzem aposição, que
  aceita qualquer sintagma nominal (inclusive nome de agente no plural) sem exigir regência.
- **`lib/descricoesRecentes.js`** — só o que **este navegador** já emitiu, e o rótulo na tela diz
  isso. ⚠ Medido: nem `PortalInvoice` nem `ServiceInvoice` tinham coluna de descrição, e o detalhe
  devolve `items: []` cravado — o histórico do servidor não sabe o que foi descrito. Escopo por
  `companyId`; some no `logout` (`AppShell.jsx:120`), porque guarda nome e CNPJ de tomadores.

### O desfecho — `lib/desfechoEmissao.js`

| camada | HTTP | o que houve | e daí |
|---|---|---|---|
| `NOSSA` | 400 | recusamos antes de enviar | corrija e envie de novo |
| `TRANSPORTE` | 502 | o pedido saiu, desfecho **desconhecido** | ⚠ **NÃO reenvie** |
| `RECEITA` | 422 | o sistema nacional analisou e recusou | corrija e emita de novo |

⚠⚠ A linha do meio é a razão do arquivo existir: reemitir pode gerar duplicidade (**E0014**) e
**não existe inutilização na NFS-e** — número queimado é buraco permanente. Nesse ramo a tela não
oferece botão nenhum de reenvio: **não um botão com aviso, nenhum botão**.
⚠ `nfse_numero_em_estado_indeterminado` (409) é da FAMÍLIA do transporte, não erro de validação.

## A LISTA DE NOTAS (`src/features/notas/`)

Lê `GET /client/companies/:id/invoices?direcao=emitidas`. O `summary` é do **filtro inteiro**
(agregado no backend), não da página — por isso vive fora da tabela.

### ⚠⚠ A união na leitura — a nota emitida aparece antes do ADN

Pedido do dono (19/08): a nota emitida deve aparecer na hora, e ficar "viva como as outras" quando o
ADN confirmar. O sintoma medido: a lista lê **`PortalInvoice`** (projeção do ADN) e a emissão grava
**`ServiceInvoice`** — entre emitir e a próxima captura, a nota não existia para o cliente.

A regra é do backend: `apps/api/src/application/notas/notasEmitidasNaoConfirmadas.js`, consumida por
`routes/portalInvoices.js:349`; a tela recebe `confirmadaPeloAdn`.

⚠ **NÃO SE ESCREVE `PortalInvoice`.** Ela é a projeção de um sistema EXTERNO, com donos declarados
(`notas/ingestaoNfse.js`, "a única porta de entrada de NFS-e no banco", mais o motor legado). Uma
quarta escrita criaria linha que a captura não conhece — defeito já pago aqui: o import manual
gravava `chaveAcesso: null` fixo, o upsert nunca achava a linha e **o faturamento somava a nota duas
vezes**. Pior: a linha escrita à mão não teria o `xmlRaw`, de onde saem os campos fiscais, o DANFSe
e a numeração da próxima emissão. **Na leitura a duplicata é reversível; na escrita ela é permanente
e contamina o dinheiro.**

⚠⚠ **A dedup usa a TUPLA DO E0014 — `(série, nDPS)`** — e ela IDENTIFICA por regra do sistema
nacional, não por convenção nossa: a RN E0014 rejeita DPS cujo conjunto *Série + Número + Município
Emissor + CNPJ* já exista, e o escopo (`PortalClient.companyId` `@unique` ↔ `Company.cnpj` `@unique`)
já fixa os dois últimos. São literalmente os mesmos números que `buildDpsXml` escreve e que o
nacional devolve dentro da NFS-e. Provas complementares: `chaveAcesso` e `numeroNfse`.
⚠ **Ausência nunca vira igualdade** — cada prova só é aplicada quando os DOIS lados têm o valor.
⚠ Só `papel: "EMIT"` do outro lado: a numeração de uma nota recebida é do prestador dela.

### ⚠⚠ Estado sem texto na tela — `lib/estadoDaLinhaDaNota.js`

Instrução literal do dono: ***"não coloque explicação disso na tela"***. Há teste varrendo o texto da
página contra as frases proibidas.

São TRÊS estados (`data-estado-nota` no `<tr>`; era um booleano `data-confirmada-adn`, e um booleano
não comporta três):

- `aguardando_adn` — emitida por nós, o ADN ainda não devolveu. **Mais clara** (`opacity: .62`,
  `app.css:142`); volta a 100% no `hover`/`focus-within`.
- `cancelamento_enviado` — acabamos de mandar cancelar. **Riscada** (`line-through`, `app.css:158`).
- `confirmada`.

⚠⚠ **Desenhos diferentes de propósito.** Os dois esperam o ADN, mas um espera confirmação de que a
nota EXISTE e o outro de que ela DEIXOU de valer — mesmo desenho para os dois é o defeito que a
distinção existe para impedir. O risco é fino e a opacidade fica cheia porque a pessoa ainda precisa
**conferir qual** nota mandou cancelar. O chip não muda de cor nem de rótulo, para não se confundir
com "cancelada".

⚠ O estado viaja em três canais: `data-estado-nota` (auditável no DOM), CSS, e `title`/`aria-label`
do chip — que **não são texto na tela** e são o que existe para quem usa leitor de tela.

### ⚠ Impedimento tem ESCOPO — `lib/impedimento.js`

A linha tem três ações (DANFSe, Cancelar, Usar como modelo) e várias chegam à MESMA conclusão sobre
a MESMA nota. Quando cada botão escrevia o próprio motivo, a linha dizia *"Ainda não confirmada."*
duas vezes, lado a lado.

- `ESCOPO.NOTA` — o fato é da NOTA; a linha já o carrega (coluna Tipo, chip, `title`). **Sem texto
  visível.**
- `ESCOPO.ACAO` — o fato é só deste botão (ex.: "sem o XML guardado", que só o DANFSe exige). **Com
  texto ao lado.**

⚠ O botão continua **desabilitado e com `title` nos dois casos** — "botão impossível não some e diz
por quê" não afrouxou, mudou de canal.

### DANFSe — `lib/danfseDaNota.js`

⚠ É o gêmeo de `apps/web/src/features/notas/lib/danfseDaNota.js` e **as perguntas divergem de
propósito**: o contrato do cliente (`serializeInvoice`) **não traz `chaveAcesso`** — traz `type` e
`hasXml`. Copiar a versão do escritório sem olhar faria `podeGerarDanfse` ler um campo que nunca
chega e desabilitar o botão em toda nota.
⚠ `confirmadaPeloAdn === false` desabilita: o id ali é um `ServiceInvoice.id` e a rota do DANFSe lê
`PortalInvoice` — ofereceria o botão para receber 404.
⚠ Recusa desconhecida **não ganha "tente de novo" fabricado**; a mensagem do servidor vence.

### Cancelamento — `lib/cancelamentoNota.js`

Decisão do dono (19/08): *"esqueça substituir então, deixe apenas o cancelar."*

⚠⚠ **A lista de motivos é FECHADA e é do LEIAUTE**, não escolha de produto: `tiposEventos_v1.01.xsd:233`
declara `<cMotivo type="TSCodJustCanc">` e `tiposSimples_v1.01.xsd:219` enumera **"1", "2", "9"**
(um caractere). ⚠ **Não confundir com `01…05, 99`** — aquela é a `TSCodJustSubst`, da substituição.
Mandar `"01"` num cancelamento é falha de schema.

⚠ `xMotivo`/justificativa: **mín. 15, máx. 255** (`TSMotivo`, `tiposSimples_v1.01.xsd:348`), e o
mínimo aparece **antes** de a pessoa digitar — descobri-lo ao clicar em "Cancelar", num ato
irreversível, é o pior momento possível.

⚠⚠ **Camada TRANSPORTE desabilita o botão** (`podeTentarDeNovo: false`, `:166`): o pedido saiu e a
resposta não voltou; a nota **pode** estar cancelada. Um segundo pedido volta recusado pelo sistema
nacional e se lê como "falhou", quando o primeiro tinha dado certo. Pela mesma razão existe a guarda
`cancelamentoEnviado` (`:63`) — o servidor ainda responde "EMITIDA" porque a lista lê `PortalInvoice`.
⚠ `corpo.podeTentarDeNovo !== false`, não `?? true`: ausência do campo não pode desabilitar o botão
para sempre, mas `false` explícito tem de desabilitar.

### Reaproveitar ("Usar como modelo") — `src/features/emitir/lib/reaproveitarNota.js`

⚠⚠ **Identificador NUNCA é copiado**: `numero`, `chaveAcesso`, `idNfse`, `idDps`, série/RPS, a
competência da origem, status, ciclo e eventos. Copiar qualquer um produz (a) duplicidade — a
rejeição **E0014** — ou (b) uma nota que se apresenta como sendo outra. O número da nova é reservado
pelo BACKEND, em transação, no instante da emissão. ⚠ A invariante é testada **por varredura do
objeto**, não campo a campo: um teste que só olhasse os campos conhecidos deixaria passar alguém
acrescentando `chaveAcesso` "só para a tela mostrar".

⚠⚠ **O VALOR: duas decisões do dono, e a segunda desfez a primeira.**
- **18/08** — sai **vazio**: *"…apenas apagando o valor — isso deveria ser possível."*
  `formatarValorParaCampo` chegou a ser **proibida por escrito** neste arquivo.
- **19/08** — é **copiado**: ele pediu a nota *"100% idêntica"*; perguntado qual pedido valia,
  respondeu **`"copia"`**. A razão própria: entre reaproveitar e emitir há uma tela inteira de
  conferência, e na prática o valor SE REPETE (serviço recorrente). Isso também **alinha os dois
  portais** — o `reaproveitarNota.js` do escritório sempre copiou.

⚠ Quem ler daqui a seis meses precisa saber que houve DUAS decisões, senão a primeira volta
"consertando" a segunda. ⚠ E copiar o valor **não abre a porta para copiar o resto**.
⚠ Nota sem total abre o campo **vazio**, nunca `0,00`, e o aviso muda de código junto
(`valor_copiado` × `valor_em_branco`) — um aviso fixo mentiria num dos dois ramos.

⚠ **Nota cancelada e nota substituída PODEM ser modelo** (a nota errada é o melhor modelo para a
certa): copiar não é reemitir, a original não é tocada e nenhum evento é gerado. O que não se pode é
a tela calar — a permissão vem sempre com o aviso de que isto não corrige nem substitui a origem.

⚠ **Nota recebida é reconhecida pelo CNPJ, não pelo `papel`**: `papel: "DEST"` existe no portal do
escritório e **não vem** no contrato do cliente. Cinturão que depende de campo inexistente não segura
nada.

⚠ A descrição **passou a chegar** em 19/08 (`1958a3de`), de **coluna** (`PortalInvoice.xDescServ`,
escrita por caminho `.../serv/cServ/xDescServ`, NT 008 §2.4.5) — **nada é parseado na listagem**. A
regra do item único continua intocada: mais de um item ⇒ descrição vazia com aviso, porque emendar
dois itens com " · " escreveria na nota nova uma frase que ninguém redigiu, e ela sai impressa no
DANFSe do tomador.

⚠⚠ **O defeito latente que essa mudança acendeu:** o efeito do MODELO escreve a descrição e marca
`descricaoDigitada`; o efeito da SUGESTÃO roda no mesmo commit, depois, e lia aquele estado pelo
closure do render anterior — ainda `false` — sobrescrevendo a descrição da nota com a sugestão do
cadastro. Era latente desde antes: enquanto `modelo.campos.descricao` era sempre `""`, a sobrescrita
era no-op. **Quem acendeu foi o teste de LIGAÇÃO, não o de regra** — a regra devolvia a descrição
certa o tempo todo, e passaria com a tela mostrando campo vazio para sempre.

⚠ **Trocar de empresa descarta o modelo** (`AppShell.jsx:69`) e a `EmitirNotaPage` **confere o
`companyId`** antes de aplicar: aplicar numa empresa o modelo tirado da nota de outra emitiria no
CNPJ errado — o pior desfecho possível num portal multi-empresa, e irreversível.

⚠ **As listas `CAMPOS_COPIADOS`/`CAMPOS_NAO_COPIADOS` do escritório NÃO existem aqui**: lá elas SÃO
o texto da tela; aqui seriam doze linhas novas na tela que o dono pediu para encolher. Lista que
ninguém renderiza é código morto.

## GUIAS (`src/features/guias/`) — `lib/linhaDigitavelTela.js`

Três ausências com significados diferentes, que não podem ser desenhadas iguais: `NAO_TENTADA`
(ninguém olhou o documento), `NAO_ENCONTRADA` (olhamos e não há linha legível), `DIVERGENTE` (lemos
uma linha íntegra que discorda do valor da guia).

⚠ **A diferença em relação ao portal do contador é deliberada: o cliente NÃO vê os dois valores da
divergência.** Os dois números são material de TRABALHO do contador; mostrá-los ao cliente entregaria
um problema sem entregar a ação, com dois valores em conflito numa tela cujo assunto é "quanto eu
pago". ⚠ Nos três casos o "Baixar PDF" continua sendo a saída — ausência de linha nunca vira ausência
de caminho para pagar.

## AUTENTICAÇÃO

⚠ **`accountGate.js` é regra de PRODUTO**: conta `FIRM` que entrasse aqui veria a tela do cliente —
com UMA empresa, os números DELA — e concluiria coisas erradas sobre a própria carteira. Vive fora
do mock e do real, chamada pelos dois: se morasse só num, o modo offline mentiria sobre a regra mais
importante da tela de login.

⚠ `mensagens.js` traduz código → frase de cliente. `invalid_reset_token` cobre **quatro** casos
(link inexistente, adulterado, vencido, já usado) e o servidor não diz qual **de propósito** — "este
link já foi usado" confirmaria a quem chutou que a conta existe. A frase dá o CONSERTO, que é o
mesmo nos quatro. ⚠ Não é o mesmo código que `invalid_token` ("sua sessão expirou").

⚠ `useCarregamento` (`lib/hooks.js`) descarta resposta atrasada: ao trocar de empresa, a requisição
da anterior pode responder depois da nova, e a tela mostraria os números de uma empresa sob o nome
de outra.

## TESTES

`npm test -w @contabilidade/portal-cliente-web` → **445 testes, 23 suítes, todas verdes** (medido em
19/08/2026). Não existiam até 18/08 (`d5a91490` subiu os primeiros 101). **0 suíte falhando é o
estado esperado.**

⚠ **`jest.config.js` e `babel.config.js` são cópia deliberada de `apps/web`**, letra por letra — um
segundo jeito de testar dentro do mesmo monorepo é um jeito a mais de esquecer de rodar.

⚠⚠ **`import.meta` quebra em tempo de PARSE.** O Jest roda em CommonJS: o arquivo inteiro morre
antes do primeiro teste, e **quem paga não é quem escreve, é quem IMPORTA**. Aqui os dois pontos são
`src/api/index.js` (`VITE_API_MODE`) e `src/api/real/realApi.js` (`VITE_API_BASE_URL`), e
`EmitirNotaPage.jsx` importa `../../api` — o teste de ligação da emissão cairia antes do primeiro
`expect`, com mensagem que não aponta para a tela. Resolvido na raiz: `babel.config.js` reescreve
`import.meta.env` → `process.env` **só no env `test`**. **Nenhuma suíte precisa de mock para isso.**

⚠ **Regra e ligação são dois testes, e os dois são obrigatórios.** Há 9 arquivos `*.ligacao.test.jsx`.
O caso da descrição acima é a prova: a regra estava certa e passava; a tela mostrava vazio.
⚠ Testes de ligação renderizam **dentro de `StrictMode`** — React 19 roda cada efeito duas vezes, e
foi assim que a guarda "já apliquei" do modelo morreu (o painel dizia "preenchido a partir da nota
nº X" sobre um formulário vazio).

## ⚠⚠ "MUDOU LÁ, MUDA AQUI" — os espelhos

Estes módulos são cópias deliberadas do portal do escritório, **sem código compartilhado**. Não há
pacote comum; a duplicação é conhecida e a obrigação de sincronizar é sua:

| aqui | original |
|---|---|
| `emitir/lib/valorDaNota.js` | `apps/web/src/features/notas/lib/valorDaNota.js` |
| `emitir/lib/consultaTomador.js` | `apps/web/src/features/notas/lib/consultaTomador.js` |
| `emitir/lib/reaproveitarNota.js` | `apps/web/src/features/notas/lib/reaproveitarNota.js` |
| `emitir/lib/descricaoSugerida.js` | `apps/web/src/features/notas/lib/descricaoSugerida.js` |
| `emitir/lib/cargaTributaria.js` | `apps/web/src/lib/nfse/cadastroEmissaoNfse.js` |
| `emitir/lib/codigoServicoDaNota.js` | `apps/api/src/application/nfse/codigoServicoDaNota.js` (**autoridade**) |
| `notas/lib/cancelamentoNota.js` (`MOTIVOS_CANCELAMENTO`) | `apps/api/src/application/nfse/motivosDeEvento.js` (**valida**) |
| `notas/lib/danfseDaNota.js` | `apps/web/src/features/notas/lib/danfseDaNota.js` (⚠ contratos DIFERENTES) |
| `lib/municipios/` · `lib/servicosNacionais/` | tabelas geradas; `servicosNacionais.data.js` sai de `apps/api/scripts/gerar-lista-servico-nacional.mjs` — **não editar à mão** |
| `lib/roles.js` | `apps/api/.../emissaoClienteAutorizacao.js` + `portal-cliente-mobile/src/roles.ts` |

⚠ Duas leituras da mesma coluna divergem na primeira correção — e aí as duas telas afirmam coisas
diferentes sobre a MESMA empresa.

## ⚠⚠ A ARMADILHA DO `select` EXPLÍCITO — já mordeu TRÊS vezes

`legacyCompanySelect`, em `apps/api/src/routes/client/index.js:102`, é um `select` do Prisma.
**Coluna que não está listada volta `undefined`, sem erro nenhum**: a rota responde 200 e a tela
"só não mostra". Um teste de comportamento passa.

As três vítimas, todas nesta semana:
1. `codigoMunicipioIbge`;
2. a carga tributária (`pTotTribFed/Est/Mun`, hoje `:157`) — a tela do cliente não sabia se o
   cadastro estava completo e por isso descrevia **as duas saídas** em vez do estado real;
3. `codigosServicoNacional` (hoje `:132`) — chegava só o singular, e por isso o seletor de código de
   serviço **não tinha o que oferecer nem como saber que havia o que escolher** (`57366057`).

⚠ Por isso a trava virou **varredura do texto do `select`**
(`routes/client/__tests__/contratoDeEmpresasDoCliente.test.js`), e não teste de comportamento.
**Campo novo que a tela do cliente precise ler: acrescente a linha no `select` E na varredura.**

⚠ O mesmo vale para `emissaoClienteLiberada` (`:196`, exposto como `emissaoNfseLiberada` em `:246`):
enquanto ele não viajava, o app só descobria o portão **pela recusa**, depois de a pessoa preencher
a nota inteira. ⚠ E **só a flag** — `emissaoClienteLiberadaEm`/`...Por` são auditoria do escritório
e não são dado do cliente. Ampliar esse `select` é por onde vazamento entre lados acontece sem
ninguém notar.

## ⚠ O QUE NÃO EXISTE — e por quê

- **Substituição de NFS-e** — **escopo FECHADO** por decisão do dono, 19/08/2026: *"esqueça
  substituir então, deixe apenas o cancelar."* ⚠ E o impedimento técnico **tinha acabado de cair** (o
  XSD e o ANEXO_I foram versionados horas antes, com o grupo `<subst>` inteiro): quem for construir
  isso está **reabrindo uma decisão, não terminando um trabalho**. O que decidiu foi a regra de
  negócio — E0060/E0061 proíbem a substituta de alterar competência/serviço/local (não optante) e
  tomador/competência/valor (Simples), que é exatamente o que ele queria poder corrigir. Para o uso
  dele, cancelar e emitir nova são dois atos deliberados e resolvem; substituir não.
- **Emissão em lote** — a **leitura** da planilha existe no backend
  (`apps/api/src/application/nfse/lote/`, 12 colunas, classificador puro), mas
  `apps/api/src/routes/nfseLoteRoutes.js` **exporta uma fábrica e não está montado em lugar nenhum**
  (verificado: nenhum `import` fora do próprio teste). **Nada disso emite.** Este portal não tem
  tela para lote.
- **Envio da nota por e-mail ao tomador** — não existe. O campo `tomadorEmail` do formulário vira o
  `<email>` **dentro da DPS** (`nfsePayload.js:150` → `NfseService.js:820`); nós não disparamos
  e-mail nenhum a partir daqui.
- **Detalhe de nota / modal / rota por nota** — a lista é uma tabela de 7 colunas, o `<tr>` não tem
  `onClick`, e o roteamento é por hash com três destinos fixos. A linha inteira **não** virou
  clicável de propósito: ela teria um destino só — a tela que pratica ato fiscal — e clique acidental
  ali é caro.
- **NF-e** — só é capturada da SEFAZ; este portal não a emite nem a cancela.
- **Router, Redux/Zustand, Tailwind, CSS por componente** — nenhum deles. Não introduza sem discutir.

## DEPLOY

Railway com **Root Directory = `apps/portal-cliente-web`**. `Dockerfile` (Vite → `dist/` → Caddy) e
`Caddyfile` são cópias deliberadas de `apps/web` — divergir faria dois serviços irmãos falharem por
motivos diferentes.

⚠ **`railway.toml` próprio existe por causa de uma falha de build real (18/08/2026)**: sem ele o
serviço caía no `railway.toml` da RAIZ, que é o da API, e o build morria em
`COPY apps/api ./apps/api → "/apps/api": not found`. ⚠ Os caminhos ali são relativos ao **root do
serviço**, não ao do repositório.

⚠ **`try_files {path} /index.html` no `Caddyfile`** é o que faz o SPA funcionar: sem ele,
`/redefinir-senha?token=…` — exatamente o que o link do e-mail abre — devolve 404.

⚠ **Variáveis `VITE_*` são de BUILD**, embutidas no bundle; precisam existir como variáveis do
serviço no painel (o Railway as passa como build args). Dev local: `npm run dev`, porta **5210**
(escolhida para não brigar com o portal do escritório).
