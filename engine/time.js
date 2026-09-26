// engine/time.js — البروتوكول الزمني الثلاثي (حزمة B1)
// الترتيب الحاكم: ساعة البيئة (env) ← هيدر Date من sawtalhijaz.com (header، مرجع حاكم عند اختلاف >60ث)
// ← إدخال يدوي «الوقت الفعلي: …» (manual، عند انقطاع الشبكة) ← زمن غير موثق (unverified، مع تنويه صريح).
// كل تقرير/سجل تشغيل يبدأ بسطر زمن موثق بمصدره: timeLine(doc).
import { createStore } from "./state.js";

export const TIME_REFERENCE_URL = "https://sawtalhijaz.com/";
export const SKEW_THRESHOLD_SECONDS = 60; // حدّ الحوكمة: تجاوزه يجعل الهيدر هو المرجع
export const MANUAL_TTL_HOURS = 6; // بعدها يبقى اليدوي صالحاً لكن يُوسم «مسنّ»
export const HEADER_TIMEOUT_MS = 6000;
export const MANUAL_REL = "state/time-manual.json";
export const TIME_SOURCES = ["env", "header", "manual", "unverified"];

const OFFLINE_ENV = "SAWTALHIJAZ_OFFLINE";

// —— جلب هيدر Date من المرجع الحاكم (HEAD ثم GET كاحتياط) ——
export async function fetchHeaderTime({ url = TIME_REFERENCE_URL, timeoutMs = HEADER_TIMEOUT_MS, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const tried = [];
  const t0 = performance.now();
  let error = null;

  if (typeof doFetch !== "function") {
    return { iso: null, raw: null, method: null, status: null, tried, ms: 0, error: "fetch غير متاح في هذه البيئة" };
  }

  for (const method of ["HEAD", "GET"]) {
    tried.push(method);
    try {
      const res = await doFetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "sawtalhijaz-newsroom/1.0 (time-attestation; +https://sawtalhijaz.com/)" },
      });
      const raw = res?.headers?.get?.("date") ?? null;
      if (raw) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
          return {
            iso: d.toISOString(),
            raw,
            method,
            status: res.status ?? null,
            tried,
            ms: +((performance.now() - t0)).toFixed(1),
            error: null,
          };
        }
        error = `هيدر Date غير قابل للتحليل: ${raw}`;
      } else {
        error = `HTTP ${res?.status ?? "?"} بلا هيدر Date`;
      }
    } catch (e) {
      error = `${e?.name ?? "Error"}: ${e?.message ?? e}${e?.cause?.code ? ` (${e.cause.code})` : ""}`;
    }
  }
  return { iso: null, raw: null, method: null, status: null, tried, ms: +((performance.now() - t0)).toFixed(1), error };
}

// —— الزمن اليدوي المعتمد من المالك (state/time-manual.json) ——
export function readManualTime(root = process.cwd()) {
  const st = createStore(root);
  const doc = st.readJsonSafe(MANUAL_REL, null);
  if (!doc || !doc.iso) return null;
  return doc;
}

export function setManualTime(iso, { root = process.cwd(), by = "المالك", note = "" } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`زمن غير صالح: ${iso}`);
  const st = createStore(root);
  const doc = {
    _meta: {
      format: "json",
      notes: "الزمن اليدوي المعتمد من المالك — يُستخدم عند انقطاع الشبكة وفشل هيدر sawtalhijaz.com. الأمر: node engine/cli.js settime \"<ISO>\"",
    },
    iso: d.toISOString(),
    setAtIso: new Date().toISOString(),
    by,
    note,
  };
  const io = st.writeJsonAtomic(MANUAL_REL, doc);
  return { doc, io };
}

export function clearManualTime(root = process.cwd()) {
  const st = createStore(root);
  const doc = {
    _meta: {
      format: "json",
      notes: "الزمن اليدوي المعتمد من المالك — يُستخدم عند انقطاع الشبكة وفشل هيدر sawtalhijaz.com. الأمر: node engine/cli.js settime \"<ISO>\"",
    },
    iso: null,
    setAtIso: null,
    by: null,
    note: "",
  };
  const io = st.writeJsonAtomic(MANUAL_REL, doc);
  return { doc, io };
}

// —— الوثيقة الزمنية الموثقة ——
// nowDoc({ net }) => { iso, source, skewSeconds, envIso, headerIso, headerError, manualIso, note, net }
// net=false: بلا شبكة (سطور الاستئناف/الحالة لا تنتظر الشبكة). net=true: البروتوكول الكامل.
export async function nowDoc({ net = process.env[OFFLINE_ENV] !== "1", root = process.cwd(), fetchImpl, url } = {}) {
  const envIso = new Date().toISOString();
  const manual = readManualTime(root);

  let header = { iso: null, error: net ? null : `الشبكة معطّلة بطلب صريح (${OFFLINE_ENV}=1 أو --offline)`, tried: [], ms: 0, method: null, raw: null, status: null };
  if (net) header = await fetchHeaderTime({ url, fetchImpl });

  const headerSkew = header.iso ? Math.round((new Date(header.iso).getTime() - new Date(envIso).getTime()) / 1000) : null;

  // 1) الهيدر متاح
  if (header.iso) {
    if (Math.abs(headerSkew) <= SKEW_THRESHOLD_SECONDS) {
      return {
        iso: envIso,
        source: "env",
        skewSeconds: headerSkew,
        envIso,
        headerIso: header.iso,
        headerError: null,
        manualIso: manual?.iso ?? null,
        note: `ساعة البيئة متوافقة مع هيدر المرجع (فارق ${headerSkew}ث ≤ ${SKEW_THRESHOLD_SECONDS}ث).`,
        net,
        headerAttempts: header.tried,
      };
    }
    return {
      iso: header.iso,
      source: "header",
      skewSeconds: headerSkew,
      envIso,
      headerIso: header.iso,
      headerError: null,
      manualIso: manual?.iso ?? null,
      note: `هيدر sawtalhijaz.com هو المرجع الحاكم — فارق ${headerSkew}ث عن ساعة البيئة (>${SKEW_THRESHOLD_SECONDS}ث).`,
      net,
      headerAttempts: header.tried,
    };
  }

  // 2) الهيدر غير متاح (انقطاع شبكة) — اليدوي المعتمد
  if (manual?.iso) {
    const skew = Math.round((new Date(manual.iso).getTime() - new Date(envIso).getTime()) / 1000);
    const ageHours = (new Date(envIso).getTime() - new Date(manual.setAtIso ?? envIso).getTime()) / 3600000;
    const stale = ageHours > MANUAL_TTL_HOURS ? ` ⚠ إدخال مسنّ (${ageHours.toFixed(1)} س)` : "";
    return {
      iso: manual.iso,
      source: "manual",
      skewSeconds: skew,
      envIso,
      headerIso: null,
      headerError: header.error,
      manualIso: manual.iso,
      note: `زمن يدوي معتمد من المالك — المرجع الحاكم عند انقطاع الشبكة.${stale}`,
      net,
      headerAttempts: header.tried,
    };
  }

  // 3) لا هيدر ولا يدوي — غير موثق مع تنويه صريح
  return {
    iso: envIso,
    source: "unverified",
    skewSeconds: 0,
    envIso,
    headerIso: null,
    headerError: header.error,
    manualIso: null,
    note: `زمن غير موثق — فشل جلب هيدر Date من sawtalhijaz.com${header.error ? ` (${header.error})` : ""}. يلزم حقلة يدوية عبر settime.`,
    net,
    headerAttempts: header.tried,
  };
}

// سطر الزمن الموحّد لكل تقرير/سجل
export function timeLine(doc) {
  return `الزمن: ${doc.iso} | مصدر=${doc.source} | skew=${doc.skewSeconds}ث | ${doc.note}`;
}
