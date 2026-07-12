import type { Course, StudentProfile } from "./types";

export type ShareBundle = {
  student: StudentProfile;
  courses: Course[];
};

export function encodeShareData(bundle: ShareBundle): string {
  const json = JSON.stringify(bundle);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShareData(encoded: string): ShareBundle | null {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as ShareBundle;
  } catch {
    return null;
  }
}
