// scripts/seed-demo.js

// Demo data for store review and screenshots: 8 accounts and 3 rooms that look like they have
// been read in for a few days (past poems, highlights, notes, memos, likes, reading streaks,
// a book per room with everyone at a different place, a word list).
//
//   까망 (kkamang) — the review account, owner of all three rooms
//   작심삼백일    까망 · 초코칩 · 몽글이 · 나비   6 days   The Adventures of Sherlock Holmes
//   토익 990 목표  까망 · 철수 · 영희         4 days   The Great Gatsby
//   셰익스피어     까망 · 빨강 · 파랑         3 days   Pride and Prejudice
//
// Dates are counted back from the day it runs (Korea time), so run it again right before review.
// Running it again first deletes these 8 accounts and the rooms 까망 owns (and everything in them),
// then builds everything fresh. It stops if anyone else is a member of one of those rooms.
// Poems and books are shared caches: they are reused (or imported) and never deleted.
//
// No password is stored in this file (the repo is public):
//   DEMO_PASSWORD   까망's password (required with --apply); the other 7 get random ones, printed at the end
//
// Dry run by default (checks every highlight against the text and prints the plan). Writes only with --apply.
//   node scripts/seed-demo.js                                                   (local DB, dry run)
//   DEMO_PASSWORD=... node scripts/seed-demo.js --apply                         (local DB)
//   DEMO_PASSWORD=... node --env-file=.env.prod scripts/seed-demo.js --apply    (production)

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { initDb, getDb } = require("../db");
const { today, addDays } = require("../lib/dates");
const { lineWords, wordCount } = require("../lib/poemWords");
const koDict = require("../lib/koDict");
const bookFetch = require("../lib/bookFetch");
const usersModel = require("../models/usersModel");
const roomsModel = require("../models/roomsModel");
const poemsModel = require("../models/poemsModel");
const booksModel = require("../models/booksModel");
const wordCache = require("../models/wordCacheModel");
const { slimify } = require("../controllers/dictionaryController");

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

const USERS = {
    kkamang: { nickname: "까망", hour: 12 },
    choco: { nickname: "초코칩", hour: 7 },
    monggeul: { nickname: "몽글이", hour: 21 },
    nabi: { nickname: "나비", hour: 23 },
    cheolsu: { nickname: "철수", hour: 8 },
    younghee: { nickname: "영희", hour: 19 },
    ppalgang: { nickname: "빨강", hour: 10 },
    parang: { nickname: "파랑", hour: 22 },
};
const OWNER = "kkamang";

// short poems only (at most 10 rows with blank lines): the whole poem fits on one phone screen
const POEMS = {
    sunflower: { title: "Ah Sunflower", author: "William Blake", lines: [
        "Ah Sunflower, weary of time,", "  Who countest the steps of the sun;", "Seeking after that sweet golden clime",
        "  Where the traveller's journey is done;", "", "Where the Youth pined away with desire,",
        "  And the pale virgin shrouded in snow,", "Arise from their graves, and aspire", "  Where my Sunflower wishes to go!"] },
    sickRose: { title: "The Sick Rose", author: "William Blake", lines: [
        "O rose, thou art sick!", "  The invisible worm,", "That flies in the night,", "  In the howling storm,", "",
        "Has found out thy bed", "  Of crimson joy,", "And his dark secret love", "  Does thy life destroy."] },
    ourShare: { title: "Our share of night to bear", author: "Emily Dickinson", lines: [
        "Our share of night to bear,", "Our share of morning,", "Our blank in bliss to fill,", "Our blank in scorning.", "",
        "Here a star, and there a star,", "Some lose their way.", "Here a mist, and there a mist,", "Afterwards -- day!"] },
    bee: { title: "The bee is not afraid of me", author: "Emily Dickinson", lines: [
        "The bee is not afraid of me,", "I know the butterfly;", "The pretty people in the woods", "Receive me cordially.", "",
        "The brooks laugh louder when I come,", "The breezes madder play.", "Wherefore, mine eyes, thy silver mists?",
        "Wherefore, O summer's day?"] },
    wordIsDead: { title: "A word is dead", author: "Emily Dickinson", lines: [
        "A word is dead", "When it is said,", "Some say.", "I say it just", "Begins to live", "That day."] },
    frigate: { title: "There is no frigate like a book", author: "Emily Dickinson", lines: [
        "There is no frigate like a book", "To take us lands away,", "Nor any coursers like a page", "Of prancing poetry.",
        "This traverse may the poorest take", "Without oppress of toll;", "How frugal is the chariot", "That bears a human soul!"] },
    tomorrow: { title: "To-Morrow", author: "Percy Bysshe Shelley", lines: [
        "Where art thou, beloved To-morrow?", "When young and old, and strong and weak,", "Rich and poor, through joy and sorrow,",
        "Thy sweet smiles we ever seek,--", "In thy place--ah! well-a-day!", "We find the thing we fled--To-day."] },
    stopHeart: { title: "If I can stop one heart from breaking", author: "Emily Dickinson", lines: [
        "If I can stop one heart from breaking,", "I shall not live in vain;", "If I can ease one life the aching,",
        "Or cool one pain,", "Or help one fainting robin", "Unto his nest again,", "I shall not live in vain."] },
    pedigree: { title: "The pedigree of honey", author: "Emily Dickinson", lines: [
        "The pedigree of honey", "Does not concern the bee;", "A clover, any time, to him", "Is aristocracy."] },
    nobody: { title: "I'm nobody!  Who are you?", author: "Emily Dickinson", lines: [
        "I'm nobody!  Who are you?", "Are you nobody, too?", "Then there 's a pair of us -- don't tell!", "They 'd banish us, you know.", "",
        "How dreary to be somebody!", "How public, like a frog", "To tell your name the livelong day", "To an admiring bog!"] },
    summer: { title: "Summer", author: "William Morris", lines: [
        "Summer looked for long am I:", "Much shall change or e'er I die.", "Prithee take it not amiss",
        "Though I weary thee with bliss."] },
    harebell: { title: "Did the harebell loose her girdle", author: "Emily Dickinson", lines: [
        "Did the harebell loose her girdle", "To the lover bee,", "Would the bee the harebell hallow", "Much as formerly?", "",
        "Did the paradise, persuaded,", "Yield her moat of pearl,", "Would the Eden be an Eden,", "Or the earl an earl?"] },
    angels: { title: "Angels in the early morning", author: "Emily Dickinson", lines: [
        "Angels in the early morning", "May be seen the dews among,", "Stooping, plucking, smiling, flying:",
        "Do the buds to them belong?", "", "Angels when the sun is hottest", "May be seen the sands among,",
        "Stooping, plucking, sighing, flying;", "Parched the flowers they bear along."] },
};

// day: 0 = today, -1 = yesterday, ...
// poem activity: hl = highlight { line (1-based, blank lines count), phrase, color }, note = { line, phrase, text },
// memo = whole-poem memo { text, likes: [users] }
// book activity: phrase is searched in the book (first match); it must lie before that member's progress.
const ROOMS = [
    {
        name: "작심삼백일",
        description: "작심삼일도 백 번이면 삼백 일",
        members: ["kkamang", "choco", "monggeul", "nabi"],
        lastOpened: 0,
        checkins: { kkamang: [-5, -4, -3, -2, -1, 0], choco: [-5, -4, -3, -2, -1, 0], monggeul: [-5, -4, -2, -1, 0], nabi: [-4, -3, -1, 0] },
        days: [
            { day: -5, poem: "sunflower", acts: [
                { user: "kkamang", hl: { line: 1, phrase: "weary of time", color: "yellow" } },
                { user: "choco", note: { line: 2, phrase: "countest the steps of the sun", text: "해바라기가 해를 따라 고개를 돌리는 걸 '해의 걸음을 센다'고 쓴 게 너무 예뻐요" } },
                { user: "monggeul", memo: { text: "해바라기한테도 가고 싶은 곳이 있다는 게 괜히 짠하다", likes: ["kkamang", "choco"] } },
            ] },
            { day: -4, poem: "sickRose", acts: [
                { user: "nabi", note: { line: 2, phrase: "The invisible worm", text: "worm이 진짜 벌레일까, 다른 걸 빗댄 걸까?" } },
                { user: "kkamang", hl: { line: 7, phrase: "crimson joy", color: "pink" } },
                { user: "choco", memo: { text: "여덟 줄밖에 안 되는데 읽고 나니 기분이 묘해요. 짧은 시가 더 오래 남네", likes: ["monggeul"] } },
            ] },
            { day: -3, poem: "ourShare", acts: [
                { user: "choco", hl: { line: 9, phrase: "Afterwards -- day!", color: "blue" } },
                { user: "kkamang", note: { line: 6, phrase: "Here a star, and there a star,", text: "밤에도 별이 하나씩은 있다는 말 같아서 위로가 돼요. 오늘 힘들었던 분들 힘내요" } },
                { user: "nabi", memo: { text: "마지막 'Afterwards — day!'에서 갑자기 아침이 오는 느낌. 짧은데 힘이 있어요", likes: ["choco", "kkamang"] } },
            ] },
            { day: -2, poem: "bee", acts: [
                { user: "monggeul", hl: { line: 6, phrase: "The brooks laugh louder when I come,", color: "yellow" } },
                { user: "choco", hl: { line: 6, phrase: "The brooks laugh louder when I come,", color: "yellow" } },
                { user: "kkamang", note: { line: 4, phrase: "cordially", text: "cordially = 진심으로, 다정하게. 숲속 친구들이 반겨 준다니 귀엽다" } },
                { user: "choco", memo: { text: "숲속 동물들을 'pretty people'이라고 부르는 게 디킨슨답네요", likes: ["kkamang"] } },
            ] },
            { day: -1, poem: "wordIsDead", acts: [
                { user: "nabi", hl: { line: 5, phrase: "Begins to live", color: "pink" } },
                { user: "monggeul", note: { line: 4, phrase: "I say it just", text: "말은 하는 순간 죽는 게 아니라 그때부터 살기 시작한다… 말 조심해야겠다" } },
                { user: "kkamang", memo: { text: "여섯 줄짜리 시인데 하루 종일 생각났어요. 우리가 남기는 메모도 그렇겠죠?", likes: ["choco", "monggeul", "nabi"] } },
            ] },
            { day: 0, poem: "frigate", acts: [
                { user: "choco", hl: { line: 1, phrase: "There is no frigate like a book", color: "blue" } },
                { user: "monggeul", note: { line: 2, phrase: "To take us lands away,", text: "frigate = 범선. 책이 우리를 먼 곳으로 데려가는 배라니, 우리 방이랑 딱 맞는 시" } },
                { user: "kkamang", hl: { line: 8, phrase: "That bears a human soul!", color: "yellow" } },
                { user: "nabi", memo: { text: "오늘 시 보고 홈즈 다시 펼쳤어요 ㅋㅋ 책이 제일 싼 여행이라는 말 공감", likes: ["choco"] } },
            ] },
        ],
        book: {
            id: 1661, setDay: -5,
            progress: { choco: { pct: 40, target: 20 }, kkamang: { pct: 25, target: 30, atLastMark: true }, monggeul: { pct: 14 }, nabi: { pct: 2 } },
            acts: [
                { day: -5, user: "kkamang", note: { phrase: "You see, but you do not observe.", text: "이 문장 때문에 홈즈 읽기 시작했어요. 보는 것과 관찰하는 것의 차이" } },
                { day: -5, user: "choco", hl: { phrase: "It is a capital mistake to theorise before one has data.", color: "yellow" } },
                { day: -4, user: "monggeul", hl: { phrase: "It is a capital mistake to theorise before one has data.", color: "pink" } },
                { day: -3, user: "choco", note: { phrase: "It is quite a three pipe problem", text: "파이프 세 대 피울 만큼 어려운 문제 ㅋㅋ 홈즈식 단위" } },
                { day: -2, user: "monggeul", hl: { phrase: "three pipe problem", color: "blue" } },
                { day: -2, user: "kkamang", hl: { phrase: "life is infinitely stranger than anything which the mind of man could invent", color: "green" } },
                { day: -1, user: "choco", note: { phrase: "the little things are infinitely the most important", text: "작은 것이 가장 중요하다. 오늘의 명언으로 저장" } },
                { day: -1, user: "nabi", hl: { phrase: "To Sherlock Holmes she is always the woman.", color: "yellow" } },
                { day: 0, user: "kkamang", note: { phrase: "There is nothing more deceptive than an obvious fact", text: "뻔한 사실이 제일 속이기 쉽다… 추리소설 한 줄 요약" } },
                { day: 0, user: "choco", hl: { phrase: "the equinoctial gales had set in with exceptional violence", color: "blue" } },
            ],
        },
    },
    {
        name: "토익 990 목표",
        description: "시로 단어 외우고, 소설로 독해 연습",
        members: ["kkamang", "cheolsu", "younghee"],
        lastOpened: -1,
        checkins: { cheolsu: [-3, -2, -1, 0], younghee: [-3, -1, 0] },
        days: [
            { day: -3, poem: "tomorrow", acts: [
                { user: "cheolsu", note: { line: 1, phrase: "beloved", text: "beloved = 사랑하는. 명사 앞에서 형용사로 쓰여요" } },
                { user: "younghee", hl: { line: 3, phrase: "through joy and sorrow", color: "yellow" } },
                { user: "kkamang", memo: { text: "내일을 찾다가 결국 오늘을 만난다는 마지막 줄이 좋아요. 미루지 말고 오늘 공부하자", likes: ["cheolsu", "younghee"] } },
            ] },
            { day: -2, poem: "stopHeart", acts: [
                { user: "cheolsu", note: { line: 2, phrase: "in vain", text: "in vain = 헛되이. 'All our efforts were in vain' 토익 Part 5 단골" } },
                { user: "kkamang", hl: { line: 1, phrase: "If I can stop one heart from breaking,", color: "green" } },
                { user: "cheolsu", memo: { text: "공부하다 지칠 때 읽으면 좋은 시. 한 사람이라도 도울 수 있으면 헛되지 않다", likes: ["kkamang"] } },
            ] },
            { day: -1, poem: "pedigree", acts: [
                { user: "younghee", hl: { line: 4, phrase: "Is aristocracy.", color: "pink" } },
                { user: "cheolsu", note: { line: 1, phrase: "pedigree", text: "pedigree = 혈통, 가문. 반려견 혈통서도 pedigree라고 해요" } },
                { user: "younghee", memo: { text: "네 줄인데 단어가 다 어려워요 ㅋㅋ 꿀벌한테는 클로버가 곧 귀족이라는 뜻", likes: ["cheolsu", "kkamang"] } },
            ] },
            { day: 0, poem: "nobody", acts: [
                { user: "cheolsu", note: { line: 4, phrase: "banish", text: "banish = 추방하다. 비슷한 말 expel, exile" } },
                { user: "kkamang", hl: { line: 6, phrase: "How dreary to be somebody!", color: "blue" } },
                { user: "younghee", memo: { text: "유명해지는 게 꼭 좋은 건 아니라는 시. 개구리 비유가 웃겨요 🐸", likes: ["cheolsu"] } },
            ] },
        ],
        book: {
            id: 64317, setDay: -3,
            progress: { cheolsu: { pct: 38, target: 14 }, kkamang: { pct: 15, atLastMark: true }, younghee: { pct: 6, target: 40 } },
            acts: [
                { day: -3, user: "younghee", hl: { phrase: "In my younger and more vulnerable years", color: "yellow" } },
                { day: -3, user: "cheolsu", note: { phrase: "vulnerable", text: "vulnerable = 취약한. vulnerable to ~ 토익 빈출!" } },
                { day: -2, user: "kkamang", hl: { phrase: "just remember that all the people in this world haven’t had the advantages that you’ve had", color: "pink" } },
                { day: -2, user: "cheolsu", hl: { phrase: "a beautiful little fool", color: "yellow" } },
                { day: -1, user: "cheolsu", note: { phrase: "He smiled understandingly", text: "understandingly = 이해심 있게. -ly 붙은 부사 하나 더 득템" } },
                { day: 0, user: "kkamang", note: { phrase: "a single green light, minute and far away", text: "그 유명한 초록 불빛! 여기서 minute은 '분'이 아니라 '아주 작은'" } },
                { day: 0, user: "cheolsu", hl: { phrase: "No, old sport, I’m not.", color: "green" } },
            ],
        },
    },
    {
        name: "셰익스피어",
        description: "셰익스피어를 좋아하는 사람들의 방",
        members: ["kkamang", "ppalgang", "parang"],
        lastOpened: -2,
        checkins: { ppalgang: [-2, -1, 0], parang: [-2, 0] },
        days: [
            { day: -2, poem: "summer", acts: [
                { user: "ppalgang", hl: { line: 4, phrase: "weary thee with bliss", color: "yellow" } },
                { user: "parang", memo: { text: "'Prithee'는 셰익스피어 희곡에서 자주 보던 말이라 반가웠어요", likes: ["ppalgang", "kkamang"] } },
            ] },
            { day: -1, poem: "harebell", acts: [
                { user: "ppalgang", note: { line: 1, phrase: "harebell", text: "harebell = 초롱꽃. 꽃이랑 벌의 사랑 이야기라 '한여름 밤의 꿈'이 생각나요" } },
                { user: "kkamang", hl: { line: 8, phrase: "Would the Eden be an Eden,", color: "pink" } },
                { user: "kkamang", memo: { text: "얻고 나서도 그 소중함이 그대로일까 묻는 시 같아요. 짧은데 생각할 게 많네요", likes: ["ppalgang"] } },
            ] },
            { day: 0, poem: "angels", acts: [
                { user: "ppalgang", hl: { line: 3, phrase: "Stooping, plucking, smiling, flying:", color: "yellow" } },
                { user: "parang", note: { line: 8, phrase: "sighing", text: "1연은 smiling, 2연은 sighing. 한 단어만 바꿔 아침과 한낮을 대비시킨 게 소네트 같아요" } },
                { user: "kkamang", hl: { line: 1, phrase: "Angels in the early morning", color: "blue" } },
                { user: "ppalgang", memo: { text: "아침엔 웃고 한낮엔 한숨 쉬는 천사들 🎭 다들 오늘은 smiling이었길", likes: ["parang", "kkamang"] } },
            ] },
        ],
        book: {
            id: 1342, setDay: -2,
            progress: { ppalgang: { pct: 22, target: 45 }, kkamang: { pct: 8, atLastMark: true }, parang: { pct: 1 } },
            acts: [
                { day: -2, user: "parang", hl: { phrase: "It is a truth universally acknowledged", color: "yellow" } },
                { day: -2, user: "ppalgang", hl: { phrase: "It is a truth universally acknowledged", color: "yellow" } },
                { day: -1, user: "kkamang", note: { phrase: "She is tolerable: but not handsome enough to tempt me", text: "다아시 첫인상 최악 ㅋㅋ 여기서부터 시작이구나" } },
                { day: -1, user: "ppalgang", note: { phrase: "Pride relates more to our opinion of ourselves; vanity to what we would have others think of us.", text: "제목이 왜 '오만과 편견'인지 알 것 같은 문장" } },
                { day: 0, user: "kkamang", hl: { phrase: "Mr. Darcy is all politeness", color: "blue" } },
                { day: 0, user: "ppalgang", hl: { phrase: "My dearest Lizzy", color: "pink" } },
            ],
        },
    },
];

// 까망's word list: words from the poems whose English (Free Dictionary) and Korean (data/ko_dict.jsonl)
// meanings agree, part of speech included, with the 품사 already in the Korean data (checked 11/14).
// day = the day that poem was read.
const VOCAB = [
    { word: "clime", phonetic: "/ˈklaɪm/", day: -5 },          // Ah Sunflower
    { word: "sorrow", phonetic: "/ˈsɔɹoʊ/", day: -3 },         // To-Morrow
    { word: "prithee", phonetic: "/ˈpɹɪði/", day: -2 },        // Summer
    { word: "pedigree", phonetic: "/ˈpɛd.ɪ.ɡɹi/", day: -1 },   // The pedigree of honey
    { word: "chariot", phonetic: "/ˈt͡ʃæɹɪət/", day: 0 },       // There is no frigate like a book
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// quote as the screen builds it: from the first word to the last word (punctuation outside dropped),
// with "--" shown as an em dash
function quoteOf(phrase) {
    return phrase.replace(/-{2,}/g, "—").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

// first occurrence of phrase's words inside text's words -> [startWord, endWord] (0-based, inclusive) or null
function findWords(text, phrase) {
    const words = lineWords(text);
    const want = lineWords(phrase);
    if (!want.length) return null;
    for (let i = 0; i + want.length <= words.length; i++) {
        if (want.every((w, k) => words[i + k] === w)) return [i, i + want.length - 1];
    }
    return null;
}

// Korea date 'YYYY-MM-DD' + hour + minutes -> UTC 'YYYY-MM-DD HH:MM:SS'.
// A time still in the future (today, run early in the day) is squeezed into "midnight .. a minute ago"
// in the same order, so it stays on the same Korea date and never looks like it came from tomorrow.
function stamp(date, hour, minute) {
    const dayStart = new Date(`${date}T00:00:00+09:00`).getTime();
    let t = dayStart + (hour * 60 + minute) * 60000;
    const latest = Date.now() - 60000;
    if (t > latest) t = dayStart + Math.max(0, latest - dayStart) * Math.min(1, (hour * 60 + minute) / (24 * 60));
    return new Date(t).toISOString().slice(0, 19).replace("T", " ");
}

// Korean meanings as the dictionary popup saves them. definitions = the English ones (for the
// part of speech the server fills in, koDict.fillPos); omit to skip that.
function koOf(word, definitions) {
    const found = koDict.lookup(word);
    if (!found || !found.entries.length) return null;
    const ko = koDict.fillPos(found.entries, definitions).slice(0, 4)
        .map((e) => ({ pos: String(e.pos || ""), ko: (e.ko || []).slice(0, 3), own: !!e.own }))
        .filter((e) => e.ko.length);
    return ko.length ? JSON.stringify(ko) : null;
}

// stored paragraphs of a book with cumulative words -> { paras: [{ idx, chapter_idx, text, before }], total }
async function loadBook(db, id) {
    const rows = await db.all(`SELECT idx, chapter_idx, text, word_count FROM book_paragraphs WHERE book_id = ? ORDER BY idx`, [id]);
    let before = 0;
    const paras = rows.map((r) => { const p = { ...r, before }; before += r.word_count; return p; });
    return { paras, total: before };
}

async function ensureBook(db, id, apply) {
    if (await booksModel.findById(id)) return true;
    if (!apply) return false;
    const meta = await bookFetch.getBookMeta(id);
    if (!meta.ok) throw new Error(`book ${id}: metadata ${meta.error}`);
    const text = await bookFetch.fetchBookText(meta.meta);
    if (!text.ok) throw new Error(`book ${id}: text ${text.error}`);
    const parsed = bookFetch.parseBook(text.text);
    if (!parsed.ok) throw new Error(`book ${id}: parse ${parsed.error}`);
    await booksModel.importBook(meta.meta, parsed);
    console.log(`  imported book ${id}`);
    return true;
}

// ---------------------------------------------------------------------------
// plan checks (no writes)
// ---------------------------------------------------------------------------

function checkPoems() {
    const problems = [];
    for (const room of ROOMS) {
        for (const d of room.days) {
            const poem = POEMS[d.poem];
            for (const a of d.acts) {
                if (!room.members.includes(a.user)) problems.push(`${room.name}: ${a.user} is not a member`);
                const m = a.hl || a.note;
                if (m && !findWords(poem.lines[m.line - 1] || "", m.phrase)) {
                    problems.push(`${room.name} ${poem.title} line ${m.line}: "${m.phrase}" not found`);
                }
            }
        }
    }
    const poemWords = new Set(Object.values(POEMS).flatMap((p) => p.lines.flatMap(lineWords)).map((w) => w.toLowerCase()));
    for (const v of VOCAB) {
        if (!poemWords.has(v.word)) problems.push(`word list: "${v.word}" is not in any poem`);
        if (!koOf(v.word)) problems.push(`word list: "${v.word}" has no Korean meaning`);
    }
    return problems;
}

// book acts -> resolved marks; throws when a phrase is missing or lies past its reader's progress.
// progress { pct } = that share of the words; { atLastMark: true } = the paragraph of that
// member's last mark, so opening the book shows it (pct is then only the label in the dry run).
function resolveBook(room, book) {
    const paraOf = (a) => {
        const m = a.hl || a.note;
        const para = book.paras.find((p) => findWords(p.text, m.phrase));
        if (!para) throw new Error(`${room.name}: "${m.phrase}" not found in book ${room.book.id}`);
        return para;
    };
    const progress = {};
    for (const [user, p] of Object.entries(room.book.progress)) {
        const target = book.total * p.pct / 100;
        let para = book.paras.find((x) => x.before >= target) || book.paras[book.paras.length - 1];
        if (p.atLastMark) {
            const own = room.book.acts.filter((a) => a.user === user).map(paraOf);
            para = own.reduce((a, b) => (b.idx > a.idx ? b : a));
        }
        progress[user] = { ...p, paragraph_idx: para.idx, pct: Math.round(para.before * 100 / book.total) };
    }
    const marks = room.book.acts.map((a) => {
        const m = a.hl || a.note;
        const para = paraOf(a);
        if (!progress[a.user]) throw new Error(`${room.name}: ${a.user} has no progress`);
        if (para.idx > progress[a.user].paragraph_idx) {
            throw new Error(`${room.name}: ${a.user}'s mark "${m.phrase}" (paragraph ${para.idx}) is past their progress (${progress[a.user].paragraph_idx})`);
        }
        const [sw, ew] = findWords(para.text, m.phrase);
        return { ...a, para, sw, ew };
    });
    return { progress, marks };
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

async function removeOld(db) {
    const names = Object.keys(USERS);
    const users = await db.all(`SELECT id, username FROM users WHERE username IN (${names.map(() => "?").join(",")})`, names);
    const ids = users.map((u) => u.id);
    const owner = users.find((u) => u.username === OWNER);
    if (owner) {
        const rooms = await db.all(`SELECT id, name FROM rooms WHERE owner_id = ?`, [owner.id]);
        for (const r of rooms) {
            const others = await db.all(`SELECT user_id FROM room_members WHERE room_id = ?`, [r.id]);
            const outsider = others.find((o) => !ids.includes(o.user_id));
            if (outsider) throw new Error(`room "${r.name}" (${r.id}) has a member who is not a demo account (user ${outsider.user_id}); not touching it`);
        }
        for (const r of rooms) await roomsModel.deleteRoom(r.id);
        if (rooms.length) console.log(`  deleted ${rooms.length} old demo room(s)`);
    }
    for (const u of users) await usersModel.deleteAccount(u.id);
    if (users.length) console.log(`  deleted ${users.length} old demo account(s)`);
}

async function seed(db, password) {
    const D = (n) => addDays(today(), n);

    // accounts
    const uid = {};
    const passwords = {};
    for (const [username, u] of Object.entries(USERS)) {
        const pw = username === OWNER ? password : crypto.randomBytes(9).toString("base64url");
        passwords[username] = pw;
        const r = await usersModel.create({ username, nickname: u.nickname, password_hash: await bcrypt.hash(pw, 10) });
        uid[username] = r.lastID;
        const joined = Math.min(...ROOMS.filter((room) => room.members.includes(username)).map((room) => Math.min(...room.days.map((d) => d.day))));
        await db.run(`UPDATE users SET created_at = ? WHERE id = ?`, [stamp(D(joined - 1), u.hour, 5), r.lastID]);
    }

    for (const room of ROOMS) {
        const r = await roomsModel.createRoom({ name: room.name, description: room.description, owner_id: uid[OWNER] });
        for (const m of room.members) if (m !== OWNER) await roomsModel.addMember({ room_id: r.id, user_id: uid[m] });
        console.log(`  room "${room.name}" (${r.id}) code ${r.invite_code}`);

        // poems, marks, memos, likes
        const stmts = [];
        for (const d of room.days) {
            const poem = POEMS[d.poem];
            const poem_id = await poemsModel.findOrCreatePoem(poem);
            const stored = await poemsModel.findPoemWithLines(poem_id);
            const lines = (stored.lines || []).map((l) => l.text);
            await poemsModel.assignPoemToRoom(r.id, poem_id, D(d.day));
            d.acts.forEach((a, i) => {
                const u = USERS[a.user];
                const at = stamp(D(d.day), u.hour, 10 + i * 9);
                const m = a.hl || a.note;
                if (m) {
                    const found = findWords(lines[m.line - 1] || "", m.phrase);
                    if (!found) throw new Error(`${poem.title} line ${m.line}: "${m.phrase}" not in the stored poem`);
                    stmts.push({
                        sql: `INSERT INTO poem_marks (room_id, poem_id, user_id, kind, color, start_line, start_word, end_line, end_word, quote, content, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        args: [r.id, poem_id, uid[a.user], a.hl ? "highlight" : "note", a.hl ? a.hl.color : null,
                            m.line, found[0], m.line, found[1], quoteOf(m.phrase), a.note ? a.note.text : null, at],
                    });
                }
                if (a.memo) {
                    stmts.push({
                        sql: `INSERT INTO memos (user_id, room_id, poem_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
                        args: [uid[a.user], r.id, poem_id, a.memo.text, at],
                    });
                    a.memo.likes.forEach((liker, k) => stmts.push({
                        sql: `INSERT INTO memo_likes (memo_id, user_id, created_at)
                              VALUES ((SELECT MAX(id) FROM memos WHERE room_id = ? AND user_id = ?), ?, ?)`,
                        args: [r.id, uid[a.user], uid[liker], stamp(D(d.day), USERS[liker].hour, 40 + k * 5)],
                    }));
                }
            });
        }
        await db.batch(stmts);

        // check-ins (reading streak; one row per user per day, shared by all rooms)
        const ck = [];
        for (const [user, days] of Object.entries(room.checkins)) {
            for (const day of days) {
                ck.push({ sql: `INSERT OR IGNORE INTO reading_checkins (user_id, date, created_at) VALUES (?, ?, ?)`,
                    args: [uid[user], D(day), stamp(D(day), USERS[user].hour, 2)] });
            }
        }
        await db.batch(ck);

        // book
        const book = await loadBook(db, room.book.id);
        const { progress, marks } = resolveBook(room, book);
        const bs = [{ sql: `INSERT INTO room_books (room_id, book_id, set_by, set_at) VALUES (?, ?, ?, ?)`,
            args: [r.id, room.book.id, uid[OWNER], stamp(D(room.book.setDay), USERS[OWNER].hour, 1)] }];
        for (const [user, p] of Object.entries(progress)) {
            const userDays = marks.filter((m) => m.user === user).map((m) => m.day);
            const last = userDays.length ? Math.max(...userDays) : room.book.setDay;
            bs.push({
                sql: `INSERT INTO reading_progress (user_id, room_id, book_id, paragraph_idx, target_end_date, started_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [uid[user], r.id, room.book.id, p.paragraph_idx, p.target ? D(p.target) : null,
                    stamp(D(room.book.setDay), USERS[user].hour, 20), stamp(D(last), USERS[user].hour, 50)],
            });
        }
        marks.forEach((m, i) => bs.push({
            sql: `INSERT INTO book_marks (room_id, book_id, user_id, kind, color, chapter_idx, start_para, start_word, end_para, end_word, quote, content, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [r.id, room.book.id, uid[m.user], m.hl ? "highlight" : "note", m.hl ? m.hl.color : null, m.para.chapter_idx,
                m.para.idx, m.sw, m.para.idx, m.ew, quoteOf((m.hl || m.note).phrase), m.note ? m.note.text : null,
                stamp(D(m.day), USERS[m.user].hour, 30 + i)],
        }));
        await db.batch(bs);

        // room order on home: the room with lastOpened 0 first
        await db.batch(room.members.map((m) => ({
            sql: `UPDATE room_members SET last_opened_at = ? WHERE room_id = ? AND user_id = ?`,
            args: [stamp(D(room.lastOpened), USERS[m].hour, 55) + ".000", r.id, uid[m]],
        })));
    }

    // 까망's word list, saved the way the dictionary popup saves (Korean meanings only, no English line).
    // English definitions come from the server's word cache, or Free Dictionary when not cached yet.
    const vocabRows = [];
    for (const [i, v] of VOCAB.entries()) {
        let defs = [];
        const cached = await wordCache.findByWord(v.word);
        if (cached) defs = JSON.parse(cached.definitions);
        else {
            const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${v.word}`).catch(() => null);
            if (r && r.ok) defs = slimify(await r.json()).definitions;
        }
        vocabRows.push({
            sql: `INSERT INTO vocab (user_id, word, phonetic, definition, definition_pos, definition_ko, created_at) VALUES (?, ?, ?, '', NULL, ?, ?)`,
            args: [uid[OWNER], v.word, v.phonetic, koOf(v.word, defs), stamp(D(v.day), USERS[OWNER].hour, 45 + i)],
        });
    }
    await db.batch(vocabRows);

    return passwords;
}

async function main() {
    const apply = process.argv.includes("--apply");
    try {
        const problems = checkPoems();
        if (problems.length) throw new Error("poem marks don't match the poems:\n  " + problems.join("\n  "));
        await initDb();
        const db = getDb();

        console.log(`Rooms (dates counted back from ${today()}, Korea time):`);
        for (const room of ROOMS) {
            const ok = await ensureBook(db, room.book.id, false);
            let bookInfo = `book ${room.book.id} not imported yet (will import)`;
            if (ok) {
                const { progress, marks } = resolveBook(room, await loadBook(db, room.book.id));
                bookInfo = `book ${room.book.id}: ${marks.length} marks, progress ` +
                    Object.entries(progress).map(([u, p]) => `${USERS[u].nickname} ${p.pct}%`).join(", ");
            }
            console.log(`  ${room.name}: ${room.members.map((m) => USERS[m].nickname).join(" · ")}, ${room.days.length} poems, ${bookInfo}`);
        }
        if (!apply) { console.log("All highlights match the text. Dry run. Add --apply to write."); return; }

        const password = process.env.DEMO_PASSWORD;
        if (!password || password.length < 8 || /\s/.test(password)) throw new Error("set DEMO_PASSWORD (8+ characters, no spaces)");
        for (const room of ROOMS) await ensureBook(db, room.book.id, true);
        // every book mark is checked before anything is deleted or written
        for (const room of ROOMS) resolveBook(room, await loadBook(db, room.book.id));
        await removeOld(db);
        const passwords = await seed(db, password);
        console.log("Done. Accounts:");
        for (const [u, pw] of Object.entries(passwords)) console.log(`  ${USERS[u].nickname}  ${u}  ${u === OWNER ? "(DEMO_PASSWORD)" : pw}`);
    } catch (err) {
        console.error(err.message || err);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    require("dotenv").config({ quiet: true });
    main();
}

module.exports = { findWords, quoteOf, ROOMS, POEMS };
