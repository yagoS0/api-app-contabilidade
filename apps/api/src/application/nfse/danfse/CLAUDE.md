# DANFSe — apresentação

## Modelo solicitado em 28/09/2026

O usuário forneceu um DANFSe como referência visual. O arquivo e seus dados reais
não devem ser versionados. As amostras e os testes usam apenas o XML sintético
de `docs/leiaute-nfse/nfse-nacional-substituicao.xml`.

- Campos sem grade: moldura externa A4 e linhas horizontais entre seções.
- Cabeçalho cinza, logo oficial ampliada, QR de 1,52 cm preservado.
- Títulos em 7 pt; rótulos em 6 pt; conteúdo em 7 pt; identificação em 7 pt.
- Título do ISSQN na primeira coluna; tipo na segunda; incidência nas duas últimas.
- Moeda/percentual e telefone formatados apenas na apresentação. Traços continuam
  sendo ausência; não inferir impostos nem preencher campos com zero.
- `danfseLeiaute.js` preserva as coordenadas transcritas da NT. Ajustes visuais
  ficam em `danfseApresentacao.js` e no gerador. Não remover o título ISSQN com
  base na antiga sobreposição: sua coluna agora está reservada.
- Sem atribuição ao fornecedor do PDF de referência. Continuam as marcas de
  homologação, cancelamento e substituição, descrição elástica e canhoto opcional.
- Todos os fluxos que usam `gerarDanfse` recebem a mesma apresentação (contador,
  cliente e lote). Não há chamada a provedor nem alteração da emissão nesta mudança.

Validar com as suítes `danfse` e renderizar amostras curta, longa e cancelada com
canhoto. Conferir página única, títulos sem sobreposição e QR decodificável.
As fontes proprietárias continuam opcionais; Helvetica é o fallback já existente,
com o aviso correspondente no relatório de conformidade.

## Ajustes após conferência de notas reais — 28/09/2026

- Percentuais individuais de IBS/CBS chegam como decimal com ponto no XML.
  A apresentação normaliza vírgula e `%`, preservando todas as casas recebidas;
  não arredondar, recalcular nem transformar ausência em zero.
- Simples e regime usam texto multilinha. Medir a altura da linha inteira e
  deslocar os campos seguintes apenas após desenhar os dois campos lado a lado.
  O crescimento consome a mesma folga das informações complementares e preserva
  a página única e o canhoto.
- Validação local: 145 testes em cinco suítes; seis XMLs reais já salvos,
  180 conferências por campo, seis QR Codes e inspeção visual das seis páginas.
  Dados reais e PDFs de evidência permanecem fora do Git. Publicação na main e em
  produção autorizada pelo dono; conferir a revisão implantada e a saúde da API.
