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
export function renderVerdaccioConfig(
  config: KnuthConfig,
  overrides?: { htpasswdFile?: string },
): string {
  const { registry, auth, publish } = config;
  const htpasswdFile = overrides?.htpasswdFile ?? auth.htpasswdFile;

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
    `    file: ${yamlString(htpasswdFile)}`,
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
 * 渲染 Kubernetes 部署清单 (k8s/verdaccio.yaml).
 * ConfigMap 挂载只读配置; htpasswd 自动落在可写 PVC (/verdaccio/storage/htpasswd) 避免只读文件系统报错.
 */
export function renderK8sManifest(config: KnuthConfig): string {
  const { docker, registry, k8s, auth } = config;
  const k8sHtpasswdFile = auth.htpasswdFile.startsWith('/verdaccio/storage/')
    ? auth.htpasswdFile
    : '/verdaccio/storage/htpasswd';

  const embeddedConfig = renderVerdaccioConfig(config, { htpasswdFile: k8sHtpasswdFile })
    .trimEnd()
    .split('\n')
    .map((line) => (line === '' ? '' : `    ${line}`))
    .join('\n');

  const pvcLines = [
    'apiVersion: v1',
    'kind: PersistentVolumeClaim',
    'metadata:',
    '  name: knuth-storage-pvc',
    `  namespace: ${yamlString(k8s.namespace)}`,
    'spec:',
    '  accessModes:',
    '    - ReadWriteOnce',
  ];
  if (k8s.storageClassName) {
    pvcLines.push(`  storageClassName: ${yamlString(k8s.storageClassName)}`);
  }
  pvcLines.push(
    '  resources:',
    '    requests:',
    `      storage: ${yamlString(k8s.storageSize)}`,
  );

  const lines = [
    ...renderGeneratedHeader(config),
    '',
    'apiVersion: v1',
    'kind: Namespace',
    'metadata:',
    `  name: ${yamlString(k8s.namespace)}`,
    '---',
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    '  name: knuth-config',
    `  namespace: ${yamlString(k8s.namespace)}`,
    'data:',
    '  config.yaml: |',
    embeddedConfig,
    '---',
    ...pvcLines,
    '---',
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: knuth-verdaccio',
    `  namespace: ${yamlString(k8s.namespace)}`,
    '  labels:',
    '    app.kubernetes.io/name: knuth',
    'spec:',
    `  replicas: ${k8s.replicas}`,
    '  # ReadWriteOnce PVC 在滚动更新双 Pod 并存时会卡在卷挂载冲突, 默认采用 Recreate',
    '  strategy:',
    '    type: Recreate',
    '  selector:',
    '    matchLabels:',
    '      app.kubernetes.io/name: knuth',
    '  template:',
    '    metadata:',
    '      labels:',
    '        app.kubernetes.io/name: knuth',
    '    spec:',
    '      securityContext:',
    '        runAsNonRoot: true',
    '        runAsUser: 10001',
    '        runAsGroup: 65533',
    '        fsGroup: 10001',
    '      containers:',
    '        - name: verdaccio',
    `          image: ${yamlString(docker.image)}`,
    '          imagePullPolicy: IfNotPresent',
    '          ports:',
    '            - name: http',
    `              containerPort: ${docker.port}`,
    '              protocol: TCP',
    '          env:',
    '            - name: VERDACCIO_PORT',
    `              value: ${yamlString(String(docker.port))}`,
    '            - name: VERDACCIO_PUBLIC_URL',
    `              value: ${yamlString(registry.publicUrl)}`,
    '          readinessProbe:',
    '            httpGet:',
    '              path: /-/ping',
    '              port: http',
    '            initialDelaySeconds: 5',
    '            periodSeconds: 10',
    '          livenessProbe:',
    '            httpGet:',
    '              path: /-/ping',
    '              port: http',
    '            initialDelaySeconds: 15',
    '            periodSeconds: 30',
    '          volumeMounts:',
    '            - name: config',
    '              mountPath: /verdaccio/conf/config.yaml',
    '              subPath: config.yaml',
    '              readOnly: true',
    '            - name: storage',
    '              mountPath: /verdaccio/storage',
    '      volumes:',
    '        - name: config',
    '          configMap:',
    '            name: knuth-config',
    '        - name: storage',
    '          persistentVolumeClaim:',
    '            claimName: knuth-storage-pvc',
    '---',
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: knuth-verdaccio',
    `  namespace: ${yamlString(k8s.namespace)}`,
    '  labels:',
    '    app.kubernetes.io/name: knuth',
    'spec:',
    `  type: ${yamlString(k8s.serviceType)}`,
    '  selector:',
    '    app.kubernetes.io/name: knuth',
    '  ports:',
    '    - name: http',
    `      port: ${docker.port}`,
    '      targetPort: http',
    '      protocol: TCP',
  ];

  return `${lines.join('\n')}\n`;
}

/**
 * 渲染等效的原生 docker run 启动命令 (兼容 Docker 与 OrbStack).
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

/**
 * 渲染 macOS container CLI 启动命令 (包含系统服务启动与具名存储卷 10001:65533 初始化).
 */
export function renderAppleContainerCommands(config: KnuthConfig): string {
  const { docker, registry } = config;
  return [
    '# 1. 启动 macOS 原生 container 后台服务',
    'container system start',
    '',
    '# 2. 创建具名存储卷并按 Verdaccio 非 root 用户 (10001:65533) 初始化属主',
    'container volume create knuth-storage',
    `container run --rm --uid 0 --entrypoint sh -v knuth-storage:/mnt ${docker.image} -c 'mkdir -p /mnt/data && chown -R 10001:65533 /mnt'`,
    '',
    '# 3. 启动 Verdaccio 容器 (注意: 建议在 knuth.config.ts 将 auth.htpasswdFile 设为 /verdaccio/storage/htpasswd)',
    'container run -d \\',
    `  --name ${docker.containerName} \\`,
    `  -p ${docker.port}:${docker.port} \\`,
    `  -e VERDACCIO_PORT=${docker.port} \\`,
    `  -e VERDACCIO_PUBLIC_URL=${registry.publicUrl} \\`,
    '  -v "$PWD/conf/config.yaml:/verdaccio/conf/config.yaml:ro" \\',
    '  -v knuth-storage:/verdaccio/storage \\',
    `  ${docker.image}`,
  ].join('\n');
}

/**
 * 渲染 rootless Podman 启动命令 (通过 --userns=keep-id:uid=10001,gid=65533 映射宿主机属主).
 */
export function renderPodmanCommands(config: KnuthConfig): string {
  const { docker, registry } = config;
  return [
    '# 如在 Linux 启用 SELinux, 可为卷参数追加 :z 或 :Z 标签',
    'podman run -d --restart=always \\',
    `  --name ${docker.containerName} \\`,
    '  --userns=keep-id:uid=10001,gid=65533 \\',
    `  -p ${docker.port}:${docker.port} \\`,
    `  -e VERDACCIO_PORT=${docker.port} \\`,
    `  -e VERDACCIO_PUBLIC_URL=${registry.publicUrl} \\`,
    '  -v "$PWD/conf:/verdaccio/conf" \\',
    '  -v "$PWD/storage:/verdaccio/storage" \\',
    '  -v "$PWD/plugins:/verdaccio/plugins" \\',
    `  ${docker.image}`,
  ].join('\n');
}
