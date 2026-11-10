# 自定义字段版本：本地构建与运行

源码位于仓库根目录。Web 和 API 使用本仓库源码构建；管理后台、Space、Live、代理等辅助服务沿用固定的官方 CE `v1.4.3` 镜像。构建脚本使用仓库指定的 pnpm 版本和锁文件。

功能范围和已运行的检查见 [本地验证记录](VERIFICATION.md)。

## 配置和启动

在仓库根目录创建 `.local/runtime.env`，参考本目录的 `runtime.env.example`，为数据库、消息队列、对象存储和应用密钥填写独立随机值。该文件仅限本机，设置权限 `600`，不要提交。

```bash
./deploy/custom/build-local.sh
./deploy/custom/manage.sh up -d plane-db plane-redis plane-mq plane-minio
./deploy/custom/manage.sh run --rm migrator
./deploy/custom/manage.sh up -d
./deploy/custom/manage.sh ps -a
```

默认入口为 http://localhost:8090，仅监听本机。配置副本测试时，可将 `LISTEN_HTTP_PORT` 改为 `8091`，并同时将 `WEB_URL` 和 `CORS_ALLOWED_ORIGINS` 改为 `http://127.0.0.1:8091`。

停止使用 `./deploy/custom/manage.sh stop`。数据保存在 `plane-custom_` 命名卷，停止容器不会删除数据。不要对有用的数据卷运行 `down -v`。

## 字段管理

项目管理员进入“项目设置 → 自定义字段”。新增字段时选择类型，维护选项并调整顺序；成员在任务创建和详情中填写值，在列表或表格的“显示”菜单切换可见性。

“签收顺序”可选择整数，“预计工时”可选择小数。单值字段支持排序，多值字段不支持排序。状态、周期、模块等新增引用字段独立保存，不会改变任务原有业务关系。已有值时锁定字段类型；清空所有任务中的值后可改类型。停用和逻辑删除字段保留历史数据。

## 备份、升级和回退

先备份当前数据库、附件和部署配置，再将数据恢复到独立卷中运行迁移及验证。备份和密钥必须保存在 Git 目录之外或被忽略的本机目录，不能提交。

本机旧环境位于 `/Users/work/Documents/本电脑/plane-local`。切换到改造版前停止旧环境；旧卷和备份继续保留。需要回退时，先停止本版本，再在旧目录运行 `./manage.sh up -d`，恢复原来的本机端口入口。旧版本不能直接连接已经执行新版迁移的数据库。

dev2 部署须等待用户完整测试确认。届时使用已验证的 Git 提交和相应架构镜像，重新备份、迁移并验证，不直接搬运本机开发环境。
