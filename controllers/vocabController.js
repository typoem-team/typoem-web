// controllers/vocabController.js
const model = require("../models/vocabModel");

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Korean meanings come from the dictionary popup as [{ pos, ko: [text], own }].
// Keep only that shape and size before it is stored (as JSON text).
function cleanKo(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const e of raw.slice(0, 4)) {
    if (!e || typeof e !== "object") continue;
    const ko = (Array.isArray(e.ko) ? e.ko : [])
      .map((t) => String(t).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 3);
    if (ko.length === 0) continue;
    out.push({ pos: String(e.pos || "").trim().slice(0, 20), ko, own: !!e.own });
  }
  return out.length ? out : null;
}

function parseKo(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : null;
  } catch (err) {
    return null;
  }
}

// [GET] /api/vocab — list the current user's saved words
async function listVocab(req, res) {
  try {
    const rows = await model.listForUser(req.user.id);
    const list = rows.map((r) => {
      if (!("definition_ko" in r)) return r;
      const { definition_ko, ...rest } = r;
      return { ...rest, ko: parseKo(definition_ko) };
    });
    res.status(200).json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}

// [POST] /api/vocab — save a word to the current user's notebook
async function addVocab(req, res) {
  try {
    const word = String(req.body.word || "").toLowerCase().trim();
    const definition = String(req.body.definition || "").trim();

    // Same word validation as the dictionary lookup
    if (!word || !/^[a-z'-]+$/.test(word)) {
      return res.status(400).json({ error: "invalid word" });
    }
    const ko = cleanKo(req.body.ko);
    // an English definition, Korean meanings, or both
    if (!definition && !ko) {
      return res.status(400).json({ error: "definition required" });
    }

    const phonetic = req.body.phonetic ? String(req.body.phonetic).trim() : null;
    await model.add(req.user.id, word, phonetic, definition, ko ? JSON.stringify(ko) : null);
    res.status(201).json({ word, phonetic, definition, ko });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}

// [DELETE] /api/vocab/:id — remove one of the user's own words
async function deleteVocab(req, res) {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });

    await model.remove(id, req.user.id);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}

module.exports = { listVocab, addVocab, deleteVocab };