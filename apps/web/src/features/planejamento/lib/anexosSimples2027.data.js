// ⚠⚠ ARQUIVO GERADO — NÃO EDITAR À MÃO.
//
// Fonte: docs/reforma-consumo/lcp214.htm (Planalto, texto compilado, ISO-8859-1)
//        SHA-256 6f3e19fefd0b4e11839c6ea4a9d18dfaec57b6c1025352b8a83c367a9267ad40
// Gerador: apps/api/scripts/gerar-anexos-simples-2027.mjs
//
// ANEXOS I A V DA LC 123/2006 na redação dada pelo art. 519 da LC 214/2025 (Anexos XVIII a XXII
// daquela lei). ⚠⚠ VIGÊNCIA: 1º/01/2027 a 31/12/2028 — e SÓ ela está aqui.
//
// ⚠⚠ EM 2026 ESTES ANEXOS NÃO VALEM. O art. 544, III da LC 214 (redação da LC 227/2026) só põe o
// art. 519 em vigor em 1º/01/2027; até lá valem os anexos antigos, sem CBS e sem IBS na partilha.
// ⚠⚠ E PARA O OPTANTE DO SIMPLES, EM 2026, IBS E CBS SÃO ZERO: art. 348, III, "c" — as alíquotas
// de teste "não serão aplicadas em relação às operações dos contribuintes optantes pelo Simples
// Nacional".
//
// ⚠⚠ AS PARCELAS A DEDUZIR NÃO MUDARAM, E AS ALÍQUOTAS NOMINAIS MUDARAM NA 6ª FAIXA — 0,10 ponto
// a menos, nos CINCO anexos, e só na vigência 1º/1/2027 a 31/12/2028 (a lei já traz a tabela de
// 2029, em que ela volta ao valor de hoje):
//
//     anexo   2026      2027-2028   2029+
//     I       19,00%    18,90%      19,00%
//     II      30,00%    29,90%      30,00%
//     III     33,00%    32,90%      33,00%
//     IV      33,00%    32,90%      33,00%
//     V       30,50%    30,40%      30,50%
//
// ⚠ Nas faixas 1 a 5 nada muda, e é por isso que a frase "o DAS não muda" vale para quase toda a
// carteira — mas NÃO para todo mundo. Quem a afirmar sem olhar a faixa põe um número errado num PDF.
//
// O que mudou em TODAS as faixas foi a REPARTIÇÃO: COFINS + PIS deram lugar a CBS, e uma fatia
// pequena virou IBS (Anexo I, 1ª faixa: CBS 15,33% + IBS 0,17% = os 15,50% que eram COFINS 12,74%
// + PIS 2,76%).
//
// ⚠ As COLUNAS diferem por anexo: o II tem IPI, o IV NÃO tem CPP (patronal por fora, art. 13
// § 5º-C) e o I não tem ISS. Ler por índice em vez de por nome é como se erra isso.
//
// Cada faixa foi provada: a partilha soma 100%, com tolerância de 0,01 ponto.
// ⚠⚠ AS FAIXAS ABAIXO NÃO FECHAM 100% NA FONTE — é arredondamento da própria lei, conferido no
// HTML do Planalto, e fica registrado aqui para ninguém achar que é erro de leitura:
//   Anexo III, 3a faixa: soma 100,01%
//   Anexo III, 4a faixa: soma 100,01%

export const ANEXOS_SIMPLES_2027 = {
  "I": {
    "colunas": [
      "IRPJ",
      "CSLL",
      "CBS",
      "CPP",
      "ICMS",
      "IBS"
    ],
    "faixas": [
      {
        "faixa": 1,
        "aliquota": 4,
        "deduzir": 0,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 15.33,
          "CPP": 41.5,
          "ICMS": 34,
          "IBS": 0.17
        }
      },
      {
        "faixa": 2,
        "aliquota": 7.3,
        "deduzir": 5940,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 15.33,
          "CPP": 41.5,
          "ICMS": 34,
          "IBS": 0.17
        }
      },
      {
        "faixa": 3,
        "aliquota": 9.5,
        "deduzir": 13860,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 15.33,
          "CPP": 42,
          "ICMS": 33.5,
          "IBS": 0.17
        }
      },
      {
        "faixa": 4,
        "aliquota": 10.7,
        "deduzir": 22500,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 15.33,
          "CPP": 42,
          "ICMS": 33.5,
          "IBS": 0.17
        }
      },
      {
        "faixa": 5,
        "aliquota": 14.3,
        "deduzir": 87300,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 15.33,
          "CPP": 42,
          "ICMS": 33.5,
          "IBS": 0.17
        }
      },
      {
        "faixa": 6,
        "aliquota": 18.9,
        "deduzir": 378000,
        "partilha": {
          "IRPJ": 13.58,
          "CSLL": 10.06,
          "CBS": 34.02,
          "CPP": 42.34,
          "ICMS": null,
          "IBS": null
        }
      }
    ]
  },
  "II": {
    "colunas": [
      "IRPJ",
      "CSLL",
      "CBS",
      "CPP",
      "IPI",
      "ICMS",
      "IBS"
    ],
    "faixas": [
      {
        "faixa": 1,
        "aliquota": 4.5,
        "deduzir": 0,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 13.85,
          "CPP": 37.5,
          "IPI": 7.5,
          "ICMS": 32,
          "IBS": 0.15
        }
      },
      {
        "faixa": 2,
        "aliquota": 7.8,
        "deduzir": 5940,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 13.85,
          "CPP": 37.5,
          "IPI": 7.5,
          "ICMS": 32,
          "IBS": 0.15
        }
      },
      {
        "faixa": 3,
        "aliquota": 10,
        "deduzir": 13860,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 13.85,
          "CPP": 37.5,
          "IPI": 7.5,
          "ICMS": 32,
          "IBS": 0.15
        }
      },
      {
        "faixa": 4,
        "aliquota": 11.2,
        "deduzir": 22500,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 13.85,
          "CPP": 37.5,
          "IPI": 7.5,
          "ICMS": 32,
          "IBS": 0.15
        }
      },
      {
        "faixa": 5,
        "aliquota": 14.7,
        "deduzir": 85500,
        "partilha": {
          "IRPJ": 5.5,
          "CSLL": 3.5,
          "CBS": 13.85,
          "CPP": 37.5,
          "IPI": 7.5,
          "ICMS": 32,
          "IBS": 0.15
        }
      },
      {
        "faixa": 6,
        "aliquota": 29.9,
        "deduzir": 720000,
        "partilha": {
          "IRPJ": 8.53,
          "CSLL": 7.53,
          "CBS": 25.22,
          "CPP": 23.59,
          "IPI": 35.13,
          "ICMS": null,
          "IBS": null
        }
      }
    ]
  },
  "III": {
    "colunas": [
      "IRPJ",
      "CSLL",
      "CBS",
      "CPP",
      "ISS",
      "IBS"
    ],
    "faixas": [
      {
        "faixa": 1,
        "aliquota": 6,
        "deduzir": 0,
        "partilha": {
          "IRPJ": 4,
          "CSLL": 3.5,
          "CBS": 15.43,
          "CPP": 43.4,
          "ISS": 33.5,
          "IBS": 0.17
        }
      },
      {
        "faixa": 2,
        "aliquota": 11.2,
        "deduzir": 9360,
        "partilha": {
          "IRPJ": 4,
          "CSLL": 3.5,
          "CBS": 16.91,
          "CPP": 43.4,
          "ISS": 32,
          "IBS": 0.19
        }
      },
      {
        "faixa": 3,
        "aliquota": 13.5,
        "deduzir": 17640,
        "partilha": {
          "IRPJ": 4,
          "CSLL": 3.5,
          "CBS": 16.42,
          "CPP": 43.4,
          "ISS": 32.5,
          "IBS": 0.19
        }
      },
      {
        "faixa": 4,
        "aliquota": 16,
        "deduzir": 35640,
        "partilha": {
          "IRPJ": 4,
          "CSLL": 3.5,
          "CBS": 16.42,
          "CPP": 43.4,
          "ISS": 32.5,
          "IBS": 0.19
        }
      },
      {
        "faixa": 5,
        "aliquota": 21,
        "deduzir": 125640,
        "partilha": {
          "IRPJ": 4,
          "CSLL": 3.5,
          "CBS": 15.43,
          "CPP": 43.4,
          "ISS": 33.5,
          "IBS": 0.17
        }
      },
      {
        "faixa": 6,
        "aliquota": 32.9,
        "deduzir": 648000,
        "partilha": {
          "IRPJ": 35.09,
          "CSLL": 15.04,
          "CBS": 19.29,
          "CPP": 30.58,
          "ISS": null,
          "IBS": null
        }
      }
    ]
  },
  "IV": {
    "colunas": [
      "IRPJ",
      "CSLL",
      "CBS",
      "ISS",
      "IBS"
    ],
    "faixas": [
      {
        "faixa": 1,
        "aliquota": 4.5,
        "deduzir": 0,
        "partilha": {
          "IRPJ": 18.8,
          "CSLL": 15.2,
          "CBS": 21.26,
          "ISS": 44.5,
          "IBS": 0.24
        }
      },
      {
        "faixa": 2,
        "aliquota": 9,
        "deduzir": 8100,
        "partilha": {
          "IRPJ": 19.8,
          "CSLL": 15.2,
          "CBS": 24.73,
          "ISS": 40,
          "IBS": 0.27
        }
      },
      {
        "faixa": 3,
        "aliquota": 10.2,
        "deduzir": 12420,
        "partilha": {
          "IRPJ": 20.8,
          "CSLL": 15.2,
          "CBS": 23.74,
          "ISS": 40,
          "IBS": 0.26
        }
      },
      {
        "faixa": 4,
        "aliquota": 14,
        "deduzir": 39780,
        "partilha": {
          "IRPJ": 17.8,
          "CSLL": 19.2,
          "CBS": 22.75,
          "ISS": 40,
          "IBS": 0.25
        }
      },
      {
        "faixa": 5,
        "aliquota": 22,
        "deduzir": 183780,
        "partilha": {
          "IRPJ": 18.8,
          "CSLL": 19.2,
          "CBS": 21.76,
          "ISS": 40,
          "IBS": 0.24
        }
      },
      {
        "faixa": 6,
        "aliquota": 32.9,
        "deduzir": 828000,
        "partilha": {
          "IRPJ": 53.71,
          "CSLL": 21.59,
          "CBS": 24.7,
          "ISS": null,
          "IBS": null
        }
      }
    ]
  },
  "V": {
    "colunas": [
      "IRPJ",
      "CSLL",
      "CBS",
      "CPP",
      "ISS",
      "IBS"
    ],
    "faixas": [
      {
        "faixa": 1,
        "aliquota": 15.5,
        "deduzir": 0,
        "partilha": {
          "IRPJ": 25,
          "CSLL": 15,
          "CBS": 16.96,
          "CPP": 28.85,
          "ISS": 14,
          "IBS": 0.19
        }
      },
      {
        "faixa": 2,
        "aliquota": 18,
        "deduzir": 4500,
        "partilha": {
          "IRPJ": 23,
          "CSLL": 15,
          "CBS": 16.96,
          "CPP": 27.85,
          "ISS": 17,
          "IBS": 0.19
        }
      },
      {
        "faixa": 3,
        "aliquota": 19.5,
        "deduzir": 9900,
        "partilha": {
          "IRPJ": 24,
          "CSLL": 15,
          "CBS": 17.95,
          "CPP": 23.85,
          "ISS": 19,
          "IBS": 0.2
        }
      },
      {
        "faixa": 4,
        "aliquota": 20.5,
        "deduzir": 17100,
        "partilha": {
          "IRPJ": 21,
          "CSLL": 15,
          "CBS": 18.94,
          "CPP": 23.85,
          "ISS": 21,
          "IBS": 0.21
        }
      },
      {
        "faixa": 5,
        "aliquota": 23,
        "deduzir": 62100,
        "partilha": {
          "IRPJ": 23,
          "CSLL": 12.5,
          "CBS": 16.96,
          "CPP": 23.85,
          "ISS": 23.5,
          "IBS": 0.19
        }
      },
      {
        "faixa": 6,
        "aliquota": 30.4,
        "deduzir": 540000,
        "partilha": {
          "IRPJ": 35.1,
          "CSLL": 15.54,
          "CBS": 19.78,
          "CPP": 29.58,
          "ISS": null,
          "IBS": null
        }
      }
    ]
  }
};

/** A vigência, para a tela poder IMPRIMI-LA. Número sem vigência não se confere depois. */
export const VIGENCIA_ANEXOS_2027 = Object.freeze({
  inicio: "2027-01-01",
  fim: "2028-12-31",
  fundamento: "LC 214/2025, art. 519 (Anexos XVIII a XXII); vigência pelo art. 544, III, na redação da LC 227/2026",
});
