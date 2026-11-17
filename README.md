# Typoem

> *Type + Poem* — 친구들과 함께 영어 시와 소설을 읽고 생각을 나누는 공간

**바로 가기:** https://typoem-app.onrender.com &nbsp;·&nbsp; **Android 앱:** [typoem-team/typoem-app](https://github.com/typoem-team/typoem-app)

Typoem은 교환 독서에서 영감을 받은 서비스입니다. 가까운 친구들과 초대 코드로 비공개 방을 만들고, 매일 영어 시 한 편과 함께 고른 소설을 읽습니다. 마음에 드는 구절에 형광펜을 긋고 메모를 남기거나, 모르는 단어를 영한 사전에서 바로 찾아 단어장에 저장할 수 있습니다. 친구가 남긴 형광펜과 메모를 보며 함께 읽을 수 있습니다.

<!-- 스크린샷: 오늘의 시 · 형광펜 · 사전 팝업 · 방 화면 -->

---

## 시작하기

1. 회원가입 후 **방을 만듭니다.**
2. **초대 코드**를 친구에게 보내 방에 초대합니다.
3. 매일 아침 도착하는 **오늘의 시**를 읽고 흔적을 남깁니다.

> 서버가 잠시 쉬고 있으면 첫 접속에 30초 정도 걸릴 수 있습니다. 잠시만 기다려 주세요.

---

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 방 | 방을 만들고 초대 코드로 친구를 초대합니다. 방 멤버만 서로의 기록을 볼 수 있습니다. |
| 오늘의 시 | 매일 아침 새로운 시 한 편이 도착합니다. 지난 시는 기록에서 다시 볼 수 있습니다. |
| 형광펜 · 주석 · 메모 | 시와 소설의 구절에 형광펜이나 주석을 남기고, 작품 전체에 대한 메모를 씁니다. 방 친구들이 남긴 흔적도 함께 보입니다. |
| 사전 · 단어장 | 단어를 두 번 탭하면 영어 뜻과 한국어 뜻을 보여 줍니다. 저장한 단어는 단어장에서 다시 볼 수 있습니다. |
| 함께 읽는 소설 | 방장이 작품을 정하면 멤버들이 장별로 읽고, 서로 어디까지 읽었는지 확인합니다. 완독 목표일을 정하면 하루에 읽을 분량을 알려 줍니다. |
| 연속 읽기 · 배지 | 매일 시를 다 읽으면 연속 읽기 기록이 이어지고 배지를 받습니다. |
| 설정 | 닉네임, 라이트 · 다크 테마, 아침 알림, 계정 삭제 등을 설정할 수 있습니다. |

---

## 개인정보 처리 방침

개인정보처리방침은 [여기](https://typoem-app.onrender.com/privacy.html)에서 확인할 수 있습니다.

---

## 문의

궁금한 점이나 불편한 점은 이메일로 보내 주세요.

| 이름 | 이메일 |
| --- | --- |
| 박소연 | amypark310@gmail.com |
| 권시현 | sihyun0305@naver.com |
| 이지섭 | ljseop1030@gmail.com |
| 김경윤 | gracekim6531@naver.com |

---

<details>
<summary>개발 정보</summary>

![CI](https://github.com/typoem-team/typoem-web/actions/workflows/test.yml/badge.svg)

이 저장소에는 서버와 웹 화면이 함께 들어 있으며, Android 앱은 이 웹 화면을 그대로 사용합니다. API 문서는 https://typoem-app.onrender.com/api/docs 에서 볼 수 있습니다.

| 구분 | 사용 기술 |
| --- | --- |
| 프론트엔드 | HTML, CSS, JavaScript |
| 백엔드 | Node.js 22, Express 5 |
| 데이터베이스 | libSQL (Turso) |
| 인증 | JWT, bcrypt |
| API 문서 | OpenAPI 3.0, Swagger UI |
| 테스트 · CI | Jest, Supertest, GitHub Actions |
| 배포 | Render |

이 프로젝트는 [so-yeon-333/typoem](https://github.com/so-yeon-333/typoem)에서 시작한 작업을 이어서 개발하고 있으며, 이전 커밋 기록은 이 저장소에 그대로 남아 있습니다.

</details>

---

## 출처 및 라이선스

- 시: [PoetryDB](https://poetrydb.org/) — 저작권이 만료된 시만 제공합니다.
- 소설: [Project Gutenberg](https://www.gutenberg.org/), [Gutendex](https://gutendex.com/) — 한국에서 저작권이 만료된 작품만 제공합니다.
- 영영 사전: [Free Dictionary API](https://dictionaryapi.dev/)
- 영한 사전: 한국어 [위키낱말사전](https://ko.wiktionary.org/) ([Wiktextract](https://github.com/tatuylonen/wiktextract), [kaikki.org](https://kaikki.org/)) — [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- 글꼴: SIL Open Font License (`public/fonts/` 각 폴더의 `OFL.txt`)


MIT License — [LICENSE](LICENSE)

