'use client';

let fpPromise = null;

export async function getFingerprint() {
  if (typeof window === 'undefined') return null;

  if (!fpPromise) {
    const FingerprintJS = (await import('@fingerprintjs/fingerprintjs')).default;
    fpPromise = FingerprintJS.load();
  }

  const fp = await fpPromise;
  const result = await fp.get();
  return result.visitorId;
}

export async function getUserIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip;
  } catch {
    return 'unknown';
  }
}
