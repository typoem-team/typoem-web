# Typoem 대수정 계획 (시안 C 기준)

> 기준 시안: [docs/design/typoem-design-C-slim.html](design/typoem-design-C-slim.html) (390×844 모바일 화면 15개)
> 11/12에 계획으로 쓰고, 11/13까지 한 일을 표시했어요. 생김새 기준은 [Design.md](design/Design.md)예요 (아래 '11/13 진행 상황'). 1장의 '지금 대응하는 파일' 칸과 2장의 '대수정 전' 흐름은 11/12 기준이에요.

## 0. 원칙

- **시안에서 따를 것**: 화면 구조와 이동 흐름. 무엇이 어느 화면에 있고, 어디를 누르면 어디로 가는지.
- **시안에서 따르지 않아도 되는 것**: 색, 폰트, 간격, 문구. 경윤이 Design.md를 만들면 바뀔 수 있어요.
- 그래서 화면 파일에는 **구조(HTML)와 동작(JS)만** 두고, 생김새는 **토큰 파일 하나와 컴포넌트 CSS**에 모아요. 디자인이 바뀌면 `tokens.css`를 고치고, 필요하면 컴포넌트 CSS 몇 군데만 고치면 되게 해요.
- 서버 API는 지금 있는 것을 최대한 그대로 써요. 새 API는 꼭 필요한 것만 만들어요 (4장).
- 이 저장소의 `public/`은 앱 저장소(typoem-team/typoem-app)가 `npm run sync`로 복사해 가요. 무엇을 지켜야 하는지는 3-5장에 정리했어요.

### 담당 표시

| 표시 | 뜻 |
|---|---|
| 🟨 소연 | 소연 담당 (11/13에 맡음) |
| 🟦 경윤 | 경윤 담당. 소연은 건드리지 않아요 |
| 🟩 지섭 | 지섭 담당. 소연은 건드리지 않아요 |
| ⬜ 미정 | 아직 담당이 없어요. 팀에서 정해요 |

### 11/13 진행 상황

| 화면 · 일 | 상태 | PR |
|---|---|---|
| 하단 탭 (홈 · 방 · 단어장 · 나), 방 탭 `rooms.html` | ✅ 끝 | #50 |
| 하단 탭 이름을 영어로 (**Home · Rooms · Words · Me**, 11/13 결정) | ✅ 끝 | 이 PR |
| 시 · 책 공통 방 헤더 (`ui.js` `drawRoomBar`, 둘 다 `?id=`) | ✅ 끝 | #51 |
| 초대 시트를 방 안으로 (`invite.js`) | ✅ 끝 | #52 |
| 홈: 스트릭 자리 + 최근 방 카드 3개 + `모든 방 보기` | ✅ 끝 → #69(안 2)로 바뀜. `rooms.js`의 홈용 분기는 지웠어요 | #53, #59, #71 |
| 지난 시: 시 화면 아래 링크 → History (`history.html`) | ✅ 끝 | #53 → #62 |
| 시 화면 밑줄 빼기 | ✅ 끝 | #48 |
| 방 카드 API (A1), 마지막에 연 방 서버 저장 (A1-b) | ✅ 끝 | #47, #58 |
| 나 `me.html` (닉네임 · 스트릭 자리 · 친구 기록 · 배지 자리 · 설정 링크) | ✅ 끝 | #54 |
| 단어장 정렬 (최근 저장 / A–Z) | ✅ 끝 | #55 |
| 닉네임 API (A4), openapi.yaml 문법 오류 | ✅ 끝 | #56 |
| 설정 `settings.html` (닉네임 · 로그아웃 · 계정 삭제) | ✅ 끝 (테마 · 출처 · 버전 더함) | #57, #65 |
| Design.md + 시안 C 색 · 글꼴 토큰 (1단계) | ✅ 끝 | #61 |
| 시안 C 글꼴 파일 (Noto Sans KR · Noto Serif KR · Newsreader · IBM Plex Mono, 한국어 2,350자 서브셋, 약 1MB) | ✅ 끝 🟨 소연 | #70 |
| 다크 모드 값 + 테마 전환 (`theme.js`, 라이트 · 다크 · 기기 설정) | ✅ 끝 | #65 |
| 스트릭 화면 생김새 · 월 캘린더 (8단계, A5): 홈 이번 주 7일, 나 큰 숫자 + 이번 달 | ✅ 끝 | #63 |
| History 화면 `history.html` 시 \| 소설 (9단계, A2) · `past.js` 지움 | ✅ 끝 | #62 |
| 책 열면 출석 (A3) | ✅ 끝 (경윤이 대신) | #64 |
| 서버 DB 왕복 줄이기 (로그인 확인 캐시 · 권한 확인 · 책 열기) | ✅ 끝 | `perf/fewer-db-round-trips` |
| 시 화면 형광펜 · 주석 (11-b) | ⬜ 🟩 지섭 | |
| CSS 나누기 (2단계) | ⬜ 🟨 소연, 11/15 제출 뒤 | |
| 앱: 새 탭 페이지 뒤로 버튼 (3-앱) | ✅ 끝 (실기기 확인 남음) | 앱 #6 |
| 앱: 바탕색 · 상태 표시줄 색 (3-앱), 다크 모드에서 시스템 바 색 | ✅ 끝 (경윤이 대신) | 앱 #7 |
| 프로필: 팝오버 대신 **설정 맨 위**로 (14단계, 11/13 결정) | ⬜ 🟩 지섭 | |
| 배지 화면 (16단계): 나 화면에 배지 목록 · 진행도 (API는 #60) | ✅ 끝 | #74 |
| 홈: 고른 방 하나를 크게 (오늘의 시 · 우리 책 표지 두 장 + History, 안 2) | ✅ 끝 | #69 |
| 아침 알림: 설정에서 켜기 · 시간 (`notify.js`, 폰 안에서 예약, 정확하지 않은 알람) | ✅ 끝 🟨 소연 (실기기 확인 남음) | #72, #73, 앱 #8 |
| 홈 화면 위젯 — 홈이 보여주는 오늘의 시 제목 · 작가 · 첫 두 줄 (웹이 `TypoemNative.updateWidget`으로 앱에 넘겨요) | 🔶 웹 끝, 앱 위젯 남음 🟨 소연. 못 끝내면 위젯만 빼고 출시 | #76 |
| 개인정보처리방침: Google Fonts 문장 빼기 (글꼴을 앱에 넣어서, #70) | ✅ 끝 🟨 소연. 원스토어에 따로 붙여 넣은 방침이 있으면 그쪽도 고쳐요 (시현) | #75 |

---

## 1. 화면별 표

API 칸: ✅ 있음 · ⚠️ 있지만 고쳐야 함 · ❌ 없음

| 시안 화면 | 지금 대응하는 파일 | 구조상 바뀌는 점 | 필요한 API |
|---|---|---|---|
| 로그인 | `login.html` `login.js` (+ `register.*`, `landing.*`) | 구조는 거의 그대로예요. 생김새만 토큰을 따라가요. 로고(SVG)는 공통 자리 하나로 빼요. | ✅ `POST /api/auth/login`, `/register` |
| 홈 (오늘) | `index.html` `index.js` `streak.js` | **가장 크게 바뀌어요.** 지금은 마지막 방 하나의 표지 덱(캐러셀)과 방 전환 시트, 초대, 지난 시 시트가 홈에 다 있어요. 앞으로는 ① 위: 이번 주 스트릭 캘린더, ② 아래: **방 카드 목록**만 둬요. 카드에는 방 이름을 크게, 오늘의 시 제목과 책 진행률을 작게 써요. 마지막으로 들어간 방이 맨 앞이에요. 카드를 누르면 그 방의 시 탭으로 바로 가요. 초대와 지난 시는 방 안으로 옮겨요. (시안 C의 홈에는 방 하나의 시·책 카드가 있지만, 팀 결정에 따라 방 목록으로 바꿔요.) | ✅ `GET /api/streak` · ⚠️ `GET /api/rooms/mine`: 카드 한 장마다 오늘의 시 제목과 책 진행률이 필요해요 (4장 A1) |
| Rooms (하단 탭 페이지) | 없어요. 지금은 홈의 `#sheet-rooms` 시트와 `ui.js`의 "내 방" 탭이 그 시트를 열어요 | **새 페이지 `rooms.html`**을 만들어요. 홈과 같은 방 카드 컴포넌트를 쓰고, 아래에 `코드로 참여`와 `새 방 만들기`를 둬요. 지금 있는 `join.html`, `create-room.html`은 그대로 연결해요. | ✅ `/rooms/mine`, `/rooms/join`, `POST /rooms` |
| 시 읽기 | `room.html` `room.js` `marks.js` `dict-popup.js` | **방 화면의 '시' 탭**이 돼요. 위에 공통 방 헤더(뒤로 · 방 이름 · 시\|책 탭)를 둬요. 시/책 전환은 "시 화면 안의 토글"이 아니라 "방 안의 두 탭"이에요. 줄을 누르면 그 줄 아래에 주석 칸이 펼쳐져요 (지금은 시트). 밑줄 대신 형광펜을 써요 (6장). | ✅ `/rooms/:id/today`, 메모, 주석, `poem-marks` |
| 메모 시트 | `room.html`의 `#sheet-memo` | 그대로 시트예요. 좋아요, 고치기, 지우기, 인용(어느 줄에 단 메모인지)을 보여줘요. 공통 `sheet` 컴포넌트를 써요. | ✅ `/rooms/:id/memos`, `/memos/:id/like` |
| 단어 뜻 (사전) | `dict-popup.js` (+ `ui.js` `koSenses` `koHtml`) | 구조는 그대로 시트예요. `단어장에 담기` 버튼은 이미 있어요. 생김새만 토큰을 따라가요. | ✅ `/api/dictionary/:word`, `POST /api/vocab` |
| 초대 시트 (홈 + 초대) | `index.html`의 `#sheet-invite` | 홈에서 **방 안(방 헤더의 멤버 아바타나 + 버튼)**으로 옮겨요. 코드 복사, 공유, 멤버 목록, 방 삭제/나가기는 지금 로직(`index.js`의 `renderMembers`, `confirmRoomAction`)을 그대로 옮겨요. | ✅ `/rooms/:id/members`, `DELETE /rooms/:id`, `/leave` |
| 프로필 (설정 맨 위) | `settings.html` | **11/13 결정: 홈 아바타 팝오버는 없애요.** 프로필(아바타 · 닉네임 · 함께한 날 · 참여한 방)은 설정 맨 위에 두고, 닉네임 바꾸기 · 아이디가 바로 아래 이어져요. 내 기록 · 배지는 나 화면, 로그아웃은 설정 맨 아래예요. | ✅ `/users/me`, `/streak`, `PATCH /users/me` (A4), `/users/me/badges` (A6) |
| History · 시 | `index.html`의 `#sheet-history` + `index.js`의 `renderHistory()` | **새 페이지 `history.html?room=ID&tab=poem`**을 만들어요. 월별로 묶은 지난 시 목록이에요. 누르면 지난 시(읽기 전용)로 가요. 🟦 경윤 | ✅ `GET /api/rooms/:id/history` |
| History · 소설 | 없어요 | 같은 `history.html`의 `소설` 탭이에요. 이 방에서 읽은 책 목록(읽는 중, 완독, 멈춤)과 `이 책으로 다시 읽기`가 들어가요. 🟦 경윤 | ❌ `GET /api/rooms/:id/books/history` (4장 A2) · ✅ 다시 읽기는 `PUT /rooms/:id/book`으로 돼요 |
| 지난 시 (읽기 전용) | `room.html?id=X&date=YYYY-MM-DD` (연결은 이미 돼요) | 같은 시 탭 화면을 읽기 전용으로 써요. 뒤로 가면 History로 가요 (지금은 홈으로 가요). | ✅ `/rooms/:id/history/:date` |
| 책 읽기 | `book.html` `book.js` `marks.js` | **방 화면의 '책' 탭**이 돼요. `room.html`과 **같은 방 헤더**를 써요. 지금은 r-bar를 페이지마다 따로 그리고, 쿼리 이름도 `?id=`와 `?room=`으로 서로 달라요. 책을 열면 출석 체크를 해요 🟩 지섭 | ✅ `/rooms/:id/book`, `/book/progress`, `/book/marks` · ⚠️ 출석 (4장 A3) |
| 나 | 없어요 (`ui.js`의 "나" 시트뿐이에요) | **새 페이지 `me.html`**을 만들어요. 큰 연속일 숫자, 월 캘린더, 배지, 친구 기록이 들어가요. 스트릭 UI 🟦 경윤 · 배지와 친구 기록 ⬜ 미정 | ✅ `/streak` (월 캘린더용 날짜 범위는 4장 A5 참고) · ✅ `/rooms/:id/streaks` · ❌ 배지 |
| 설정 | 없어요 (`privacy.html`만 있어요) | **새 페이지 `settings.html`**을 만들어요. 테마(라이트/다크/기기 설정), 닉네임, 아이디, 개인정보처리방침, 출처, 버전, 로그아웃, 계정 삭제가 들어가요. ⬜ 미정 | ✅ `DELETE /api/users/me` (탈퇴) · ❌ 닉네임 바꾸기 · 테마는 API가 필요 없어요 (기기에만 저장) |
| 단어장 | `vocab.html` `vocab.js` | **이미 있어요.** 하단 탭에도 이미 있어요. 시안처럼 `최근 저장 / A–Z` 정렬만 더하면 돼요 (클라이언트 정렬로 충분해요). 카드는 공통 `word-card` 컴포넌트로 빼요. | ✅ `GET/POST/DELETE /api/vocab` (확인함: `routes/vocab.js`, `controllers/vocabController.js`) |

> 단어장 확인 결과: 단어 저장 API(`GET/POST/DELETE /api/vocab`)와 화면(`vocab.html`), 하단 탭은 이미 있어요. 그래서 "아직 안 만든 것" 목록에서 빼도 돼요. 남은 일은 정렬 버튼과 생김새뿐이에요.

---

## 2. 라우팅·화면 이동 흐름

### 대수정 전 (11/12)

```
login ─▶ index.html (홈 = 마지막 방 하나)
          ├─ 표지 덱(오늘의 시 + 지난 시) ─▶ room.html?id=X[&date=]   (시)
          │                                   └─ r-tabs ─▶ book.html?room=X (책)
          ├─ 방 이름 ▼ ─▶ #sheet-rooms (방 바꾸기 / 코드 참여 / 새 방)
          ├─ + 초대 ─▶ #sheet-invite
          └─ 지난 시 ─▶ #sheet-history ─▶ room.html?id=X&date=
하단 탭: 오늘(index) · 내 방(index#rooms → 시트) · 단어장(vocab) · 나(시트)
```

문제: 방이 "홈의 상태"예요. 홈에서 방을 바꾸고 표지를 넘겨야 들어가요. 시/책이 서로 다른 페이지인데 시 화면 안의 토글처럼 보여요.

### 11/13 지금

```
login ─▶ index.html (홈)
          ├─ 스트릭 자리 (.streak-slot, 생김새는 8단계)
          ├─ 최근 방 카드 3개 (마지막에 연 방이 맨 앞, 서버 순서) ─▶ room.html?id=X (시 탭)
          └─ 모든 방 보기 ─▶ rooms.html
room.html?id=X (시) · book.html?id=X (책): 같은 방 헤더 (뒤로 · 방 이름 · 시|책)
          ├─ 방 이름 ─▶ 초대 시트 (invite.js)
          └─ (시 화면 아래) 지난 시 보기 ─▶ #sheet-history (past.js) ─▶ room.html?id=X&date=
rooms.html: 방 전체 + 코드로 참여 · 새 방 만들기
me.html: 닉네임 · 스트릭 자리 · 친구 기록 · 배지 자리 ─▶ settings.html (닉네임 · 로그아웃 · 계정 삭제)
하단 탭: 홈(index) · 방(rooms.html) · 단어장(vocab.html) · 나(me.html)
```

### 시안 C (앞으로)

```
login ─▶ index.html (홈)
          ├─ 스트릭 주간 캘린더
          └─ 방 카드 목록 (마지막에 들어간 방이 맨 앞)
                └─ 카드 ─▶ room.html?id=X            (방 · 시 탭, 바로)
                             ├─ 탭 '책' ─▶ book.html?id=X   (방 · 책 탭)
                             ├─ 멤버 · + ─▶ 초대 시트
                             ├─ 단어 ─▶ 사전 시트 ─▶ 단어장에 담기
                             ├─ 메모 ─▶ 메모 시트
                             └─ History ─▶ history.html?room=X&tab=poem|book
                                            ├─ 지난 시 ─▶ room.html?id=X&date=  (읽기 전용, 뒤로 → History)
                                            └─ 책 ─▶ book.html?id=X / 다시 읽기 확인 시트
me.html ─▶ settings.html (맨 위 프로필 · 테마 · 닉네임 · 정보 · 계정)
하단 탭: Home(index) · Rooms(rooms.html) · Words(vocab.html) · Me(me.html)   ← 이름은 영어 (11/13)
```

바뀌는 규칙:

1. **방이 기본 단위예요.** 방 안의 탭은 `시`와 `책`이에요. 둘 다 같은 방 헤더를 써요.
   - 페이지는 지금처럼 `room.html`과 `book.html` 두 개로 둬요. `book.js`가 1,200줄이라 합치면 위험이 너무 커요. 쿼리 이름만 `?id=`로 맞춰요 (`book.html?room=`도 한동안 받아줘요).
   - 지금 `room.html`과 `book.html`에 이미 있는 `@view-transition`은 그대로 둬요. 탭을 바꿀 때 헤더가 고정된 것처럼 보여요.
2. **방 카드는 오버뷰 없이 바로 시 탭으로 가요.** (11/13) 홈이 오늘의 시를 미리 받지 않아서 `sessionStorage` 넘겨주기(`typoem:open`, `typoem:today`)는 쓰지 않아요. `room.js`의 받는 코드는 지섭의 형광펜 작업 뒤에 지워요.
3. **마지막에 들어간 방이 맨 앞이에요.** (11/13) 서버가 `room_members.last_opened_at`으로 정렬해서 줘요 (A1-b, PR #58). 옛 `typoem:lastRoom` localStorage는 지웠어요.
4. **"나"는 시트가 아니라 페이지예요.** (11/13) `me.html`이 생겼어요. 프로필은 팝오버 없이 설정 맨 위에 둬요 (11/13 결정, 14단계).
5. **지난 시는 홈이 아니라 History로 가요.** `room.html?date=`의 뒤로 버튼은 `history.html?room=X`로 가요.
6. 데스크톱(1024px 이상)에서 지금 쓰는 2단 배치와 `data-wide` 시트/팝오버 규칙은 그대로 둬요. 시안이 모바일 화면만 보여주니, 넓은 화면 배치는 Design.md가 나온 뒤에 다시 정해요.

---

## 3. 구조와 스타일 나누기

### 3-1. 지금 상태

- `public/styles.css` 한 파일이 3,756줄이에요. 색은 이미 맨 위 토큰(37개)에서만 정해요 (PR #40, 경윤). 아래쪽의 hex는 모두 `var(--ink, #1f1b16)` 같은 대체값이에요. 글꼴 크기와 간격은 아직 화면마다 px로 직접 써요.
- 다크 모드 블록(`[data-theme]`, `prefers-color-scheme`)은 아직 없어요.
- 공통 UI 중 하단 탭, "나" 시트, 날짜는 `ui.js`가 그려요. 방 상단 바(r-bar)는 `room.html`과 `book.html`에 따로 복사되어 있어요.
- 빌드 단계가 없어요 (정적 파일). 이건 그대로 둬요. 번들러를 들이지 않아요.

### 3-2. 파일 배치 제안

```
public/
  css/
    tokens.css        ← 색·폰트·글자 크기·간격·모서리·그림자. 라이트/다크 두 벌. 디자인 바뀌면 여기만 고쳐요
    fonts.css         ← @font-face (지금 styles.css 맨 위에 있는 것을 옮겨요)
    base.css          ← reset, body, 링크, 폼 기본
    components.css    ← 공통 부품 (아래 목록). 값은 전부 var(--…)로만 써요
    pages/
      home.css  room.css  book.css  history.css  me.css  settings.css  vocab.css  auth.css
  ui.js               ← 공통 레이아웃: 하단 탭, 방 헤더, 시트 열기·닫기
  (화면 html/js는 지금 자리 그대로)
```

- 각 html은 `tokens → fonts → base → components → pages/<화면>.css` 순서로 link해요. `styles.css`는 이 다섯 개를 `@import`만 하는 파일로 잠시 남겨둬요. 아직 옮기지 않은 페이지의 링크가 깨지지 않게 하려는 거예요. 앱 sync는 폴더째 복사해서 이 파일이 없어도 돼요 (3-5장).
- 규칙
  - `components.css`와 `pages/*.css`에는 **색 hex, 폰트 이름, px 간격을 직접 쓰지 않아요.** 다 토큰으로 써요. (예외: 1px 선, 레이아웃 계산값)
  - HTML에 인라인 `style=""`을 쓰지 않아요. 시안은 인라인 스타일로 되어 있지만, 옮길 때 클래스로 바꿔요.
  - 클래스 이름은 생김새가 아니라 역할로 지어요. `.room-card`, `.room-card__title`은 좋고, `.big-serif-21`은 안 돼요.
  - 검사: `grep -nE "#[0-9a-fA-F]{3,6}" public/css/components.css public/css/pages/*.css`의 결과가 0줄이어야 해요. PR마다 확인해요.

### 3-3. 공통 컴포넌트 (시안에서 되풀이되는 것)

| 컴포넌트 | 시안에서 쓰는 곳 | 지금 코드 |
|---|---|---|
| `tabbar` 하단 탭 4개 | 홈, 방, History, 나, 단어장 | `ui.js` `buildTabbar()` (탭 이름과 링크만 바꿔요) |
| `room-header` 뒤로 · 방 이름 · 시\|책 탭 · 단어장 | 시 읽기, 책 읽기, 지난 시 | room.html·book.html에 복사된 `.r-bar` + `.r-tabs` → `ui.js`가 그리게 해요 |
| `room-card` | 홈, 방 탭 | 없어요 (새로 만들어요) |
| `week-strip` 주간 캘린더 | 홈 (나 화면은 이번 달 달력) | `streak.js`의 `#streak-week` 🟦 경윤 |
| `sheet` 아래에서 올라오는 시트 (손잡이, 제목, 닫기) | 메모, 사전, 초대, 다시 읽기 확인 | `ui.js` `openSheet()` + `.sheet` (그대로 써요) |
| `popover` | 데스크톱의 시트 (초대 · 사전) | `data-wide="popover"` 규칙을 써요 |
| `segmented` 알약 탭 | 시\|책, 시\|소설, 테마 | `.r-tabs` → 공통으로 빼요 |
| `avatar` / `avatar-stack` | 홈, 메모, 초대, 친구 기록 | `index.js`, `room.js`에 따로 있어요 → 하나로 모아요 |
| `chip` 품사, 방장, 나, 완독 | 사전, 초대, 단어장, History | 흩어져 있어요 |
| `progress-bar` | 방 카드, History 소설, 책 읽기 | book.js에 있어요 |
| `list-row` (> 화살표가 있는 줄) | 설정 | `.s-row` |
| `word-card` | 단어장 | `vocab.js` `vocabCard()` |
| `btn` (primary, ghost, danger, link) | 전체 | `.btn`, `.pri`, `.sec`가 섞여 있어요 → 이름을 하나로 맞춰요 |

### 3-4. 디자인 토큰 초안 (시안 C CSS에서 뽑음, Design.md 전까지 임시)

> 🟦 경윤 담당. 아래는 **초안 제안**이에요. 최종 값과 이름은 경윤이 Design.md에서 정해요.

```css
:root {
  /* 색: 역할 이름으로 써요 (값은 시안 C) */
  --color-bg:            #FFFFFF;
  --color-surface:       #F1F6F3;   /* History 박스, 코드 박스, 통계 칸 */
  --color-line:          #DDEBE4;   /* 구분선, 칩 바탕, 시트 손잡이 */
  --color-line-dashed:   #B9CEC4;   /* 아직 안 온 날 */
  --color-ink:           #28383C;   /* 본문, 주 버튼 바탕, 어두운 카드 */
  --color-ink-2:         #4F6568;   /* 보조 글자, 시 읽기 머리 띠, 시트 뒤 배경 */
  --color-ink-on-dark-2: #DDEBE4;   /* 어두운 바탕 위 보조 글자 */
  --color-on-ink:        #FFFFFF;
  --color-accent:        #82AAB9;   /* 책, 진행률, 현재 탭 점 */
  --color-accent-warm:   #F2CB96;   /* 오늘의 시, 인용 줄, 방장 칩 */
  --color-accent-rose:   #E3A59D;   /* 아바타 */
  --color-danger:        #9A3B30;   /* 오류, 삭제 */
  --color-highlight:     rgba(236, 196, 64, .40);  /* 형광펜 (지금 --hl-yellow와 같아요) */
  --color-scrim:         rgba(40, 56, 60, .45);

  /* 글꼴: 역할 */
  --font-ui:      'Noto Sans KR', sans-serif;     /* UI 글자 */
  --font-ko-head: 'Noto Serif KR', serif;         /* 방 이름, 한국어 제목 */
  --font-text:    'Newsreader', serif;            /* 시·책 본문, 영어 제목 */
  --font-mono:    'IBM Plex Mono', monospace;     /* 날짜, 숫자, 라벨 */

  /* 글자 크기 (시안에서 쓰인 값) */
  --fs-2xs: 10px; --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-base: 14px;
  --fs-body: 15px; --fs-lg: 16px; --fs-text: 19px; --fs-h3: 22px; --fs-h2: 28px;
  --fs-h1: 44px; --fs-hero: 76px;

  /* 간격 */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-7: 28px;
  --gutter: 24px;

  /* 모서리 */
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-sheet: 18px; --radius-pill: 999px;

  /* 크기 */
  --touch: 44px;        /* 누르는 곳 최소 크기 (시안 전체가 지켜요) */
  --tabbar-h: 76px;
  --shadow-pop: 0 12px 32px rgba(40, 56, 60, .28);
}

/* 다크: 값만 바꿔요. 구조 CSS는 그대로예요 */
:root[data-theme="dark"] { /* Design.md에서 정해요 */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* 위와 같은 값 */ } }
```

- 지금 토큰(`--bg`, `--ink`, `--accent` …)은 한동안 새 토큰을 가리키게 해요. 예: `--ink: var(--color-ink)`. 그러면 기존 CSS가 깨지지 않고 조금씩 옮길 수 있어요.
- 테마 전환: `settings.html`에서 고른 값을 `localStorage['typoem:theme']`에 저장하고, 각 페이지 `<head>`의 한 줄짜리 인라인 스크립트가 `<html data-theme>`를 붙여요. 페이지가 처음 그려질 때 깜빡이지 않게 하려는 거예요. `meta theme-color`도 함께 바꿔요.
- 폰트: (11/13, PR #70) 시안의 4종을 `public/fonts/`에 직접 올렸어요 (subset woff2 + OFL.txt). 한국어 2종은 KS X 1001 2,350자만 남겼고, 굵기는 CSS가 쓰는 것만이에요. 자세한 건 Design.md 2장. 옛 MaruBuri · Cormorant · Gentium은 토큰의 뒤쪽 글꼴로 남아 있어요.

### 3-5. 앱(typoem-app)과 맞물리는 곳 (2026-11-12 확인)

앱 저장소의 `scripts/sync-web.mjs`와 `app-shell/app-shell.js`를 읽고 확인한 내용이에요.

| 확인한 것 | 결과 | 계획에 주는 영향 |
|---|---|---|
| sync가 무엇을 복사하나 | `public/` 전체를 하위 폴더까지 `www/`로 복사해요 (`cpSync … recursive`). 따로 정한 파일 목록은 없어요 | `css/`, `css/pages/` 같은 새 폴더는 앱에도 그대로 들어가요. sync 목록을 고칠 필요가 없어요 |
| app-shell 태그를 어디에 넣나 | `www/` **맨 위 폴더의 `.html`에만** `<script src="/app-shell.js">`를 넣어요 (`readdirSync(outDir)`라 하위 폴더는 안 봐요) | **새 페이지(`rooms.html`, `history.html`, `me.html`, `settings.html`)는 반드시 `public/` 바로 아래에 둬요.** `public/pages/` 같은 곳에 두면 앱에서 뒤로 버튼, 공유, 상태 표시줄이 안 돼요 |
| 웹이 부르는 app-shell 함수 | `TypoemNav.setBackHandler`/`back()` (`room.js:71`, `book.js:722`, `ui.js:420`), `TypoemNative.setStatusBar` (`index.js:8·15`, `room.js:62`, `book.js:282`) | 홈 덱을 지울 때(5단계) `setStatusBar('dark')`는 남겼어요 (`index.js:8`, bfcache로 돌아올 때 `:15`). 시 화면 머리 띠가 어두우면 `room.js:62`의 `'light'`도 유지해요. 시트를 여닫는 새 화면은 `TypoemNav` 규칙을 따라요 |
| 안드로이드 뒤로 버튼 | (11/12) `EXIT_PAGES = ['/', '/index.html', '/login.html', '/landing.html']`. 그 밖의 페이지는 `history.back()`, 기록이 없으면 홈으로 가요 | 새 하단 탭 페이지(`rooms.html`, `me.html`, `vocab.html`)에서 뒤로 버튼을 누르면 탭을 거꾸로 돌아가요. (11/13, 앱 PR #6) `app-shell.js`의 `BACK_RULES` 상수 하나로 정해요 (`EXIT_PAGES`를 합침): 홈 · 로그인 · 랜딩은 앱 종료, 탭 페이지(`rooms` · `vocab` · `me`)는 홈으로(`location.replace`), `settings.html`은 `history.back()`이고 기록이 없으면 `me.html`. 새 페이지를 더하면 여기에 규칙을 더해요. 앱의 `npm test`(`scripts/test-back-button.mjs`)로 확인해요 |
| 바탕색 | `app-shell.js:242`의 `PAPER = '#f2eee7'`와 `capacitor.config.json`의 `backgroundColor`, `StatusBar.backgroundColor`에 지금 바탕색이 박혀 있어요 | 시안의 흰 바탕이나 다크 모드로 바꾸면 **앱 쪽 값도 같이 바꿔야 해요.** 다크 모드는 app-shell이 `--bg`를 읽어서 상태 표시줄 색을 정하게 바꾸는 앱 PR이 필요해요 (13단계와 함께) |
| 깨어나는 중 화면 | `app-shell.js:91-102`가 `var(--bg)`, `var(--ink)`, `var(--ink-2)`, `var(--on-ink)`를 써요 | 토큰 이름을 바꿔도 **이 네 이름은 별칭으로 계속 남겨요** (3-4장의 "기존 토큰은 새 토큰을 가리키게" 규칙) |
| 아침 알림 (11/13) | 웹 `notify.js`가 `Capacitor.Plugins.LocalNotifications`를 직접 불러요 (앱 PR #8: `@capacitor/local-notifications` 8.x, 알림 아이콘 `ic_stat_typoem`). 플러그인이 없으면 설정의 알림 칸이 숨겨져요 | 정확한 알람 권한(`SCHEDULE_EXACT_ALARM`)은 넣지 않아요. 그래서 웹이 알림마다 `isExactNotification: false`를 줘요 (PR #73). 플러그인 8.3+ 기본값은 `true`라, 빼면 켤 때마다 '알람 및 리마인더' 설정 화면이 떠요 |

참고: 앱의 `npm run sync:local`은 `WEB_DIR=../typoem-web …` 형식이라 Windows PowerShell에서는 그대로 실행되지 않아요. Git Bash에서 실행하거나 `$env:WEB_DIR='../typoem-web'; npm run sync`로 해요.

---

## 4. 새로 필요하거나 바꿔야 하는 API

| # | API | 왜 필요해요 | 크기 | 담당 |
|---|---|---|---|---|
| A1 | `GET /api/rooms/mine` 응답에 `today_poem_title`, `book_title`, `book_progress`(내 진행률 %) 추가 | 홈과 방 탭의 방 카드. 이게 없으면 방마다 `/today`와 `/book`을 따로 불러야 해요 (방 N개 × 2번) | 작아요. 서브쿼리 몇 개면 돼요. 오늘의 시가 아직 정해지지 않은 방은 `null` | 🟨 소연 (PR #47) |
| A1-b | `room_members.last_opened_at` + `/mine`을 이 순서로 정렬 | 기기를 바꿔도 "마지막에 들어간 방이 맨 앞"이 맞게 하려면 필요해요 | 작아요 | **끝났어요** (PR #58, 🟨 소연). `/today`(`?checkin=0` 말고)와 `/book`을 열면 기록해요. 옛 `typoem:lastRoom` localStorage와 `sortRooms`는 지웠어요 |
| A2 | `GET /api/rooms/:id/books/history` → `[{ book_id, title, author, status: reading\|finished\|paused, progress, last_read_at, finished_at, my_mark_count, readers }]` | History · 소설 탭 | 중간. `reading_progress`와 `room_books`, `book_marks`를 모아요 | 🟦 경윤 |
| A3 | 책을 열면 출석 체크: `GET /rooms/:id/book` 또는 `PUT …/book/progress`에서 `streakModel` 체크인 호출 (`/today`가 이미 하는 방식과 같게, `?checkin=0`으로 끌 수 있게) | "시든 소설이든 열면 그날 읽은 거예요" | 작아요 | 🟩 지섭 |
| A4 | `PATCH /api/users/me` `{ nickname }` | 프로필의 닉네임 바꾸기, 설정 | 작아요. 길이와 공백 검사 필요 | 🟨 소연 (PR #56). 서버만 했어요. 응답은 `{ id, username, nickname }`. 설정 화면(PR #57)에서 써요. 바꾸면 `localStorage`의 `typoem_user`도 같이 바꿔요 |
| A5 | `GET /api/streak?month=YYYY-MM` (또는 응답에 `days: [...]` 범위 추가) | 나 화면의 월 캘린더. 지금 응답에는 `week`만 있어요 | 작아요 | 🟦 경윤 (스트릭 UI와 함께) |
| A6 | 배지 `GET /api/users/me/badges` | 나 화면 배지 | **있어요** (시현, #60): 연속 3/7/30일 · 첫 메모 · 메모 10개 · 첫 완독. 화면에 붙이는 일만 남았어요 | 🟦 시현 → 화면 ⬜ |
| — | 친구 기록: `GET /api/rooms/:id/streaks` | 나 화면의 친구 기록 | **있어요** | — |
| — | 탈퇴: `DELETE /api/users/me` | 설정 → 계정 삭제 | **있어요** | ✅ 설정 → 계정 삭제 (PR #57) |
| — | 단어장: `GET/POST/DELETE /api/vocab` | 단어장 탭 | **있어요** | — |

API를 바꾸거나 더하면 `openapi.yaml`과 `tests/`도 같이 고쳐요.

---

## 5. 작업 순서 제안

먼저 뼈대(토큰과 공통 레이아웃)를 깔고, 그다음 화면을 하나씩 옮겨요. 단계마다 PR 하나로 나눠요.

| 단계 | 할 일 | 담당 | 비고 |
|---|---|---|---|
| 1 | `tokens.css` 초안과 Design.md 시작 (3-4장 값 기반) | 🟦 경윤 | 소연은 값에 손대지 않아요. 이름만 같이 정해요 |
| 2 | `styles.css`를 `css/` 아래 파일 5개로 나누기 (**동작과 생김새는 그대로**, 옮기기만). 기존 토큰을 새 토큰 이름에 연결 | 🟨 소연 | 눈으로 보이는 변화 0이 목표예요. 화면 스크린샷을 전후로 비교해요. **11/15, v1.0 심사 제출 뒤에 해요.** 11/13에는 네 명이 styles.css를 같이 고쳐서 나누면 충돌이 커요 |
| 3 | `ui.js`: 하단 탭을 홈·방·단어장·나로 바꾸고, 공통 `room-header`를 그리게 하기, `book.html`이 `?id=`도 받게 하기 | 🟨 소연 | **끝났어요.** 하단 탭은 PR #50, 방 헤더(`drawRoomBar`)와 `book.html?id=`는 PR #51. `room.html`과 `book.html`의 복사된 r-bar를 지웠어요 |
| 3-앱 | 앱 저장소(typoem-app): 새 탭 페이지 뒤로 버튼, 바탕색·상태 표시줄 색을 시안 C에 맞추기 (3-5장) | 🟨 소연 | 3단계와 경윤의 Design.md(색 값) 뒤에 해요 |
| 4 | API A1 (`/rooms/mine`에 카드 정보 추가) | 🟨 소연 | 테스트 포함. PR #47 |
| 5 | 홈 다시 짜기: 주간 캘린더 자리 + 방 카드 목록. 덱과 홈의 시트 지우기 | 🟨 소연 | **끝났어요** (PR #53). 주간 캘린더 **생김새와 동작**은 🟦 경윤. 홈에는 자리(`.streak-slot` 안의 `[data-streak]`)만 둬요. 방 카드 목록은 `rooms.js`를 홈과 방 탭이 같이 써요 |
| 6 | `rooms.html` (방 카드 재사용 + 참여·만들기) | 🟨 소연 | **끝났어요** (PR #50). 방 카드는 `ui.js`의 `roomCard`. 홈도 `rooms.js`를 같이 써요 (`data-limit`) |
| 7 | 초대 시트를 방 안으로 옮기기 (`index.js` → `room.js`나 공통 파일) | 🟨 소연 | **끝났어요** (PR #52). 공통 파일 `invite.js`로 옮겼어요. 시·책 헤더의 방 이름을 누르면 열려요 |
| 8 | 스트릭 화면 UI (주간, 월, 나 화면 상단) + A5 | 🟦 경윤 | 소연은 건드리지 않아요 |
| 9 | History 화면 시\|소설 탭 + A2 | 🟦 경윤 | 소연은 건드리지 않아요. 6단계 전에 `history.html` 파일 이름만 같이 정해요 |
| 10 | 책 열면 출석 체크 (A3) | 🟩 지섭 | 소연은 건드리지 않아요 |
| 11 | 시 화면 밑줄 기능 지우기 | 🟨 소연 | **끝났어요 (PR #48, 11/13 merge).** 지섭이 자고 있어서 소연이 먼저 했어요. 방 헤더(3단계)가 같은 파일을 건드려서요 |
| 11-b | 시 화면에 형광펜·주석 붙이기 (`marks.js`, ToDo '시 주석 소설처럼 만들기') | 🟩 지섭 | 소연은 건드리지 않아요. `poem-marks` API는 이미 있어요. 지금 시 화면에는 밑줄도 형광펜도 없어서 **v1.0 빌드 전에 꼭 들어가야 해요.** 사전 더블 탭은 원래 돼요 |
| 12 | `me.html` 뼈대 (스트릭 자리 🟦 + 친구 기록 + 배지 자리) | 🟨 소연 | **끝났어요** (PR #54). 하단 "나" 탭이 `me.html`로 가요. 스트릭 자리는 홈과 같은 마크업(`.streak-slot`)이에요. 친구 기록은 나 말고 멤버가 있는 방마다 `/rooms/:id/streaks`를 불러요. 개인정보처리방침과 로그아웃도 여기로 옮겼어요 |
| 13 | `settings.html` + 테마 전환 + 다크 토큰 + 탈퇴 UI + A4 닉네임 | 🟨 소연 | **테마 말고는 끝났어요** (PR #57). 닉네임 바꾸기, 개인정보처리방침, 로그아웃, 계정 삭제(비밀번호 다시 받기)가 있어요. 나 화면에서는 `설정` 링크로 가요. 테마 전환과 다크 토큰은 다크 **값**(🟦 경윤, Design.md)이 나오면 더해요 |
| 14 | 프로필을 설정 맨 위로 (팝오버 없음, 11/13 결정) | 🟩 지섭 | `settings.html` 맨 위에 아바타 · 닉네임 · 함께한 날 · 참여한 방. 시안 캔버스의 '설정' 보드를 따라요 |
| 15 | 단어장 정렬(최근 저장 / A–Z) + `word-card` 컴포넌트 | 🟨 소연 | **정렬은 끝났어요** (PR #55). 클라이언트에서 정렬하고, 고른 정렬은 이 기기에 기억해요(`typoem:vocabSort`). 알약 모양은 `.r-tabs`를 같이 써요. `word-card` 공통 컴포넌트는 단어 카드를 쓰는 곳이 단어장 하나뿐이라 두 번째로 쓰는 곳이 생길 때 빼요 |
| 16 | 배지 화면 | 🟦 경윤 | **끝났어요** (PR #74). 나 화면에 배지 목록과 진행도(예: 2 / 7)를 보여줘요. 순서는 먼저 받을 수 있는 것부터 |

**서로 기다려야 하는 것**
- 2 → 3 → 5 순서는 꼭 지켜요. 나머지 화면은 3이 끝나면 동시에 해도 돼요.
- 8, 9, 10, 11은 다른 사람 담당이라 소연 작업과 같은 파일을 건드릴 수 있어요. 특히 `room.js`(11-b), `streak.js`(8), `index.js`(5와 8). **5단계 전에 경윤과 홈의 스트릭 자리 마크업(id와 data 속성)을 먼저 맞춰요.** 11-b(지섭)와 3단계(소연)는 둘 다 `room.html`과 `room.js`를 고쳐요. PR을 올리기 전에 서로 한 번 말해요.
- 각 단계가 끝나면 앱 저장소에서 `npm run sync` 후 다시 빌드해서 확인해요. 새 파일은 자동으로 복사돼요. 다만 새 html이 `public/` 바로 아래에 있는지 확인해요 (3-5장).
- 앱 저장소에서 따로 해야 하는 일: 탭 페이지의 뒤로 버튼 동작, 바탕색과 상태 표시줄 색(시안 색이나 다크 모드를 넣을 때). 웹 PR과 같은 날 앱 PR을 내요.

---

## 6. 지우거나 정리할 코드

| 무엇 | 어디 | 언제·누가 |
|---|---|---|
| 시\|책 토글 (`.r-tabs` 마크업 2곳, `tab-poem`/`tab-book` href 세팅) | `room.html:28-31`, `book.html:25-28`, `room.js:34-35`, `book.js:219-220`, `styles.css:842`부터 이어지는 "시 \| 책" 블록 (`:873` view-transition 포함) | **끝났어요** (PR #51). 공통 `room-header` 탭으로 바꿨어요. view-transition은 남겼어요 |
| 복사된 r-bar (뒤로 · 방 이름) | `room.html`, `book.html` | **끝났어요** (PR #51) |
| 시 화면 밑줄: `#l-mark` 버튼, `marks` Set, `typoem:marks:*` localStorage, `.marked` 스타일, `aria-label="이 줄에 밑줄 · 메모"` | `room.html:68`, `room.js:46, 182, 258, 269, 360-386, 550`, `styles.css:980, 1006`의 `.ln.marked` | **끝났어요** (PR #48, 🟨 소연). 기기에 남은 `typoem:marks:*`는 지우지 않았어요. 이제 아무도 읽지 않고 크기도 작아요 |
| 홈 표지 덱(캐러셀): `#deck`, `#dots`, `coverHTML`, `renderDeck`, `layoutDeck`, `goTo`, `openCover`, `wireDeck`(끌기) | `index.html`, `index.js:342-557` (`coverHTML` 342 … `wireDeck` 500), `styles.css:1515-1516`, `:1722`부터 "Cover deck" 블록 | **끝났어요** (PR #53, 🟨 소연). 펼치기 애니메이션과 sessionStorage 넘겨주기(`typoem:open`, `typoem:today`)는 다시 쓰지 않았어요. 방 카드는 `/rooms/mine`만 받아서 넘겨줄 시 데이터가 없어요. 그래서 `room.js`의 `paintFromCover`와 `takeHomeCopy`는 이제 아무 일도 안 해요. 지섭의 형광펜 작업 뒤에 지울지 정해요. `setStatusBar('dark')`는 3-5장대로 남겼어요 |
| 홈의 방 전환 시트 `#sheet-rooms`, `room-switch` | `index.html`, `index.js:254` `renderRooms`, `:268` `openRooms`, `:300` 참여 폼 | **끝났어요** (PR #53). 참여는 `join.html`에서 해요 |
| 홈의 지난 시 시트 `#sheet-history`, `renderHistory()` | `room.html`의 `#past-link`, `#sheet-history`, `past.js` | 홈에서는 지웠어요 (PR #53). 지금은 시 화면 아래 `지난 시 보기` 링크가 시트를 열어요. 9단계 🟦 경윤: History가 생기면 `#past-link`를 `history.html?room=X&tab=poem` 링크로 바꾸고 `past.js`와 `#sheet-history`를 지워요 |
| 홈의 초대 시트 `#sheet-invite` | `index.html`, `index.js:143-253` (`renderMembers` 143, `drawRoomAction` 163, `confirmRoomAction` 171, `syncShareButton` 206) | **끝났어요** (PR #52). `invite.js`로 옮겼어요. 로직은 그대로예요 |
| 연속일 링 `#streak-ring` | `index.html`, `streak.js` | 8단계 🟦 경윤 (주간 캘린더로 바꿀지 경윤이 정해요) |
| 하단 탭 "오늘"·"내 방" 팝오버 처리 (`data-popover-keep`, `index.html#rooms`, `typoem:rooms` 이벤트) | `ui.js:297`(`data-popover-keep` 검사), `ui.js:362-397`(`buildTabbar`, "내 방" 링크 `:375`, 이벤트 `:397`), `index.js:283` | **끝났어요** (PR #50) |
| "나" 시트 `#sheet-me` | `ui.js:320` `openMe()` | **끝났어요** (PR #54). "나" 탭이 `me.html` 링크가 되면서 지웠어요 |
| `var(--x, #hex)` 대체값 (토큰 이름이 바뀌면 옛 색이 남을 수 있어요), 직접 쓴 px 글자 크기·간격 | `styles.css` 전체 | 2단계부터 조금씩. 대체값은 지우고, 크기와 간격은 토큰으로 바꿔요 |
| 옛 디자인 참고 파일 주석 (`Design reference: docs/design/typoem-calm-demo.html`) | `styles.css:4`, `docs/design/typoem-calm-demo.html` | Design.md가 생기면 주석을 바꾸고, 옛 시안은 지울지 팀에서 정해요 |
| `@view-transition` 인라인 `<style>` 2곳 | `room.html`, `book.html` | 2단계에서 `pages/room.css`로 옮겨요 |

---

## 남은 질문 (팀 결정 필요)

1. 홈과 방 탭에 같은 방 목록이 두 번 나와요. 홈은 "요약 카드", 방 탭은 "전체 목록 + 만들기·참여"로 나누는 안을 제안해요. 아니면 홈에는 최근 방 몇 개만 보여줄까요? → **일단 이렇게 바꿨어요** (PR #59, 🟨 소연): 홈은 최근에 연 방 3개까지 + `모든 방 보기`, 방 탭은 전체 + 만들기·참여. 개수는 `index.html`의 `data-limit="3"` 하나만 바꾸면 돼요 → **11/13에 안 2로 바뀌었어요** (PR #69): 홈은 고른 방 하나만 크게, 방 목록은 Rooms 탭에만 있어요
2. ~~홈의 '오늘의 시 · 우리 책' 큰 카드~~ → **정했어요 (11/13): 안 2** (PR #69). 고른 방 하나를 크게(시 = 앰버 선, 소설 = 블루 선 북커버 두 장 + History), Rooms 탭에서 방을 고르면 홈이 그 방으로 바뀌어요 (`POST /api/rooms/:id/open`)
3. 데스크톱(1024px 이상) 배치를 이번 대수정에서 같이 바꿀까요, 나중에 할까요?

### 정한 것 (11/13)
- 하단 탭 이름은 영어: **Home · Rooms · Words · Me** (아이콘은 그대로)
- 프로필 팝오버는 없애고 설정 맨 위로
- 다크 모드: 라이트 · 다크 · 기기 설정, 기본은 라이트 (값은 Design.md)
- 아침 알림: 폰 안에서 미리 예약해서 문구는 고정이에요 ("오늘의 시가 도착했어요 / 한 편 읽고 하루를 시작해요"). 기본 오전 8시, 설정에서 켜고 시간을 골라요. 원스토어 권한 설명: "알림(선택): 설정에서 켜면 매일 고른 시간에 '오늘의 시' 알림을 보내기 위해 사용하며, 끄면 알림을 보내지 않습니다."
- **v1.1 패치는 없어요.** 아침 알림 · 홈 화면 위젯 · 배지 화면도 오늘(11/13) 끝내고, 내일(11/14) v1.0 하나로 빌드해서 원스토어에 제출해요. 위젯을 못 끝내면 위젯만 빼고 출시해요 (출시는 미루지 않아요). CSS 나누기(2단계)는 보이는 변화가 없는 정리라 그대로 제출 뒤에 해요
