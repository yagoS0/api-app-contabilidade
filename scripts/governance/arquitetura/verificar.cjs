// Node 20. Leitura estática: nunca carrega ou executa o código da árvore analisada.
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

const extensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx'];
const modelOperations = new Set([
  'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'delete', 'deleteMany', 'upsert', 'aggregate', 'count', 'groupBy',
]);
const clientOperations = new Set([
  '$transaction', '$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$queryRawTyped',
]);
const pilotWrites = {
  guides: new Set(['guide', 'appSetting']),
  accounting: new Set(['accountingEntry', 'accountingEntryLine']),
};

function listSources(root) {
  const files = [];
  function visit(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const absolute = path.join(folder, item.name);
      if (item.isDirectory() && !['__tests__', '__fixtures__', 'node_modules'].includes(item.name)) {
        visit(absolute);
      }
      if (item.isFile() && extensions.includes(path.extname(item.name)) &&
          !/\.(?:test|spec|d)\.[^.]+$/.test(item.name)) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }
  visit(root);
  return files.sort();
}

function owner(file) {
  return /^(?:modules|application)\/([^/]+)\//.exec(file)?.[1];
}

function addEdge(graph, from, to) {
  if (!graph.has(from)) graph.set(from, new Set());
  if (!graph.has(to)) graph.set(to, new Set());
  graph.get(from).add(to);
}

// Tarjan. Comparar as arestas internas permite detectar ampliação de um ciclo existente.
function reportCycles(graph, report) {
  const index = new Map();
  const low = new Map();
  const stack = [];
  const active = new Set();
  function visit(from) {
    index.set(from, index.size);
    low.set(from, index.get(from));
    stack.push(from);
    active.add(from);
    for (const to of graph.get(from)) {
      if (!index.has(to)) {
        visit(to);
        low.set(from, Math.min(low.get(from), low.get(to)));
      } else if (active.has(to)) {
        low.set(from, Math.min(low.get(from), index.get(to)));
      }
    }
    if (low.get(from) !== index.get(from)) return;
    const component = new Set();
    let next;
    do {
      next = stack.pop();
      active.delete(next);
      component.add(next);
    } while (next !== from);
    for (const member of component) {
      for (const target of graph.get(member)) {
        if (component.has(target)) report(member, target);
      }
    }
  }
  for (const from of graph.keys()) if (!index.has(from)) visit(from);
}

function property(node) {
  return node?.computed ? node.property?.value : node?.property?.name;
}

function visitAst(node, inspect) {
  inspect(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) visitAst(child, inspect);
    } else if (value?.type) {
      visitAst(value, inspect);
    }
  }
}

function scan(checkout) {
  const root = path.resolve(checkout, 'apps/api/src');
  const files = new Set(listSources(root));
  const schema = fs.readFileSync(path.resolve(checkout, 'apps/api/prisma/schema.prisma'), 'utf8');
  const models = new Set([...schema.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map(([, name]) =>
    name[0].toLowerCase() + name.slice(1)));
  if (!models.size) throw new Error('Schema Prisma sem modelos reconhecidos.');
  const fileGraph = new Map();
  const moduleGraph = new Map();
  const counts = new Map();
  function record(...parts) {
    const key = JSON.stringify(parts);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    let ast;
    try {
      ast = parser.parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'importAttributes'] });
    } catch (error) {
      throw new Error(file + ': ' + error.message);
    }
    const context = owner(file);
    const adapter = /^infrastructure\/db\//.test(file) || /^modules\/[^/]+\/infrastructure\/prisma\//.test(file);
    const composition = file === 'server.js' || file.startsWith('composition/');
    const domain = /^modules\/[^/]+\/domain\//.test(file);
    const application = /^modules\/[^/]+\/application\//.test(file);
    const report = (rule, ...details) => record(rule, file, ...details);

    function dependency(specifier) {
      if (typeof specifier !== 'string') {
        report('import-dinamico-sem-resolucao');
        return;
      }
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
        if (!adapter && /^@prisma\/client(?:\/|$)/.test(specifier)) report('prisma-import', specifier);
        if (domain && !['node:crypto','crypto'].includes(specifier)) report('dominio-pacote-externo', specifier);
        return;
      }
      const raw = specifier.startsWith('@/') ? specifier.slice(2) : path.posix.join(path.posix.dirname(file), specifier);
      const target = [raw, ...extensions.map(ext => raw + ext), ...extensions.map(ext => raw + '/index' + ext)]
        .find(candidate => files.has(candidate));
      if (!target) {
        if (file.startsWith('modules/') && !/\.(?:json|csv)$/.test(raw)) report('import-local-nao-resolvido', specifier);
        return;
      }
      addEdge(fileGraph, file, target);
      const other = owner(target);
      if (context && other && context !== other) addEdge(moduleGraph, context, other);
      const publicEntry = /^modules\/[^/]+\/public\.[cm]?[jt]s$/.test(target);
      if (other && other !== context && !composition && !publicEntry) report('import-profundo', target);
      const database = target === 'infrastructure/db/prisma.js' || /^(?:infrastructure\/db|modules\/[^/]+\/infrastructure\/prisma)\//.test(target);
      if (database && !adapter && (!composition || target === 'infrastructure/db/prisma.js')) report('prisma-import', target);
      if (domain && !target.startsWith('modules/' + context + '/domain/')) report('dominio-dependencia', target);
      if (application && /(?:^|\/)(infrastructure|routes|presentation)\//.test(target)) report('aplicacao-dependencia', target);
    }

    function inspect(node) {
      if (node.source && ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
        dependency(node.source.type === 'StringLiteral' ? node.source.value : undefined);
      }
      if (node.type === 'CallExpression' && (node.callee.type === 'Import' ||
          (node.callee.type === 'Identifier' && node.callee.name === 'require'))) {
        dependency(node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : undefined);
      }
      if (!adapter && node.type === 'NewExpression' && (node.callee.name === 'PrismaClient' || property(node.callee) === 'PrismaClient')) {
        report('prisma-construtor');
      }
      if (!['TaggedTemplateExpression', 'CallExpression', 'OptionalCallExpression'].includes(node.type)) return;
      const callee = node.callee || node.tag;
      const operation = property(callee);
      const model = property(callee.object);
      const modelCall = models.has(model) && modelOperations.has(operation);
      // Uma propriedade de DTO com o mesmo nome de modelo pode ser lida livremente.
      if (!adapter && (modelCall || clientOperations.has(operation))) {
        report('prisma-chamada', model || '', operation, source.slice(callee.start, callee.end).replace(/\s+/g, ''));
      }
      if (adapter && file.startsWith('modules/') && pilotWrites[context] && modelCall &&
          /^(?:create|update|delete|upsert)/.test(operation) && !pilotWrites[context].has(model)) {
        report('escrita-fora-do-piloto', model, operation);
      }
    }
    visitAst(ast.program, inspect);
  }
  reportCycles(fileGraph, (from, to) => record('ciclo-arquivo', from, to));
  reportCycles(moduleGraph, (from, to) => record('ciclo-modulo', from, to));
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function readBaseline(filename) {
  const value = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.entries(value).some(([key, count]) => !Array.isArray(JSON.parse(key)) || !Number.isSafeInteger(count) || count < 1)) {
    throw new Error('Formato de baseline inválido');
  }
  return value;
}

function main(args) {
  const [mode, checkout, baseline] = args;
  if (!checkout || !['snapshot', 'diagnose', 'check'].includes(mode) || args.length !== (mode === 'snapshot' ? 2 : 3)) {
    throw new Error('Uso: snapshot <checkout> | diagnose|check <checkout> <baseline.json>');
  }
  const current = scan(checkout);
  if (mode === 'snapshot') {
    console.log(JSON.stringify(current, null, 2));
    return 0;
  }
  const previous = readBaseline(baseline);
  const total = counts => Object.values(counts).reduce((sum, n) => sum + n, 0);
  let additions = 0;
  for (const [key, count] of Object.entries(current)) {
    const before = previous[key] || 0;
    if (count <= before) continue;
    additions += count - before;
    console.log(key, 'base=' + before, 'candidata=' + count);
  }
  console.log('Legado (base):', total(previous), '| Candidata:', total(current), '| Acréscimos:', additions);
  return mode === 'check' && additions ? 1 : 0;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { scan };
