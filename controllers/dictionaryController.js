// controllers/dictionaryController.js
const wordCache = require("../models/wordCacheModel");

const DICT_API = "https://api.dictionaryapi.dev/api/v2/entries/en";

// Trims the large Free Dictionary API response down to the fields the UI needs.
// Pure function, so it is easy to unit test (exported below).
function slimify(apiData) {
  const entry = Array.isArray(apiData) ? apiData[0] : apiData;
  if (!entry) return { word: "", phonetic: null, definitions: [] };

  // phonetic: prefer the top-level field, otherwise the first phonetics entry that has text
  let phonetic = entry.phonetic || null;
  if (!phonetic && Array.isArray(entry.phonetics)) {
    const found = entry.phonetics.find((p) => p && p.text);
    if (found) phonetic = found.text;
  }

  // Walk through meanings and collect definitions/examples per part of speech
  const definitions = [];
  if (Array.isArray(entry.meanings)) {
    for (const meaning of entry.meanings) {
      const partOfSpeech = meaning.partOfSpeech || "";
      if (Array.isArray(meaning.definitions)) {
        for (const def of meaning.definitions) {
          if (!def || !def.definition) continue;
          definitions.push({
            partOfSpeech,
            definition: def.definition,
            example: def.example || null,
          });
        }
      }
    }
  }

  return { word: entry.word, phonetic, definitions };
}

async function getDictionary(req, res) {
  const word = String(req.params.word || "").toLowerCase().trim();

  // Input validation: allow only English letters, apostrophes and hyphens
  if (!word || !/^[a-z'-]+$/.test(word)) {
    return res.status(400).json({ error: "invalid word" });
  }

  try {
    // 1. Check the cache first (a hit means no external call is needed)
    const cached = await wordCache.findByWord(word);

    if (cached) {
      return res.json({
        word: cached.word,
        phonetic: cached.phonetic,
        definitions: JSON.parse(cached.definitions),
        cached: true,
      });
    }

    // 2. Cache miss -> call the external Free Dictionary API
    let apiRes;
    try {
      apiRes = await fetch(`${DICT_API}/${encodeURIComponent(word)}`, {
        headers: { Accept: "application/json", "User-Agent": "Typoem/1.0 (+https://typoem-app.onrender.com)" },
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      console.error("Dictionary fetch failed:", err);
      return res.status(502).json({ error: "dictionary service unavailable" });
    }

    if (apiRes.status === 404) {
      return res.status(404).json({ error: "word not found" });
    }
    if (!apiRes.ok) {
      // Log why the upstream refused (e.g. 429 rate limit, 403 blocked) so it shows in Render logs
      const body = await apiRes.text().catch(() => "");
      console.error(
        `Dictionary upstream error: status=${apiRes.status} word=${word} body=${body.slice(0, 200).replace(/\s+/g, " ")}`
      );
      return res.status(502).json({ error: "dictionary service unavailable" });
    }

    const data = await apiRes.json();
    const slim = slimify(data);

    // If there are no definitions, treat it as not found and do not cache it
    if (slim.definitions.length === 0) {
      return res.status(404).json({ error: "word not found" });
    }

    // 3. Store in the cache (the model handles the SQL and JSON.stringify).
    //    word is UNIQUE, so the model's INSERT OR IGNORE avoids a conflict
    //    if two requests look up the same new word at once.
    await wordCache.upsert(word, slim.phonetic, slim.definitions);

    return res.json({ ...slim, cached: false });
  } catch (err) {
    console.error("Dictionary error:", err);
    return res.status(500).json({ error: "internal server error" });
  }
}

module.exports = { getDictionary, slimify };