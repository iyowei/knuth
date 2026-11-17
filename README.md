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

### 1. 准备配置文件

复制示例配置为本地配置 (`knuth.config.ts` 已被 `.gitignore` 忽略):

```shell
cp knuth.config.example.ts knuth.config.ts
```

编辑 `knuth.config.ts`, 借助 `defineConfig` 即可获得完整类型提示与字段注释, 常见修改项包括:

- `registry.title` / `registry.description`: 站点标题与描述
- `registry.publicUrl`: 对外访问地址 (会同步写入 `web.publicPath` 与 `VERDACCIO_PUBLIC_URL`)
- `registry.logo`: 可选 Web UI 图标地址, 留空则不输出
- `scopes.private`: 仅认证用户可读写的私有作用域 (如 `@myorg/*` 或简写 `myorg`)
- `scopes.publicInternal`: 允许匿名读取、仅认证发布的公开内部作用域

完整类型契约定义于 [scripts/config.ts](./scripts/config.ts) (`KnuthUserConfig`)。

### 2. 生成部署文件

```shell
npm run init
```

若想先使用默认示例配置直接体验, 可执行:

```shell
npm run init -- --example
```

生成产物如下 (均默认忽略, 不进入 Git):

- `conf/config.yaml`: Verdaccio 主配置
- `docker-compose.yaml`: 生产编排配置
- `docker-compose-debug.yaml`: 本地调试编排配置 (不注入 `VERDACCIO_PUBLIC_URL`)

### 3. 启动服务

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

# 清理本地缓存包与密码文件
npm run clean
```

## Nginx 与 HTTPS 反向代理

参见官方指南:

- [Verdaccio Reverse Proxy](https://verdaccio.org/docs/reverse-proxy)
- [Verdaccio SSL](https://verdaccio.org/docs/ssl)
