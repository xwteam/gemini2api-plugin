<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie 유지 브라우저 확장 프로그램</h3>
<p>브라우저가 Cookie를 로테이션하면 바로 중계에 동기화하고, 계정이 만료되거나 세션이 무효해지면 로컬 브라우저(주거용 IP)에서 Gemini를 새로고침하여 새 Cookie를 제출해 약 2시간 제한 돌파를 돕습니다.</p>

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="MV3">
  <img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-Latest-1a73e8?style=flat-square&logo=googlechrome&logoColor=white" alt="Browser">
  <img src="https://img.shields.io/badge/JavaScript-ES%20Module-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JS">
  <img src="https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-%E9%9B%B6-success?style=flat-square" alt="No deps">
  <img src="https://img.shields.io/badge/License-Non--Commercial-red?style=flat-square" alt="License">
</p>

<p>📦 메인 프로젝트: <a href="https://github.com/xwteam/gemini2api"><b>gemini2api</b></a> (Gemini Web 리버스 프록시) · 본 확장은 Cookie 유지용 동반 도구입니다</p>

<p>
  <a href="#-동작-원리">동작 원리</a> &bull;
  <a href="#-핵심-기능">핵심 기능</a> &bull;
  <a href="#-설치">설치</a> &bull;
  <a href="#-설정">설정</a> &bull;
  <a href="#-다중-계정">다중 계정</a> &bull;
  <a href="#-ui">UI</a> &bull;
  <a href="#-권한">권한</a> &bull;
  <a href="#-faq">FAQ</a> &bull;
  <a href="#-알려진-제한">제한</a>
</p>

<p>
  📖 문서: <a href="../zh-CN/README.md">简体中文</a> | <a href="../zh-TW/README.md">繁體中文</a> | <a href="../en/README.md">English</a> | <a href="../ja/README.md">日本語</a> | 한국어
</p>

</div>

---

> [!NOTE]
> 본 확장은 [Gemini2API](https://github.com/xwteam/gemini2api)의 동반 도구입니다. 연구·학습 목적만. 상업적 이용 금지.

> [!WARNING]
> Google과 무관합니다. 브라우저 확장으로 Gemini 로그인 Cookie를 읽으므로 Google 이용약관 위반 가능성이 있습니다. 본인 책임 하에 사용하세요.

> [!IMPORTANT]
> **2시간 제한을 100% 돌파한다고 보장하지 않습니다.** 로컬 브라우저와 중계가 동일 계정 세션을 공유합니다. v1.3.0부터는 브라우저가 로테이션한 새 Cookie를 중계에 바로 동기화하며, **gemini2api ≥ v1.6.44**와 함께 쓰면 중계가 해당 계정을 직접 로테이션하지 않아 서로 밀어내는 일을 막습니다(v1.6.41~v1.6.43 중계는 여전히 자체 로테이션). [Issue](https://github.com/xwteam/gemini2api-plugin/issues)에 실측 결과 공유 환영.

---

## 💡 동작 원리

데이터센터 IP 중계 서버에서는 Google 세션이 약 2시간 후 만료되는 경우가 많습니다. **로컬 브라우저는 주거용 IP에서 동작하므로 동일 계정 세션이 더 오래 유지될 수 있습니다.** 본 확장은 두 경로로 동작합니다:

```
① 능동 동기화(v1.3.0): 브라우저가 Cookie를 로테이션 → 중계로 전달
chrome.cookies.onChanged 가 __Secure-1PSIDTS / __Secure-1PSID 변경 감지
  → 약 10초 기다려 연속 변경 병합 → 현재 Cookie 읽기(탭 새로고침 없음)
  → 대상: 사이드바에 바인딩한 계정 ID, 없으면 PSID 매칭
  → 마지막 성공 제출과 다르고 마지막 제출 후 ≥ 60초 → PUT /admin/accounts/{id}/cookies
  (service worker가 대기 중 중단돼도 주기 폴링마다 다시 확인해 보충)

② 구조: N초마다 → GET /admin/status 로 중계 계정 상태 확인
  ├─ active 이고 정상 → 아무 것도 안 함
  └─ expired(만료) 또는 is_healthy=false(세션 무효)
        → 열린 gemini.google.com 탭 새로고침
        → chrome.cookies 로 새 __Secure-1PSID / __Secure-1PSIDTS 읽기
        → PUT /admin/accounts/{id}/cookies 로 중계에 제출
        → 다음 폴링에서 active 복구 확인
```

확장 자체는 Cookie를 로테이션하지 않습니다. 능동 동기화는 브라우저가 이미 바꾼 값을 중계에 넘길 뿐이며, **탭 새로고침은 만료·세션 무효 감지 시 1회만** 하고 쿨다운으로 반복을 방지합니다. 두 경로 모두 `X-Gemini2API-Keepalive: gemini2api-plugin/<버전>` 헤더를 붙여 제출하며, **gemini2api ≥ v1.6.44**는 이를 보고 해당 계정을 「브라우저 유지」로 표시하고 서버 측 로테이션을 멈춥니다(구버전 중계는 헤더를 무시).

## 🌟 핵심 기능

- **능동 동기화(v1.3.0)**: 브라우저가 Cookie를 로테이션하면 약 10초 내 중계에 제출. 값이 바뀐 경우만, 동일 계정은 최소 60초 간격, 주기 폴링으로 보충. 확장 자체는 로테이션·페이지 새로고침을 하지 않음
- **구조**: 만료되었거나 중계가 active인데 `is_healthy=false`(세션 무효)일 때만 탭을 새로고침하고 새 Cookie 제출
- **HttpOnly Cookie 읽기**: `chrome.cookies`로 `__Secure-` 인증 Cookie 접근
- **자동 새로고침**: 열린 Gemini 탭 자동 갱신
- **계정별 제출 + 혼선 방지**: 계정 ID 지정 시 직접 제출; 미지정 시 PSID 자동 매칭
- **쿨다운**: 동일 계정 연속 새로고침 방지
- **고정 사이드바**: 오른쪽에 상시 표시, 로그 장시간 모니터링
- **다국어 UI**: 확장 UI·로그가 Chrome 브라우저 언어를 자동 따름 (간체·번체 중국어 / 영 / 일 / 한), 문서 언어와 일치
- **제로 의존성**: Manifest V3 + 순수 JavaScript, 빌드 불필요
- **프라이버시**: API Key·Cookie는 로컬만, 설정한 중계로만 전송. 동기화 기록은 Cookie 해시 지문만 저장하고 값은 저장하지 않음

## 📦 설치

> [!TIP]
> Chrome, Edge 등 Chromium 브라우저 지원.

1. 저장소 클론 또는 다운로드
2. 확장 프로그램 페이지: `chrome://extensions` 또는 `edge://extensions`
3. **개발자 모드** 활성화
4. **압축해제된 확장 프로그램을 로드합니다** → 프로젝트 루트（`manifest.json` 있는 폴더） 선택

> [!IMPORTANT]
> `manifest.json`이 있는 저장소 루트를 로드하세요. 본 저장소는 **확장 실행 파일, 정적 docs**(`docs/`)**와 단위 테스트**(`tests/`, 확장이 로드하지 않음. 개발자는 Node ≥ 22에서 `node --test tests/` 실행)만 포함 — 문서 생성 스크립트 없음.

5. 확장 아이콘 → 사이드바:
   - 상단에서 **이 브라우저가 담당할 계정 ID** 바인딩 (예: `account-0`)
   - 우측 상단 **중계 설정**에서 URL·API Key 입력

## ⚙ 설정

### 사이드바 (이 브라우저 인스턴스)

| 항목 | 설명 |
|------|------|
| **계정 ID** | **강력 권장** (`account-0` 등). 브라우저 1개 = 계정 1개, 여기서 바인딩; 다중 계정 시 프로필마다 별도 설정 |

**바인딩** 클릭. 비우면 PSID 자동 매칭 (다중 계정 비권장).

### 중계 설정 페이지

| 항목 | 설명 |
|------|------|
| **중계 URL** | Gemini2API 주소 (예: `http://1.2.3.4:5918`) |
| **API Key** | `sk-` 키; gemini2api ≥ v1.6.16 `ADMIN_API_KEY` 분리 시 **관리 키** 입력 |
| **폴링 간격** | 기본 60초, 최소 30초 |
| **새로고침 쿨다운** | 구조 시 동일 계정 재처리 간격, 기본 120초(능동 동기화는 고정 최소 60초 간격) |

**연결 테스트** 후 **저장**.

> [!NOTE]
> **gemini2api 호환**:
> - v1.6.16부터 PSID 마스킹. **계정 ID 바인딩 권장**.
> - v1.6.41~v1.6.43은 Google 세션이 죽은 계정도 `active`로 보고하고 `is_healthy`만 false로 둡니다. v1.3.0부터 확장은 이를 「세션 무효」로 보고 구조합니다.
> - **v1.6.44부터** 확장이 Cookie를 제출한 계정은 「브라우저 유지」(`/admin/status`의 `keepalive_mode`가 `browser`)가 되어 서버 측 로테이션이 멈춥니다. 서버 측 로테이션으로 되돌리려면(예: 시크릿 창 Cookie로 교체) 해당 브라우저에서 본 확장을 먼저 끄고 패널에서 Cookie를 수동 업데이트하세요(안 그러면 다음 동기화 때 다시 브라우저 유지로 바뀜).

> [!IMPORTANT]
> **브라우저 인스턴스당 계정 1개.** gemini.google.com 탭 상시 유지, **전용 프로필** 사용. 사이드바 상단에서 **계정 ID 바인딩**.

## 👥 다중 계정

계정마다 **격리된 브라우저 환경** + 각각 본 확장 설치:

| 계정 | 브라우저 환경 | Google 계정 |
|------|-------------|------------|
| account-0 | Chrome 프로필 A | 계정 0 |
| account-1 | Chrome 프로필 B | 계정 1 |

동일 **중계 설정** (URL + API Key); **사이드바 상단**에서 서로 다른 계정 ID 바인딩 (예: A→`account-0`, B→`account-1`).

## 🖥 UI

툴바 아이콘 → **오른쪽 고정 사이드바**.

- 상단 **계정 ID 바인딩**; 상태(활성 / 만료 / 세션 무효)·마스킹된 PSID·동작 로그(능동 동기화 기록 포함)·**지금 확인**·**강제 새로고침 제출**·우측 상단 **중계 설정**
- 로컬 Cookie 표시 및 중계 계정 일치 여부
- 배지: 파랑=활성, 빨강=만료·세션 무효(구조 대상), `!`=연결 실패

## 🔐 권한

| 권한 | 용도 |
|------|------|
| `cookies` + `*://*.google.com/*` | Gemini HttpOnly Cookie 읽기 및 변경 감시(능동 동기화) |
| `tabs` | gemini.google.com 탭 검색·새로고침 |
| `storage` | 설정·로그·동기화 기록(해시 지문만) 저장 |
| `alarms` | 주기 폴링 |
| 중계 호스트 권한 | 저장 시 동적 요청 |

> [!NOTE]
> API Key와 Cookie는 로컬에만 저장되며 설정한 중계로만 전송됩니다. v1.3.0 능동 동기화로 권한이 늘지 않았고, 동기화 기록은 Cookie의 SHA-256 축약 지문만 저장합니다.

## ❓ FAQ

**Q: gemini.google.com 탭을 찾을 수 없음?**
A: https://gemini.google.com 에 로그인하고 탭을 열어두세요.

**Q: 새로고침 후에도 Cookie 없음?**
A: 미로그인 또는 다른 계정 로그인. 다시 로그인하세요.

**Q: 제출 후에도 만료?**
A: PSID가 Google에서 폐기됐을 수 있음. 재로그인 필요.

**Q: 만료되지 않았는데 Cookie를 제출하는 이유?**
A: v1.3.0 능동 동기화입니다. 브라우저와 중계가 같은 Google 세션을 공유하므로 브라우저가 PSIDTS를 로테이션하면 중계의 이전 값은 곧 무효가 됩니다. 그래서 새 값을 전달합니다(값이 바뀐 경우만, 동일 계정 최소 60초 간격, 탭 새로고침 없음). gemini2api ≥ v1.6.44면 중계가 해당 계정 로테이션을 멈춰 서로 밀어내지 않습니다.

**Q: 사이드바의 「세션 무효」란?**
A: 중계는 `active`로 보고하지만 `is_healthy`가 false — Google 세션이 실제로는 죽은 상태입니다(gemini2api v1.6.41~v1.6.43의 보고 방식). 확장은 「만료됨」과 똑같이 구조합니다(탭 새로고침 후 새 Cookie 제출).

**Q: 계정 정지 위험?**
A: Google에 추가 요청을 보내지 않음(능동 동기화는 브라우저에 있는 Cookie를 중계로 넘길 뿐, 탭 새로고침은 구조 시에만). 저빈도이나 비공식 방식. 본인 판단.

**Q: 계정 A Cookie가 B로 제출?**
A: PSID 검증 후 불일치 시 거부. **브라우저당 1계정** 준수.

**Q: `Cannot load extension with file or directory name _doc_templates`?**
A: **v1.2.2+** 로 업데이트. **v1.2.3**부터 문서 생성 도구는 저장소에서 제거됨.

## ⚠ 알려진 제한

- **브라우저 1개 = 계정 1개**
- **2시간 돌파 보장 없음**(gemini2api v1.6.41~v1.6.43은 중계도 로테이션하므로 서로 밀어낼 수 있음. v1.6.44 이상에서 해소)
- **브라우저 상시 실행 필요**(능동 동기화도 열린 Gemini 탭의 Cookie 로테이션에 의존)

## 📄 라이선스

[PolyForm Noncommercial License 1.0.0](../../LICENSE) — 비상업용만.

## ⚠ 면책

Google과 무관. 학습·연구 목적. 모든 결과는 사용자 책임.
