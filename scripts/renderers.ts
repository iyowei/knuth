import type { KnuthConfig } from './config.ts';

const GENERATED_BANNER = [
  '# 由 Knuth (scripts/init.ts) 根据配置源自动生成, 请勿直接手改.',
  '# 如需调整, 请修改描述配置文件后重新执行: npm run init',
];

/**
 * 将字符串安全序列化为 YAML 双引号标量, 免疫冒号、井号与引号导致的语法破坏.
 */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderGeneratedHeader(config: KnuthConfig): string[] {
  const desc = config.registry.description
    ? `${config.registry.title} — ${config.registry.description}`
    : config.registry.title;
  return [`# ${desc}`, ...GENERATED_BANNER];
}

function renderScopeBlock(
  scope: string,
  access: '$authenticated' | '$all',
  comment: string,
): string[] {
  return [
    `  ${yamlString(scope)}:`,
    `    # ${comment}`,
    `    access: ${access}`,
    '    publish: $authenticated',
    '    unpublish: $authenticated',
    '    # 刻意不设 proxy: 切断上游代理路径, 防依赖混淆 (dependency confusion) 攻击.',
    '    # 参见 https://verdaccio.org/docs/best#remove-proxy-to-increase-security-at-private-packages',
  ];
}

function renderUplinksSection(config: KnuthConfig): string[] {
  const lines: string[] = [
    '# https://verdaccio.org/docs/configuration#uplinks',
    '#',
    '# 上游源收敛建议:',
    '#   1. 发布前查重强依赖上游: 若未开启 publish.allow_offline, 任一代理上游超时或异常都可能',
    '#      造成 503 拒绝发布; 冗余源越多故障面越大, 建议控制在 1~2 个稳定镜像源.',
    '#   2. 实测参考 (curl -sSL -o /dev/null -w "%{http_code} %{time_total}s" --max-time 10 "https://<源>/react"):',
    '#        npmmirror  https://registry.npmmirror.com                 HTTP 200 / 1.11s',
    '#        huawei     https://mirrors.huaweicloud.com/repository/npm/ HTTP 200 / 2.20s',
    '#        tencent    https://mirrors.cloud.tencent.com/npm/         HTTP 200 / 2.34s',
    'uplinks:',
  ];

  for (const uplink of config.uplinks) {
    lines.push(
      `  ${uplink.name}:`,
      `    url: ${yamlString(uplink.url)}`,
      `    timeout: ${yamlString(uplink.timeout)}`,
      `    fail_timeout: ${yamlString(uplink.failTimeout)}`,
    );
  }
  return lines;
}

function renderPackagesSection(config: KnuthConfig): string[] {
  const uplinkNames = config.uplinks.map((item) => item.name).join(' ');
  const lines: string[] = [
    '# https://verdaccio.org/docs/protect-your-dependencies/',
    '# https://verdaccio.org/docs/configuration#packages',
    '# 匹配规则自上而下生效, 私有与公开内部 scope 必须排在 "@*/*" 之前.',
    'packages:',
  ];

  for (const scope of config.scopes.private) {
    lines.push(
      ...renderScopeBlock(scope, '$authenticated', '私有 scope: 仅认证用户可读写'),
      '',
    );
  }

  for (const scope of config.scopes.publicInternal) {
    lines.push(
      ...renderScopeBlock(
        scope,
        '$all',
        '公开可读的内部包: 匿名可拉取, 发布与撤包仍需认证',
      ),
      '',
    );
  }

  lines.push(
    '  "@*/*":',
    '    access: $all',
    '    publish: $authenticated',
    '    unpublish: $authenticated',
    `    proxy: ${uplinkNames}`,
    '',
    '  "**":',
    '    access: $all',
    '    publish: $authenticated',
    '    unpublish: $authenticated',
    `    proxy: ${uplinkNames}`,
  );
  return lines;
}

/**
 * 渲染 Verdaccio 主配置文件 (conf/config.yaml).
 */
export function renderVerdaccioConfig(config: KnuthConfig): string {
  const { registry, auth, publish } = config;
  const webLines = [
    'web:',
    `  title: ${yamlString(registry.title)}`,
  ];
  if (registry.logo) {
    webLines.push(`  logo: ${yamlString(registry.logo)}`);
  }
  webLines.push(
    '  gravatar: false',
    '  sort_packages: asc',
    `  darkMode: ${registry.darkMode}`,
    '  html_cache: false',
    '  login: true',
    '  showInfo: false',
    '  showSettings: false',
    '  showThemeSwitch: false',
    '  showFooter: false',
    '  showSearch: true',
    '  showRaw: true',
    '  showDownloadTarball: true',
    `  publicPath: ${yamlString(registry.publicUrl)}`,
  );

  const sections = [
    ...renderGeneratedHeader(config),
    '',
    'storage: /verdaccio/storage/data',
    'plugins: /verdaccio/plugins',
    '',
    ...webLines,
    '',
    'auth:',
    '  htpasswd:',
    '    file: ./htpasswd',
    '    # 允许注册的最大用户数, 设为 -1 可禁用注册',
    `    max_users: ${auth.maxUsers}`,
    '',
    ...renderUplinksSection(config),
    '',
    ...renderPackagesSection(config),
    '',
    '# https://verdaccio.org/docs/configuration#server',
    'server:',
    `  keepAliveTimeout: ${registry.keepAliveTimeout}`,
    '',
    '# https://verdaccio.org/docs/configuration#offline-publish',
    '# 上游掉线时允许继续发布 (跳过公共包查重; 对私有无 proxy scope 零影响)',
    'publish:',
    `  allow_offline: ${publish.allowOffline}`,
    '',
    'security:',
    '  web:',
    '    sign:',
    `      expiresIn: ${yamlString(auth.jwtExpiresIn)}`,
    '',
    '# https://verdaccio.org/docs/configuration#user-rate-limit',
    '# 用户端点限流 (npm login/adduser、npm token、网站登录等), 防密码爆破',
    'userRateLimit:',
    `  windowMs: ${auth.userRateLimit.windowMs}`,
    `  max: ${auth.userRateLimit.max}`,
    '',
    `max_body_size: ${yamlString(registry.maxBodySize)}`,
    '',
    'middlewares:',
    '  audit:',
    '    enabled: true',
    '',
    `log: { type: stdout, format: pretty, level: ${registry.logLevel} }`,
    '',
    'i18n:',
    `  web: ${yamlString(registry.i18n)}`,
  ];

  return `${sections.join('\n')}\n`;
}

/**
 * 渲染 Docker Compose 编排文件; 生产模式注入 VERDACCIO_PUBLIC_URL, 调试模式不注入.
 */
export function renderDockerCompose(config: KnuthConfig, debug = false): string {
  const { docker, registry } = config;
  const envLines = [
    `      VERDACCIO_PORT: ${docker.port}`,
  ];
  if (!debug) {
    envLines.push(`      VERDACCIO_PUBLIC_URL: ${yamlString(registry.publicUrl)}`);
  }

  const lines = [
    ...renderGeneratedHeader(config),
    '',
    'services:',
    '  verdaccio:',
    `    image: ${yamlString(docker.image)}`,
    `    container_name: ${yamlString(docker.containerName)}`,
    '    networks:',
    `      - ${docker.networkName}`,
    '    environment:',
    ...envLines,
    '    ports:',
    `      - ${yamlString(`${docker.port}:${docker.port}`)}`,
    '    volumes:',
    "      - './conf:/verdaccio/conf'",
    "      - './storage:/verdaccio/storage'",
    "      - './plugins:/verdaccio/plugins'",
    'networks:',
    `  ${docker.networkName}:`,
    '    driver: bridge',
  ];

  return `${lines.join('\n')}\n`;
}

/**
 * 渲染等效的原生 docker run 启动命令, 便于命令行直接部署.
 */
export function renderDockerRunCommand(config: KnuthConfig): string {
  const { docker, registry } = config;
  return [
    'docker run -d --restart=always \\',
    `  --name ${docker.containerName} \\`,
    `  -p ${docker.port}:${docker.port} \\`,
    `  -e VERDACCIO_PORT=${docker.port} \\`,
    `  -e VERDACCIO_PUBLIC_URL=${registry.publicUrl} \\`,
    '  -v "$PWD/conf:/verdaccio/conf" \\',
    '  -v "$PWD/storage:/verdaccio/storage" \\',
    '  -v "$PWD/plugins:/verdaccio/plugins" \\',
    `  ${docker.image}`,
  ].join('\n');
}
