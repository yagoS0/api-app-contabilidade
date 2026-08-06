# Leiaute da EFD-Contribuições — artefatos oficiais versionados

Passo zero da Entrega 8: o leiaute **não se transcreve nem se deduz** — ele entra no repositório
como artefato oficial e o gerador é implementado registro a registro contra ele. Sem estes arquivos
commitados, implementação de gerador está bloqueada (mesma regra do espelho da DEFIS).

## O que está aqui

| Arquivo | Origem | Baixado em | SHA-256 |
|---|---|---|---|
| `Guia_Pratico_EFD_Contribuicoes_v1.35_2021-06-18.pdf` | `sped.rfb.gov.br/estatico/AD/06A0F5C4E4CC8CA16035EB891A3AE31EA79708/…` | 2026-08-06 | `60eace459169238808e3e745e952fcbbbd2af6b7f933b043e8c9692b68f4d08b` |

4.105.830 bytes, cabeçalho `%PDF-1.7` conferido. É a versão vigente segundo a página de Manuais do
módulo (`sped.rfb.gov.br/item/show/1989`), confirmada em 06/08/2026.

## ⚠ O que NÃO está aqui, e por quê

**As tabelas de códigos 4.3.x** (códigos de receita do M205/M605, CST, e as demais). Elas **não são
arquivos estáticos com URL fixa**: a página oficial de tabelas
(`sped.rfb.gov.br/item/show/1548`) aponta para um consultor ASP.NET com postback —
`www.sped.fazenda.gov.br/spedtabelas/AppConsulta/publico/aspx/ConsultaTabelasExternas.aspx?CodSistema=SpedPisCofins` —
onde se escolhe **pacote** e depois **tabela** em dois `<select>` encadeados. Os pacotes disponíveis
(lidos do HTML em 06/08/2026): Consumo (69), CST (68), Tabelas de Apuração de Contribuição e Crédito
(71), Operações com Contribuição (72), Operações com Crédito (70), Receitas e Deduções/Exclusões
(76), Visão Integrada da DCTF (77), Globais (67).

**Consequência de arquitetura, e ela é a mesma do motor tributário:** as tabelas 4.3.x são **dados
versionados por vigência**, não constantes de código. Elas mudaram quatro vezes só em 2026 (§7 da
especificação). Hardcodá-las repetiria o erro que `tabelasFiscais.js` existe para não cometer.

Baixá-las exige exercitar o postback do consultor — trabalho próprio, com data de vigência por
tabela, que **ainda não foi feito**. Enquanto não for, **o gerador não tem como escriturar M205/M605
com código de receita**, que é registro obrigatório do caminho consolidado do Lucro Presumido.

**A Nota Técnica nº 12/2026** (procedimentos em atendimento à LC 224/2025) também não está aqui —
mesma página dinâmica (`item/show/1837`). Ela conecta com FONTES_FISCAIS §2.4 e afeta CST e ajustes
de alíquota, então é pré-requisito do gerador, não acessório.

## Estado da Entrega 8

O que **está** entregue: o rastro da entrega (upload do arquivo, marca de transmissão no PVA,
recibo) e a **regra de obrigatoriedade** — optante do Simples Nacional não entrega, e a tela diz a
dispensa com a norma citada (`features/obrigacoes/entregas/lib/obrigatoriedadeEfd.js`).

O que **não** está: o gerador do arquivo. Falta o descrito acima, e falta o critério de aceite nº 1
da especificação — **importar e validar no PVA sem erros**. Esse gate não é executável neste
ambiente: o PVA é um programa desktop com assinatura por certificado. Um gerador escrito contra o
Guia e nunca passado pelo validador é exatamente o risco que a especificação nomeia — "arquivo
aceito com dado errado é o risco pior".

## Reconferência da Resolução CGSN 140/2018 (§9 da especificação)

O corpo da resolução resiste a extração automatizada; os **anexos** são baixáveis pela rota
`anexoOutros.action` do portal — ver `docs/fontes-fiscais-inicio-atividade.md`, que é quem depende
dessas transcrições. Os Anexos VI e VII (mapeamento CNAE) fecham o parâmetro "CNAE → anexo" do
FONTES_FISCAIS §9 e ainda não foram carregados.
