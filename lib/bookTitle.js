// lib/bookTitle.js
// Book titles as people read them.
//
// Some catalogue titles come with library markup, e.g. Project Gutenberg's RDF gives
//   "Peter Pan : $b [Peter and Wendy]"
// where "$b" is a MARC subfield marker (the subtitle follows) and "[...]" an alternate title.
// We show the main title only: "Peter Pan".

function cleanBookTitle(raw) {
    let t = String(raw ?? "");
    t = t.split(/\r?\n/)[0];                       // Gutenberg puts the subtitle on the next line
    t = t.split(/\s*\$[a-z]\b\s*/i)[0];            // MARC subfield ($b subtitle, $c …): keep what's before it
    t = t.replace(/\s*\[[^\]]*\]\s*$/, "");        // a trailing [alternate title]
    t = t.replace(/\s*[:;,/=]\s*$/, "");           // the punctuation that introduced the dropped part
    t = t.replace(/\s+/g, " ").trim();
    return t || "Untitled";
}

module.exports = { cleanBookTitle };
