// Reviewed: 2026-11-20
// The review (unit 34): every 90 days, check these lists against the last 90 days' lint warnings
// and findings (words that keep turning up, words that never do), change them, then update the
// date above. `mirai doctor` warns once the date is more than 90 days old.
//
// The writing lint's word lists (unit 31; research/13 §9c). One place, read by the lint only:
// never pasted into an agent's prompt (unit 34 teaches the style with examples instead).
//
// BANNED: words that hide meaning, from GOV.UK's "words to avoid"
// (https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style#words-to-avoid) and the Federal
// Plain Language Guidelines, kept to the ones that are never needed in a product or technical
// document. Each has its fix. "deploy", "deliver", "key" and "impact" stay allowed: in software
// they have a plain meaning.
export const BANNED = Object.freeze([
  [/\bleverag(?:e|es|ed|ing)\b/i, 'say "use"'],
  [/\butili[sz](?:e|es|ed|ing|ation)\b/i, 'say "use"'],
  [/\bfacilitat(?:e|es|ed|ing)\b/i, 'say what is done, and by whom'],
  [/\bempower(?:s|ed|ing)?\b/i, 'say what the person can now do'],
  [/\bsynerg(?:y|ies)\b/i, 'say what works better together, and how'],
  [/\bstreamlin(?:e|es|ed|ing)\b/i, 'say which steps go, or how much time is saved'],
  [/\boverarching\b/i, 'cut it, or say what it covers'],
  [/\bholistic(?:ally)?\b/i, 'say what is included'],
  [/\bseamless(?:ly)?\b/i, 'say what the user no longer has to do'],
  [/\bbest-in-class\b|\bworld-class\b|\bstate-of-the-art\b|\bcutting-edge\b/i, 'say what it does better, with a number'],
  [/\bgoing forward\b/i, 'cut it, or give the date'],
  [/\bin order to\b/i, 'say "to"'],
  [/\betc\b\.?/i, 'list every item, or say what the list covers ("such as …")'],
  [/\band so on\b/i, 'list every item, or say what the list covers'],
]);

// Vague adjectives: banned in a sentence with no number in it (Spec Kit's ambiguity list:
// https://github.com/github/spec-kit). "Fast" is fine in "under 200 ms, fast enough to …".
export const VAGUE = Object.freeze(['fast', 'scalable', 'secure', 'robust', 'intuitive', 'user-friendly', 'efficient', 'performant', 'reliable', 'flexible']);

// Acronyms a reader of MIRAI's documents knows: no need to spell them out. UNKNOWN is the
// templates' own word for a missing baseline (31's P2: the lint took it for an acronym). The
// date and time placeholders (YYYY-MM-DD HH:MM:SS, 32's P2) and UTC aren't acronyms to spell out.
export const ACRONYMS = new Set([
  'API', 'APIs', 'UI', 'UX', 'URL', 'HTTP', 'HTTPS', 'JSON', 'CSV', 'PDF', 'SQL', 'HTML', 'CSS', 'ID', 'IDs',
  'PR', 'MR', 'CI', 'QA', 'PRD', 'HLD', 'LLD', 'ADR', 'OK', 'AI', 'MIRAI', 'GDPR', 'EU', 'US', 'UK', 'iOS',
  'TODO', 'UNKNOWN', 'FAQ', 'SaaS', 'SSO', 'MVP', 'KPI', 'SLA', 'SLO', 'CPU', 'RAM', 'GB', 'MB', 'KB', 'TB', 'TLS', 'SSH', 'DNS',
  'YYYY', 'YY', 'MM', 'DD', 'HH', 'SS', 'UTC',
  // Unit 36: the journeys' "E2E test:" line, MIRAI's own label.
  'E2E',
]);
