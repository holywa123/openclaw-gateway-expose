# OpenClaw Gateway Expose Skill

将 OpenClaw Gateway 暴露到外网访问的完整解决方案。

## 功能特性

- ✅ HTTPS 自签名证书反向代理
- ✅ IP 白名单访问控制
- ✅ Tailscale Funnel 支持
- ✅ Cloudflare Tunnel 支持
- ✅ 完整配置文档

## 适用场景

- 从其他设备远程访问 OpenClaw Control UI
- 在服务器上部署 OpenClaw 并外网访问
- 需要 HTTPS 安全上下文以满足浏览器要求

## 安装方法

### 方式一：SkillHub 安装（推荐）

```bash
# 下载 Skill 文件后安装
skillhub install openclaw-gateway-expose.skill
```

### 方式二：手动安装

```bash
# 1. 解压到 skills 目录
# Windows: C:\Users\<用户名>\.qclaw\workspace\skills\
# macOS/Linux: ~/.qclaw/workspace/skills/

# 2. 解压
unzip openclaw-gateway-expose.skill -d openclaw-gateway-expose/
```

## 快速开始

### 1. 修改 Gateway 配置

编辑 `~/.qclaw/openclaw.json`：

```json
{
  "gateway": {
    "bind": "lan",
    "port": 28789,
    "controlUi": {
      "allowedOrigins": [
        "null",
        "file://",
        "https://your-server-ip:8443"
      ],
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  }
}
```

### 2. 生成自签名证书

```powershell
$cert = New-SelfSignedCertificate `
  -DnsName 'openclaw.local', 'your-server-ip' `
  -CertStoreLocation cert:\LocalMachine\My `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -NotAfter (Get-Date).AddYears(1)

$pwd = ConvertTo-SecureString -String 'your-password' -Force -AsPlainText
Export-PfxCertificate `
  -Cert $cert `
  -FilePath 'C:\Users\Administrator\openclaw.pfx' `
  -Password $pwd
```

### 3. 启动 HTTPS 代理

```bash
# 基础版本
node scripts/https-proxy.js

# 带 IP 白名单版本
node scripts/https-proxy-with-ip-whitelist.js
```

### 4. 访问 Dashboard

打开浏览器访问：`https://your-server-ip:8443`

## 替代方案

### Tailscale Funnel（最安全）

```bash
winget install Tailscale.Tailscale
tailscale up
tailscale funnel --bg https+insecure://127.0.0.1:28789
```

### Cloudflare Tunnel

```bash
winget install Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create openclaw
cloudflared tunnel run openclaw
```

## 安全建议

| 方案 | 安全性 | 说明 |
|------|--------|------|
| 仅禁用设备认证 | ⭐⭐ 低 | Token 唯一保护 |
| IP 白名单 + 禁用设备认证 | ⭐⭐⭐⭐ 中高 | 双重保护 |
| Tailscale Funnel | ⭐⭐⭐⭐⭐ 高 | 正规证书 + 设备认证 |
| 正规 SSL + 设备认证 | ⭐⭐⭐⭐⭐ 高 | 最佳实践 |

## 故障排除

### "origin not allowed"

将访问地址添加到 `gateway.controlUi.allowedOrigins`

### "control ui requires device identity"

启用 `dangerouslyDisableDeviceAuth: true` 或使用正规 HTTPS 证书

### "disconnected (4008): connect failed"

设备身份验证失败，启用 `dangerouslyDisableDeviceAuth: true`

## 文件说明

- `SKILL.md` - 完整配置文档
- `scripts/https-proxy.js` - 基础 HTTPS 代理
- `scripts/https-proxy-with-ip-whitelist.js` - 带 IP 白名单的代理

## 许可证

MIT License
