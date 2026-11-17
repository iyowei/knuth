# 在 Kubernetes (K8s) 上部署与启动 Knuth

适用于标准 Kubernetes 集群 (包括 k3s、EKS、ACK、OrbStack 内置 K8s 等)。

## 生成机制与权限设计

运行 `npm run init` 时, 生成器会根据 `knuth.config.ts` 中的 `registry`、`docker`、`scopes`、`uplinks` 与 `k8s` 段同步生成 `k8s/verdaccio.yaml` (包含 `Namespace`、`ConfigMap`、`PersistentVolumeClaim`、`Deployment` 与 `Service`), 并由 `npm run check` 统一校验防漂移。

内置清单解决了 3 个常见线上坑点:

1. **`ConfigMap` 只读与用户密码写入分离**: `ConfigMap` 通过 `subPath: config.yaml` 只读挂载到 `/verdaccio/conf/config.yaml`, 并在生成 K8s `ConfigMap` 时自动将 `auth.htpasswd.file` 重定向至可写 PVC 内的 `/verdaccio/storage/htpasswd` (避免 `npm adduser` 写入只读挂载报 `EROFS`)。
2. **非 root 卷权限对齐**: Pod `securityContext` 显式声明 `runAsNonRoot: true`、`runAsUser: 10001`、`runAsGroup: 65533` 与 `fsGroup: 10001`, 保证 Verdaccio 进程对挂载的 PVC 拥有完整读写权限。
3. **`ReadWriteOnce` 卷更新防死锁**: `Deployment` 更新策略使用 `Recreate` (避免滚动更新新旧两个 Pod 跨节点争抢同一块 `ReadWriteOnce` 存储卷导致卡死), 并内置基于 `/-/ping` 端点的 `readinessProbe` 与 `livenessProbe`。

## 配置项参考

在 `knuth.config.ts` 中可按需自定义 `k8s` 段 (全部可选):

```ts
k8s: {
  namespace: 'knuth',       // 部署命名空间
  replicas: 1,              // 副本数 (ReadWriteOnce 存储建议保持 1)
  storageSize: '5Gi',       // PVC 容量
  storageClassName: '',     // 留空使用集群默认 StorageClass
  serviceType: 'ClusterIP', // ClusterIP | NodePort | LoadBalancer
}
```

## 部署与验证

### 1. 生成清单并下发集群

```shell
npm run init
# 或快速验证: npm run init -- --example

kubectl apply -f ./k8s/verdaccio.yaml
```

### 2. 检查 Pod 与持久化状态

```shell
kubectl -n knuth rollout status deploy/knuth-verdaccio
kubectl -n knuth get pods,pvc,svc
```

### 3. 本地端口转发验证

当 `serviceType` 为 `ClusterIP` 时, 可先通过 `port-forward` 验证访问与发包:

```shell
kubectl -n knuth port-forward svc/knuth-verdaccio 5673:5673
```

随后浏览器打开 `http://localhost:5673` 或用 `npm adduser --registry=http://localhost:5673` 测试账号注册。

## 生产暴露 (Ingress) 提示

- 推荐保持 `Service` 为 `ClusterIP`, 在前方接入集群 Ingress Controller 或 Gateway API 终止 HTTPS TLS 证书, 并将最终域名填回 `knuth.config.ts` 的 `registry.publicUrl`。
- 若使用 Nginx Ingress, 务必同步放宽上传包体上限以匹配 `registry.maxBodySize` (例如为 Ingress 添加注解 `nginx.ingress.kubernetes.io/proxy-body-size: "100m"`), 否则发布较大 tarball 时会在网关层返回 `413 Request Entity Too Large`。

## 镜像构建与集群拉取说明

Kubernetes 本身不负责构建容器镜像, 多架构集群调度与自建镜像推送方式请参阅 [跨平台镜像构建与架构差异](./build-and-platforms.md)。
