# Typoem

![CI](https://github.com/typoem-team/typoem-web/actions/workflows/test.yml/badge.svg)

**서비스:** https://typoem-app.onrender.com &nbsp;·&nbsp; **API 문서:** https://typoem-app.onrender.com/api/docs &nbsp;·&nbsp; **Android 앱:** [typoem-team/typoem-app](https://github.com/typoem-team/typoem-app)

> *Type + Poem* — 친구들과 함께 영어 시와 소설을 읽고 생각을 나누는 공간

Typoem은 가까운 친구들이 초대 코드로 만든 비공개 방에서 매일 영어 시 한 편과 소설을 함께 읽는 서비스입니다. 시의 단어에 하이라이트와 메모를 남기고, 모르는 단어는 영한 사전으로 바로 찾아 단어장에 저장할 수 있습니다. 소설은 방마다 저작권이 만료된 영어 작품을 한 권 정해 장별로 함께 읽습니다.

이 저장소에는 서버와 웹 화면이 함께 들어 있습니다. Android 앱은 이 저장소의 웹 화면을 그대로 사용합니다.

이 프로젝트는 [so-yeon-333/typoem](https://github.com/so-yeon-333/typoem)에서 시작한 작업을 이어서 개발하고 있습니다. 이전 커밋 기록은 이 저장소에 그대로 남아 있습니다.

---

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 방 | 방을 만들고 초대 코드로 친구를 초대합니다. |
| 오늘의 시 | 방마다 하루에 한 편씩(한국 시간 기준) 시가 주어집니다. 지난 시는 기록에서 다시 볼 수 있습니다. |
| 하이라이트 · 메모 | 시의 단어나 구절에 하이라이트나 메모를 남기고, 시 전체에 대한 메모를 남깁니다. |
| 사전 · 단어장 | 단어를 누르면 영어 뜻과 한국어 뜻을 보여 줍니다. 저장한 단어는 단어장에서 다시 봅니다. |
| 함께 읽는 소설 | 방장이 작품을 정하면 멤버들이 장별로 읽고, 서로 어디까지 읽었는지 확인합니다. |
| 연속 읽기 · 배지 | 매일 시를 다 읽으면 연속 읽기 기록이 이어지고 배지를 받습니다. |
| 설정 | 닉네임, 라이트 · 다크 테마, 아침 알림(앱), 계정 삭제를 제공합니다. |

---

## 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| 프론트엔드 | HTML, CSS, JavaScript |
| 백엔드 | Node.js 22, Express 5 |
| 데이터베이스 | libSQL (운영: Turso, 개발 · 테스트: 로컬 SQLite 파일) |
| 인증 | JWT, bcrypt |
| API 문서 | OpenAPI 3.0, Swagger UI |
| 테스트 · CI | Jest, Supertest, GitHub Actions |
| 배포 | Render |

---

## 실행 방법

Node.js 22가 필요합니다.

```bash
git clone https://github.com/typoem-team/typoem-web.git
cd typoem-web
npm install
cp .env.example .env     # JWT_SECRET에 임의의 긴 문자열을 넣습니다
npm run dev              # http://localhost:3000
```

처음 실행하면 로컬 데이터베이스 파일(`typoem.db`)과 예시 데이터가 만들어집니다. 회원가입 후 이용해 주세요.

테스트는 다음 명령으로 실행합니다.

```bash
npm test
```

### 환경 변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `JWT_SECRET` | 필수 | 토큰 서명용 비밀 키 |
| `JWT_EXPIRES_IN` | 필수 | 토큰 유효 기간 (예: `1h`) |
| `PORT` | | 서버 포트 (기본값 `3000`) |
| `DB_PATH` | | 로컬 데이터베이스 파일 경로 (기본값 `./typoem.db`) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | 운영 | Turso 데이터베이스 연결 정보 |
| `CORS_ORIGINS` | | 추가로 허용할 출처 |
| `NODE_ENV` | | `development`, `production`, `test` |

그 밖의 선택 항목은 `.env.example`에 설명되어 있습니다.

---

## 배포

`main` 브랜치에 변경이 합쳐지면 GitHub Actions에서 테스트를 실행하고, Render가 자동으로 배포합니다. 데이터는 Turso에 저장되어 재배포 후에도 유지됩니다.

---

## 데이터 출처 및 라이선스

- 시: [PoetryDB](https://poetrydb.org/)
- 영어 뜻: [Free Dictionary API](https://dictionaryapi.dev/)
- 책: [Project Gutenberg](https://www.gutenberg.org/), [Gutendex](https://gutendex.com/) — 한국에서 저작권이 만료된 작품만 제공합니다.
- 한국어 뜻: 한국어 [위키낱말사전](https://ko.wiktionary.org/) ([Wiktextract](https://github.com/tatuylonen/wiktextract), [kaikki.org](https://kaikki.org/)), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- 글꼴: SIL Open Font License (`public/fonts/` 각 폴더의 `OFL.txt`)

---

## 팀

| 이름 | 이메일 |
| --- | --- |
| 박소연 | amypark310@gmail.com |
| 권시현 | sihyun0305@naver.com |
| 이지섭 | ljseop1030@gmail.com |
| 김경윤 | gracekim6531@naver.com |

## 라이선스

MIT License — [LICENSE](LICENSE)
