# Typoem

![CI](https://github.com/so-yeon-333/typoem/actions/workflows/test.yml/badge.svg)

**Live app:** https://typoem-app.onrender.com &nbsp;·&nbsp; **API docs:** https://typoem.onrender.com/api/docs

> *Type + Poem* — A cozy little corner where friends gather to read a daily poem and leave their ink-marks across the page.

Typoem is a full-stack web application where small groups of close friends gather in private code-based rooms to read one English poem together each day. Users can leave memos on the poem as a whole, attach line-level annotations to specific lines, and look up unfamiliar words through a built-in dictionary.

This project is the team submission for **ITM519 Web Programming (Spring 2026)**, Team 5.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Running the App](#running-the-app)
- [Testing](#testing)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Team](#team)
- [AI Use Disclosure](#ai-use-disclosure)
- [License](#license)

---

## Features

**Core**

- Create or join private rooms with invite codes
- Receive a daily English poem in each room
- Write and share full-poem memos
- Attach line-level annotations to specific lines
- Look up unknown words with an in-app dictionary

**Additional**

- **Personal vocabulary notebook** — save words from the dictionary popup and review them later (`/api/vocab`)
- **Poem history** — browse every daily poem a room has read, newest first, with the members who left notes on each (`/api/rooms/:id/history`)
- **Memo likes** — like and unlike memos, with per-memo like counts (`/api/memos/:id/like`)

**Stretch (not implemented)**

- Replies on memos
- Streaks and badges
- Calendar with friend activity
- Review past poems with notes
- Dark mode

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML + CSS + Vanilla JavaScript |
| Backend | Node.js + Express |
| Database | SQLite (sqlite + sqlite3) |
| Authentication | JWT + `bcrypt` |
| API Documentation | `swagger-ui-express` + `yamljs` |
| Testing | Jest + Supertest |
| CI | GitHub Actions |
| Deployment | Render (free tier) |

**External APIs**

- [PoetryDB](https://poetrydb.org/) — Source of English poems (free, no auth)
- [Free Dictionary API](https://dictionaryapi.dev/) — Word definitions and pronunciation (free, no auth)

**Data**

- Korean meanings of English words (`data/ko_dict.jsonl`) come from the Korean edition of [Wiktionary](https://ko.wiktionary.org/), extracted by [Wiktextract](https://github.com/tatuylonen/wiktextract) ([kaikki.org](https://kaikki.org/)). Licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Rebuild with `scripts/build_ko_dict.py`.

---

## Project Structure

```
typoem/
├── server.js               # Entry point — env validation, DB init, seed, listen
├── app.js                  # Express app — middleware, routers, Swagger, /api/health
├── db.js                   # Database connection (initDb / getDb)
├── openapi.yaml            # OpenAPI 3.0 specification
├── package.json
├── package-lock.json
├── routes/                 # Express routers
│   ├── auth.js
│   ├── users.js
│   ├── rooms.js
│   ├── memos.js
│   ├── annotations.js
│   ├── dictionary.js
│   ├── public.js
│   └── vocab.js
├── controllers/            # Route handler logic
├── models/                 # DB access layer
├── lib/
│   └── poemFetch.js        # Shared PoetryDB fetch helper
├── middleware/
│   └── authMiddleware.js
├── db/
│   ├── schema.sql          # CREATE TABLE statements
│   └── seed.js             # DB initialization + seed data
├── data/
│   └── poems.json          # Pre-fetched poems from PoetryDB
├── tests/                  # Jest + Supertest tests
├── scripts/                # Utility scripts (e.g., fetch-poems.js)
├── public/                 # Frontend (Lecture 12 pattern)
│   ├── landing.html / landing.js      # Public landing page (logged-out visitors)
│   ├── index.html / index.js          # My Rooms — room list (logged-in home)
│   ├── register.html / register.js
│   ├── login.html / login.js
│   ├── create-room.html / create-room.js
│   ├── join.html / join.js
│   ├── room.html / room.js            # Today's poem + memos + annotations
│   ├── history.html / history.js      # Past daily poems for a room
│   ├── vocab.html / vocab.js          # Personal vocabulary notebook
│   ├── dict-popup.js                  # Dictionary popup (word lookup + save)
│   ├── auth.js                        # Shared helper (JWT, requireLogin, authFetch)
│   ├── assets/                        # Static assets (e.g., paw.svg)
│   └── styles.css
├── .github/
│   └── workflows/
│       └── test.yml        # GitHub Actions CI
├── .env.example
├── .gitignore
└── README.md
```

The structure follows the MVC pattern, with frontend pages served as static files from `public/`.

---

## Prerequisites

- **Node.js** v22.x (the project is pinned to Node 22 via `engines` in `package.json`; the CI runs on Node 22)
- **npm** v10 or higher
- A GitHub account (for cloning)

Check your versions:

```bash
node --version
npm --version
```

---

## Setup

```bash
git clone https://github.com/so-yeon-333/typoem.git
cd typoem
npm install
cp .env.example .env
```

Then edit `.env` and fill in your values (see [Environment Variables](#environment-variables)).

On first startup, the database is created from `db/schema.sql` and seeded with demo data (`db/seed.js`): sample users, one room with invite code `ABC123`, and one poem ("Wild Nights - Wild Nights!" by Emily Dickinson) set as today's poem, so the room screen has content to display. (The seeded users use placeholder password hashes and are not meant for login; register a new account to log in.) Seeding is skipped if the database already contains users. To reset, delete the database file (`typoem.db`) and restart.

---

## Environment Variables

Create a `.env` file based on `.env.example`:

| Variable | Description | Example |
| --- | --- | --- |
| `PORT` | Port the server listens on | `3000` |
| `JWT_SECRET` | Secret key for signing JWTs (use a long random string) | `your-long-random-string-here` |
| `JWT_EXPIRES_IN` | JWT expiry passed to `jsonwebtoken` (e.g. `1h`) | `1h` |
| `DB_PATH` | Path to the SQLite database file | `./typoem.db` |
| `NODE_ENV` | Environment mode | `development` or `production` |

> ⚠️ `JWT_SECRET` and `JWT_EXPIRES_IN` are **required**. The server checks them on startup (`server.js`) and stops right away if either one is missing.

> ⚠️ **Never commit `.env` to git.** It is listed in `.gitignore`.

---

## Running the App

### Development

```bash
npm run dev
```

Uses Node's `--watch` mode for automatic restart on file changes. Open `http://localhost:3000` in your browser. The same Express server serves both the REST API and the frontend pages from `public/`.

### Production-style run

```bash
npm start
```

A health check endpoint is available at `/api/health`, which returns `{ "status": "ok", "app": "Typoem" }`.

### Refreshing the poem pool (optional)

`data/poems.json` holds poems pre-fetched from PoetryDB. To re-fetch a fresh batch:

```bash
npm run fetch-poems
```

This is a one-off utility (`scripts/fetch-poems.js`) and is not required to run the app.

---

## Testing

All tests are written with Jest and Supertest.

```bash
npm test
```

To run with a coverage report:

```bash
npm run test:coverage
```

**What's tested:**

- Unit tests for controllers, validators, and utilities (at least 2 modules with real logic)
- API tests covering at least one authenticated route, one error case (401/404/400), and one successful main-flow endpoint

Tests run automatically on every push to `main` and on every pull request via GitHub Actions (see CI badge at the top of this README).

---

## API Documentation

The OpenAPI 3.0 specification is in `openapi.yaml` (repository root).

When the server is running, you can open the API documentation (where you can try the endpoints in the browser) at:

```
http://localhost:3000/api/docs
```

On the deployed instance: https://typoem.onrender.com/api/docs

The docs are served by loading the static `openapi.yaml` file with `yamljs` and rendering it through `swagger-ui-express`.

---

## Deployment & CI/CD

The application is deployed on Render (free tier) so it can be opened easily during evaluation.

**Deployed URL:** https://typoem.onrender.com

### Continuous Deployment (CD)
Render is connected to this GitHub repository and auto-deploys on every push to `main`.
Combined with GitHub Actions CI, the full pipeline is:

`push / PR → GitHub Actions (CI: tests) → merge to main → Render auto-deploy (CD)`

Every change that lands on `main` is tested by CI, then automatically built and released to the live URL with no manual step.

### Notes on Render's free tier
* Render's free web service does not persist files on disk, so the SQLite database is wiped on every redeploy and after periods of inactivity.
* To handle this, the app seeds the database with a set of ready-made poems on every startup, so there is always something to show.
* User-created data (accounts, rooms, memos) is therefore not persistent — it is kept only until the next redeploy or sleep.
* Free services sleep after ~15 minutes of inactivity; the first request after that may take about 30 seconds to wake up.

### Running locally as a fallback
If the deployed URL is unavailable, follow the [Setup](https://github.com/so-yeon-333/typoem#setup) and [Running the App](https://github.com/so-yeon-333/typoem#running-the-app) sections.
---

## Contributing

This is a team project; the following workflow is followed by all team members.

### Branch Naming

```
feature/<area>-<short-description>    # e.g., feature/auth-jwt
fix/<area>-<short-description>        # e.g., fix/login-validation
test/<area>                           # e.g., test/auth-controller
docs/<area>                           # e.g., docs/readme-update
chore/<area>                          # e.g., chore/install-bcrypt
```

### Commit Messages

We follow simplified Conventional Commits:

```
feat: <description>     # New feature
fix: <description>      # Bug fix
test: <description>     # Test addition
docs: <description>     # Documentation
refactor: <description> # Code refactoring
chore: <description>    # Maintenance, setup
```

All commit messages are written in English.

### Pull Request Workflow

1. Create a feature branch from `main`
2. Make changes and commit
3. Push the branch and open a Pull Request on GitHub
4. CI must pass before merging
5. Review from a teammate is recommended but not required
6. Use Merge commit so each person's commit history stays visible on `main`
7. Delete the feature branch after merging (GitHub does this automatically)

### Git Configuration

Before your first commit, ensure your git identity matches your GitHub account:

```bash
git config user.name "Your Name"
git config user.email "your-github-email@example.com"
```

---

## Team

**Team 5**

| Member | Role |
| --- | --- |
| 박소연 | Team Lead, Frontend (poem screen, memo/annotation UI), Deployment, Initial repo and CI setup |
| 권시현 | Backend (DB schema, memos, line annotations, tests) |
| 이지섭 | Backend (authentication, rooms, today's poem API) |
| 김경윤 | Frontend (auth pages, room list, dictionary), CI maintenance and reporting |

---

## AI Use Disclosure

**Tools used:**

- Claude (Anthropic)

**How each team member used AI:**

- **박소연 (Soyeon)**
  1. Designing the UI structure and interaction patterns of the P13 poem screen (memo/annotation drawer, gutter click target)
  2. Comparing font metrics (digit/cap-height ratio of IM Fell English SC vs Gentium Book Plus) with help using fontTools
  3. Debugging the Render deployment — diagnosing free-tier environment issues such as the `sqlite3` v6 GLIBC requirement conflict
  4. Cross-checking the final README line by line against the actual code to catch mismatches (entry point, missing env vars, etc.)

- **이지섭 (Jiseop)**
  1. Help structuring and scaffolding which test cases to write
  2. Help with areas not covered in class or unclear, such as SQLite handling
  3. Debugging when errors occurred or behavior did not match intent
  4. Because the team conventions and project specification are very specific, repeatedly checking with AI whether his code followed them

- **권시현 (Sihyun)**
  1. Structuring the `sqlite` + `sqlite3` handling and the `initDb()` / `getDb()` layer
  2. Designing the REST API structure (404/403 branching, splitting routes across two paths)
  3. Scaffolding tests using a mock-based approach
  4. Cross-checking his code against the project spec and team conventions (table constraints, REST response codes)

- **김경윤 (Gyeongyoon)**
  1. Building the auth pages and room pages (form handling, client-side validation, the authFetch request/response/error flow)
  2. Designing the dictionary popup (`dict-popup.js`) — reusable popup DOM, event delegation for word clicks, position-flip calculation, close-on-Esc/outside-click — mostly not covered in class
  3. Writing the regex that strips punctuation from PoetryDB markup (`_italic_`, em dashes) so dictionary lookups don't break
  4. Debugging the mobile popup-position bug and word-lookup failures caused by punctuation

All AI-assisted output is reviewed, understood, and modified by the responsible team member before being committed.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
