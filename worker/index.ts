import { onRequest as proxyHandler } from "./routes/proxy";
import { onRequest as paletteHandler } from "./routes/palette";
import { onRequestPost as loginHandler } from "./routes/login";
import { onRequest as storageHandler } from "./routes/storage";
import { timingSafeEqual } from "./lib/security";

export interface Env {
  PASSWORD?: string;
  LANGUAGE?: string;
  ASSETS: Fetcher;
  DB?: D1Database;
}

interface HandlerContext {
  request: Request;
  env: Env;
  waitUntil: (promise: Promise<unknown>) => void;
}

const PUBLIC_PATH_PATTERNS = [/^\/login(?:\/|$)/, /^\/api\/login(?:\/|$)/];

const PUBLIC_FILE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".png",
  ".svg",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".txt",
  ".map",
  ".json",
  ".woff",
  ".woff2",
]);

function hasPublicExtension(pathname: string): boolean {
  const lastDotIndex = pathname.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return false;
  }
  const extension = pathname.slice(lastDotIndex).toLowerCase();
  return PUBLIC_FILE_EXTENSIONS.has(extension);
}

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname)) ||
    hasPublicExtension(pathname)
  );
}

function parseCookies(request: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = request.headers.get("Cookie");
  if (!header) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) {
      cookies[key] = value;
    }
  }
  return cookies;
}

async function isAuthenticated(request: Request, password: string): Promise<boolean> {
  const authCookie = parseCookies(request).auth;
  if (!authCookie) {
    return false;
  }
  return timingSafeEqual(authCookie, btoa(password));
}

/**
 * 鉴权守卫：未配置 PASSWORD 时放行（与原 Pages 中间件行为一致）；
 * 已配置时校验 Cookie，未通过则返回 302 跳转登录页。
 * 返回 null 表示已放行。
 */
async function authGuard(request: Request, password?: string): Promise<Response | null> {
  if (typeof password !== "string") {
    return null;
  }
  if (await isAuthenticated(request, password)) {
    return null;
  }
  const url = new URL(request.url);
  return Response.redirect(new URL("/login", url).toString(), 302);
}

async function maybeApplyI18n(response: Response, language?: string): Promise<Response> {
  if (language !== "ENG") {
    return response;
  }
  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("text/html")) {
    return response;
  }
  return new HTMLRewriter()
    .on("head", {
      element(element: Element) {
        element.prepend(`<script>window.SITE_LANGUAGE = "ENG";</script>`, { html: true });
      },
    })
    .transform(response);
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "") || "/";
  }
  return pathname;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  let modified = false;
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
      modified = true;
    }
  }
  if (!modified) {
    return response;
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 从静态资源服务获取内容，显式跟随其规范化重定向（如 /index.html -> /）。
 */
async function fetchAsset(env: Env, targetUrl: URL, maxRedirects = 3): Promise<Response> {
  let current = targetUrl.toString();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await env.ASSETS.fetch(current);
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("Location");
    if (!location) {
      return response;
    }
    const next = new URL(location, current).toString();
    if (next === current) {
      return response;
    }
    current = next;
  }
  return new Response("Too many redirects while resolving asset", { status: 508 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);
    const context = { request, env, waitUntil: ctx.waitUntil.bind(ctx) } as HandlerContext;

    try {
      // 公开接口：登录（无需鉴权）
      if (pathname === "/api/login") {
        return applySecurityHeaders(await loginHandler(context));
      }

      // 登录页：公开访问，直接回源静态资源
      if (pathname === "/login" || pathname.startsWith("/login/")) {
        const assetResponse = await fetchAsset(env, new URL(pathname + url.search, url));
        return applySecurityHeaders(await maybeApplyI18n(assetResponse, env.LANGUAGE));
      }

      // 受保护路由：/proxy、/palette、/api/storage
      if (pathname === "/proxy" || pathname === "/palette" || pathname === "/api/storage") {
        const denied = await authGuard(request, env.PASSWORD);
        if (denied) {
          return denied;
        }

        let response: Response;
        if (pathname === "/proxy") {
          response = await proxyHandler(context);
        } else if (pathname === "/palette") {
          response = await paletteHandler({ request });
        } else {
          response = await storageHandler({ request, env });
        }
        return applySecurityHeaders(response);
      }

      // 其余路径按静态资源处理，沿用原有公开扩展名规则
      if (!isPublicPath(pathname)) {
        const denied = await authGuard(request, env.PASSWORD);
        if (denied) {
          return denied;
        }
      }

      const assetResponse = await fetchAsset(env, new URL(pathname + url.search, url));

      if (assetResponse.status === 404) {
        return new Response("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      return applySecurityHeaders(await maybeApplyI18n(assetResponse, env.LANGUAGE));
    } catch (error) {
      console.error("[Worker] Unhandled error:", error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  },
};
