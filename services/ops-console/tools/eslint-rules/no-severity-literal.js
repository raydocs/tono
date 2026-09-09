function severityTokens(text) {
  return text.matchAll(/--(sev|warn|rem|info|ok|unk)-(fg|line|bg)\b/g);
}

function hexColours(text) {
  return text.matchAll(/#[0-9a-fA-F]{3,8}\b/g);
}

function filenameOf(context) {
  const raw = context.filename ?? context.getFilename?.() ?? '';
  const normalised = String(raw).replace(/\\/g, '/');
  return normalised.startsWith('/') ? normalised : `/${normalised}`;
}

function isExempt(filename) {
  if (filename.includes('/src/styles/')) return true;
  if (filename.endsWith('/src/components/ops/StatusWord.tsx')) return true;
  if (filename.endsWith('/src/components/ops/QuotaGauge.tsx')) return true;
  return false;
}

function textOfQuasi(node) {
  return node.value.cooked ?? node.value.raw ?? '';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Keep severity tokens and hard-coded colours in src/styles or the two tone primitives.',
    },
    schema: [],
    messages: {
      severityToken: 'Severity token {{token}} belongs in src/styles or the two tone primitives.',
      hexColour: 'Hard-coded colour {{token}}; use a token from src/styles.',
      hslColour: 'hsl() belongs in src/styles or the two tone primitives.',
    },
  },
  create(context) {
    const filename = filenameOf(context);
    if (isExempt(filename)) return {};

    function checkText(node, text) {
      if (typeof text !== 'string' || text.length === 0) return;

      for (const match of severityTokens(text)) {
        context.report({
          node,
          messageId: 'severityToken',
          data: { token: match[0] },
        });
      }
      for (const match of hexColours(text)) {
        context.report({
          node,
          messageId: 'hexColour',
          data: { token: match[0] },
        });
      }
      if (text.includes('hsl(')) {
        context.report({
          node,
          messageId: 'hslColour',
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkText(node, node.value);
      },
      TemplateElement(node) {
        checkText(node, textOfQuasi(node));
      },
      JSXText(node) {
        checkText(node, node.value);
      },
    };
  },
};
