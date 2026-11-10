# dev2 独立 Docker 部署

本目录部署新建的 `plane-dev2` 项目。应用源码使用已合并、已测试的版本；不要导入本地体验账号、项目或测试数据。反向代理与证书由使用者配置。

## 数据库与资源

优先核实宝塔 PostgreSQL 是否已经可用。2026-11-10 只读核查发现宝塔没有安装或登记 PgSQL；宿主 PostgreSQL 18.6 与 Dify PostgreSQL 属于其他环境。因此本次按授权备选方案运行 Plane 专属 PostgreSQL 15 容器，保留它们的运行状态和配置。

所有新容器进入独立 `plane-dev2.slice`：总内存上限 1800 MiB、软阈值 1500 MiB、CPU 上限 1.5 核。容器各自还有限额，Celery 并发为 1。这个预算用于共享服务器上的小规模使用，不能作为满负载容量保证。上线与后续扩容须检查实际内存、延迟和 OOM 记录。

## 文件位置

| 内容               | dev2 路径                                                    |
| ------------------ | ------------------------------------------------------------ |
| 部署文件           | `/home/plane/deploy/`                                        |
| 环境配置           | `/home/plane/plane.env`，权限 600                            |
| 数据目录           | `/home/plane/data/`                                          |
| 数据库             | `/home/plane/data/postgres/`                                 |
| 附件及对象存储状态 | `/home/plane/data/uploads/`、`/home/plane/data/minio-state/` |
| 完成的备份         | `/www/backup/plane/`                                         |
| 配置备份解密密钥   | `/home/plane/private/backup.key`，权限 600，独立保存异机副本 |
| 版本与验收记录     | `/home/plane/records/`                                       |

PostgreSQL 数据目录不是 SQLite 文件。运行中的该目录不能直接当作数据库备份。

## 构建与首次启动

在本机或独立构建环境生成 `linux/amd64` 镜像，dev2 仅加载和运行。`build.sh` 可复用经过源代码比对的前端和管理后台构建产物，必须分别提供 `PLANE_DEV2_WEB_SOURCE_REVISION`、`PLANE_DEV2_ADMIN_SOURCE_REVISION`。构建输出 Web、管理后台和 API 的独立镜像标签、构建端镜像 ID、完整 inspect 元数据及附 SHA256 的 tar 包，不覆盖本地 `plane-custom` 镜像。

管理后台使用本仓库源码构建，并打包到官方 CE `v1.4.3` 的 nginx 运行环境，保留现有代理路由及旧哈希资源，便于已打开的页面在升级期间继续加载。构建时可通过 `ADMIN_RUNTIME_IMAGE` 覆盖基础镜像，以使用已加载的固定版本；运行镜像由 `PLANE_ADMIN_IMAGE` 指定。

辅助服务沿用已经验证的固定版本；基础镜像按 amd64 manifest 选择并形成唯一标签。Compose 设置 `pull_policy: never`。传输后先核对归档 SHA256，再逐个核对镜像内容清单：完整有序 `RootFS.Layers`、全部有效 `Config`、OS/架构、创建信息及应用源码标签。不同 Docker 引擎的 `Id` 可能分别表示 config 摘要或 manifest 摘要，不能直接作为跨引擎判据；只有明确的缺省空值字段可规范为省略，层顺序、命令、环境变量和标签必须保持一致。

1. 安装新 slice 单元并启动它，不修改现有服务或 Docker daemon。
2. 创建新数据目录和随机凭据，从 `env.example` 生成 `/home/plane/plane.env`。
3. 加载镜像并核对清单。
4. `./manage.sh up -d plane-db plane-redis plane-mq plane-minio`。
5. 等待数据库就绪，执行 `./manage.sh run --rm migrator`。
6. `./manage.sh up -d`，持续检查新项目的内存、日志及原有业务状态。

管理命令在 `/home/plane/deploy/` 执行。`manage.sh` 默认使用上述环境文件和项目名；测试环境可通过 `PLANE_DEV2_ENV_FILE`、`PLANE_DEV2_PROJECT_NAME` 指定独立配置。

## 访问入口

仅发布 `127.0.0.1:8090`，对应 Plane 完整代理入口。数据库、队列、缓存及对象存储管理端口不向宿主公网发布。

使用者将完整站点反代至这个入口，并开启 WebSocket、保留 Host 与转发协议头，保持上传限制一致。最终访问 URL 须写入 `/home/plane/plane.env` 的 `WEB_URL` 和 `CORS_ALLOWED_ORIGINS`，`APP_DOMAIN` 填写对应域名；然后执行 `./manage.sh up -d --no-deps api worker beat-worker proxy` 应用配置。交付时仅配置回环地址，域名确定后完成这一步再初始化账号。

全新环境保留 `/god-mode/` 的首次管理员设置流程，不带入体验账号或示例项目。初始化后可在个人设置中选择简体中文。

## 定时备份

每日北京时间 03:30 由独立 `plane-dev2-backup.timer` 调用备份脚本，保留最近 **3 份成功备份**。使用独立定时器是因为当前宝塔创建任务的内部流程会重启共享 cron 并修改秒级任务脚本；本次保持既有计划任务不变。备份文件可通过宝塔文件管理查看。

备份脚本会暂停 Plane 写入和调度、等待后台任务完成，逻辑导出 PostgreSQL、归档附件及加密配置，验证成功后才发布完成目录并轮换旧备份。备份期间 Plane 会短暂不可用，其他项目继续运行。失败或半成品不会删除成功历史，退出时恢复此前运行的服务。配置解密密钥不包含在备份包中，需单独妥善保存。

手动备份与检查定时器：

```bash
systemctl start plane-dev2-backup.service
systemctl status plane-dev2-backup.service
systemctl list-timers plane-dev2-backup.timer
journalctl -u plane-dev2-backup.service -n 50 --no-pager
```

首次部署后要运行真实备份和隔离恢复演练，校验数据库、附件和配置可恢复。首次备份及解密密钥另存本机一份；后续持续异机备份需要配置可用的存储目的地。

## 恢复与升级

`restore.py` 默认只恢复到 `plane_restore_` 前缀的显式测试数据库和全新隔离目录，先验证备份校验值及归档路径，再写入测试目标。不得把恢复演练指向业务数据库或现有数据目录。

每次升级先生成完整备份，再使用固定镜像版本执行迁移。回退需要匹配的旧镜像、数据库、附件及配置；旧版本不可直接连接已执行新迁移的数据库。

停止本项目使用 `./manage.sh stop`，不清理其他项目、不执行全局 Docker prune、不删除数据目录。
