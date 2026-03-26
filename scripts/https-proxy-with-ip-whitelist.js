const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 配置
const CERT_PATH = process.env.OPENCLAW_CERT_PATH || 'C:\\Users\\Administrator\\openclaw.pfx';
const CERT_PASSPHRASE = process.env.OPENCLAW_CERT_PASS || 'openclaw123';
const PROXY_PORT = parseInt(process.env.OPENCLAW_PROXY_PORT) || 8443;
const TARGET_HOST = process.env.OPENCLAW_TARGET_HOST || '127.0.0.1';
const TARGET_PORT = parseInt(process.env.OPENCLAW_TARGET_PORT) || 28789;

// IP 白名单配置（可选）
// IP 白名单配置
// 方式1：通过环境变量设置 ALLOWED_IPS，如："192.168.1.100,10.0.0.50"
// 方式2：直接修改下面的数组
const ALLOWED_IPS = ['58.19.0.149']; // 只允许特定 IP 访问

// 检查证书文件
if (!fs.existsSync(CERT_PATH)) {
  console.error(`Error: Certificate file not found at ${CERT_PATH}`);
  console.error('Please generate a self-signed certificate first:');
  console.error('  $cert = New-SelfSignedCertificate -DnsName "openclaw.local" -CertStoreLocation cert:\\LocalMachine\\My');
  console.error('  Export-PfxCertificate -Cert $cert -FilePath "C:\\Users\\Administrator\\openclaw.pfx" -Password (ConvertTo-SecureString -String "openclaw123" -Force -AsPlainText)');
  process.exit(1);
}

const options = {
  pfx: fs.readFileSync(CERT_PATH),
  passphrase: CERT_PASSPHRASE
};

const server = https.createServer(options);

// 获取客户端真实 IP
function getClientIP(req) {
  // 优先从 X-Forwarded-For 获取（如果有反向代理）
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  // 否则使用直接连接的 IP
  return req.socket.remoteAddress.replace(/^::ffff:/, '');
}

// 检查 IP 是否在白名单中
function isIPAllowed(ip) {
  if (!ALLOWED_IPS || ALLOWED_IPS.length === 0) {
    return true; // 没有设置白名单，允许所有
  }
  return ALLOWED_IPS.includes(ip);
}

// 处理常规 HTTP 请求
server.on('request', (req, res) => {
  const clientIP = getClientIP(req);
  console.log(`[HTTP] ${req.method} ${req.url} from ${clientIP}`);
  
  // IP 白名单检查
  if (!isIPAllowed(clientIP)) {
    console.warn(`[HTTP] Blocked request from unauthorized IP: ${clientIP}`);
    res.writeHead(403);
    res.end('Forbidden: Your IP is not in the allowed list');
    return;
  }
  
  const proxyOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${TARGET_HOST}:${TARGET_PORT}`
    }
  };

  const proxy = http.request(proxyOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', (err) => {
    console.error('[HTTP] Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxy);
});

// 处理 WebSocket 升级
server.on('upgrade', (req, socket, head) => {
  const clientIP = getClientIP(req);
  console.log(`[WS] Upgrade request: ${req.url} from ${clientIP}`);
  
  // IP 白名单检查
  if (!isIPAllowed(clientIP)) {
    console.warn(`[WS] Blocked WebSocket from unauthorized IP: ${clientIP}`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  
  const proxyOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${TARGET_HOST}:${TARGET_PORT}`
    }
  };

  const proxyReq = http.request(proxyOptions);
  
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    console.log('[WS] Got upgrade response from target');
    
    // 构建 101 响应
    let responseHeaders = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      responseHeaders += `${key}: ${value}\r\n`;
    }
    responseHeaders += '\r\n';
    
    socket.write(responseHeaders);
    
    if (proxyHead && proxyHead.length) {
      socket.write(proxyHead);
    }
    if (head && head.length) {
      proxySocket.write(head);
    }
    
    // 双向管道
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    
    proxySocket.on('error', (err) => {
      console.error('[WS] Proxy socket error:', err.message);
      socket.destroy();
    });
    
    socket.on('error', (err) => {
      console.error('[WS] Client socket error:', err.message);
      proxySocket.destroy();
    });
    
    proxySocket.on('close', () => {
      console.log('[WS] Proxy socket closed');
    });
    
    socket.on('close', () => {
      console.log('[WS] Client socket closed');
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[WS] Proxy request error:', err.message);
    socket.destroy();
  });

  proxyReq.end();
});

server.on('error', (err) => {
  console.error('[Server] Error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PROXY_PORT} is already in use. Please stop the existing process or choose a different port.`);
  }
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('OpenClaw Gateway HTTPS Proxy');
  console.log('='.repeat(60));
  console.log(`Listening:    https://0.0.0.0:${PROXY_PORT}`);
  console.log(`Proxying to:  http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`Certificate:  ${CERT_PATH}`);
  if (ALLOWED_IPS && ALLOWED_IPS.length > 0) {
    console.log(`IP Whitelist: ${ALLOWED_IPS.join(', ')}`);
  } else {
    console.log(`IP Whitelist: Disabled (allowing all IPs)`);
  }
  console.log('='.repeat(60));
  console.log('');
  console.log('Usage with IP whitelist:');
  console.log('  set ALLOWED_IPS=192.168.1.100,10.0.0.50');
  console.log('  node https-proxy-with-ip-whitelist.js');
  console.log('');
  console.log('Press Ctrl+C to stop');
});
