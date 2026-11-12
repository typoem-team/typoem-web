// lib/koGloss.js
// Tidy a Korean dictionary meaning from Wiktionary for display. data/ko_dict.jsonl keeps the
// original text; the server tidies what it sends (dictionary lookups and the saved vocab list),
// so the installed app, which bundles old copies of the web screens, gets it too.
//
// Dropped: ★ grammar notes, Hanja, [..] alternatives ("오다[가다]" -> "오다"), English
// leftovers ("«with»", "(come to do, ...)", "〔An edict or law.〕"), grammar codes ("U", "가산",
// "[보통 pl.]"). Kept: (..) hints that tell what the word takes or where it is used
// ("(식사 등을) 하다", "(법률)"); the screens show those in a lighter colour.

const GROUP = /\((?:[^()]|\([^()]*\))*\)/g; // (..) with one level of nesting
const latinHeavy = (g) => (g.match(/[A-Za-z]/g) || []).length > 2 * (g.match(/[가-힣]/g) || []).length;

function tidyPart(t) {
    return String(t)
        .replace(/\s*;\s*/g, ", ")
        .replace(/\(\s*[★※][^()]*\)|\s*[★※].*$/g, "")
        .replace(/^(?:~?\s*\b(?:sth|sb)\b\s*\|?\s*)+/, "")    // "sth | ~ sth (액체에) 담그다"
        .replace(/(?<=[([\s])英(?=[)\]\s,])/g, "영국").replace(/(?<=[([\s])美(?=[)\]\s,])/g, "미국") // (英), (특히 美)
        .replace(/[([][一-鿿][一-鿿\s/·]*[)\]]/g, "")
        .replace(/«[^»]*[A-Za-z][^»]*»|\(\s*\+\s*\)/g, "")
        .replace(/〔[^〔〕가-힣]*〕/g, "")
        .replace(/^(?:U|C|가산|불가산)\s+/, "")
        .replace(/\[[^\[\]]*\bpl\.[^\[\]]*\]/g, "")
        .replace(/(^|,\s*)\[([^\[\]]+)\]/g, "$1($2)")   // leading [컴퓨터] label -> (컴퓨터)
        .replace(/\s?\[[^\[\]]*\]/g, "")
        .replace(GROUP, (g) => (latinHeavy(g) ? "" : g))
        .replace(/\(\s*\)/g, "")
        .replace(/\s+([,.])/g, "$1")
        .replace(/(?:,\s*)+(?=,|$)/g, "")
        .replace(/^[,\s]+/, "")
        .replace(/\s+/g, " ")
        .trim();
}

// one meaning (may hold ' / '-separated parts) -> tidied meaning, "" when nothing is left
function tidyGloss(g) {
    return String(g).split(" / ").map(tidyPart).filter(Boolean).join(" / ");
}

// [{ pos, ko: [meaning], own }] -> same shape, tidied. Team-written (own) meanings are left alone.
function tidyEntries(entries) {
    if (!Array.isArray(entries)) return entries;
    return entries
        .map((e) => (e && !e.own && Array.isArray(e.ko) ? { ...e, ko: e.ko.map(tidyGloss).filter(Boolean) } : e))
        .filter((e) => !e || !Array.isArray(e.ko) || e.ko.length > 0);
}

module.exports = { tidyGloss, tidyEntries };
