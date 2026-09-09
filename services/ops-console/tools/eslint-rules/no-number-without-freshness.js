const NUMERIC_BINOPS = new Set(['+', '-', '*', '/', '%', '**']);

function filenameOf(context) {
  const raw = context.filename ?? context.getFilename?.() ?? '';
  const normalised = String(raw).replace(/\\/g, '/');
  return normalised.startsWith('/') ? normalised : `/${normalised}`;
}

function inScope(filename) {
  if (filename.includes('/src/components/ops/')) return false;
  return filename.includes('/src/pages/') || filename.includes('/src/app/');
}

function isStaticallyNumeric(node) {
  if (!node) return false;
  if (node.type === 'Literal' && typeof node.value === 'number') return true;
  if (
    node.type === 'UnaryExpression'
    && (node.operator === '+' || node.operator === '-')
    && isStaticallyNumeric(node.argument)
  ) {
    return true;
  }
  if (
    node.type === 'BinaryExpression'
    && NUMERIC_BINOPS.has(node.operator)
    && (isStaticallyNumeric(node.left) || isStaticallyNumeric(node.right))
  ) {
    return true;
  }
  if (node.type === 'CallExpression') {
    const callee = node.callee;
    if (callee.type === 'Identifier' && callee.name === 'Number') return true;
    if (
      callee.type === 'MemberExpression'
      && callee.object.type === 'Identifier'
      && callee.object.name === 'Math'
    ) {
      return true;
    }
  }
  if (
    node.type === 'MemberExpression'
    && !node.computed
    && node.property.type === 'Identifier'
    && node.property.name === 'length'
  ) {
    return true;
  }
  return false;
}

function formatMethodName(node) {
  const callee = node.callee;
  if (
    callee
    && callee.type === 'MemberExpression'
    && !callee.computed
    && callee.property.type === 'Identifier'
  ) {
    return callee.property.name;
  }
  return '';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Format numbers in src/components/ops or src/lib/display.ts, not in pages or the app shell.',
    },
    schema: [],
    messages: {
      rawFormat: '{{method}} formats a number outside the ops primitives; use a formatter from src/lib/display.ts.',
      rawInterpolation: 'Interpolating a raw number here hides where it came from; format it in src/components/ops or src/lib/display.ts.',
    },
  },
  create(context) {
    const filename = filenameOf(context);
    if (!inScope(filename)) return {};

    return {
      CallExpression(node) {
        const method = formatMethodName(node);
        if (method !== 'toFixed' && method !== 'toLocaleString') return;
        context.report({
          node,
          messageId: 'rawFormat',
          data: { method },
        });
      },
      TemplateLiteral(node) {
        if (!node.expressions.some(isStaticallyNumeric)) return;
        context.report({
          node,
          messageId: 'rawInterpolation',
        });
      },
    };
  },
};
