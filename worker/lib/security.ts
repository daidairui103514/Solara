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
