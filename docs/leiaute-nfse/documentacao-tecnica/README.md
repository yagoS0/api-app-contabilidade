# Documentação Técnica oficial da NFS-e Nacional — leiaute, XSD e correlação IBS/CBS

Mesma regra de `docs/lista-servico-nacional/`, `docs/leiaute-nfse/` e
`docs/leiaute-efd-contribuicoes/`: leiaute e tabela de código fiscal **não se transcrevem de
memória nem se deduzem por analogia** — entram no repositório como artefato oficial, com URL,
versão, data, tamanho e hash, e o código é conferido campo a campo contra eles.

⚠ **Esta pasta fecha a lacuna que estava escrita em três lugares do projeto**: "o XSD do leiaute
NÃO está versionado neste repositório — não há um único `.xsd` na árvore"
(`apps/api/src/application/nfse/NfseService.js:191-192`,
`apps/api/src/application/nfse/dpsCodigos.js:12-13`, e `docs/leiaute-nfse/README.md`, seção "as
descrições dos códigos"). Agora está. As afirmações que se apoiavam nessa ausência precisam ser
relidas — ver "O que a fonte primária CORRIGIU", no fim.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx` | `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx` | 2026-08-19 |
| `nfse-esquemas_xsd-v1-01-20260209.zip` | `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/nfse-esquemas_xsd-v1-01-20260209.zip` | 2026-08-19 |
| `esquemas-xsd/` | conteúdo extraído do zip acima (ver "Por que o zip E o extraído") | 2026-08-19 |
| `anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-01-00.xlsx` | `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-01-00.xlsx` | 2026-08-19 |

Os dois primeiros vêm da seção **Documentação Atual**; o ANEXO_VIII vem da seção **RTC** (reforma
tributária) da Documentação Técnica do portal `gov.br/nfse` — a mesma pasta `/rtc` de onde veio a
NT 008 do DANFSe.

### Tamanho e SHA-256 (conferidos no download, 19/08/2026)

| Arquivo | Bytes | Tipo real | SHA-256 |
|---|---|---|---|
| `anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx` | 215.196 | OOXML (`PK\x03\x04`), 5 abas | `de5bc492959eadc8bfa7540e16939995924f2188f743648eaf84d3b31e9eeb7c` |
| `nfse-esquemas_xsd-v1-01-20260209.zip` | 65.640 | ZIP, 20 `.xsd` + 4 diretórios | `e7935cbd9470527c6cc32984c1b2263e614183bf0139ce2733eaaed2de9a8072` |
| `anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-01-00.xlsx` | 142.315 | `Microsoft Excel 2007+`, 3 abas | `a21be0e86b7ae2c0c1cfec4ef0d398b96520345790b50f79e4c5b7d1dfe32fb3` |

**Nenhum download veio HTML de erro.** Os três responderam `HTTP 200` com `Content-Type` binário
(`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` nos dois XLSX,
`application/zip` no zip) e os três começam com a assinatura `50 4B 03 04`.

⚠ **Não estranhe o `file` do ANEXO_I.** Ele sai como `Zip archive data`, e não como
`Microsoft Excel 2007+` como o ANEXO_VIII, só porque a ordem interna das entradas do OOXML é
diferente (o `[Content_Types].xml` não é a primeira). O arquivo abre normalmente, com as 5 abas
listadas abaixo. **Não é corrupção nem página de erro.**

## Por que o zip E o extraído

Os dois, de propósito:

- **o zip** é o artefato que corresponde byte a byte à URL — é ele que permite reconferir o
  SHA-256 contra o portal daqui a um ano. É a *procedência*;
- **o extraído** é o que `grep`, `xmllint` e qualquer validador de schema realmente consomem, e é
  a única forma de o diff de uma futura atualização (1.01 → 1.02) ser legível na revisão. Um zip
  no diff é uma linha binária.

⚠ **O extraído NÃO reproduz o zip.** O zip traz dois diretórios **vazios**
(`Schemas/Componente_recepcao/` e `Schemas/Componente_Schemas/`), e git não versiona diretório
vazio. Quem re-zipar a árvore obtém um hash diferente do publicado. Por isso o zip fica: ele é a
prova, o extraído é a ferramenta.

Custo total: 65 KB (zip) + 422 KB (extraído).

### `esquemas-xsd/Schemas/` — o que tem dentro

| Versão | Arquivos | Entrada |
|---|---|---|
| `1.00/` | 10 `.xsd` | `DPS_v1.00.xsd`, `NFSe_v1.00.xsd`, `evento_v1.00.xsd`, `pedRegEvento_v1.00.xsd`, `CNC_v1.00.xsd` |
| `1.01/` | 10 `.xsd` | `DPS_v1.01.xsd`, `NFSe_v1.01.xsd`, `evento_v1.01.xsd`, `pedRegEvento_v1.01.xsd`, `CNC_v1.00.xsd` |

Todos com data interna **11/02/2026**. O peso está em três arquivos por versão:
`tiposComplexos_v1.01.xsd` (116.856 bytes, 324 `xs:element name=`),
`tiposSimples_v1.01.xsd` (70.711 bytes, 138 `xs:simpleType`) e
`tiposEventos_v1.01.xsd` (31.544 bytes).

O `DPS_v1.01.xsd` é só a casca: declara `targetNamespace="http://www.sped.fazenda.gov.br/nfse"`,
o elemento raiz `DPS` do tipo `TCDPS` e inclui `tiposComplexos_v1.01.xsd`. **É em
`tiposComplexos` e `tiposSimples` que está o leiaute.**

**Delta 1.00 → 1.01** (medido por diff dos nomes declarados): entra o bloco inteiro de
**IBS/CBS** (`IBSCBS`, 26 tipos `TCRTC*`, `cClassTrib`, `cCredPres`, `cIndOp`, `cCIB`), entram
`cMotivoEmisTI`, `chNFSeRej`, `CSTReg`, `TCInfoRefNFSe`, `TCInfoItemPed`; **saem**
`TCExploracaoRodoviaria`, `TCLocacaoSublocacao`, `categ`, `categVeic`.
⚠ **`subst`, `cNBS` e `pAliq` são IDÊNTICOS nas duas versões** — mesmo tipo, mesma cardinalidade,
mesma enumeração. Nenhuma das quatro respostas abaixo depende de migrar de 1.00 para 1.01.

### `anexo_i-…​.xlsx` — 5 abas

| Aba | Dimensão | O que é |
|---|---|---|
| `MUN.INCID_INFO.SERV.` | A1:H341 | por `cTribNac`, a regra de **localidade de incidência** (EP / LP / ET / EDEmit) da LC 116/03 e a obrigatoriedade dos grupos `obra` / `atvEvento` |
| `EXPORTACAO_EMISSÃO_NFS-e` | A1:N117 | matriz de cenários de **comércio exterior**: locais declarados × `tribISSQN` × mensagem exibida |
| `RN_RECEPCAO_DPS` | A1:H17 | 16 regras de **recepção** (certificado ICP-Brasil, base 64, namespace, UTF-8, schema) — `E1200`…`E1242` |
| **`LEIAUTE DPS_NFS-e `** | A1:AA417 | **o leiaute**: 415 campos (315 sob `…/DPS/infDPS`, 100 sob `NFSe/infNFSe`), colunas `CAMINHO NO XML · CAMPO · ELE · TIPO · OCOR. · TAM. · DESCRIÇÃO · NOTAS EXPLICATIVAS` |
| **`RN DPS_NFS-e `** | A1:R655 | **as regras de negócio**: 653 linhas, **428 códigos `E####` distintos**, colunas `B` caminho · `C` campo · `D` regra · `F` aplic. · `G` efeito · `H` CÓD. ERRO · `I` MSG. ERRO · `J` nível (1/2/3) · `K–N` quem executa · `O` observações |

⚠ **Nota de método — a planilha tem células mescladas.** Nas abas `LEIAUTE` e `RN`, as colunas
`B` (caminho) e `C` (campo) só são preenchidas na **primeira** linha de cada bloco; as linhas
seguintes do mesmo campo vêm com `B`/`C` vazias. Ler linha a linha sem subir até o cabeçalho do
bloco faz uma regra parecer órfã. Toda citação deste README traz a **linha exata** e, quando ela
herda, o cabeçalho do bloco também.

⚠ **A planilha tem COMENTÁRIOS de célula, e nenhum extrator de tabela os enxerga.**
São 55 em `EXPORTACAO_EMISSÃO_NFS-e` (coluna `J`, texto das mensagens de erro/aviso; coluna `E`)
e 32 em `RN DPS_NFS-e` (coluna `H`, todos com a mesma frase: *"Regra executada somente quando o
emitente da DPS for o tomador ou intermediário do serviço (tpEmit = 2 ou 3)"* — em `H159–H162`,
`H208`, `H210`, `H240`, `H246–H247`, `H250`, `H253–H256`, `H260`, `H278`, `H284–H285`,
`H288`, `H291–H294`, `H298`, `H326`, `H330`, `H414–H415`, `H498–H499`, `H502–H503`).
Quem for atrás de uma regra tem de abrir `xl/comments1.xml` e `xl/comments2.xml` do próprio
`.xlsx`, ou vai concluir um negativo falso.

### `anexoviii-…​.xlsx` — 3 abas

| Aba | Dimensão | O que é |
|---|---|---|
| `REGRA inc. X` | A1:F5 | matriz 2×2 (`P/S onerosa S/N` × `adquirido do exterior S/N`) que produz o `cIndOp` |
| `tabela geral` | A1:L1522 | **o de-para**: `Item LC 116 · Descrição Item · NBS · DESCRIÇÃO NBS · PS ONEROSA? · ADQ EXTERIOR? · INDOP · Local incidência IBS · cClassTrib · nome cClassTrib` |
| `Planilha2` | vazia | — |

⚠ Na `tabela geral` o **Item LC 116 e o `cIndOp`/`cClassTrib` só aparecem na PRIMEIRA linha** de
cada grupo; as linhas seguintes trazem só o `NBS` e a descrição. Ler sem propagar para baixo dá
código faltando em ~2/3 das linhas.
⚠ Este anexo é **IBS/CBS (reforma tributária)**. Ele **não** é a lista NBS do campo `cNBS` da DPS
1.01 — essa continua sendo o **ANEXO_B**, já versionado em `docs/lista-servico-nacional/`, e é o
que a regra `E0316` cita nominalmente.

## Como reobter

1. baixar as três URLs da tabela acima para esta pasta (o portal serve os arquivos direto, sem
   sessão);
2. conferir que a resposta veio `HTTP 200` **com `Content-Type` binário** e que o arquivo começa
   com `50 4B 03 04` — página de erro do gov.br chega como HTML e passa despercebida se só se
   olhar o tamanho;
3. recalcular o SHA-256 e trocar **tamanho, hash e data** nas tabelas acima;
4. reextrair o zip: `unzip -o nfse-esquemas_xsd-*.zip -d esquemas-xsd`;
5. se a versão mudou (1.01 → 1.02), **rever as quatro respostas abaixo antes de mexer em código**
   — cada uma cita linha/elemento, então dá para reconferir uma a uma.

⚠ **Nada aqui é buscado em runtime.** Mesma regra da lista do IBGE e da lista de serviço nacional.

---

# As quatro perguntas, respondidas na fonte primária

Método usado, para quem for reconferir: leitura da planilha por `xlsx` (SheetJS) célula a célula
com endereço (`A509`, `H509`, …) **e**, em cruzamento independente, extração crua do
`xl/sharedStrings.xml` do próprio `.xlsx` via `unzip` + regex — porque este projeto já quase
entregou um negativo falso por falha da ferramenta de extração. Os negativos abaixo estão marcados
com qual dos dois métodos os sustenta.

## 1. `pAliq` — a alíquota de ISS na DPS

**Confirmado, e o que acreditávamos estava incompleto e com o eixo trocado.**

**Cardinalidade e tipo (XSD, autoridade formal):**
`esquemas-xsd/Schemas/1.01/tiposComplexos_v1.01.xsd:1919` —
`<xs:element name="pAliq" type="TSDec1V2" minOccurs="0"/>`, dentro de
`complexType name="TCTribMunicipal"` (linha 1857), que é o tipo de
`NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun`. **`minOccurs="0"`, `maxOccurs` ausente = 1 →
cardinalidade `0-1`, opcional.** Idêntico em 1.00 (`tiposComplexos_v1.00.xsd:1519`).
ANEXO_I, aba `LEIAUTE DPS_NFS-e `, **linha 312** (`#311`): `OCOR. = 0-1`, `TAM. = 1V2`. As duas
fontes concordam.

⚠ **`TSDec1V2` é mais apertado do que "número decimal"** (`tiposSimples_v1.01.xsd:1441-1449`):
`<xs:pattern value="0|[0-9]{1}(\.[0-9]{2})?"/>`. Ou seja: **um único dígito inteiro** e, se houver
casas, **exatamente duas**. `"5.00"` vale, `"2.50"` vale, `"0"` vale; **`"1.8"` é INVÁLIDO**
(tem de ser `"1.80"`) e **`"10.00"` é INVÁLIDO** (o schema teto é 9,99). Cair aqui é falha de
schema, não `E####` — erro mais confuso de diagnosticar.

⚠ **`tribMun` não leva "só `tribISSQN` e `tpRetISSQN`".** O `TCTribMunicipal` tem **sete** filhos,
nesta ordem: `tribISSQN` (1-1) · `cPaisResult` (0-1) · `tpImunidade` (0-1) · `exigSusp` (0-1) ·
`BM` (0-1) · `tpRetISSQN` (1-1) · `pAliq` (0-1).

**`E0617` — texto e condições (ANEXO_I, aba `RN DPS_NFS-e `, linha 509 = RN #506; cabeçalho do
bloco em `B504`/`C504` = `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/` · `pAliq`):**

- `D509` (regra): *"Não é permitido o preenchimento do campo pAliq quando ocorrer as condições
  abaixo simultaneamente: 1) o prestador de serviço seja não optante do Simples Nacional
  (opSimpNac = 1) na data de competência informada na DPS, e 2) o convênio do município de
  incidência do ISSQN está ativo na data de competência informada na DPS;"*
- `H509` = `E0617`; `G509` = `Rej.`; `J509` = nível **3** (regra municipal); `K509` = `V`
  (executada só na recepção de DPS pela Sefin — `L`/`M`/`N` = `X`).
- `I509` (mensagem): *"Não é permitido informar alíquota quando o prestador de serviço não é
  optante do simples nacional (opSimpNac = 1) na data de competência informada na DPS, com o
  município de incidência do ISSQN com situação 'ATIVO' no Sistema Nacional NFS-e."*

⚠ **`opSimpNac = 1` é NÃO OPTANTE**, não "optante" — `LEIAUTE`, linha 141, e
`tiposSimples_v1.01.xsd:996-1011` (`TSOpSimpNac`: 1 Não Optante · 2 MEI · 3 ME/EPP). Quem lê
"opSimpNac = 1" como Simples inverte a regra inteira.

⚠ **As "duas exceções" NÃO batem — são treze regras, e o eixo é outro.** O bloco `pAliq` vai das
linhas **504 a 516** (RN #501–#513) e é uma matriz completa:

| Linha | Erro | Cenário | `pAliq` |
|---|---|---|---|
| 504 | `E0595` | alíquota > 5% | **proibido** (nível 2) |
| 505 | `E0600` | `opSimpNac = 2` (MEI) | **proibido** |
| 506 | `E0602` | `tribISSQN` = 2 (imunidade), 3 (exportação) ou 4 (não incidência) | **proibido** |
| 507 | `E0604` | `regEspTrib` ≠ 0 | **proibido** |
| 508 | `E0612` | benefício municipal do tipo "Isenção" ou "Alíquota Diferenciada" | **proibido** |
| 509 | `E0617` | `opSimpNac=1` + município de incidência **ATIVO** | **proibido** |
| 510 | `E0619` | `opSimpNac=1` + município **NÃO ativo** + `regEspTrib=0` | **OBRIGATÓRIO** |
| 511 | `E0621` | `opSimpNac=3` + `regApTribSN=1` + mun. **ATIVO** + sem BM isenção/dif. + `tpRetISSQN` 2 ou 3 | **OBRIGATÓRIO** (mínimo **1,8%**) |
| 512 | `E0625` | idem, mas `tpRetISSQN = 1` | **proibido** |
| 513 | `E0628` | `opSimpNac=3` + `regApTribSN=1` + mun. **NÃO ativo** + `tpRetISSQN` 2 ou 3 | **OBRIGATÓRIO** (mínimo **1,8%**) |
| 514 | `E0631` | idem, mas `tpRetISSQN = 1` | **proibido** |
| 515 | `E0635` | `opSimpNac=3` + `regApTribSN` 2 ou 3 + mun. **ATIVO** | **proibido** |
| 516 | `E0640` | `opSimpNac=3` + `regApTribSN` 2 ou 3 + mun. **NÃO ativo** | **OBRIGATÓRIO** |

O que muda em relação ao que acreditávamos:

1. **O eixo não é "tributado fora do município" — é "o convênio do município de incidência está
   ATIVO no Sistema Nacional NFS-e".** São coisas diferentes: serviço prestado em outro município
   que TAMBÉM é conveniado e ativo continua **proibindo** `pAliq`. A justificativa está na própria
   descrição do campo no leiaute (`LEIAUTE`, linha 312, coluna NOTAS): *"Se o município de
   incidência pertence ao Sistema Nacional NFS-e a alíquota estará parametrizada e, portanto, será
   fornecida pelo sistema. Se o município de incidência não pertence … deverá ser fornecida pelo
   emitente."*
2. **"Optante com ISS retido" só vale com `regApTribSN = 1`.** Com `regApTribSN` 2 ou 3 a retenção
   é irrelevante: decide só se o município está ativo (`E0635` / `E0640`).
3. **Não é só "pode informar" — em quatro cenários é OBRIGATÓRIO e a omissão REJEITA**
   (`E0619`, `E0621`, `E0628`, `E0640`).
4. Há um **piso** de 1,8% nos dois cenários de Simples com retenção, e um **teto** de 5%
   (`E0595`) — mais apertado que os 9,99 que o schema deixaria passar.

## 2. `dhEmi` retroativo

**Os dois códigos confirmados. O piso existe, mas não é em dias — e por isso a pesquisa anterior
não o achou.**

**`E0008` (ANEXO_I, `RN DPS_NFS-e `, linha 144 = RN #141; `B144` = `NFSe/infNFSe/DPS/infDPS/`,
`C144` = `dhEmi`):** `D144` *"A data de emissão da DPS deve ser anterior ou igual à data e hora do
seu processamento (dhProc) pelo Sistema Nacional NFS-e."* · `H144` = `E0008` · `G144` = `Rej.` ·
`J144` = nível **1** · `K–N` todos `V` (executada em todos os pontos). **Confirmado: `dhEmi ≤
dhProc`.**

**`E0015` (linha 150 = RN #147; `B150` = `NFSe/infNFSe/DPS/infDPS/`, `C150` = `dCompet`):**
`D150` *"A data de competência informada na DPS deve ser anterior ou igual à data de emissão
(dhEmi) da DPS."* · `H150` = `E0015` · nível **1** · `K–N` todos `V`. **Confirmado:
`dCompet ≤ dhEmi`** — e note que a regra está catalogada **sob `dCompet`**, não sob `dhEmi`.

**O piso: existe, e é uma DATA-ÂNCORA, nunca uma contagem de dias.** Logo abaixo, no mesmo bloco
de `dCompet`:

| Linha | Erro | Piso |
|---|---|---|
| 151 | `E0016` | `dCompet ≥` data de **ativação do convênio do município emissor** — *"exceto quando o emitente da DPS for MEI (opSimpNac = 2)"* (nível 1, só Sefin) |
| 152 | `E1270` | mesma regra, executada **só no ADN** (`K/L = X`, `M/N = V`); exige ainda situação do convênio = ATIVO |
| 153 | `E0018` | `dCompet ≥` data de **inscrição do CNPJ** do emitente |
| 154 | `E0020` | `dCompet ≥` data de **inscrição do CPF** do emitente |
| 155 | `E0023` | `dCompet ≥` data do **indicador municipal** registrada no CNC (se houver registro ativo) |
| 156 | `E0025` | `dCompet ≥` data de **autorização de uso dos emissores** para o contribuinte (CNC) |

Combinando com `E0015` (`dCompet ≤ dhEmi`): **`dhEmi ≥ dCompet ≥ max(ativação do convênio,
inscrição do CNPJ/CPF, datas do CNC)`.** O piso do `dhEmi` é, portanto, **transitivo** — e depende
do município e do contribuinte, o que é exatamente a razão de nenhum número em dias aparecer.

⚠ **Negativo confirmado por DOIS métodos independentes: não existe janela nacional em dias.**
Varrendo o `xl/sharedStrings.xml` cru do `.xlsx` (2.579 strings) com `\b\d+\s*(dias|meses|anos)\b`,
**a pasta inteira tem apenas DUAS strings com janela temporal explícita**, e nenhuma delas limita
`dhEmi`:
- *"A data de compartilhamento do DF-e não pode ser posterior à há mais de **6 anos** de sua
  emissão"* — `E1294`, linha 145. ⚠ `K145 = X`, `L145 = X`, **`M145 = V`**: é regra do **ADN, no
  compartilhamento de NFS-e pelos municípios**, não da recepção de DPS. Não é o nosso caminho;
- *"Prazo máximo parametrizável é **2 anos**"* — nota do `chSubstda`, ver pergunta 4.

O mesmo cruzamento mostra que a string `dhEmi` aparece em **3** lugares no arquivo todo: o nome do
campo e os textos de `E0015` (regra e mensagem). O texto de `E0008` diz *"data de emissão da
DPS"*, sem citar a tag — por isso um grep ingênuo por `dhEmi` acha 2 e não 3 regras.

## 3. `cNBS`

**Cardinalidade formal confirmada. Mas "não é obrigatório" está ERRADO como afirmação geral, e o
`E0316` EXISTE na fonte oficial.**

**Cardinalidade (XSD):** `tiposComplexos_v1.01.xsd:1349` —
`<xs:element name="cNBS" type="TSCodNBS" minOccurs="0"/>`, dentro do grupo
`NFSe/infNFSe/DPS/infDPS/serv/cServ`. **`minOccurs="0"` → `0-1`.** Tipo
`TSCodNBS` (`tiposSimples_v1.01.xsd:1369-1379`): `<xs:pattern value="[0-9]{9}"/>` — **exatamente
9 dígitos**, string, não número. ANEXO_I, `LEIAUTE`, **linha 198** (`#197`): `OCOR. = 0-1`,
`TAM. = 9`. Idêntico em 1.00 (`tiposComplexos_v1.00.xsd:901`). O achado empírico (DPS sem `cNBS`
aceita) está certo **para o cenário que testamos**.

**`E0316` EXISTE, é oficial, e pune NBS INVÁLIDO — não ausente.**
ANEXO_I, `RN DPS_NFS-e `, **linha 324** (RN #321; `B324` = `NFSe/infNFSe/DPS/infDPS/serv/cServ/`,
`C324` = `cNBS`):

- `D324` (regra): *"O código da lista NBS informado na DPS não existe, conforme tabela NBS do
  ANEXO_B-NBS2-LISTA_SERVICO_NACIONAL-SNNFSe do Manual Integrado do Sistema Nacional NFS-e."*
- `I324` (mensagem): *"Código da lista NBS informado inexistente tabela de NBS do sistema."*
- `G324` = `Rej.` · `J324` = nível **2** · `K324` = `V` (Sefin), `M324` = `V` (ADN).

Os quatro fornecedores estavam certos quanto à existência, e a regra é **de validação de conteúdo**
(*"informado … não existe"*), disparando só quando o campo **vem preenchido com código fora da
tabela**. A tabela citada é o **ANEXO_B**, que já está versionado em
`docs/lista-servico-nacional/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx`, aba `LISTA.NBS_v2.0`
(1.211 linhas) — a aba que o README daquela pasta declara **"não usada"**.

⚠ **E há TRÊS regras que tornam o `cNBS` OBRIGATÓRIO**, apesar do `0-1` do schema (linhas
325–327, RN #322–#324, herdando `C324 = cNBS`):

| Linha | Erro | Quando `cNBS` passa a ser obrigatório |
|---|---|---|
| 325 | `E0318` | emitente é o prestador (`tpEmit=1`) **e** país do tomador no exterior, ou país do intermediário no exterior, ou `cPaisPrestacao` informado → **exportação de serviço** |
| 326 | `E0320` | emitente é tomador (`tpEmit=2`) ou intermediário (`tpEmit=3`) **e** país do prestador no exterior ou `cPaisPrestacao` informado → **importação de serviço** |
| 327 | `E0322` | o bloco `NFSe/infNFSe/DPS/infDPS/IBSCBS` for informado na DPS |

Todas nível 2, `Rej.`, executadas na Sefin (`K = V`) e no ADN (`M = V`).
A linha 326 (`E0320`) tem **comentário de célula** em `H326` — *"Regra executada somente quando o
emitente da DPS for o tomador ou intermediário do serviço (tpEmit = 2 ou 3)"* — invisível para
extrator de tabela.

## 4. O grupo `<subst>`

### Onde mora e o que tem dentro

**Posição na árvore (XSD, `tiposComplexos_v1.01.xsd:806-810`, dentro do `xs:sequence` de
`TCInfDPS`):**

```
DPS/infDPS/
  tpAmb · dhEmi · verAplic · serie · nDPS · dCompet · tpEmit
  cMotivoEmisTI (0-1) · chNFSeRej (0-1) · cLocEmi
  subst          ← AQUI, entre cLocEmi e prest
  prest · toma (0-1) · interm (0-1) · serv · valores · IBSCBS (0-1)
```

⚠ `xs:sequence` é **ordenada**: `<subst>` vai **depois de `</cLocEmi>` e antes de `<prest>`**.
No nosso gerador isso é entre a linha **780** (`<cLocEmi>`) e a **782** (`<prest>`) de
`apps/api/src/application/nfse/NfseService.js`. Fora dessa posição é falha de schema.

**Estrutura completa (`complexType name="TCSubstituicao"`, `tiposComplexos_v1.01.xsd:849-875`;
confirmada em `LEIAUTE`, linhas 113–116, RN #112–#115):**

| Elemento | Tipo XSD | Ocorrência | Restrição |
|---|---|---|---|
| `subst` | `TCSubstituicao` | **0-1** (`minOccurs="0"`) | grupo — *"Dados da NFS-e a ser substituída"* |
| └ `chSubstda` | `TSChaveNFSe` | **1-1** | `[0-9]{50}`, `maxLength 50` — chave de acesso da NFS-e **a ser substituída** |
| └ `cMotivo` | `TSCodJustSubst` | **1-1** | enumeração fechada — ver abaixo |
| └ `xMotivo` | `TSMotivo` | **0-1** | `minLength 15`, `maxLength 255` |

### A lista oficial do `cMotivo` — e uma DIVERGÊNCIA entre as duas fontes oficiais

**`tiposSimples_v1.01.xsd:235-256`, `simpleType name="TSCodJustSubst"`, `xs:restriction
base="xs:string"`:**

```
<xs:enumeration value="01"/>   01 - Desenquadramento de NFS-e do Simples Nacional
<xs:enumeration value="02"/>   02 - Enquadramento de NFS-e no Simples Nacional
<xs:enumeration value="03"/>   03 - Inclusão Retroativa de Imunidade/Isenção para NFS-e
<xs:enumeration value="04"/>   04 - Exclusão Retroativa de Imunidade/Isenção para NFS-e
<xs:enumeration value="05"/>   05 - Rejeição de NFS-e pelo tomador ou pelo intermediário
                                    se responsável pelo recolhimento do tributo
<xs:enumeration value="99"/>   99 - Outros
```

**Idêntico em 1.00** (`tiposSimples_v1.00.xsd`, mesmas 6 enumerações) e **idêntico no evento**
(`tiposEventos_v1.01.xsd:267`, `e105102/cMotivo` é do mesmo `TSCodJustSubst`, com a nota
*"Obtido do campo da DPS 'DPS/infDPS/subst/cMotivo'"*).

⚠⚠ **O ANEXO_I DISCORDA DO XSD, e o ANEXO_I é que está errado.** `LEIAUTE`, linha 115, descreve
*"1 - Desenquadramento … 5 - Rejeição … 99 - Outros"* (um dígito) e declara **`TAM. = 1`** — que
é internamente incoerente com o próprio `99` que a mesma célula lista. **Vale o XSD**: são
**strings de 2 caracteres, com zero à esquerda** (`"01"`…`"05"`, `"99"`). Enviar `"1"` é falha de
schema.

Isso **confirma o que o projeto já fazia**: `NfseService.js:240` grava
`normalizeDigits(cMotivo).padStart(2,"0").slice(-2)` e o comentário da linha 234 (*"`cMotivo` do
e105102 tem TAMANHO 2 (01, 02, 03, 04, 05, 99)"*), que vinha do ANEXO_II, agora tem também o XSD
por trás. **O "01…05, 99 sem fonte" passou a ter fonte primária.**

### As regras de negócio que cercam a substituição

Bloco `subst`, ANEXO_I `RN DPS_NFS-e `, linhas **169–187** (RN #166–#184). Cabeçalho do bloco em
`B170`/`C170` (`NFSe/infNFSe/DPS/infDPS/subst` · `chSubstda`) — as linhas 171–185 **herdam** esse
cabeçalho.

**O que pode ser substituído (todas `Rej.`):**

| Linha | Erro | Regra | Nível |
|---|---|---|---|
| 170 | `E0042` | chave inválida: DV errado, **ou** os campos Cód.Mun./Tipo de Inscrição/Inscrição da chave não baterem com o `Id` desta DPS | 1 |
| 171 | `E0044` | NFS-e **inexistente** na base do autorizador nacional | 1 |
| 172 | `E0046` | **NFS-e cancelada não pode ser substituída** | 1 |
| 174 | `E0056` | NFS-e **sem identificação do tomador**, conforme parametrização do município emissor | 3 |
| 175 | `E0058` | substituição **com alteração da identificação do não emitente**, conforme parametrização | 3 |
| 176 | `E0060` | com `opSimpNac = 1`: **não podem ser alterados** `dCompet`, subitem da lista nacional, código complementar municipal e local da prestação | 2 |
| 177 | `E0061` | com `opSimpNac = 2` ou `3`: **não podem ser alterados** identificação do tomador (se identificado), `dCompet` e `vServ` | 2 |
| 178 | `E0065` | NFS-e gerada em **ambiente gerador diferente** | 1 |
| 179 | `E0068` | NFS-e com **Solicitação de Análise Fiscal para Cancelamento aguardando resposta** | 1 |
| 180 | `E0070` | NFS-e com **Evento de Manifestação de Confirmação** | 2 |
| 181 | `E0072` | NFS-e com **Manifestação de Confirmação Tácita** | 2 |
| 182 | `E0074` | NFS-e com **Evento de Tributos Recolhidos** vinculado, conforme parametrização do município de incidência (⚠ `O182`: *"Aguarda para Implementar no Contexto do MAN"*) | 3 |
| 183 | `E0076` | NFS-e com **Bloqueio de Ofício** vigente para o Evento de Cancelamento por Substituição | 1 |
| 187 | `E0078` | `cMotivo = 99` **exige** `xMotivo` | 1 |

⚠ **`E0060` e `E0061` são a regra que mais muda o desenho de tela**: a substituição **não é uma
nota nova livre**. Para não optante, competência, código de serviço e local da prestação ficam
travados; para Simples (MEI e ME/EPP), competência, valor do serviço e tomador ficam travados.
Uma UI que ofereça "corrigir o valor" numa nota de empresa do Simples produz `E0061`.

**Prazo (`E0050`, linha 173, RN #170):** *"Não poderá ocorrer a substituição de NFS-e fora do prazo
permitido, **conforme parametrização do município emissor** da NFS-e, **exceto** quando a
justificativa for Desenquadramento ou Enquadramento de NFS-e no Simples Nacional (cMotivo = 1 ou
2)."* Nível 3. **Não há prazo nacional**: o teto do que o município pode parametrizar é **2 anos**
— `LEIAUTE`, linha 114, coluna NOTAS EXPLICATIVAS: *"O município conveniado … deverá parametrizar
o prazo máximo permitido … **Prazo máximo parametrizável é 2 anos**."*
⚠ (A mesma célula usa `cMotivo = 1 ou 2` — a grafia de 1 dígito do ANEXO_I. São `"01"`/`"02"`.)

A mesma nota do `chSubstda` traz mais duas parametrizações municipais: se o município **impede ou
não** a substituição de nota sem NI do tomador (é o `E0056`), e a regra de que *"um evento de
bloqueio de ofício para qualquer outro tipo de evento é considerado vigente se não há um
correspondente evento de desbloqueio de ofício que contemple o tipo de evento bloqueado"* (é o
`E0076`).

**O que acontece com a original — e a ORDEM, agora com fonte:**
o `e105102` ("Cancelamento de NFS-e por Substituição") é gerado sobre a **substituída** e carrega
`chSubstituta` (`tiposEventos_v1.01.xsd:289-293`, `TSChaveNFSe`, **1-1**), enquanto a DPS da
substituta carrega `chSubstda`. As duas pontas apontam uma para a outra, em sentidos opostos.
Duas regras do ADN fixam a ordem (linhas 184–185, `K/L = X`, `M/N = V` — regras de
compartilhamento do município com o ADN, não da nossa recepção):

- `E1308`: *"Uma NFS-e substituta não pode ser compartilhada com o ADN … antes que o cancelamento
  por substituição de NFS-e da nota a ser substituída tenha sido compartilhada anteriormente."*
- `E1310`: *"… antes que o evento de cancelamento por substituição … contenha a referência ao
  identificador da NFS-e substituta"*, isto é, o `e105102/chSubstituta` tem de já apontar para ela.

⚠ **Nada nesta fonte diz que o emitente ENVIA o `e105102`.** Ele aparece como evento **vinculado a
uma NFS-e existente** (`pedRegEvento/infPedReg/chNFSe`), e o `chSubstituta` é `1-1`: não existe
evento de substituição válido antes de a substituta existir. Isso é **coerente com o veto já
registrado** em `apps/api/CLAUDE.md:612-616` e `NfseService.js:1056-1077` — o caminho de `sendEvent`
está invertido. **O ANEXO_I não é o documento que descreve o verbo HTTP**; quem afirma "substituir
é `POST /nfse` com `<subst>`" continua sendo o Manual dos Contribuintes §1.3.2.a, que **não está
versionado aqui**.

---

# O que a fonte primária CORRIGIU — releia estas linhas do repositório

| Onde | O que está escrito | O que a fonte primária diz |
|---|---|---|
| `apps/api/src/application/nfse/NfseService.js:191-192` | *"o XSD NÃO está versionado neste repositório — não há um único `.xsd` na árvore"* | **Falso a partir desta entrega**: 20 `.xsd` em `docs/leiaute-nfse/documentacao-tecnica/esquemas-xsd/Schemas/` |
| `apps/api/src/application/nfse/dpsCodigos.js:12-18` | *"⚠ O XSD do leiaute NÃO está versionado … NENHUMA linha destas tabelas pode se apoiar no schema oficial"* + `verificadoNoLeiaute: false` em todas as entradas | O schema está aqui. `opSimpNac`, `regApTribSN`, `tpRetISSQN`, `regEspTrib`, `tribISSQN`, `tpImunidade` têm enumeração fechada em `tiposSimples_v1.01.xsd` |
| `apps/api/src/application/nfse/dpsCodigos.js` — `MEI_NAO_MAPEADO` (MEI recusa porque *"o `2` do MEI tem só um comentário de código"*) | MEI fica de fora | **`opSimpNac = 2` é oficialmente MEI**: `tiposSimples_v1.01.xsd:996-1011` (`TSOpSimpNac`) e `LEIAUTE` linha 141. ⚠ A recusa pode continuar por outros motivos (`E0600` proíbe `pAliq` de MEI, `E0016` isenta MEI da data de convênio, `E0676` proíbe `tribFed` de MEI) — mas **não mais por falta de fonte do código** |
| `apps/api/CLAUDE.md:685-687` | *"a **alíquota de ISS não entra na DPS que enviamos** — `infDPS/…/trib/tribMun` leva só `tribISSQN` e `tpRetISSQN`"* | Verdade sobre **o que o gerador faz**, não sobre o leiaute. `TCTribMunicipal` tem 7 filhos, e `pAliq` é **obrigatório** em 4 cenários (`E0619`/`E0621`/`E0628`/`E0640`) |
| `NfseService.js:853-856` — `<tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>…</tpRetISSQN></tribMun>` | `tribISSQN` cravado em `1`, sem `pAliq` | Se o município de incidência **não estiver ativo** no SN NFS-e, a DPS é rejeitada por `E0619` (não optante) ou `E0640` (ME/EPP fora do SN). Hoje não há como preencher — **lacuna, não erro de escrita** |
| `docs/lista-servico-nacional/README.md` | aba `LISTA.NBS_v2.0` *"**não usada** (o `cNBS` é campo opcional da DPS e ninguém o preenche neste projeto)"* | É **exatamente** a tabela que o `E0316` cita nominalmente, e o `cNBS` deixa de ser opcional em exportação (`E0318`), importação (`E0320`) e IBS/CBS (`E0322`) |
| `docs/leiaute-nfse/README.md` — *"O leiaute (XSD / Anexo I …) não está versionado neste repositório"*, e `danfseDescricoes.js` nasce vazio | os 12 campos codificados do DANFSe ficam sem descrição | **As descrições existem** — `cStat` (leiaute linha 18: 100 Gerada · 102 Decisão Judicial/Administrativa · 103 Avulsa · 107 MEI), `opSimpNac`, `regApTribSN`, `tribISSQN`, `tpRetISSQN`, `tpImunidade` já foram lidas aqui, e as demais estão nas mesmas duas fontes. ⚠ **Preencher `danfseDescricoes.js` é trabalho de código e NÃO foi feito nesta rodada** |
| `apps/api/CLAUDE.md` — leiaute 1.01 *"o projeto **não tem o XSD versionado** … Subir sem schema para validar troca uma rejeição conhecida por uma desconhecida"* | argumento para não migrar | O argumento **caiu**. E o delta está medido: `subst`, `cNBS` e `pAliq` são idênticos em 1.00 e 1.01; o que 1.01 acrescenta é IBS/CBS (facultativo), `cMotivoEmisTI` e `chNFSeRej` |

## O que continua SEM resposta

- **A data de corte do `E0001`/`E1260`** (expiração da versão do leiaute) não está em nenhum dos
  três arquivos. Verificado nos dois métodos.
- **O verbo/endpoint da substituição.** O ANEXO_I descreve leiaute e regras, não a API. "Substituir
  é `POST /nfse` com `<subst>`" continua se apoiando no **Manual dos Contribuintes §1.3.2.a**, que
  **não está versionado aqui**. O Manual e o ANEXO_II (eventos) são os próximos candidatos.
- **A forma da resposta de ERRO** do sistema nacional (a árvore de campos que carrega o `E####`).
  O ANEXO_I dá o código e a mensagem, não o envelope.
- **A lista de códigos do MUNICÍPIO (`cTribMun`)** — continua sem fonte nacional, como já dizia
  `docs/lista-servico-nacional/README.md`. `E0314` confirma que quem a administra é cada município.
- **Quais municípios estão "ATIVO" no Sistema Nacional NFS-e** — é o eixo de metade das regras de
  `pAliq`, e essa lista **não é um dos três arquivos**. Sem ela não dá para saber, antes de enviar,
  se `pAliq` é obrigatório ou proibido.

## ⚠ O que NÃO pode entrar nesta pasta

Vale aqui a mesma proibição de `docs/leiaute-nfse/README.md`: **NFS-e real de contribuinte não é
versionada** — nem como fixture, nem como exemplo, nem como anexo de documentação. Os arquivos
desta pasta são leiaute e tabela pública, sem um único dado de contribuinte.
