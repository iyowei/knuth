# Knuth

配置驱动、安全加固的 [Verdaccio](https://verdaccio.org/) 私有 NPM 注册表部署套件。

通过一份 TypeScript 描述性配置 (`knuth.config.ts`) 统一派生 Verdaccio 主配置与 Docker Compose 编排文件, 避免站点名称、对外域名与私有 scope 在多处文件之间散落和漂移, 同时内置防依赖混淆、上游源收敛与用户端点限流策略。

## 核心特性

- **TypeScript 单源配置驱动**: 基于 `defineConfig` 提供完整类型约束与 IDE 悬停提示, 由 `knuth.config.ts` 一次生成 `conf/config.yaml`、`docker-compose.yaml` 与 `docker-compose-debug.yaml`, 并支持 `--check` 防配置漂移。
- **零公司绑定与防误提交**: 本地配置 (`knuth.config.ts`) 与所有生成产物均在 `.gitignore` 中忽略, 部署私有环境时不会误将组织域名或内部 scope 提交到版本库。
- **依赖混淆防护**: 配置中的 `scopes.private` 与 `scopes.publicInternal` 自动排在 `@*/*` 规则之前并强制切断 `proxy`, 确保内部包不向公共源查询与合并元数据。
- **安全与高可用默认项**:
  - 启用 `userRateLimit` 防登录/令牌接口暴力破解;
  - 默认收敛为 `npmmirror` 与 `huawei` 双上游镜像并收紧超时与冷却探测;
  - 默认开启 `publish.allow_offline`, 避免公共上游抖动阻断发布。

## 环境要求

- Node.js `>= 24` (初始化脚本与 `.ts` 配置基于原生 TypeScript 类型剥离直接运行, 无需编译或安装第三方运行时依赖)
- Docker / Docker Compose

## 快速开始

### 1 分钟本地体验

如果想先用内置示例配置快速验证效果 (`http://localhost:5673`), 执行以下 4 步即可:

```shell
git clone https://github.com/iyowei/knuth.git
cd knuth
npm run init -- --example
docker compose up -d
```

启动后浏览器打开 `http://localhost:5673`, 即可看到默认实例界面 (Web UI 与默认配置支持 `@knuth/*` 与 `@knuth-public/*` 示例作用域)。

### 正式环境定制部署

#### 第 1 步: 创建本地配置

复制示例配置为本地配置 (`knuth.config.ts` 已被 `.gitignore` 忽略, 不会进入版本库):

```shell
cp knuth.config.example.ts knuth.config.ts
```

编辑 `knuth.config.ts`, 借助 `defineConfig` 即可获得完整类型提示与字段注释, 常见修改项包括:

- `registry.title` / `registry.description`: 站点标题与描述
- `registry.publicUrl`: 对外访问地址 (同步写入 `web.publicPath` 与 `VERDACCIO_PUBLIC_URL`, 请使用最终访问域名且无需末尾斜杠)
- `registry.logo`: 可选 Web UI 图标地址, 留空则不输出
- `scopes.private`: 仅认证用户可读写的私有作用域 (如 `@myorg/*` 或简写 `myorg`)
- `scopes.publicInternal`: 允许匿名读取、仅认证发布的公开内部作用域
- `auth.maxUsers`: 允许注册的用户数量上限, 设为 `-1` 可关闭自助注册

完整类型契约定义于 [scripts/config.ts](./scripts/config.ts) (`KnuthUserConfig`)。

#### 第 2 步: 生成部署文件

```shell
npm run init
```

生成产物如下 (均默认忽略, 不进入 Git):

- `conf/config.yaml`: Verdaccio 主配置
- `docker-compose.yaml`: 生产编排配置
- `docker-compose-debug.yaml`: 本地调试编排配置 (不注入 `VERDACCIO_PUBLIC_URL`)

#### 第 3 步: 启动与进入容器

```shell
# 正式启动 (后台运行)
docker compose up -d

# 本地调试
docker compose -f ./docker-compose-debug.yaml up
```

如需进入容器排查:

```shell
docker exec -it --user=root knuth-verdaccio sh
```

### 客户端接入与首次发包

服务启动后, 按以下流程注册账号、绑定客户端并发布首个私有包 (下例以本地 `http://localhost:5673` 为例, 生产环境请替换为 `registry.publicUrl`):

1. **创建或登录用户**:

```shell
npm adduser --registry=http://localhost:5673
```

2. **在业务项目根目录配置 `.npmrc`**:

```ini
# 推荐: 仅内部作用域走 Knuth 私有仓, 其余公共依赖沿用全局默认源
@knuth:registry=http://localhost:5673
```

> 实际使用时将 `@knuth` 替换为你在 `scopes.private` 或 `scopes.publicInternal` 中配置的 scope 前缀; 如果希望所有第三方依赖也统一走 Knuth 缓存代理, 改为 `registry=http://localhost:5673`。

3. **发布私有包**:

```shell
# 也可以在业务包 package.json 中配置 publishConfig.registry
npm publish --registry=http://localhost:5673
```

- 命中 `scopes.private` 的包: 未登录状态下页面不可见, 拉取和发布都必须先 `npm login`。
- 命中 `scopes.publicInternal` 的包: 支持匿名拉取, 但发布与撤包仍要求认证账号。

## 生产上线与运维清单

- **初始建号后关闭公开注册**: 团队成员注册完毕后, 建议在 `knuth.config.ts` 中将 `auth.maxUsers` 改为 `-1`, 然后重新运行 `npm run init` 与 `docker compose up -d` 重建/重启容器, 防止外部未知用户注册并向 `@*/*` 或其它未受限路径写入内容。
- **配置变更生效流**: 每次修改 `knuth.config.ts` 后, 务必重新执行 `npm run init` 刷新 `conf/config.yaml` 与编排文件, 再重启容器使其生效; 部署脚本或 CI 中可通过 `npm run check` 检测产物是否发生手动篡改或漂移。
- **持久化目录备份**: 所有已发布包、上游缓存与账号密码哈希分别存放在 `storage/data/` 与 `conf/htpasswd`, 生产环境应定期备份这两个路径。
- **慎用清理脚本**: `npm run clean` 会直接删除 `storage/data` 与 `conf/htpasswd`, 仅限本地调试重置, **严禁在生产目录执行**。

## CLI 选项

```shell
npm run init -- [选项]
```

| 选项 | 说明 |
|---|---|
| `-c, --config <路径>` | 指定自定义配置文件 (支持 `.ts` / `.mts` / `.js` / `.mjs` / `.json`, 默认读取 `./knuth.config.ts`) |
| `--example` | 使用内置 `knuth.config.example.ts` 生成配置 |
| `--dry-run` | 仅预览将生成的文件体积与等效 `docker run` 命令, 不写入磁盘 |
| `--check` | 检查已生成文件是否与配置源完全一致, 漂移时返回非零退出码 |
| `-h, --help` | 显示命令行帮助 |

## 校验与测试

```shell
# 运行单元测试与端到端生成检查
npm test

# 校验已生成文件是否与配置源一致
npm run check -- --example

# 清理本地缓存包与密码文件 (仅限本地调试)
npm run clean
```

## Nginx 与 HTTPS 反向代理

参见官方指南:

- [Verdaccio Reverse Proxy](https://verdaccio.org/docs/reverse-proxy)
- [Verdaccio SSL](https://verdaccio.org/docs/ssl)
