// scripts/seed-video.js

// Demo data for filming the contest video, kept apart from the review account (까망) so the two never
// touch each other. Same rooms, poems and books as scripts/seed-demo.js, with new people and many
// more highlights, line notes, memos and likes, so one phone screenshot of a poem is full of activity.
//
//   소연 (soyeon_demo) — owner of all three rooms
//   작심삼백일    소연 · 지섭 · 시현 · 경윤
//   토익 990 목표  소연 · 철수 · 영희
//   셰익스피어     소연 · 빨강 · 파랑
//
// Everything else (dry run, --apply, reruns delete and rebuild, random passwords for everyone but the
// owner) works like seed-demo.js. DEMO_PASSWORD here sets 소연's password.
//   node scripts/seed-video.js                                                   (local DB, dry run)
//   DEMO_PASSWORD=... node --env-file=.env.prod scripts/seed-video.js --apply    (production)

const demo = require("./seed-demo");

// review username -> filming username (the _demo suffix keeps them clear of real accounts)
const RENAME = {
    kkamang: "soyeon_demo", choco: "jiseop_demo", monggeul: "sihyun_demo", nabi: "gyeongyun_demo",
    cheolsu: "cheolsu_demo", younghee: "younghee_demo", ppalgang: "ppalgang_demo", parang: "parang_demo",
};
const NICK = { kkamang: "소연", choco: "지섭", monggeul: "시현", nabi: "경윤" };

const USERS = Object.fromEntries(Object.entries(demo.USERS).map(([u, v]) => [RENAME[u], { ...v, nickname: NICK[u] || v.nickname }]));
const OWNER = RENAME[demo.OWNER];

// extra activity, by room name and day (same shapes as seed-demo.js; users are the filming usernames)
const S = "soyeon_demo", J = "jiseop_demo", H = "sihyun_demo", G = "gyeongyun_demo";
const C = "cheolsu_demo", Y = "younghee_demo", R = "ppalgang_demo", P = "parang_demo";
const EXTRA = {
    "작심삼백일": {
        [-5]: [
            { user: H, hl: { line: 3, phrase: "sweet golden clime", color: "yellow" } },
            { user: S, note: { line: 3, phrase: "clime", text: "clime = 기후, 지역(시에서 쓰는 말). 단어장에 저장!" } },
            { user: J, memo: { text: "첫날 시! 우리 방 시작을 해바라기로 해서 좋다 🌻", likes: [S, H] } },
        ],
        [-4]: [
            { user: J, hl: { line: 1, phrase: "O rose, thou art sick!", color: "pink" } },
            { user: H, note: { line: 8, phrase: "dark secret love", text: "사랑이 오히려 장미를 망친다니… 해석이 여러 개라 같이 얘기해 보고 싶어요" } },
            { user: S, memo: { text: "블레이크 시는 짧은데 그림이 그려져요. 폭풍 치는 밤의 장미", likes: [G, H] } },
        ],
        [-3]: [
            { user: H, hl: { line: 1, phrase: "Our share of night to bear,", color: "yellow" } },
            { user: G, note: { line: 7, phrase: "Some lose their way.", text: "길을 잃는 사람도 있다고 솔직하게 말해 줘서 좋아요" } },
            { user: J, memo: { text: "night랑 morning, bliss랑 scorning. 짝 맞춘 단어 찾는 재미", likes: [H, S] } },
        ],
        [-2]: [
            { user: G, hl: { line: 3, phrase: "The pretty people in the woods", color: "pink" } },
            { user: S, hl: { line: 7, phrase: "The breezes madder play.", color: "blue" } },
            { user: H, note: { line: 8, phrase: "thy silver mists", text: "silver mists = 눈물. 너무 행복해서 눈물이 나는 걸까?" } },
            { user: H, memo: { text: "산책하고 싶어지는 시. 오늘 퇴근길에 개울 보러 감", likes: [G, S] } },
        ],
        [-1]: [
            { user: J, hl: { line: 1, phrase: "A word is dead", color: "blue" } },
            { user: S, hl: { line: 6, phrase: "That day.", color: "yellow" } },
            { user: G, note: { line: 3, phrase: "Some say.", text: "누군가는 그렇게 말하지만 나는 다르게 말한다. 시가 대화처럼 짜여 있어요" } },
            { user: J, memo: { text: "오늘 친구한테 고맙다고 말해 봤어요. 그 말도 오늘부터 살기 시작했겠죠", likes: [S, H, G] } },
            { user: G, memo: { text: "두 단어짜리 줄이 이렇게 셀 수 있다니", likes: [J] } },
        ],
        [0]: [
            { user: G, hl: { line: 3, phrase: "coursers", color: "pink" } },
            { user: H, hl: { line: 4, phrase: "prancing poetry", color: "yellow" } },
            { user: J, note: { line: 5, phrase: "the poorest", text: "가장 가난한 사람도 탈 수 있는 여행. 도서관 생각나요" } },
            { user: S, note: { line: 6, phrase: "Without oppress of toll;", text: "toll = 통행료. 책 여행엔 통행료가 없다!" } },
            { user: G, hl: { line: 7, phrase: "How frugal is the chariot", color: "green" } },
            { user: J, hl: { line: 8, phrase: "a human soul", color: "pink" } },
            { user: S, memo: { text: "frigate, courser, chariot… 탈것이 세 개나 나오는 시. 오늘은 어디로 떠나 볼까요?", likes: [J, H, G] } },
            { user: J, memo: { text: "읽고 바로 홈즈 한 장 더 읽음 ㅋㅋ 이 방 덕분에 책 읽는 습관 생겼어요", likes: [S, G] } },
            { user: H, memo: { text: "frugal = 검소한. 책이 제일 검소한 마차라는 말이 좋다", likes: [S] } },
        ],
    },
    "토익 990 목표": {
        [-1]: [
            { user: S, note: { line: 2, phrase: "concern", text: "concern = ~와 관계가 있다. 토익에선 '걱정'보다 이 뜻이 자주 나와요" } },
            { user: C, hl: { line: 3, phrase: "A clover, any time, to him", color: "green" } },
        ],
        [0]: [
            { user: Y, hl: { line: 2, phrase: "Are you nobody, too?", color: "pink" } },
            { user: Y, hl: { line: 7, phrase: "like a frog", color: "yellow" } },
            { user: C, note: { line: 8, phrase: "livelong", text: "livelong = 기나긴, 온종일의. the livelong day 통째로 외우기" } },
            { user: S, note: { line: 9, phrase: "admiring bog", text: "bog = 늪. 개구리를 칭찬해 주는 늪 ㅋㅋ" } },
            { user: C, memo: { text: "dreary = 따분한, 음울한. 오늘 단어 세 개 건졌다", likes: [S, Y] } },
        ],
    },
    "셰익스피어": {
        [0]: [
            { user: R, hl: { line: 4, phrase: "Do the buds to them belong?", color: "blue" } },
            { user: P, hl: { line: 6, phrase: "when the sun is hottest", color: "pink" } },
            { user: S, note: { line: 9, phrase: "Parched", text: "parched = 바싹 마른. 아침엔 이슬, 한낮엔 모래" } },
            { user: P, memo: { text: "'the dews among'처럼 전치사가 뒤로 가는 어순, 셰익스피어에서도 자주 봐요", likes: [R, S] } },
        ],
    },
};
// extra book marks (phrase must come before that member's progress; checked before anything is written)
const EXTRA_BOOK = {
    "작심삼백일": [
        { day: -4, user: H, hl: { phrase: "the most perfect reasoning and observing machine that the world has seen", color: "yellow" } },
        { day: -3, user: J, note: { phrase: "I had seen little of Holmes lately", text: "왓슨이 결혼하고 홈즈랑 멀어졌다는 첫 장면. 둘이 다시 만나서 반가워요" } },
        { day: -1, user: G, hl: { phrase: "the most perfect reasoning and observing machine", color: "pink" } },
    ],
};

// usernames only ever appear as whole JSON strings ("kkamang"), never inside the Korean text
const renamed = JSON.parse(JSON.stringify(demo.ROOMS).replace(/"([a-z]+)"/g, (m, u) => (RENAME[u] ? `"${RENAME[u]}"` : m)));
const ROOMS = renamed.map((room) => ({
    ...room,
    days: room.days.map((d) => ({ ...d, acts: [...d.acts, ...((EXTRA[room.name] || {})[d.day] || [])] })),
    book: { ...room.book, acts: [...room.book.acts, ...(EXTRA_BOOK[room.name] || [])].sort((a, b) => a.day - b.day) },
}));

const CAST = { USERS, OWNER, ROOMS, POEMS: demo.POEMS, VOCAB: demo.VOCAB };

if (require.main === module) {
    require("dotenv").config({ quiet: true });
    demo.main(CAST);
}

module.exports = CAST;
