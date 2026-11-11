// Highlight rules tag request-table rows with CSS classes.
//
// Syntax (the part before "=>" uses the same syntax as the request filter):
//   <filter expression> => [toggle|add|remove] <class> [<class> ...]
// The action is optional and defaults to "add".
//
// Each class is applied to a row as "hl-<class>". Rules run in order, so
// later rules see the classes added or removed by earlier ones.
//   toggle -> add the class if missing, remove it if present
//   add    -> add the class
//   remove -> remove the class
//
// Classes named after a CSS named color (e.g. "red", "steelblue") tint the
// row background. Classes named after an entry of HIGHLIGHT_EMOJIS show that
// emoji in front of the row number. TEXT_STYLE_CLASSES (bold, italic,
// underline) change the row's text style.
//
// Examples:
//   status:>=400 => red
//   method:POST => add green bold
//   host:cdn.example.com -type:image => toggle gray
//   (status:404 or status:500) => red underline error
//   reqheader:authorization => lock
//   duration:>2s => toggle orange italic fire
import { compileFilterQuery } from './filterParser.js';
import type { ParsedEntry } from '../types/har.js';

export type HighlightAction = 'toggle' | 'add' | 'remove';

export interface HighlightRule {
  text: string;
  action: HighlightAction;
  classes: string[];
  matches: (entry: ParsedEntry) => boolean;
}

export type ParseHighlightResult = { rule: HighlightRule } | { error: string };

export const HIGHLIGHT_SEPARATOR = '=>';
export const DEFAULT_ACTION: HighlightAction = 'add';

// Text-style classes; each has a rule in main.css.
export const TEXT_STYLE_CLASSES: readonly string[] = ['bold', 'italic', 'underline', 'strikethrough'];

const ACTION_PATTERN = /^(toggle|add|remove)(?=\s|$)\s*(.*)$/i;
const CLASS_PATTERN = /^[a-z0-9_-]+$/;

// All CSS named colors (CSS Color Module Level 4). Each one has a matching
// "#requests-table tbody tr.hl-<name>" rule in main.css.
export const NAMED_COLORS: readonly string[] = [
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen'
];

// Emoji classes: the class name maps to the emoji shown on the row.
export const HIGHLIGHT_EMOJIS: Readonly<Record<string, string>> = {
  warning: '⚠️',
  error: '❌',
  success: '✅',
  info: 'ℹ️',
  question: '❓',
  exclamation: '❗',
  stop: '🛑',
  prohibited: '🚫',
  star: '⭐',
  fire: '🔥',
  bolt: '⚡',
  sparkles: '✨',
  heart: '❤️',
  thumbsup: '👍',
  thumbsdown: '👎',
  bug: '🐛',
  skull: '💀',
  bomb: '💣',
  rocket: '🚀',
  flag: '🚩',
  pin: '📌',
  bookmark: '🔖',
  bell: '🔔',
  eye: '👁️',
  lock: '🔒',
  unlock: '🔓',
  key: '🔑',
  shield: '🛡️',
  clock: '⏱️',
  hourglass: '⌛',
  pause: '⏸️',
  money: '💰',
  package: '📦',
  globe: '🌐',
  cookie: '🍪',
  link: '🔗',
  mag: '🔍',
  wrench: '🔧',
  memo: '📝',
  pencil: '✏️',
  trash: '🗑️',
  recycle: '♻️',
  arrowup: '⬆️',
  arrowdown: '⬇️'
};

// Returns the CSS class applied to a row for a highlight class token.
export function highlightClassName(token: string): string {
  return `hl-${token}`;
}

// Parses one line of the highlight input into a rule, or an error message.
export function parseHighlightRule(input: string): ParseHighlightResult {
  const text = input.trim();
  const separatorIndex = text.lastIndexOf(HIGHLIGHT_SEPARATOR);
  if (separatorIndex === -1) {
    return { error: `Missing "${HIGHLIGHT_SEPARATOR}" - use: <filter> => toggle|add|remove <class>...` };
  }

  const expression = text.slice(0, separatorIndex).trim();
  if (!expression) {
    return { error: `Missing filter expression before "${HIGHLIGHT_SEPARATOR}"` };
  }

  const afterSeparator = text.slice(separatorIndex + HIGHLIGHT_SEPARATOR.length).trim();
  const actionMatch = ACTION_PATTERN.exec(afterSeparator);
  const action = (actionMatch ? actionMatch[1]!.toLowerCase() : DEFAULT_ACTION) as HighlightAction;
  const classText = actionMatch ? actionMatch[2]! : afterSeparator;

  const classes = [...new Set(classText.toLowerCase().split(/[\s,]+/).filter(Boolean))];
  if (classes.length === 0) {
    return { error: `Missing class names after "${HIGHLIGHT_SEPARATOR}"` };
  }
  const invalid = classes.find(c => !CLASS_PATTERN.test(c));
  if (invalid) {
    return { error: `Invalid class name "${invalid}" - use letters, digits, "-" or "_"` };
  }

  return {
    rule: {
      text: `${expression} ${HIGHLIGHT_SEPARATOR} ${action} ${classes.join(' ')}`,
      action,
      classes,
      matches: compileFilterQuery(expression)
    }
  };
}

// Runs all rules in order against an entry and returns the resulting class
// tokens (without the "hl-" prefix).
export function computeHighlightClasses(rules: HighlightRule[], entry: ParsedEntry): string[] {
  const classes = new Set<string>();
  for (const rule of rules) {
    if (!rule.matches(entry)) continue;
    for (const cls of rule.classes) {
      if (rule.action === 'add') {
        classes.add(cls);
      } else if (rule.action === 'remove') {
        classes.delete(cls);
      } else if (classes.has(cls)) {
        classes.delete(cls);
      } else {
        classes.add(cls);
      }
    }
  }
  return [...classes];
}
