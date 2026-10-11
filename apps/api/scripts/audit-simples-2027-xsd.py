"""Auditoria estrutural offline; não assina, transmite nem autoriza DPS.

Uso: python audit-simples-2027-xsd.py --xsd DPS_v1.01.xsd --xml modelo-homolog.xml
Requer lxml. O modelo deve ser exclusivamente de homologação (tpAmb=2).
"""
import argparse
import copy
import json
from pathlib import Path
from lxml import etree

cli = argparse.ArgumentParser(description=__doc__)
cli.add_argument('--xsd', required=True)
cli.add_argument('--xml', required=True)
args = cli.parse_args()
parser = etree.XMLParser(resolve_entities=False, no_network=True)
schema = etree.XMLSchema(etree.parse(args.xsd, parser))
doc = etree.parse(args.xml, parser)
ns = {'n': 'http://www.sped.fazenda.gov.br/nfse'}
if doc.findtext('.//n:tpAmb', namespaces=ns) != '2':
    raise SystemExit('O modelo precisa ter tpAmb=2; documentos de produção não são aceitos.')
if not schema.validate(doc):
    raise SystemExit('Modelo base inválido no XSD informado; não é possível atribuir a falha aos campos novos.')

def validate(tree):
    ok = schema.validate(tree)
    return {'aceitoPeloXsd': ok, 'erros': [e.message for e in schema.error_log]}

future = copy.deepcopy(doc)
future.find('.//n:dCompet', ns).text = '2027-01-10'
cases = {'modeloBase': validate(doc), 'competencia2027SemCamposNovos': validate(future)}
for option in ('1', '3'):
    candidate = copy.deepcopy(future)
    group = candidate.find('.//n:prest/n:regTrib', ns)
    field = etree.Element('{%s}regApIBSCBSSN' % ns['n'])
    field.text = option
    # Ordem prevista entre apuração do ISS e regime especial; nunca enviada.
    previous = group.find('n:regApTribSN', ns)
    group.insert(list(group).index(previous) + 1, field)
    cases['regApIBSCBSSN_' + option] = validate(candidate)
candidate = copy.deepcopy(future)
group = candidate.find('.//n:serv/n:cServ', ns)
field = etree.SubElement(group, '{%s}cAtvSN' % ns['n'])
field.text = '9'  # Valor de ensaio; não atribui atividade fiscal à empresa do modelo.
cases['cAtvSN_isolado'] = validate(candidate)
names = set()
for file in Path(args.xsd).parent.rglob('*.xsd'):
    tree = etree.parse(str(file), parser)
    names.update(tree.xpath('//xs:element/@name', namespaces={'xs': 'http://www.w3.org/2001/XMLSchema'}))
fields = ['regApIBSCBSSN', 'cAtvSN', 'gTribSN', 'vReceitaBrutaSN']
print(json.dumps({
    'escopo': 'XSD local: não valida assinatura criptográfica nem regras de negócio do autorizador',
    'transmitido': False,
    'camposDeclarados': {name: name in names for name in fields},
    'casos': cases,
    'liberacaoProducao': False,
    'nota': 'A aprovação isolada do XSD nunca libera emissão; faltam contrato integrado e homologação ponta a ponta.',
}, ensure_ascii=True, indent=2))
