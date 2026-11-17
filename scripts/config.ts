import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 允许的 Verdaccio 日志级别 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'http' | 'warn' | 'error' | 'fatal';

/** 单个上游注册表配置 */
export interface UplinkConfig {
  /** 上游源标识名 (仅限小写字母、数字与 _-) */
  name: string;
  /** 上游源基础 URL (http 或 https) */
  url: string;
  /** 单次请求超时 (如 "10s") */
  timeout: string;
  /** 连续失败进入冷却后的恢复探测周期 (如 "1m") */
  failTimeout: string;
}

/** Knuth 完整配置对象 (经校验和默认值补齐后的规范化形态) */
export interface KnuthConfig {
  registry: {
    /** Web UI 页面标题 */
    title: string;
    /** 注册表实例描述信息, 写入生成产物头注释 */
    description: string;
    /** 对外访问完整 URL (同步驱动 web.publicPath 与 VERDACCIO_PUBLIC_URL) */
    publicUrl: string;
    /** Web UI Logo URL; 留空则不输出 logo 字段 */
    logo: string;
    /** 是否启用暗色主题 */
    darkMode: boolean;
    /** Web UI 界面语言 */
    i18n: string;
    /** 单次请求体最大体积 (如 "100mb") */
    maxBodySize: string;
    /** HTTP Keep-Alive 超时秒数 */
    keepAliveTimeout: number;
    /** Verdaccio 日志输出级别 */
    logLevel: LogLevel;
  };
  docker: {
    /** Verdaccio 容器镜像及标签 */
    image: string;
    /** 容器名称 */
    containerName: string;
    /** 宿主机与容器映射端口 */
    port: number;
    /** Docker Compose 桥接网络名称 */
    networkName: string;
  };
  auth: {
    /** 允许注册的最大用户数; 设为 -1 可禁止新用户注册 */
    maxUsers: number;
    /** Web 登录令牌有效期 (如 "8h") */
    jwtExpiresIn: string;
    userRateLimit: {
      /** 限流时间窗口 (毫秒) */
      windowMs: number;
      /** 时间窗口内单用户端点最大请求次数 */
      max: number;
    };
  };
  scopes: {
    /** 完全私有作用域 (如 "@myorg/*" 或 "myorg"): 仅认证用户可读写 */
    private: string[];
    /** 公开可读内部作用域 (如 "@myorg-public/*"): 匿名可读, 仅认证用户可发布与撤包 */
    publicInternal: string[];
  };
  /** 公共包代理上游注册表列表 (按声明顺序串联探测) */
  uplinks: UplinkConfig[];
  publish: {
    /** 上游公共源不可达时是否允许继续发布 (对本地私有 scope 零影响) */
    allowOffline: boolean;
  };
}

/** 面向用户编写 knuth.config.ts 时的输入配置类型 (除必填项外均可选) */
export interface KnuthUserConfig {
  registry: {
    title: string;
    publicUrl: string;
    description?: string;
    logo?: string;
    darkMode?: boolean;
    i18n?: string;
    maxBodySize?: string;
    keepAliveTimeout?: number;
    logLevel?: LogLevel;
  };
  docker?: Partial<KnuthConfig['docker']>;
  auth?: {
    maxUsers?: number;
    jwtExpiresIn?: string;
    userRateLimit?: Partial<KnuthConfig['auth']['userRateLimit']>;
  };
  scopes?: Partial<KnuthConfig['scopes']>;
  uplinks?: Array<{
    name: string;
    url: string;
    timeout?: string;
    failTimeout?: string;
  }>;
  publish?: Partial<KnuthConfig['publish']>;
}

/**
 * 为 knuth.config.ts 提供类型推导与 IDE 自动补全的声明辅助函数.
 */
export function defineConfig(config: KnuthUserConfig): KnuthUserConfig {
  return config;
}

const VALID_LOG_LEVELS = new Set<LogLevel>([
  'trace',
  'debug',
  'info',
  'http',
  'warn',
  'error',
  'fatal',
]);

const TS_OR_JS_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const SCOPE_NAME_RE = /^@[a-z0-9][a-z0-9._-]*\/\*$/;
const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const UPLINK_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const DURATION_RE = /^[1-9][0-9]*(ms|s|m|h|d)$/;
const BODY_SIZE_RE = /^[1-9][0-9]*(kb|mb|gb)$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\r\n\0\x01-\x1f\x7f]/;

/** 默认配置模板, 用于补齐可选字段 */
export const DEFAULT_CONFIG: Omit<KnuthConfig, 'registry'> & {
  registry: Omit<KnuthConfig['registry'], 'title' | 'publicUrl'>;
} = {
  registry: {
    description: '配置驱动、安全加固的私有 NPM 注册表',
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
    maxUsers: 12,
    jwtExpiresIn: '8h',
    userRateLimit: {
      windowMs: 60000,
      max: 30,
    },
  },
  scopes: {
    private: [],
    publicInternal: [],
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
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`配置字段 "${field}" 必须是配置对象`);
  }
  return value;
}

function assertSingleLineString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new Error(`配置字段 "${field}" 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new Error(`配置字段 "${field}" 不能为空`);
  }
  if (CONTROL_CHAR_RE.test(trimmed)) {
    throw new Error(`配置字段 "${field}" 不能包含换行或控制字符`);
  }
  return trimmed;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`配置字段 "${field}" 必须是布尔值`);
  }
  return value;
}

function assertIntRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`配置字段 "${field}" 必须是 [${min}, ${max}] 范围内的整数`);
  }
  return value;
}

function assertPattern(value: unknown, field: string, pattern: RegExp, hint: string): string {
  const str = assertSingleLineString(value, field);
  if (!pattern.test(str)) {
    throw new Error(`配置字段 "${field}" 格式不合法: ${hint} (当前值: "${str}")`);
  }
  return str;
}

function normalizeHttpUrl(value: unknown, field: string, stripTrailingSlash: boolean): string {
  const raw = assertSingleLineString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`配置字段 "${field}" 不是有效的 URL: "${raw}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`配置字段 "${field}" 仅支持 http 或 https 协议 (当前值: "${raw}")`);
  }
  return stripTrailingSlash ? raw.replace(/\/+$/, '') : raw;
}

/**
 * 将用户输入的 scope 规范化为 "@org/*" 形式并校验合法性.
 * 拒绝通配保留规则 (如 "@*"、"**") 与非法字符, 避免破坏 Verdaccio 匹配优先级.
 */
export function normalizeScopePattern(raw: unknown, field: string): string {
  const str = assertSingleLineString(raw, field);
  if (str.includes(' ') || str === '**' || str === '@*/*' || str === '*') {
    throw new Error(`配置字段 "${field}" 不能包含通配保留规则或空格: "${str}"`);
  }

  let normalized = str;
  if (!normalized.startsWith('@')) {
    normalized = `@${normalized}`;
  }
  if (!normalized.includes('/')) {
    normalized = `${normalized}/*`;
  }

  if (!SCOPE_NAME_RE.test(normalized)) {
    throw new Error(
      `配置字段 "${field}" 必须是合法 npm scope (如 "@myorg/*" 或 "myorg"), 当前值: "${str}"`,
    );
  }
  return normalized;
}

function normalizeScopeList(rawList: unknown, field: string): string[] {
  if (rawList === undefined) return [];
  if (!Array.isArray(rawList)) {
    throw new Error(`配置字段 "${field}" 必须是字符串数组`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = 0; i < rawList.length; i += 1) {
    const normalized = normalizeScopePattern(rawList[i], `${field}[${i}]`);
    if (seen.has(normalized)) {
      throw new Error(`配置字段 "${field}" 存在重复项: "${normalized}"`);
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseRegistry(raw: unknown): KnuthConfig['registry'] {
  const obj = assertPlainObject(raw, 'registry');
  const title = assertSingleLineString(obj.title, 'registry.title');
  const publicUrl = normalizeHttpUrl(obj.publicUrl, 'registry.publicUrl', true);

  const description =
    obj.description !== undefined
      ? assertSingleLineString(obj.description, 'registry.description', true)
      : DEFAULT_CONFIG.registry.description;

  let logo = DEFAULT_CONFIG.registry.logo;
  if (obj.logo !== undefined) {
    const rawLogo = assertSingleLineString(obj.logo, 'registry.logo', true);
    logo = rawLogo === '' ? '' : normalizeHttpUrl(rawLogo, 'registry.logo', false);
  }

  const darkMode =
    obj.darkMode !== undefined
      ? assertBoolean(obj.darkMode, 'registry.darkMode')
      : DEFAULT_CONFIG.registry.darkMode;

  const i18n =
    obj.i18n !== undefined
      ? assertSingleLineString(obj.i18n, 'registry.i18n')
      : DEFAULT_CONFIG.registry.i18n;

  const maxBodySize =
    obj.maxBodySize !== undefined
      ? assertPattern(obj.maxBodySize, 'registry.maxBodySize', BODY_SIZE_RE, '示例: 100mb')
      : DEFAULT_CONFIG.registry.maxBodySize;

  const keepAliveTimeout =
    obj.keepAliveTimeout !== undefined
      ? assertIntRange(obj.keepAliveTimeout, 'registry.keepAliveTimeout', 0, 864000)
      : DEFAULT_CONFIG.registry.keepAliveTimeout;

  let logLevel = DEFAULT_CONFIG.registry.logLevel;
  if (obj.logLevel !== undefined) {
    const rawLevel = assertSingleLineString(obj.logLevel, 'registry.logLevel') as LogLevel;
    if (!VALID_LOG_LEVELS.has(rawLevel)) {
      throw new Error(
        `配置字段 "registry.logLevel" 无效: "${rawLevel}", 允许值: ${[...VALID_LOG_LEVELS].join(', ')}`,
      );
    }
    logLevel = rawLevel;
  }

  return {
    title,
    description,
    publicUrl,
    logo,
    darkMode,
    i18n,
    maxBodySize,
    keepAliveTimeout,
    logLevel,
  };
}

function parseDocker(raw: unknown): KnuthConfig['docker'] {
  if (raw === undefined) return { ...DEFAULT_CONFIG.docker };
  const obj = assertPlainObject(raw, 'docker');

  const image =
    obj.image !== undefined
      ? assertSingleLineString(obj.image, 'docker.image')
      : DEFAULT_CONFIG.docker.image;
  if (/\s/.test(image)) {
    throw new Error(`配置字段 "docker.image" 不能包含空白字符: "${image}"`);
  }

  const containerName =
    obj.containerName !== undefined
      ? assertPattern(obj.containerName, 'docker.containerName', DOCKER_NAME_RE, '仅限字母数字与 ._-')
      : DEFAULT_CONFIG.docker.containerName;

  const port =
    obj.port !== undefined
      ? assertIntRange(obj.port, 'docker.port', 1, 65535)
      : DEFAULT_CONFIG.docker.port;

  const networkName =
    obj.networkName !== undefined
      ? assertPattern(obj.networkName, 'docker.networkName', DOCKER_NAME_RE, '仅限字母数字与 ._-')
      : DEFAULT_CONFIG.docker.networkName;

  return { image, containerName, port, networkName };
}

function parseAuth(raw: unknown): KnuthConfig['auth'] {
  if (raw === undefined) {
    return {
      ...DEFAULT_CONFIG.auth,
      userRateLimit: { ...DEFAULT_CONFIG.auth.userRateLimit },
    };
  }
  const obj = assertPlainObject(raw, 'auth');

  const maxUsers =
    obj.maxUsers !== undefined
      ? assertIntRange(obj.maxUsers, 'auth.maxUsers', -1, 1000000)
      : DEFAULT_CONFIG.auth.maxUsers;

  const jwtExpiresIn =
    obj.jwtExpiresIn !== undefined
      ? assertPattern(obj.jwtExpiresIn, 'auth.jwtExpiresIn', DURATION_RE, '示例: 8h, 7d')
      : DEFAULT_CONFIG.auth.jwtExpiresIn;

  let userRateLimit = { ...DEFAULT_CONFIG.auth.userRateLimit };
  if (obj.userRateLimit !== undefined) {
    const limitObj = assertPlainObject(obj.userRateLimit, 'auth.userRateLimit');
    userRateLimit = {
      windowMs:
        limitObj.windowMs !== undefined
          ? assertIntRange(limitObj.windowMs, 'auth.userRateLimit.windowMs', 1000, 86400000)
          : DEFAULT_CONFIG.auth.userRateLimit.windowMs,
      max:
        limitObj.max !== undefined
          ? assertIntRange(limitObj.max, 'auth.userRateLimit.max', 1, 100000)
          : DEFAULT_CONFIG.auth.userRateLimit.max,
    };
  }

  return { maxUsers, jwtExpiresIn, userRateLimit };
}

function parseScopes(raw: unknown): KnuthConfig['scopes'] {
  if (raw === undefined) {
    return { private: [], publicInternal: [] };
  }
  const obj = assertPlainObject(raw, 'scopes');
  const privateScopes = normalizeScopeList(obj.private, 'scopes.private');
  const publicInternalScopes = normalizeScopeList(obj.publicInternal, 'scopes.publicInternal');

  const privateSet = new Set(privateScopes);
  for (const scope of publicInternalScopes) {
    if (privateSet.has(scope)) {
      throw new Error(`scope "${scope}" 不能同时出现在 scopes.private 与 scopes.publicInternal`);
    }
  }

  return {
    private: privateScopes,
    publicInternal: publicInternalScopes,
  };
}

function parseUplinks(raw: unknown): UplinkConfig[] {
  if (raw === undefined) {
    return DEFAULT_CONFIG.uplinks.map((item) => ({ ...item }));
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('配置字段 "uplinks" 必须是非空数组 (至少保留 1 个上游源)');
  }

  const names = new Set<string>();
  return raw.map((entry, idx) => {
    const field = `uplinks[${idx}]`;
    const obj = assertPlainObject(entry, field);
    const name = assertPattern(obj.name, `${field}.name`, UPLINK_NAME_RE, '仅限小写字母、数字与 _-');
    if (names.has(name)) {
      throw new Error(`配置字段 "uplinks" 存在重复名称: "${name}"`);
    }
    names.add(name);

    return {
      name,
      url: normalizeHttpUrl(obj.url, `${field}.url`, false),
      timeout:
        obj.timeout !== undefined
          ? assertPattern(obj.timeout, `${field}.timeout`, DURATION_RE, '示例: 10s')
          : '10s',
      failTimeout:
        obj.failTimeout !== undefined
          ? assertPattern(obj.failTimeout, `${field}.failTimeout`, DURATION_RE, '示例: 1m')
          : '1m',
    };
  });
}

function parsePublish(raw: unknown): KnuthConfig['publish'] {
  if (raw === undefined) return { ...DEFAULT_CONFIG.publish };
  const obj = assertPlainObject(raw, 'publish');
  const allowOffline =
    obj.allowOffline !== undefined
      ? assertBoolean(obj.allowOffline, 'publish.allowOffline')
      : DEFAULT_CONFIG.publish.allowOffline;
  return { allowOffline };
}

/**
 * 校验未知的原始配置对象并补齐默认值, 返回规范化后的 KnuthConfig.
 */
export function validateConfig(raw: unknown): KnuthConfig {
  const root = assertPlainObject(raw, 'root');
  return {
    registry: parseRegistry(root.registry),
    docker: parseDocker(root.docker),
    auth: parseAuth(root.auth),
    scopes: parseScopes(root.scopes),
    uplinks: parseUplinks(root.uplinks),
    publish: parsePublish(root.publish),
  };
}

/**
 * 从指定路径读取并校验 Knuth 配置.
 * 原生支持 TypeScript/JS 模块 (.ts/.mts/.js/.mjs) 的默认导出, 并兼容 .json 配置文件.
 */
export async function loadConfigFile(configPath: string): Promise<KnuthConfig> {
  const absPath = resolve(configPath);
  const ext = extname(absPath).toLowerCase();

  if (ext === '.json') {
    const rawText = readFileSync(absPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`解析 JSON 配置文件 "${configPath}" 失败: ${detail}`);
    }
    return validateConfig(parsed);
  }

  if (TS_OR_JS_EXTENSIONS.has(ext)) {
    // 附加时间戳查询参数绕过 ESM 缓存, 确保同进程多次加载同一测试文件能读取最新内容
    const moduleUrl = `${pathToFileURL(absPath).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const loaded = (await import(moduleUrl)) as { default?: unknown };
    if (loaded.default === undefined) {
      throw new Error(`配置文件 "${configPath}" 缺少默认导出 (export default)`);
    }
    return validateConfig(loaded.default);
  }

  throw new Error(
    `不支持的配置文件格式 "${ext || '(无扩展名)'}", 请使用 .ts / .mts / .js / .mjs / .json`,
  );
}
