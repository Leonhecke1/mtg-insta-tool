/**
 * Regelbasierte Spam-Erkennung fuer Kommentare unter eigenen Posts
 * (kostenlos, ohne LLM). Zielt auf die typischen Bot-Muster: "send me this
 * post", "DM us to promote", Krypto/Gewinnspiel-Links, Repost-Accounts.
 * Lieber zu vorsichtig: im Zweifel NICHT als Spam werten, denn ausgeblendete
 * Kommentare von echten Menschen sind schlimmer als ein Bot mehr.
 */

const PATTERNS: RegExp[] = [
  /\bs\s?end me (?:this|the) post\b/i,
  /\bshare me (?:this|the) post\b/i,
  /\bsend (?:it|this) to me\b/i,
  /\b(?:dm|message|inbox) (?:us|me|@\w+) (?:to|for) (?:promo|promote|feature|collab)/i,
  /\bpromote (?:it|this|your page|your account) on @/i,
  /\b(?:promo|promotion|collab)\?? (?:dm|inbox)\b/i,
  /\bwant (?:more )?(?:followers|likes|views)\b/i,
  /\b(?:crypto|bitcoin|forex|investment|onlyfans|giveaway winner)\b/i,
  /\bcheck (?:my|our) (?:bio|profile|page) for\b/i,
  /\bclick (?:the )?link in (?:my|our) bio\b/i,
  /\bhttps?:\/\/\S+/i,
];

export function isSpamComment(text: string, username: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (PATTERNS.some((re) => re.test(t))) return true;
  // Repost-/Explore-Accounts mit Standard-Floskel
  if (/(?:explore|repost|feature|promo)[._]/i.test(username) && /\b(?:send|share|dm)\b/i.test(t)) {
    return true;
  }
  return false;
}
