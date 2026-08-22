import { timingSafeEqual, passwordToken } from "../lib/security";

const MAX_AGE_SECONDS = 48 * 60 * 60;

// 简单登录限流：基于 Cache API 的固定窗口计数，按 IP 限制尝试次数
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 300;

async function isRateLimited(request: Request, cache: Cache): Promise<boolean> {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
    "unknown";
  const windowKey = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const cacheKey = new Request(`https://ratelimit.local/login/${ip}/${windowKey}`, {
    method: "GET",
  });

  let attempts = 0;
  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      attempts = parseInt((await cached.text()) || "0", 10) || 0;
    }
  } catch {
    return false;
  }

  if (attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    return true;
  }

  const counterResponse = new Response(String(attempts + 1), {
    headers: { "Cache-Control": `public, max-age=${RATE_LIMIT_WINDOW_SECONDS}` },
  });
  try {
    await cache.put(cacheKey, counterResponse);
  } catch {
    // 写入失败时放行，宁可宽松也不阻断正常用户
  }
  return false;
}

export async function onRequestPost(context: any) {
  const { request, env } = context;
  const passwordEnv = env.PASSWORD;
  const url = new URL(request.url);

  const body = await request.json().catch(() => ({ password: "" }));
  const providedPassword = typeof body.password === "string" ? body.password : "";

  if (typeof passwordEnv !== "string") {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 仅对失败尝试计数限流，成功登录不受影响
  const validPassword =
    providedPassword && (await timingSafeEqual(providedPassword, passwordEnv));

  if (!validPassword && url.protocol !== "http:") {
    if (await isRateLimited(request, caches.default)) {
      return new Response(JSON.stringify({ error: "Too many attempts, please retry later" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS) },
      });
    }
  }

  if (validPassword) {
    const cookieSegments = [
      `auth=${await passwordToken(passwordEnv)}`,
      `Max-Age=${MAX_AGE_SECONDS}`,
      "Path=/",
      "SameSite=Lax",
      "HttpOnly",
    ];
    if (url.protocol === "https:") {
      cookieSegments.push("Secure");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": cookieSegments.join("; "),
      },
    });
  }

  return new Response(JSON.stringify({ success: false }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
