/**
 * 常数时间字符串比较：先对两侧做 SHA-256 摘要再逐字节异或，
 * 避免直接 === 比较带来的时序侧信道，且不受长度差异影响。
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let index = 0; index < bytesA.length; index += 1) {
    diff |= bytesA[index] ^ bytesB[index];
  }
  return diff === 0;
}

/**
 * 生成用于 Cookie 的口令令牌：SHA-256(口令) 的 base64。
 * Cookie 中只存摘要而非 base64(口令)，泄露后无法反推出原口令。
 * 注意：修改此算法会使已登录用户失效一次，需重新登录。
 */
export async function passwordToken(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(password)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
