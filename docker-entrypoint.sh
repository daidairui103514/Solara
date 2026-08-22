#!/bin/sh

# 如果用户传入了 PASSWORD 环境变量，将其写入到 wrangler 能够读取的 .dev.vars 文件中
if [ ! -z "$PASSWORD" ]; then
    echo "PASSWORD=\"$PASSWORD\"" > /app/.dev.vars
    echo "Password environment variable configured in .dev.vars"
else
    echo "No PASSWORD environment variable provided, skipping .dev.vars creation."
fi

if [ ! -z "$LANGUAGE" ]; then
    echo "LANGUAGE=\"$LANGUAGE\"" >> /app/.dev.vars
fi

# 启动 Cloudflare Workers 本地开发服务器（读取 wrangler.jsonc 配置）
# --ip 0.0.0.0 允许外部访问
# --port 8787 绑定到 8787 端口
# --persist-to=/app/data 将 D1 数据库文件等持久化保存，以便做 volume 映射
echo "Starting Solara via Wrangler (Cloudflare Workers local dev server)..."
exec npx wrangler dev --ip 0.0.0.0 --port 8787 --persist-to=/app/data
