import { useEffect, useState } from "react";
import { fetchAiKey, fetchServerConfig } from "../api/me";

/**
 * 이 서버가 어떤 운영 형태인지(family = 가족 공용 / personal = 개인 서재)와,
 * 로그인한 사람이 Claude 기능(표지 사진 인식·새책 추천)을 쓸 수 있는지.
 *
 * 같은 코드가 가족 공용(family) 서버와 개인 서재(personal) 서버(예: homelibrary.kr) 두 곳에서 돈다.
 * 화면이 주소를 보고 판단하지 않고 **서버에 묻는다** — 주소로 판단하면 LAN·Tailscale 주소에서 틀린다.
 *
 * 여러 화면이 동시에 물어도 요청은 한 번만 나가게 모듈 수준에 담아 둔다
 * (한 화면에 폼이 여러 개면 같은 요청이 열 번 나간다).
 */

// 서버에 닿지 못했을 때의 기본값은 **예전(family) 동작**이다 — 가족 서버가 갑자기 바뀌어 보이면 안 된다.
const FAMILY_DEFAULT = { library_mode: "family", signup_enabled: false, signup_requires_invite: false };

let configCache = null;
let configPromise = null;

export function loadServerConfig() {
  if (configCache) return Promise.resolve(configCache);
  if (!configPromise) {
    configPromise = fetchServerConfig()
      .then((c) => (configCache = c))
      .catch(() => {
        configPromise = null; // 다음에 다시 물어본다
        return FAMILY_DEFAULT;
      });
  }
  return configPromise;
}

/**
 * `loaded`가 false인 동안은 기본값(family)이다. **처음 한 번만 정해지는 값**(폼의 초기값 등)을
 * 여기에 기대는 화면은 loaded가 될 때까지 기다려야 한다 — 안 그러면 personal 서버에서도
 * 첫 렌더에 family 값이 박힌다.
 */
export function useServerConfig() {
  const [config, setConfig] = useState(
    configCache ? { ...configCache, loaded: true } : { ...FAMILY_DEFAULT, loaded: false }
  );
  useEffect(() => {
    let alive = true;
    loadServerConfig().then((c) => alive && setConfig({ ...c, loaded: true }));
    return () => {
      alive = false;
    };
  }, []);
  return config;
}

export function isPersonal(config) {
  return config?.library_mode === "personal";
}

// ── Claude 기능 사용 가능 여부 (로그인한 사람마다 다르다) ──────────────────
let aiCache = null;
let aiPromise = null;
const aiListeners = new Set();

function publish(value) {
  aiCache = value;
  aiListeners.forEach((fn) => fn(value));
}

export function refreshAiStatus() {
  aiPromise = fetchAiKey()
    .then((s) => {
      publish(s);
      return s;
    })
    .catch(() => {
      aiPromise = null;
      return aiCache;
    });
  return aiPromise;
}

/** 키를 저장/삭제한 화면이 결과를 바로 알린다(다시 묻지 않고). */
export function setAiStatus(value) {
  publish(value);
}

/** 로그아웃·다른 계정 로그인 때 비운다 — 앞사람의 상태가 남으면 안 된다. */
export function resetAiStatus() {
  aiCache = null;
  aiPromise = null;
}

/** null = 아직 모름. 모를 때는 기능을 **보여 준다**(family에서 깜빡임 없이 예전처럼). */
export function useAiStatus() {
  const [status, setStatus] = useState(aiCache);
  useEffect(() => {
    aiListeners.add(setStatus);
    if (!aiCache && !aiPromise) refreshAiStatus();
    else if (aiPromise) aiPromise.then((s) => s && setStatus(s));
    return () => aiListeners.delete(setStatus);
  }, []);
  return status;
}

export function aiAvailable(status) {
  return status === null || status === undefined ? true : !!status.available;
}
