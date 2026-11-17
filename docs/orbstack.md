# 在 OrbStack 上启动 Knuth

[OrbStack](https://orbstack.dev/) 在 macOS 上提供轻量化的原生 Linux 虚拟机与完整 Docker Engine / Compose V2 兼容层。

## 前置准备

1. 启动 OrbStack 应用。
2. 在项目根目录生成配置与编排文件:

```shell
npm run init -- --example
# 或先复制并修改 knuth.config.ts 后执行 npm run init
```

## 启动方式

OrbStack 直接兼容标准 Compose 与 Docker CLI, 无需修改 `docker-compose.yaml`:

```shell
# 后台启动
docker compose up -d

# 本地调试
docker compose -f ./docker-compose-debug.yaml up
```

## 访问与域名特性

启动后有两种本地访问途径:

1. **标准端口映射**: `http://localhost:5673` (由 `docker.port` 决定)。
2. **OrbStack 零配置本地域名**:

```text
http://<service>.<project>.orb.local:<port>
```

在默认项目目录 `knuth` 与默认服务名 `verdaccio` 下, 可直接访问 `http://verdaccio.knuth.orb.local:5673` (若在浏览器端使用自定义域名作为 `publicUrl`, 请确保实际对外入口与 `registry.publicUrl` 一致)。

容器内如需反向访问 macOS 宿主机上运行的调试服务, 直接使用 `host.docker.internal`。

## 存储挂载与权限说明

- OrbStack 默认通过优化后的 VirtioFS 在 macOS 与 Linux 容器间共享 `./conf`、`./storage` 与 `./plugins`, 日常开发调试通常可直接读写, 不需要额外 `chown`。
- 若业务测试涉及大量小文件高频写入 (例如缓存上千个公共 npm 包), 可考虑改用 Docker 命名卷存放 `/verdaccio/storage` 以获取更高的文件 I/O 性能并规避 macOS 文件系统语义差异。

## 镜像构建差异

在 Apple Silicon Mac 上执行 `docker build` 时, OrbStack 原生高速构建 `linux/arm64` 镜像, 并内置 Rosetta 2 转译加速 `linux/amd64` 跨架构构建。详情请参阅 [跨平台镜像构建与架构差异](./build-and-platforms.md)。
