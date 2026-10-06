"""Validação XSD completa local. Não verifica validade criptográfica ou regras fiscais externas."""
import argparse
from pathlib import Path
from lxml import etree

parser = argparse.ArgumentParser()
parser.add_argument('--schema', required=True, type=Path)
parser.add_argument('xml', nargs='+', type=Path)
args = parser.parse_args()
xml_parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
schema = etree.XMLSchema(etree.parse(str(args.schema.resolve()), xml_parser))
falhas = 0
for arquivo in args.xml:
    try:
        doc = etree.parse(str(arquivo.resolve()), xml_parser)
        if doc.docinfo.doctype:
            raise ValueError('DOCTYPE não permitido')
        schema.assertValid(doc)
    except (etree.Error, ValueError) as erro:
        falhas += 1
        print(f'{arquivo.name}: {erro}')
print(f'{len(args.xml) - falhas}/{len(args.xml)} XMLs válidos contra {args.schema.name}')
raise SystemExit(1 if falhas else 0)
