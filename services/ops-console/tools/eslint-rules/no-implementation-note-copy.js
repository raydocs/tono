import path from 'node:path';

const CJK = /[\u3400-\u9FFF]/;

const BANNED = [
  { word: '桶', ignoreCase: false },
  { word: '差分', ignoreCase: false },
  { word: 'payload', ignoreCase: true },
  { word: 'revision', ignoreCase: true },
  { word: 'schema', ignoreCase: true },
  { word: 'DTO', ignoreCase: false },
  { word: 'TODO', ignoreCase: false },
  { word: 'placeholder', ignoreCase: true },
  { word: 'undefined', ignoreCase: true },
  { word: 'NaN', ignoreCase: true },
];

function filenameOf(context) {
  const raw = context.filename ?? context.getFilename?.() ?? '';
  const normalised = String(raw).replace(/\\/g, '/');
  return normalised.startsWith('/') ? normalised : `/${normalised}`;
}

function textOfQuasi(node) {
  return node.value.cooked ?? node.value.raw ?? '';
}

function containsBanned(text, word, ignoreCase) {
  if (ignoreCase) return text.toLowerCase().includes(word.toLowerCase());
  return text.includes(word);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Keep Chinese copy in src/copy and keep implementation notes out of operator copy.',
    },
    schema: [],
    messages: {
      cjkOutsideCopy: 'Chinese copy belongs in src/copy, not in {{file}}.',
      bannedWord: '"{{word}}" is an implementation note, not operator copy.',
    },
  },
  create(context) {
    const filename = filenameOf(context);
    const base = path.posix.basename(filename);
    // The whole directory: the words live in four files, one per page's
    // vocabulary, and `copy.ts` is only the barrel that joins them.
    const isCopy = filename.includes('/src/copy/') && !filename.endsWith('.test.ts');
    const isSrcTs = /\/src\/.+\.tsx?$/.test(filename);
    const isTest = base.endsWith('.test.ts') || base.endsWith('.test.tsx');

    function checkCjk(node, text) {
      if (typeof text !== 'string' || !CJK.test(text)) return;
      context.report({
        node,
        messageId: 'cjkOutsideCopy',
        data: { file: base },
      });
    }

    function checkBanned(node, text) {
      if (typeof text !== 'string') return;
      for (const { word, ignoreCase } of BANNED) {
        if (!containsBanned(text, word, ignoreCase)) continue;
        context.report({
          node,
          messageId: 'bannedWord',
          data: { word },
        });
      }
    }

    if (isCopy) {
      return {
        Literal(node) {
          if (typeof node.value === 'string') checkBanned(node, node.value);
        },
        TemplateElement(node) {
          checkBanned(node, textOfQuasi(node));
        },
      };
    }

    if (!isSrcTs || isTest) return {};

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkCjk(node, node.value);
      },
      TemplateElement(node) {
        checkCjk(node, textOfQuasi(node));
      },
      // Not a string literal, but `<span>节点</span>` is exactly the leak this
      // rule exists to stop.
      JSXText(node) {
        checkCjk(node, node.value);
      },
    };
  },
};
