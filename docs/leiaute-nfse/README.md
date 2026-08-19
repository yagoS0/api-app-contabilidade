# Leiaute da NFS-e Nacional — artefatos oficiais versionados

Mesma regra do `docs/leiaute-efd-contribuicoes/`: leiaute **não se transcreve de memória nem se
deduz por analogia** — ele entra no repositório como artefato oficial, com URL, versão, data e
hash, e o gerador é implementado campo a campo contra ele.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `NT_008_SE_CGNFSe_DANFSe_v1.02_2026-07-14.pdf` | `https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf` | 2026-08-14 |
| `nfse-nacional-substituicao.xml` | amostra de leiaute 1.01 (identificadores fabricados — ver o cabeçalho do próprio arquivo) | — |
| **`documentacao-tecnica/`** | ANEXO_I (leiaute DPS/NFS-e + regras de negócio), **esquemas XSD 1.00 e 1.01** e ANEXO_VIII (de-para Item/NBS/IndOp/cClassTrib) — ver o `README.md` da subpasta | 2026-08-19 |

⚠ **A afirmação "o leiaute (XSD / Anexo I) não está versionado neste repositório", repetida
abaixo e em `NfseService.js:191` / `dpsCodigos.js:12`, DEIXOU DE VALER** — ver
`documentacao-tecnica/README.md`, seção "O que a fonte primária CORRIGIU". As consequências
adotadas a partir dessa ausência (entre elas `danfseDescricoes.js` nascer vazio) precisam ser
revistas; **nada de código foi alterado nesta rodada.**

**NT 008, versão 1.02, de 14/07/2026** — "Especificações Técnicas do DANFSe", SE/CGNFS-e.
1.201.429 bytes, `%PDF-1.7`, 26 páginas,
SHA-256 `1265f403aedcdc5f08b3049dcc18a15c2bc155f51afccf3d12690fef2f4fb0ff`.
Localizada na seção **RTC** da Documentação Técnica do portal `gov.br/nfse` (a página de
Documentação Técnica não lista o arquivo; ele está sob `/rtc`).

Histórico de versões declarado pela própria NT (p. 5): 1.0 (sem data) → **1.01** (30/06/2026,
alteração da data de suspensão da API) → **1.02** (14/07/2026, alteração da data de suspensão da
API; quantidade de caracteres dos campos; ajuste no tratamento de `vPis`, `vCofins` e
`tpRetPisCofins`; outras correções pontuais).

## Por que o DANFSe passou a ser nosso

A NT diz o motivo com todas as letras (item 1, p. 6):

> "Esta nota técnica servirá de base para a geração do DANFSe por meios de softwares de emissão de
> NFS-e, ERPs e sistemas fiscais, motivo pelo qual, a API de geração do DANFSe
> (https://adn.nfse.gov.br/danfse/docs/index.html) será sobrestada (suspensa) na data de 03 de
> agosto de 2026."

Instituição do documento: **Res. CGNFS-e nº 3/2023, art. 13** — o DANFSe "não poderá conter
informações que não existam no arquivo XML". A NT repete a regra em §2.1: *"Não poderão ser
impressas informações que não constem do arquivo da NFS-e."*

## As regras que governam o desenho (conferidas na NT, com o item de origem)

| Regra | Item |
|---|---|
| Qualquer tipo de papel, **exceto papel jornal**; contraste suficiente para o QR Code | §2, §2.2 |
| **Via única**, salvo disposição expressa em outro sentido | §2 |
| **Obrigatoriamente em uma única página** | §2.2 |
| Modo **retrato**, formulário de tamanho **mínimo A4** (210 × 297 mm) | §2.2.1 |
| Margens de **0,15 cm (mín.) a 0,20 cm (máx.)** em cada lateral, inclusive superior e inferior | §2.2.2 |
| Linhas divisórias de **0,5 pt**; borda da página de **1 pt** | §2.2.3 |
| Sombreamento **cinza claro (5%)** no cabeçalho, nos títulos de bloco e nos campos "Emitente da NFS-e" e "Valor Líquido da NFS-e + IBS/CBS"; branco (0%) no resto | §2.2.3 |
| Fontes: **Arial** nos títulos/labels, **Microsoft Sans Serif** nos conteúdos, preto sólido (K100), espaçamento normal | §2.4 |
| Títulos de **bloco**: 7 pt, negrito, CAIXA ALTA | §2.4.1 |
| Títulos de **campo**: 6 pt, negrito, Primeira Letra Maiúscula — **exceto** os do bloco "Dados de Identificação da NFS-e", que são 7 pt, negrito, CAIXA ALTA | §2.4.2 |
| Conteúdo dos campos: **7 pt**, normal | §2.4.3, §2.4.4 |
| Cabeçalho: logomarca à esquerda; ao centro "DANFSe v2.0" + "Documento Auxiliar da NFS-e" em **9 pt Arial negrito**; à direita município (8 pt), ambiente gerador e tipo de ambiente (6 pt), em Microsoft Sans Serif | §2.4.3 |
| **Chave de acesso impressa em bloco único de 50 dígitos** | §2.1.1 |
| **QR Code** à direita dos campos de identificação, mínimo **1,52 × 1,52 cm**, em X **17,48 cm** / Y **1,67 cm** | §2.4.3 |
| Conteúdo do QR Code: `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=` **+ a chave de acesso** | §2.4.3 |
| Abaixo do QR, em **3 linhas, 6 pt**: "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e" | §2.4.3 |
| **`tpAmb` = 2 (Homologação)** → "NFS-e SEM VALIDADE JURÍDICA" no cabeçalho, abaixo de "Documento Auxiliar da NFS-e", **negrito, 9 pt, Arial, vermelho sólido (M100/Y100)** | §2, §2.4.3 |
| NFS-e **cancelada** → marca d'água diagonal "CANCELADA", mínimo **50 pt**, Arial, cinza **K35** | §2.5.1 |
| NFS-e **substituída** → marca d'água diagonal "SUBSTITUÍDA", mesmas características | §2.5.2 |
| Totais Aproximados de Tributos (Lei 12.741/2012) vão em **Informações Complementares**, e são **obrigatórios** | §2, nota 10 |

### ⚠ O que a NT resolve e que costuma ser suposto errado

1. **Campo sem informação no XML NÃO some — leva um traço.** Nota 12 do item 2.4.5: *"Os campos sem
   informações no XML devem ser preenchidos com um traço (-)"*. Isso **não** conflita com o art. 13:
   o traço marca ausência, não inventa conteúdo. Suprimir a linha inteira só é permitido nos casos
   nomeados (notas 1 e 5, e as supressões do §2.3).
2. **O DANFSe não tem tabela de itens.** Não existe grupo repetitivo de produtos/serviços como no
   DANFE da NF-e: há **um** campo `xDescServ` (limite sugerido de 1.300 caracteres) e **um** campo de
   informações complementares (2.000). Logo, "nota com muitos itens" não é o caso que estoura a
   página.
3. **O transbordo é resolvido por truncamento, não por segunda página.** §2.1: a quantidade de
   caracteres sugerida "não tem caráter obrigatório, podendo-se utilizar quantidade diversa,
   **acrescido de reticências (...)**, quando o campo não suportar a totalidade de caracteres do
   texto a ser inserido". A própria tabela do §2.4.5 dá o corte por campo (ex.: `xDescServ` em 1.297
   + "...", informações complementares em 1.997 + "...", nomes em 77 + "...").
4. **Folga de espaço vem de supressão de bloco, não de nova página** (§2.3): tomador/destinatário/
   intermediário/ISSQN não preenchidos viram uma linha única de texto ("… NÃO IDENTIFICADO NA
   NFS-e"), e a altura liberada é transferida para "Descrição do Serviço" e/ou "Informações
   Complementares". Limitação de impressora (§2.5.3) reduz **só** o bloco de Informações
   Complementares.
5. **O bloco "Canhoto" é opcional** (nota 11).

### ⚠ A NT é do DANFSe **v2.0**, que é multitributário — e o nosso XML é 1.01

O cabeçalho impresso é literalmente `DANFSe v2.0` e o leiaute traz um bloco inteiro de
**Tributação IBS/CBS** (§2.1.10), além de `finNFSe`, do bloco "Destinatário da Operação" e dos
totais `vTotNF` / `vIBSTot` / `vCBS`. Todos esses campos vêm dos grupos `IBSCBS` —
`NFSe/infNFSe/DPS/infDPS/IBSCBS/…` e `NFSe/infNFSe/IBSCBS/…` — que **não existem no leiaute 1.01**,
que é o das notas que este projeto captura e da amostra versionada aqui. Pela nota 12 esses campos
saem com traço. Ver `apps/api/src/application/nfse/danfse/danfseLeiaute.js`, constante
`CAMPOS_SEM_FONTE_NO_LEIAUTE_1_01`.

A NT também anuncia (item 1) que **haverá nota técnica específica** para o DANFSe das operações que
passam a ser fato gerador de IBS/CBS sem serem, hoje, formalizadas por documento fiscal (seção
"3.a)" da NT nº 007, de 07/02/2026). Essa nota **não está aqui**.

### ⚠ A descrição do serviço NÃO é um dos códigos pendentes — ela vem no XML

O DANFSe imprime, acima do rótulo "Descrição do Serviço" e **sem rótulo próprio**, a descrição do
código de tributação: §2.4.5, campo "DESCRIÇÃO DO CÓDIGO DE TRIBUTAÇÃO NACIONAL / MUNICIPAL",
`xTribNac + xTribMun`, em `NFSe/infNFSe/`, com a regra *"SE xTribMun <> '' ENTÃO Descrição Municipal
SENÃO Descrição Nacional"*. A NFS-e devolvida já traz o texto pronto (a amostra versionada aqui tem
as duas tags), então **não falta tabela nenhuma para este campo** e o art. 13 é respeitado por
construção. Não confundir com os doze campos codificados da seção seguinte.

### ⚠ O que a NT manda imprimir e o projeto **não tem como resolver**: as descrições dos códigos

Em doze campos a NT manda *"utilizar a descrição das opções previstas no leiaute"* (`tpEmit`,
`cStat`, `finNFSe`, `opSimpNac`, `regApTribSN`, `tribISSQN`, `tpRetISSQN`, `regEspTrib`,
`tpImunidade`, `tpSusp`, `tpBM`, `tpRetPisCofins`). **O leiaute (XSD / Anexo I da documentação
técnica) não está versionado neste repositório** — é a mesma ausência já registrada em
`apps/api/src/application/nfse/dpsCodigos.js`. A NT dá apenas *exemplos* de descrição, e sem dizer a
qual número cada uma corresponde.

Consequência adotada: `danfseDescricoes.js` nasce **vazio**, o DANFSe imprime o **código cru do
XML** (que é conteúdo do arquivo, portanto conforme o art. 13) e o gerador devolve a lista de campos
nessa condição em `conformidade.descricoesPendentes`. Preencher esse mapa por analogia com a NF-e ou
por leitura de blog seria inventar tabela de código fiscal.

## Conferência contra um DANFSe oficial (2026-08-14)

O dono forneceu **um DANFSe real, gerado pelo sistema oficial**, e o gerador foi comparado com ele
rótulo a rótulo e bloco a bloco.

⚠ **Esse arquivo NÃO está aqui e não pode entrar**: é nota fiscal de contribuinte, com CNPJ,
endereço, telefone e e-mail de prestador **e** de tomador — a mesma classe de arquivo que já foi
versionada por descuido uma vez e continua na história do git. Nada dele virou fixture, teste,
exemplo ou linha desta documentação; ele serviu para ler **leiaute**, e só.

O que a conferência mudou está em `apps/api/CLAUDE.md`, seção "CONFERIDO CONTRA UM DANFSe OFICIAL":
o que a NT já exigia e não estava feito (rótulos do §2.4.2, sombreamento do §2.2.3, máscaras do
§2.4.5, nota 5, nota 12 em campo composto) e, separadamente, **onde o oficial e a NT discordam** —
nesses casos vale a NT, e a divergência fica escrita para o dono decidir.

## Modelo visual (Anexo I)

O Anexo I (pp. 25–26 do PDF) é uma **imagem** e não foi transcrito: a disposição obrigatória dos
campos foi reconstruída a partir da tabela de coordenadas do §2.4.5, que é numérica e completa
(altura, largura, distância da margem esquerda e do topo, em centímetros, para cada campo). Quem for
conferir o resultado contra o modelo precisa abrir o PDF.
