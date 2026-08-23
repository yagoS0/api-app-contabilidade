# CLAUDE.md — PDF Reader / Parser (apps/pdf-reader)

Serviço Python 3.12 + FastAPI para parsing de guias PDF.

## Propósito

Recebe arquivos PDF de guias fiscais (DARF, GPS, FGTS, ISS, etc.), extrai os dados estruturados e retorna JSON para a API principal.

## Estrutura

```
app/
  main.py            - Entry point FastAPI, registra routers
  config.py          - Configurações (env vars, settings)
  routers/           - Endpoints HTTP
  services/          - Lógica de parsing e orquestração
  extractors/        - Extratores específicos por tipo de guia
  __init__.py
Dockerfile
requirements.txt
```

## Padrões

### Endpoints

- Todos os endpoints em `app/routers/`
- Retornar sempre JSON estruturado com campos consistentes
- Em caso de erro de parsing, retornar erro com mensagem clara (não 500 genérico)

```python
# Padrão de resposta de sucesso
{
  "tipo": "DARF",
  "vencimento": "2026-04-30",
  "valor": 1234.56,
  "cnpj": "00.000.000/0001-00",
  "competencia": "03/2026",
  ...
}

# Padrão de resposta de erro
{
  "erro": "Tipo de guia não reconhecido",
  "detalhe": "..."
}
```

### Extractors

- Cada tipo de guia tem seu próprio extrator em `app/extractors/`
- Extratores recebem texto extraído pelo pdfplumber e retornam dict
- Não misturar lógica de extração de diferentes tipos no mesmo arquivo
- Usar regex com nomes de grupo para clareza: `(?P<valor>\d+,\d+)`

### Services

- `app/services/` orquestra: recebe o PDF, chama pdfplumber, identifica tipo, delega ao extrator correto
- Um service central de roteamento (`parser_service.py` ou similar) decide qual extrator usar

## ⚠ SITFIS — leitura POSICIONAL (provada em 21/08/2026, LIGADA em 23/08/2026)

`app/extractors/sitfis_posicional.py` + `prova_sitfis_posicional.py` (na raiz deste app) +
**`app/routers/sitfis.py`**, a porta HTTP.

### ✅ LIGADA (23/08/2026) — e o parser de texto continua VIVO

⚠⚠ **ESTE BLOCO DIZIA "NADA DISTO ESTÁ LIGADO" ATÉ 23/08/2026.** Está ligado. O que **não** mudou:
o parser de texto (`apps/api/src/application/fiscal/serpro/parseSitfisRelatorio.js`) **continua
intacto e continua rodando em produção** — ele é a SEGUNDA OPINIÃO, e o confronto entre as duas
leituras é uma das três provas de fidelidade. Apagá-lo apagaria a prova.

| onde | o quê |
|---|---|
| `app/routers/sitfis.py` | **`POST /sitfis/posicional`** — mesmo corpo do `/extract` (`content_base64`), mesma validação (`decode_base64_pdf`), resposta com **`relatorio`** em vez de `fields` |
| `app/main.py` | registra o router |
| `apps/api/src/modules/pdfReader/pdfReader.service.js` | `postSitfisPosicional`, ao lado de `postExtract` — **mesmo transporte**, não um cliente HTTP novo |
| `apps/api/src/application/fiscal/serpro/lerRelatorioSitfis.js` | o desenho **posicional vence / texto cai**, e o confronto órgão a órgão |
| `apps/api/scripts/reprocessar-sitfis-posicional.mjs` | relê o acervo guardado (**ensaio por padrão**) |

**O desenho, em uma frase:** *a posicional vence quando fecha; quando não fecha, cai para o texto.*
O confronto é **por ÓRGÃO** e usa o MESMO critério da prova (`len(antes) != len(depois)` derruba o
órgão): órgão em que as duas leituras não concordam no número de blocos fica com os blocos do
TEXTO, com o motivo nomeado. Nunca se mistura bloco de uma leitura com bloco de outra no mesmo
órgão, e a posicional nunca faz um bloco desaparecer da tela.

⚠ **O endpoint devolve 422, não 500,** quando a leitura estoura ou quando o PDF não tem seção de
diagnóstico nenhuma (`SITFIS_NO_DIAGNOSTICO`): relatório sem diagnóstico com `success: true` faria
a tela do contador mostrar "nada consta" para uma empresa que pode dever — o erro caro.

⚠ **O CABEÇALHO DO RELATÓRIO CONTINUA VINDO DO TEXTO** (data de emissão, CNPJ/nome). A leitura
posicional ignora de propósito tudo que está antes do primeiro marco de órgão — dados cadastrais,
quadro societário, certidão. Ela responde pelas TABELAS do diagnóstico, não pela capa.

### O que a prova mediu (24 relatórios REAIS, 38 blocos)

| | texto (hoje) | posição |
|---|---|---|
| tabela certa | **31** | **31, IDÊNTICOS** (título, descrição, colunas, registros, anotações, linhas cruas) |
| linhas cruas | 3 (blocos SIDA) | **viraram tabela: 15 inscrições em dívida ativa** |
| só descrição | 4 | 4, iguais |
| coluna trocada | **0** | **0** |

O critério de aceite foi do dono e foi fixado ANTES de rodar: *um só dos 31 diferente e a
abordagem volta para a mesa*. Saíram **31 de 31 idênticos**. Repetir: veja o cabeçalho de
`prova_sitfis_posicional.py` (dois comandos; o PDF vem do banco, **zero chamada ao SERPRO**).

### ⚠ POR QUE A EXTRAÇÃO É POR POSIÇÃO E NÃO POR CONTAGEM DE LINHA

O parser de texto lê o PDF já **achatado numa fila de linhas** (uma célula por linha) e agrupa os
dados de N em N. Isso obriga a rede de proteção a ser **aritmética** (`dados % colunas == 0`) —
desalinhamento múltiplo do número de colunas fecha a divisão e passa, com valor em coluna errada.

⚠ **E remendar o texto não resolve, isso foi MEDIDO:** nos **dois** blocos SIDA do **mesmo** PDF
(90.777.111/0001-45 — ⚠ **CNPJ ANONIMIZADO**: mesmo formato e comprimento do real, dígitos
fabricados, na mesma disciplina das fixtures de `parseSitfisRelatorio.test.js`. A observação é de
produção; só o identificador foi trocado, porque arquivo de repositório entra no histórico do git
para sempre. **Não traga o real de volta**), a coluna `Ajuizado em` é vazia em todos os registros;
no texto achatado essa
célula aparece como linha em branco num bloco e **não aparece no outro**. Não há regra no texto que
diga qual é qual. No PDF a mesma informação é exata: o cabeçalho imprime `Ajuizado em` em x=307,92
e nenhum registro tem palavra naquela faixa. **A célula vazia é um x sem palavra — informação, não
ausência.**

### ⚠ A RÉGUA NÃO É UM LIMIAR INVENTADO: É A LARGURA DO ESPAÇO

Medido nos 24 relatórios: a fonte é **Courier** (monoespaçada), corpos 9/10/12, e um espaço mede
**0,6 × corpo** — 5,40 / 6,00 / 7,20 pt. **2.028 das 2.043** folgas entre palavras vizinhas de
corpo 9 valem 5,40 cravados. Logo: *duas palavras separadas por mais de um espaço estão em células
diferentes*.

⚠ O caso que decide o desenho: no cabeçalho de `Pendência - Débito (SIEF)` a folga entre `Cons.` e
`Situação` é de **7,00 pt** — maior que um espaço e menor que dois. É isso, e só isso, que faz
`Sdo. Dev. Cons.` ser uma coluna e `Situação` ser outra. Nenhum limiar por "gap grande" acerta esse
caso: agrupar por folga relativa juntaria as duas.

### ⚠ AS ARMADILHAS DO PARSER DE TEXTO QUE DEIXAM DE EXISTIR

São artefato do achatamento, não do relatório. Na geometria simplesmente não há o que consertar:

| # (no parser de texto) | por que some |
|---|---|
| 1 · CNPJ colado na 1ª célula do cabeçalho | é uma **linha** própria, com y próprio |
| 2 · cabeçalho da página 2 cortando a tabela | é uma **faixa de y fixa** no topo de toda página (medido: mobília em y 27,9–97,9; conteúdo nunca acima de 125,7) |
| 3 · anotação colada no registro seguinte | a anotação é uma linha própria |
| 4 · célula partida em duas linhas (`2º` + `TRIM/2026`) | a continuação cai na **mesma faixa de x** da célula — `CELULAS_PARTIDAS`, a lista fechada de formatos, deixa de ser necessária |
| 5 · receita sem código (`SIMPLES NAC.`) engolida pela anotação | era efeito da 3 |
| 6 · anotação colada no título do bloco | idem 3 |
| 8 · o mesmo cabeçalho com duas grafias (`Vl. Original` × `Vl.Original`) | o nome da coluna vem do PDF e quem separa as colunas é o **x**, não o nome |

⚠ **O que NÃO some, e por isso continua sendo lista fechada:** `COLUNAS_CONHECIDAS` responde
**onde começa o cabeçalho**, não quais são as colunas. Um bloco pode imprimir descrição e cabeçalho
na MESMA linha (`SIMPLES NACIONAL - EM PARCELAMENTO` em x=12 e `Parcelas em atraso` em x=587) e
nada na geometria separa os dois. Achado o começo, **todos** os grupos daquela linha viram colunas —
e é aí que o SIDA se conserta: o parser de texto precisa reconhecer cada rótulo um a um e para no
primeiro desconhecido (`Inscrito em`), derrubando o resto do cabeçalho para dentro dos dados.
⚠ A lista está **espelhada** do `parseSitfisRelatorio.js`. Duas listas divergentes fariam a mesma
empresa ser lida de dois jeitos.

### ⚠ O MODO DE FALHAR É O DE HOJE: LINHAS CRUAS COM AVISO

Uma linha de débito lida errado é **pior** que uma linha não lida. As três provas moram no código:

1. **cada palavra dentro de uma faixa** — o ponteiro de coluna só avança; palavra cuja coluna mais
   próxima já ficou para trás derruba o bloco; e no fim exige-se **corredor de branco** entre
   colunas vizinhas em toda a altura do bloco;
2. **tipo por coluna** — data em coluna de data, dinheiro em coluna de dinheiro (célula vazia é
   permitida e declarada, porque é informação);
3. **confronto com o texto** — `prova_sitfis_posicional.py` compara o multiconjunto de caracteres
   de cada bloco nas duas leituras. Resultado medido: **29 blocos idênticos caractere a caractere**
   e resíduo total de **`{':' × 15}`** — só o dois-pontos do rótulo `Situação:`, que o parser de
   texto descarta e a leitura posicional guarda como *nome* da anotação. **Zero caractere perdido,
   zero inventado.**

Falhando qualquer uma: `colunas: []`, `registros: []`, linhas cruas em `naoInterpretado` e o motivo
em `aviso`. Experimento executado (pondo `Receita` entre as colunas de dinheiro): os 4 blocos
tabulados do relatório caem para linhas cruas, nomeando `'8109-02 - PIS' não é valor monetário na
coluna 'Receita'`. Nenhuma tabela torta sai.

### ⚠ A PROVA FOI REPETIDA NO CAMINHO LIGADO (23/08/2026)

Não é a mesma medição de 21/08 relida: é a **cadeia inteira** — banco → PDF guardado → HTTP para
este serviço → leitura posicional → confronto com o parser de texto —, rodada por
`apps/api/scripts/reprocessar-sitfis-posicional.mjs` em **ensaio**, contra os 24 relatórios reais:

```
  relatórios no banco ............ 24     sem PDF guardado ............... 0
  leitura posicional falhou ...... 0      IDÊNTICOS ...................... 31
  DIVERGENTES .................... 0      blocos que PASSAM a virar tabela  3
```

Os 3 são `Pendência - Inscrição (SIDA)` (1 registro numa empresa, 7 em outra) e
`Inscrição com Exigibilidade Suspensa (SIDA)` (7) — **15 inscrições em dívida ativa** com
`Inscrição · Receita · Inscrito em · Ajuizado em · Processo · Tipo de Devedor`.

### ⚠ O QUE A PROVA **NÃO** CONSEGUIU (resultado negativo, medido)

Dos 7 blocos que hoje saem crus/só-descrição, **3 viraram tabela e 4 continuam iguais**:

- **`Parcelamento com Exigibilidade Suspensa (PARCSN/PARCMEI)`** (2 blocos) — **não é defeito**: a
  única linha é `SIMPLES NACIONAL - EM PARCELAMENTO`, laudo em texto corrido, sem rótulo nenhum.
  Tabular exigiria inventar cabeçalho. **Não force.**
- **`Omissão de DASN SIMEI`** (1) — o bloco tem duas células (`(Ano-Calendário)` e `2025`) e
  nenhuma delas é rótulo de coluna nem par rótulo/valor. Sai como descrição, exatamente como hoje.
- **`Parcelamento com Exigibilidade Suspensa (SISPAR)`** (1) — o número da conta e a descrição do
  edital **não têm rótulo**; só `Modalidade:` tem. Ler por pares produziria uma tabela de
  modalidades **sem as contas a que elas pertencem** — por isso a leitura por pares exige, no
  máximo, **uma linha solta por registro** (a forma do SIEFPAR: uma modalidade por parcelamento), e
  este bloco não passa. Fica como está.
  - ⚠⚠ **REEXAMINADO AO LIGAR (23/08/2026): CONTINUA SEM FECHAR, E ISSO É RESPOSTA.** É o bloco que
    o dono citou (*"não conseguimos organizar este trecho em tabela"*, `Conta016148291 / TRANSACAO
    POR ADESAO - EDITAL PGDAU N 11/2025… Modalidade: SIMPLES NACIONAL…`). **Não foi forçado.** As
    duas saídas óbvias são as duas proibidas: inventar o cabeçalho (`Conta`, `Edital`) é fabricar
    rótulo em documento fiscal; ler só `Modalidade:` por pares produz uma tabela de modalidades
    **sem as contas**, que afirma menos do que se sabe e parece afirmar mais. Na tela ele continua
    aparecendo INTEIRO, na ordem impressa, com o aviso âmbar de não-interpretado.
    **Tabular este bloco depende de o dono dizer quais são as colunas** — não é trabalho de parser.

### ⚠ O que o dono passa a ver, e o que ainda é decisão dele

As **15 inscrições em dívida ativa** (14 numa empresa, 1 em outra) saem com `Inscrição · Receita ·
Inscrito em · Ajuizado em · Processo · Tipo de Devedor`. A **situação** de cada uma
(`ATIVA A SER COBRADA`, `AJUIZADA`, `NEGOCIADA NO SISPAR`…) vem no campo novo
**`anotacoesPorRegistro`**, amarrada ao registro, com o rótulo que o PDF imprime.

⚠⚠ **E ISSO OBRIGOU UMA MUDANÇA NA TELA, ao ligar (23/08/2026):** até aqui `anotacoes` só podia vir
de uma linha `Notificação de lançamento:` (é a única que o parser de texto reconhece), e a tela
cravava esse rótulo. A leitura posicional lê **qualquer** par `Rótulo: valor`, e o primeiro que ela
trouxe foi `Situação:`. Mantido o rótulo fixo, a aba diria *"Notificação de lançamento: ATIVA A SER
COBRADA"* — **rótulo falso sobre dado fiscal**. Hoje o rótulo sai de `anotacoesPorRegistro`, que é o
que o PDF imprime, e só quando ele cobre exatamente as anotações; qualquer sobra volta ao rótulo de
antes. Nada é inventado e nada é escondido (`SitfisRelatorioTabela.jsx`, `anotacoesComRotulo`).

⚠ **Promover `Situação` a COLUNA da tabela é decisão de produto, não foi feita.** Ela é impressa
numa linha própria, indentada, fora do grid do cabeçalho; transformá-la em coluna funde duas linhas
visuais num registro só. O dado está lá, nomeado pelo próprio relatório — falta o dono dizer como
quer vê-lo. Mesma pergunta vale para `Notificação de lançamento`, que hoje já viaja em `anotacoes`
sem dizer de qual registro é (e passa a dizer, no campo novo).

## Integração com a API

- A API Node.js chama este serviço via HTTP (URL configurada em `PDF_READER_URL`)
- Autenticação entre serviços: verificar se há token interno configurado
- O serviço deve estar rodando na porta **8000** por padrão

## Variáveis de Ambiente

```
PORT      (default 8000)
```

## Regras

- Não usar OCR — depender apenas do pdfplumber (texto nativo do PDF)
- Adicionar novo tipo de guia = novo arquivo em `extractors/` + registro no service
- Manter `requirements.txt` atualizado após instalar dependências
- Não subir arquivos PDF de teste com dados reais de clientes no repositório
- Logs de erro devem incluir o nome do arquivo e tipo de guia tentado
