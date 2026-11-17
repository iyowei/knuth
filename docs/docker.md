# 在 Docker 上启动 Knuth

适用于标准 Linux Docker Engine、Docker Desktop 以及基于 Docker 的边缘设备部署。

## 前置准备

1. 在项目根目录执行初始化, 生成 `conf/config.yaml`、`docker-compose.yaml` 与 `docker-compose-debug.yaml`:

```shell
# 使用自定义配置
npm run init

# 或直接用内置示例配置快速验证
npm run init -- --example
```

2. 若在 **Linux** 宿主机使用目录绑定挂载, 预先确保挂载目录属主匹配容器内的 Verdaccio 非 root 用户 (`UID 10001` / `GID 65533`), 否则容器启动后会报 `EACCES: permission denied`:

```shell
sudo chown -R 10001:65533 ./conf ./storage ./plugins
```

> 若改用 Docker 具名卷 (`docker volume create`), Docker 会自动从镜像初始化目录属主, 无需手工 `chown`。

## 启动方式

### 方式 A: 使用 Docker Compose (推荐)

```shell
# 正式启动 (后台运行, 会注入 VERDACCIO_PUBLIC_URL)
docker compose up -d

# 查看状态与日志
docker compose ps
docker compose logs -f verdaccio

# 本地调试启动 (不注入生产公开域名)
docker compose -f ./docker-compose-debug.yaml up
```

### 方式 B: 使用原生 `docker run`

可通过生成器输出带完整参数的启动命令:

```shell
npm run init -- --commands
```

示例启动命令 (附带基于 `/-/ping` 端点的健康检查):

```shell
docker run -d --restart=always \
  --name knuth-verdaccio \
  -p 5673:5673 \
  -e VERDACCIO_PORT=5673 \
  -e VERDACCIO_PUBLIC_URL=http://localhost:5673 \
  -v "$PWD/conf:/verdaccio/conf" \
  -v "$PWD/storage:/verdaccio/storage" \
  -v "$PWD/plugins:/verdaccio/plugins" \
  --health-cmd 'wget --quiet --tries=1 --spider http://127.0.0.1:5673/-/ping || exit 1' \
  --health-interval 30s \
  --health-timeout 5s \
  --health-retries 3 \
  verdaccio/verdaccio:6.10.1
```

> 健康检查请使用 `127.0.0.1` 而非 `localhost`: Alpine 基础镜像会优先把 `localhost` 解析为 IPv6 (`::1`), 而 Verdaccio 6 默认监听 IPv4 (`0.0.0.0`)。

## 容器交互与排查

```shell
# 以 root 身份进入容器排查权限或配置
docker exec -it --user=root knuth-verdaccio sh
```

## 底层运行时架构说明 (ARM64 / 树莓派节点参考)

在 Linux / ARM64 (如树莓派) 边缘节点部署 Docker 时, 容器并不是由 `docker` 单个进程直接拉起的, 而是由一套**三层运行时架构**协同工作 (以实测栈 `Docker 29.5.2 -> containerd 2.2.4 -> crun 1.30.1` 为例):

这三层的分工就像**前台总管、调度员和现场操作工**:

1. **Docker (`29.5.2`, 前台总管)**: 对外提供 `docker` / `docker compose` 命令接口, 并负责管理虚拟网络、端口映射与容器日志收集。
2. **containerd (`2.2.4`, 调度员)**: 在中间管理镜像拉取、解压与容器生命周期任务调度。
3. **crun (`1.30.1`, 现场操作工)**: 真正对接 Linux 内核创建 cgroups、namespaces 并启动隔离进程。相比 Go 语言编写的默认运行时 `runc`, 用 C 语言编写的轻量级 OCI 运行时 `crun` 在树莓派等 ARM 资源受限设备上启动更快、内存占用更省。

> **Note**: 在宿主机进程列表 (`ps aux`) 里看到的 `containerd-shim-runc-v2` 只是 `containerd` 的标准 v2 垫片进程名字, **不代表底层用的就是 `runc`**。在配置好 `crun` 作为默认运行时的节点上, 这个垫片实际指向并调用的是 `/usr/local/bin/crun`。

可通过以下命令确认节点实际生效的运行时:

```shell
docker info | grep -iE 'runtime|version'
```

## 镜像构建差异

默认直接拉取多架构官方镜像 `verdaccio/verdaccio:6.10.1`, 无需本地构建。如需自定义构建扩展插件镜像, 请参阅 [跨平台镜像构建与架构差异](./build-and-platforms.md)。
