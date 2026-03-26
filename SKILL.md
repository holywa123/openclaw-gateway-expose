---
name: openclaw-gateway-expose
description: 将 OpenClaw Gateway 暴露到外网访问的完整解决方案。支持 HTTPS 自签名证书反向代理、Tailscale Funnel、防火墙配置等。当用户需要将 OpenClaw Control UI 从本地访问扩展到外网访问时使用此 Skill。触发关键词：gateway 外网访问、control ui 远程访问、openclaw 公网访问、https 代理、自签名证书。
---

# OpenClaw Gateway 外网访问配置

本 Skill 提供将 OpenClaw Gateway 从本地访问（127.0.0.1）扩展到外网访问的完整解决方案。

## 使用场景

- 从其他设备远程访问 OpenClaw Control UI
- 在服务器上部署 OpenClaw 并外网访问
- 需要 HTTPS 安全上下文以满足浏览器要求

## 前提条件

1. OpenClaw 已安装并运行
2. 服务器防火墙/安全组允许相应端口
3. 具有管理员权限

## 配置步骤

### 步骤 1：修改 Gateway 绑定模式

编辑 `~/.qclaw/openclaw.json`，将 `gateway.bind` 从 `loopback` 改为 `lan`：

```json
{
  "gateway": {
    "bind": "lan",
    "port": 28789,
    "controlUi": {
      "allowedOrigins": [
        "null",
        "file://",
        "https://your-domain:8443"
      ],
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  }
}
```

**关键配置说明：**
- `bind: lan` - 监听所有网络接口（不仅是 127.0.0.1）
- `allowedOrigins` - 允许访问 Control UI 的来源地址
- `allowInsecureAuth: true` - 允许非安全上下文认证
- `dangerouslyDisableDeviceAuth: true` - 禁用设备身份验证（解决自签名证书问题）

### 步骤 2：生成自签名 SSL 证书

使用 PowerShell 生成证书：

```powershell
$cert = New-SelfSignedCertificate `
  -DnsName 'openclaw.local', 'your-server-ip' `
  -CertStoreLocation cert:\LocalMachine\My `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -NotAfter (Get-Date).AddYears(1)

# 导出证书
$pwd = ConvertTo-SecureString -String 'your-password' -Force -AsPlainText
Export-PfxCertificate `
  -Cert $cert `
  -FilePath 'C:\Users\Administrator\openclaw.pfx' `
  -Password $pwd
```

### 步骤 3：创建 HTTPS 反向代理

使用 Node.js 创建代理服务器（见 scripts/https-proxy.js）：

```javascript
const https = require('https');
const http = require('http');
const fs = require('fs');

const options = {
  pfx: fs.readFileSync('C:\\Users\\Administrator\\openclaw.pfx'),
  passphrase: 'your-password'
};

const PROXY_PORT = 8443;
const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 28789;

const server = https.createServer(options);

// HTTP 请求处理
server.on('request', (req, res) => {
  const proxyOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` }
  };

  const proxy = http.request(proxyOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxy);
});

// WebSocket 升级处理
server.on('upgrade', (req, socket, head) => {
  const proxyOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` }
  };

  const proxyReq = http.request(proxyOptions);
  
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    let responseHeaders = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      responseHeaders += `${key}: ${value}\r\n`;
    }
    responseHeaders += '\r\n';
    
    socket.write(responseHeaders);
    
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);
    
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    
    proxySocket.on('error', (err) => { socket.destroy(); });
    socket.on('error', (err) => { proxySocket.destroy(); });
  });

  proxyReq.on('error', (err) => { socket.destroy(); });
  proxyReq.end();
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`HTTPS Proxy running on https://0.0.0.0:${PROXY_PORT}`);
});
```

### 步骤 4：配置防火墙

Windows 防火墙放行端口：

```powershell
# 放行 Gateway 端口
New-NetFirewallRule `
  -DisplayName 'OpenClaw Gateway' `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 28789 `
  -Action Allow

# 放行 HTTPS 代理端口
New-NetFirewallRule `
  -DisplayName 'OpenClaw HTTPS' `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8443 `
  -Action Allow
```

### 步骤 5：云服务器安全组配置

如果使用云服务器（如腾讯云、阿里云），需要在控制台配置安全组：

| 方向 | 协议 | 端口 | 来源 |
|------|------|------|------|
| 入站 | TCP | 28789 | 0.0.0.0/0 或指定 IP |
| 入站 | TCP | 8443 | 0.0.0.0/0 或指定 IP |

### 步骤 6：启动服务

1. **重启 QClaw** - 使配置更改生效
2. **启动 HTTPS 代理** - `node https-proxy.js`
3. **访问 Dashboard** - `https://your-server-ip:8443`

## 替代方案

### 方案 A：Tailscale Funnel（推荐，最安全）

使用 Tailscale 的 Funnel 功能自动提供 HTTPS：

```bash
# 安装 Tailscale
winget install Tailscale.Tailscale

# 启动并登录
tailscale up

# 启用 Funnel
tailscale funnel --bg https+insecure://127.0.0.1:28789
```

访问地址：`https://your-machine.tailxxxxx.ts.net`

### 方案 B：Cloudflare Tunnel

使用 Cloudflare Tunnel 无需开放端口：

```bash
# 安装 cloudflared
winget install Cloudflare.cloudflared

# 登录并创建隧道
cloudflared tunnel login
cloudflared tunnel create openclaw

# 配置并运行
cloudflared tunnel route dns openclaw openclaw.yourdomain.com
cloudflared tunnel run openclaw
```

## 故障排除

### 问题："origin not allowed"

**原因：** `allowedOrigins` 未包含访问地址

**解决：** 将访问地址添加到 `gateway.controlUi.allowedOrigins` 数组中

### 问题："control ui requires device identity"

**原因：** 浏览器要求 HTTPS 安全上下文

**解决：** 
- 使用 HTTPS 代理（本方案）
- 或启用 `dangerouslyDisableDeviceAuth: true`

### 问题："disconnected (4008): connect failed"

**原因：** 设备身份验证失败

**解决：** 在配置中添加 `dangerouslyDisableDeviceAuth: true`

### 问题："disconnected (1006): no reason"

**原因：** WebSocket 代理配置不正确

**解决：** 确保代理脚本正确处理 `upgrade` 事件和协议头转发

## 增强安全：IP 白名单

在代理层添加 IP 白名单，只允许特定设备访问：

```javascript
// 在 https-proxy.js 中添加 IP 白名单
const ALLOWED_IPS = ['192.168.1.100', '58.19.0.149']; // 允许的 IP 列表

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress.replace(/^::ffff:/, '');
}

function isIPAllowed(ip) {
  if (!ALLOWED_IPS || ALLOWED_IPS.length === 0) return true;
  return ALLOWED_IPS.includes(ip);
}

// 在请求处理中添加检查
if (!isIPAllowed(clientIP)) {
  res.writeHead(403);
  res.end('Forbidden: IP not allowed');
  return;
}
```

完整代码见 `scripts/https-proxy-with-ip-whitelist.js`

## 安全注意事项

⚠️ **本配置降低了安全性以换取便利性，请注意：**

1. **自签名证书** - 浏览器会显示警告，需要手动信任
2. **禁用设备认证** - 仅依赖 Token 认证，确保 Token 强度足够
3. **IP 白名单** - 强烈推荐配置，只允许特定 IP 访问
4. **公网暴露** - 建议限制访问 IP 或使用 VPN
5. **生产环境** - 建议使用正规 SSL 证书（Let's Encrypt）

**安全层级对比：**

| 方案 | 安全性 | 说明 |
|------|--------|------|
| 仅禁用设备认证 | ⭐⭐ 低 | Token 唯一保护 |
| IP 白名单 + 禁用设备认证 | ⭐⭐⭐⭐ 中高 | 双重保护 |
| Tailscale Funnel | ⭐⭐⭐⭐⭐ 高 | 正规证书 + 设备认证 |
| 正规 SSL + 设备认证 | ⭐⭐⭐⭐⭐ 高 | 最佳实践 |

## 相关文件

- `scripts/https-proxy.js` - HTTPS 反向代理脚本
