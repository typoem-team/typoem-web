# Typoem Design.md (시안 C)

> 화면 생김새의 기준 문서예요. 값은 `public/styles.css` 맨 위 토큰에 그대로 들어가 있어요.
> 화면 구조와 이동 흐름은 [redesign-plan.md](../redesign-plan.md)를 따라요. 이 문서는 **생김새**만 정해요.
> 시안 캔버스(Claude Design): 시안 C — 지금 기능에 맞춘 화면 (경윤에게 링크 받기)
> 담당: 🟦 경윤 · 처음 쓴 날: 2026-11-13

## 0. 한 줄로

흰 종이 위에 짙은 청록 잉크, 민트로 나누고, 앰버(시)와 블루(소설) 두 가지 색으로 구분해요.
제목은 영어 세리프 이탤릭, 본문 UI는 한국어 산세리프, 숫자·날짜는 고정폭이에요.

## 1. 색

새 CSS에서는 **역할 이름(`--color-*`)**만 써요. 화면 CSS에 hex를 직접 쓰지 않아요.

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `--color-bg` | `#FFFFFF` | 화면 바탕 |
| `--color-surface` | `#F1F6F3` | History 박스, 현재 방 카드, 통계 칸, 알약 탭 바탕 |
| `--color-line` | `#DDEBE4` | 구분선, 칩 바탕, 시트 손잡이, 줄 주석 말풍선(민트) |
| `--color-line-dashed` | `#B9CEC4` | 아직 오지 않은 날 (점선 동그라미) |
| `--color-ink` | `#28383C` | 본문 글자, 주 버튼, 어두운 카드(북커버) |
| `--color-ink-2` | `#4F6568` | 보조 글자, 시 읽기 머리 띠, 시트 뒤 막 |
| `--color-ink-3` | `#7C8F91` | 안 고른 탭 아이콘, placeholder (큰 글자·아이콘만) |
| `--color-on-ink` | `#FFFFFF` | 어두운 바탕 위 글자 |
| `--color-on-ink-2` | `#DDEBE4` | 어두운 바탕 위 보조 글자 |
| `--color-accent` | `#82AAB9` | **소설·책**, 진행 막대, 현재 탭 점. 채우기 전용 |
| `--color-accent-text` | `#3F6E7E` | 흰 바탕 위 링크·강조 글자 |
| `--color-accent-warm` | `#F2CB96` | **오늘의 시**, 인용 줄, 방장 칩, 완독 칩 |
| `--color-accent-rose` | `#E3A59D` | 아바타 |
| `--color-danger` | `#9A3B30` | 오류, 삭제, 계정 삭제 |
| `--color-highlight` | `rgba(236,196,64,.40)` | 형광펜 |
| `--color-scrim` | `rgba(40,56,60,.45)` | 시트·팝오버 뒤 반투명 막 |

규칙
- **시 = 앰버, 소설 = 블루.** 홈 카드 안쪽 선, 라벨(`TODAY'S POEM`, `OUR BOOK`), 화살표 색으로 구분해요.
- `#82AAB9`와 `#F2CB96`은 흰 바탕 위 **글자색으로 쓰지 않아요** (대비가 낮아요). 어두운 바탕 위 글자나 채우기로만 써요. 흰 바탕 위 강조 글자는 `--color-accent-text`.
- 아바타 색은 rose · line(민트) · warm · accent 네 가지를 돌려 써요. 글자는 `--color-ink`.
- 옛 이름(`--bg`, `--ink`, `--ink-2`, `--on-ink`, `--accent` …)은 새 값을 가리켜요. 앱(`typoem-app/app-shell.js`)이 읽으니 지우지 않아요.
- 다크 모드: 이름은 그대로, 값만 바꿔요 (`:root[data-theme="dark"]`, 기기 설정이면 `prefers-color-scheme`). `theme.js`가 `<html data-theme>`를 붙여요.

### 다크 값

| 토큰 | 다크 값 | 메모 |
|---|---|---|
| `--color-bg` | `#161E20` | |
| `--color-surface` | `#1F2A2D` | |
| `--color-line` | `#2E3D40` | |
| `--color-line-dashed` | `#4A5E60` | |
| `--color-ink` | `#E6EEEA` | 글자. ink로 채운 버튼은 밝아져요 → 그 위 글자는 `--button-ink #28383C` |
| `--color-ink-2` | `#A9BCBA` | |
| `--color-ink-3` | `#7F9493` | |
| `--color-on-ink` | `#FFFFFF` | 그대로: 표지 · 아바타 · 시 머리 띠 위 글자 |
| `--color-accent` | `#82AAB9` | 그대로 |
| `--color-accent-text` | `#9CC3D1` | 어두운 바탕 위 링크 |
| `--color-accent-warm` / `-rose` | 그대로 | |
| `--color-danger` | `#E08A7E` | 어두운 바탕에서 읽히게 밝게 |
| `--color-highlight` | `rgba(236,196,64,.30)` | |
| `--color-scrim` | `rgba(0,0,0,.55)` | |
| 표지 색 `--cover-1…7` | 그대로 | |

## 2. 글꼴

| 토큰 | 글꼴 | 쓰는 곳 |
|---|---|---|
| `--font-ui` | Noto Sans KR | 버튼, 목록, 설명, 한국어 UI 전부 |
| `--font-ko-head` | Noto Serif KR (600) | 방 이름, 한국어 제목, 닉네임 |
| `--font-text` | Newsreader | 시·책 본문, 영어 제목. 화면 제목은 **이탤릭** |
| `--font-mono` | IBM Plex Mono | 날짜, 숫자, 라벨(대문자 + 자간 1.5px), 줄 번호 |

- 모두 SIL OFL이에요. `public/fonts/<글꼴>/`에 woff2와 `OFL.txt`를 같이 올렸어요 (11/13, 소연). 합쳐서 약 1MB예요.
- 한국어 두 글꼴은 KS X 1001 한글 2,350자 + 영문 · 문장부호만 남겼어요 (MaruBuri와 같은 기준). 그 밖의 드문 한글은 그 글자만 뒤쪽 글꼴로 보여요.
- CSS가 쓰는 굵기만 남겼어요: Noto Sans KR 400–700(가변), Noto Serif KR 600, Newsreader 300–500(가변, 보통 · 이탤릭), IBM Plex Mono 400 · 500. 다른 굵기를 쓰려면 글꼴을 다시 만들어야 해요.

### 글자 크기

| 토큰 | px | 예 |
|---|---|---|
| `--fs-2xs` | 10 | 아주 작은 라벨, 요일 |
| `--fs-xs` | 11 | 모노 라벨 (`TODAY'S POEM`), 탭 이름 |
| `--fs-sm` | 12 | 보조 설명, 칩 |
| `--fs-md` | 13 | 작은 버튼 |
| `--fs-base` | 14 | 버튼, 메모 본문 |
| `--fs-body` | 15 | 목록 줄, 설정 |
| `--fs-lg` | 16 | 작가 이름 |
| `--fs-text` | 19 | 시 본문 |
| `--fs-h3` | 22 | 한국어 제목 |
| `--fs-h2` | 28 | 카드 위 작품 제목 |
| `--fs-h1` | 44 | 화면 제목 (`Rooms`, `History`, `Words`, `Me`), 시 제목 |
| `--fs-hero` | 96 | 나 화면 연속일 숫자 |

## 3. 간격 · 모서리 · 그림자

- 간격: `--space-1`(4) `-2`(8) `-3`(12) `-4`(16) `-5`(20) `-6`(24) `-7`(28). 화면 좌우 여백은 `--gutter` 24px.
- 누르는 곳은 최소 `--touch` 44px.
- 모서리: `--radius-sm` 4 · `-md` 6(버튼) · `-lg` 8(카드) · `-xl` 14(팝오버) · `-sheet` 18(시트 위쪽) · `-pill` 999(알약).
- 북커버: `--radius-book` (책등 쪽 3px, 반대쪽 10px) + `--shadow-book`.
- 떠 있는 박스: `--shadow-pop`.

## 4. 공통 부품

| 부품 | 생김새 |
|---|---|
| 하단 탭 | 4칸: **Home · Rooms · Words · Me** (영어). 아이콘 22px 선 아이콘 + 11px 글자. 현재 탭은 굵게 + 아래 4px 점(`--color-accent`). 높이 76px. 아이콘: Home=집, Rooms=사람 두 명, Words=책갈피, Me=사람 한 명 |
| 화면 제목 | 탭 화면 맨 위 `Newsreader` 이탤릭 44px (`Rooms`, `History`, `Words`, `Me`). 오른쪽에 모노 11px 개수 (`3 ROOMS`, `4 WORDS`) |
| 북커버 카드 | 바탕 `--color-ink`, 왼쪽 책등 그림자(가로 그라데이션), `--radius-book`, `--shadow-book`. 안쪽 8px에 1px 선(시=앰버, 소설=블루, 반투명). 맨 아래 한 줄: 왼쪽 정보(아바타·메모 수 / 오늘 약 N쪽), 오른쪽 화살표. 줄 전체가 링크 |
| 작은 책 표지 | 42×60, 색 채우기 + 책등 그라데이션 + 안쪽 1px 흰 선 |
| 방 카드 | 흰 바탕, 1px `--color-line`, `--radius-lg`. 현재 방은 1.5px `--color-ink` 테두리 + `--color-surface` 바탕 + 진한 `지금 방` 칩 |
| 알약 탭 | 바탕 `--color-surface` (어두운 바탕 위에서는 흰 16%), 고른 칸 `--color-ink` + 흰 글자 |
| 시트 | 아래에서 올라와요. 위 모서리 18px, 손잡이 40×4 `--color-line`, 뒤에 `--color-scrim` |
| 줄 주석 말풍선 | 그 줄 바로 아래, `--color-line`(민트) 바탕, 위쪽 꼬리, 아래 그림자. 열린 줄 외에는 opacity .35 |
| 아바타 | 동그라미, 첫 글자, 겹칠 때 흰 2px 테두리 + -8px. 초대는 맨 끝 점선 동그라미 `+` |
| 칩 | 11px, 좌우 9px, 모서리 10px. `읽는 중`=line, `완독`=warm, `멈춤`=테두리만 |
| 아이콘 | 인라인 SVG 선 아이콘만 (stroke 1.6–2, round). **이모지는 쓰지 않아요** |

## 5. 문구

- 화면 제목과 하단 탭은 영어, 나머지 UI 문구는 한국어 `-요`체.
- 사용자가 모를 말(구텐베르크, 책 번호, 목표일 등)은 쓰지 않아요.
- 출처·라이선스는 설정 > `출처 및 라이선스`에만 둬요.

## 6. 바뀐 결정 기록

| 날짜 | 결정 |
|---|---|
| 11/12 | 시안 C(파스텔)로 가요. 로그인·회원가입은 한국어 |
| 11/13 | 하단 탭 Home · Rooms · Words · Me, Rooms는 시트가 아니라 탭 페이지 |
| 11/13 | 프로필 팝오버는 없애고, 프로필은 설정 맨 위로 (홈 아바타 없음) |
| 11/13 | 홈의 시·소설 카드는 북커버 모양 (홈에 큰 카드를 둘지는 **결정 필요**: redesign-plan '남은 질문 2') |
| 11/13 | 하단 탭 이름은 영어로 확정 (Home · Rooms · Words · Me), 다크 모드 기본은 라이트 |
| 11/13 | 초대는 멤버 아바타 끝의 점선 `+` |

## 7. 앱(typoem-app)에서 같이 바꿀 것

- `app-shell.js`의 `PAPER = '#f2eee7'`, `capacitor.config.json`의 `backgroundColor`, `StatusBar.backgroundColor` → `#FFFFFF` (🟨 소연, 3-앱)
- 상태 표시줄 글자색은 어두운 색 (흰 바탕이라서)
