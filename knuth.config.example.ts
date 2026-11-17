import { defineConfig } from './scripts/config.ts';

export default defineConfig({
  registry: {
    // Web UI 页面标题
    title: 'Knuth NPM 注册表',
    // 实例描述 (写入生成产物头注释)
    description: '配置驱动、安全加固的私有 NPM 注册表',
    // 对外访问完整 URL (同步驱动 web.publicPath 与 VERDACCIO_PUBLIC_URL)
    publicUrl: 'http://localhost:5673',
    // Web UI Logo 地址; 留空则不输出 logo 字段
    logo: '',
    darkMode: true,
    i18n: 'zh-CN',
    maxBodySize: '100mb',
    keepAliveTimeout: 36000,
    logLevel: 'warn',
  },
  docker: {
    image: 'verdaccio/verdaccio:6.10.1',
    containerName: 'knuth-verdaccio',
    port: 5673,
    networkName: 'knuth-network',
  },
  auth: {
    // 默认写入 ./htpasswd (/verdaccio/conf/htpasswd); 若宿主机 /verdaccio/conf 只读挂载可改为 /verdaccio/storage/htpasswd
    htpasswdFile: './htpasswd',
    // 允许注册的最大用户数; 设为 -1 可禁用新用户注册
    maxUsers: 12,
    jwtExpiresIn: '8h',
    userRateLimit: {
      windowMs: 60000,
      max: 30,
    },
  },
  scopes: {
    // 私有 scope (仅认证用户可读写; 自动切断上游 proxy 防依赖混淆)
    private: ['@knuth/*'],
    // 公开可读内部 scope (匿名可读、认证可发布; 同样切断上游 proxy 并排在 @*/* 之前)
    publicInternal: ['@knuth-public/*'],
  },
  uplinks: [
    {
      name: 'alibaba',
      url: 'https://registry.npmmirror.com',
      timeout: '10s',
      failTimeout: '1m',
    },
    {
      name: 'huawei',
      url: 'https://mirrors.huaweicloud.com/repository/npm/',
      timeout: '10s',
      failTimeout: '1m',
    },
  ],
  publish: {
    allowOffline: true,
  },
  k8s: {
    namespace: 'knuth',
    replicas: 1,
    storageSize: '5Gi',
    storageClassName: '',
    serviceType: 'ClusterIP',
  },
});
