"""Valida preparaÃƒÂ§ÃƒÂ£o NT009 contra XSD local, sem assinatura ou transmissÃƒÂ£o.
Uso: python validar-dps-nt009-xsd.py --xsd DPS_v1.01.xsd --preparacao resultado.json
O resultado sempre mantÃƒÂ©m a emissÃƒÂ£o bloqueada, mesmo quando o XSD aceita o XML.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname
from lxml import etree
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--xsd',required=True)
p.add_argument('--preparacao',required=True)
a=p.parse_args()
root=Path(a.xsd).resolve().parent
class LocalOnly(etree.Resolver):
    def resolve(self,url,pubid,context):
        if url.startswith('file:'):
            parsed=urlparse(url)
            if parsed.netloc: raise ValueError('ReferÃªncia remota proibida')
            url=url2pathname(parsed.path)
        target=Path(url).resolve()
        if not target.is_relative_to(root) or target.suffix!='.xsd':
            raise ValueError('ReferÃƒÂªncia XSD fora do pacote local')
        return self.resolve_filename(str(target),context)
parser=etree.XMLParser(resolve_entities=False,no_network=True,load_dtd=False)
parser.resolvers.add(LocalOnly())
data=json.loads(Path(a.preparacao).read_text(encoding='utf-8-sig'))
if data.get('contrato')!='NT009_V1_01_NOVEMBRO_2026' or data.get('liberadoParaEmissao') is not False:
    raise SystemExit('Esperada preparaÃƒÂ§ÃƒÂ£o offline do contrato NT009 de novembro')
raw=data['xml']
if len(raw)>1_000_000 or '<!DOCTYPE' in raw.upper() or '<!ENTITY' in raw.upper():
    raise SystemExit('XML inseguro ou acima do limite')
doc=etree.fromstring(raw.encode(),parser)
ns={'n':'http://www.sped.fazenda.gov.br/nfse','xs':'http://www.w3.org/2001/XMLSchema'}
if doc.tag!='{'+ns['n']+'}DPS' or doc.findtext('n:infDPS/n:tpAmb',namespaces=ns)!='2' or not (doc.findtext('n:infDPS/n:dCompet',namespaces=ns) or '').startswith('2026-'):
    raise SystemExit('Apenas DPS sintÃƒÂ©tica de homologaÃƒÂ§ÃƒÂ£o de 2026')
if doc.xpath('//*[local-name()="Signature"]'):
    raise SystemExit('PreparaÃƒÂ§ÃƒÂ£o deve ser nÃƒÂ£o assinada')
schema=etree.XMLSchema(etree.parse(str(Path(a.xsd).resolve()),parser))
valid=schema.validate(doc)
files=sorted(root.glob('*.xsd'))
names=set()
for file in files:
    names.update(etree.parse(str(file),parser).xpath('//xs:element/@name',namespaces=ns))
markers=['vAjusteBC','nDUIMP','nDUE','verCalcIBSCBS']
result={'contrato':data['contrato'],'aceitoPeloXsd':valid,'camposNT009Presentes':{name:name in names for name in markers},
        'erros':[e.message for e in schema.error_log],
        'arquivos':[{'nome':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files],
        'liberadoParaEmissao':False,'transmitido':False,
        'limite':'XSD valida estrutura; nÃƒÂ£o comprova regras externas, assinatura ou homologaÃƒÂ§ÃƒÂ£o. XML nÃƒÂ£o assinado pode exigir assinatura no contrato definitivo.'}
print(json.dumps(result,ensure_ascii=True,indent=2))

# Reprovação não pode ser confundida com sucesso por um pipeline.
sys.exit(0 if valid and all(name in names for name in markers) else 2)
