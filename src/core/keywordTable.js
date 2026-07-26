// First-match-wins keyword → delta table for the chat input's local
// superchat/keyword simulator (see chat.chatboardLayer.js's submit()). Ported
// verbatim from system/NeedyGirl-簡化版-工程實作規格.md §9 — category ORDER
// matters (it's the tie-break when a message could match more than one),
// so don't alphabetize or otherwise reshuffle this list. E.g. 酸民 lists
// `去死` (not bare `死`) while 暗黑 lists bare `死` — a message containing
// only `死` is meant to fall through 酸民 and land on 暗黑, which only works
// because categories are checked in this order, not merged into one lookup.
export const KEYWORD_CATEGORIES = [
  {
    id: 'sweet',
    delta: { affection: 6 },
    keywords: ['cute', 'love', '加油', '喜歡', '天使', '可愛', 'kawaii'],
  },
  {
    id: 'hater',
    delta: { stress: 10, darkness: 6 },
    keywords: ['hate', '滾', '醜', '去死', '噁', '廢'],
    locked: true, // spec: 留言不可刪 — no delete UI exists yet, just a flag for future-proofing
  },
  {
    id: 'fourthwall',
    delta: { stress: 4 },
    keywords: ['p-chan', 'p醬', '中之人', '本名'],
    // spec also calls for a holographic glitch pulse here; intentionally not
    // wired this round (no external "single pulse" hook exists on any
    // effect layer yet) — stat delta only for now.
  },
  {
    id: 'dark',
    delta: { darkness: 22, stress: -6 },
    keywords: ['od', 'overdose', '光', '死', '消える'],
  },
  {
    id: 'easter',
    delta: {},
    keywords: ['raincandy'],
  },
  {
    id: 'ascension',
    delta: {},
    // User-requested (not from the spec doc): triggers a one-shot kaomoji
    // danmaku flood (see yandereProtoOverlay.js's triggerAscensionFlood(),
    // called from chat.chatboardLayer.js's submit()) instead of any stat
    // delta. No delta here on purpose — same "stay a secret" reasoning as
    // `easter` above, which is also why buildKeywordHint() skips it.
    // Same trigger word across zh/ja/ko/en, per the kaomoji reference's own
    // per-language phrasing (†升天†/†昇天†/†승천†/ASCENSION) — unlike every
    // other category here, this one is meant to fire regardless of which
    // language the player happens to type in.
    keywords: ['升天', '昇天', '승천', 'ascension'],
  },
];

// Plain case-insensitive substring matching — the keyword lists mix Chinese
// (no natural word boundaries) and Latin terms, so `\b` boundaries would only
// ever apply unevenly across the list for no real benefit at this scale.
export function matchMessage(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const category of KEYWORD_CATEGORIES) {
    if (category.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return { id: category.id, delta: category.delta, locked: category.locked };
    }
  }
  return null;
}
