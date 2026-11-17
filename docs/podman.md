# 在 Podman 上启动 Knuth

适用于 Linux 原生 Rootless / Rootful Podman 与 macOS Podman Machine (以下参数已对照 `podman 6.2.0` 核验)。

## 前置准备

1. 生成运行配置:

```shell
npm run init
# 或快速体验: npm run init -- --example
```

2. 若在 **macOS** 上运行, 需先初始化并启动 Podman Linux 虚拟机:

```shell
podman machine init
podman machine start
```

## 启动方式

### 方式 A: Rootless `podman run` (推荐, 无需 `sudo chown`)

Rootless Podman 默认会把宿主机当前用户映射为容器内的 `root (UID 0)`。但 `verdaccio/verdaccio:6.10.1` 内部以 `UID 10001 / GID 65533` 启动服务, 直接绑定本地目录会触发权限拒绝。

通过 `--userns=keep-id:uid=10001,gid=65533` 把当前宿主机用户直接映射为容器内的 `10001:65533`:

```shell
# 若在启用 SELinux 的 Linux 发行版 (RHEL / Fedora / CentOS) 运行, 请为每个 -v 参数末尾追加 :z 或 :Z
podman run -d --restart=always \
  --name knuth-verdaccio \
  --userns=keep-id:uid=10001,gid=65533 \
  -p 5673:5673 \
  -e VERDACCIO_PORT=5673 \
  -e VERDACCIO_PUBLIC_URL=http://localhost:5673 \
  -v "$PWD/conf:/verdaccio/conf" \
  -v "$PWD/storage:/verdaccio/storage" \
  -v "$PWD/plugins:/verdaccio/plugins" \
  verdaccio/verdaccio:6.10.1
```

也可以直接运行 `npm run init -- --commands` 自动按你的配置输出对应 `podman run` 命令。

### 方式 B: 使用 `podman compose` 复用 `docker-compose.yaml`

当本机已安装 `podman-compose` 或配置了外部 `docker-compose` 后端时, 可直接编排启动:

```shell
podman compose -f docker-compose.yaml up -d
```

> 若在 Linux Rootless 环境下通过 Compose 启动遇到 `EACCES: permission denied`, 需在宿主机对应用户命名空间内调整挂载目录属主 (不要用宿主机的 `sudo chown`, 而是用 `podman unshare`):
>
> ```shell
> podman unshare chown -R 10001:65533 ./conf ./storage ./plugins
> ```

## Linux 开机自启建议

Podman 默认无后台守护进程, `--restart=always` 仅在容器运行时或由守护单元拉起后生效。Linux 生产环境建议配合 Podman Quadlet (将 `.container` 文件放入 `~/.config/containers/systemd/` 或 `/etc/containers/systemd/`) 交给 `systemd` 管理开机自启与日志。

## 镜像构建差异

Podman 的多架构构建不走 Docker Buildx driver 模型, 而是通过 `--manifest` 聚合多平台镜像清单。详情请参阅 [跨平台镜像构建与架构差异](./build-and-platforms.md)。
