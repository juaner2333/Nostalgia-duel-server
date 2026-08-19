# EDOPro 资源源盘点（任务 6.1）

依据 `resources.manifest.json`（公共清单）与 `resources.manifest.private.example.json`（私有模板）逐源盘点。归属规则按 design.md 决策 5：资源源的归属按其**全部消费者**判断，不按源 ID 是否包含 `edopro` 判断。

## 供给 `edopro/*` 目标的 assembly 规则（公共清单共 4 条）

| # | 目标 | 源 | 映射方式 |
| --- | --- | --- | --- |
| 1 | `edopro/lflists` | `edopro-lflists` | 整源目录 |
| 2 | `edopro/evolution-lflists` | `evolution-lflists` | 整源目录 |
| 3 | `edopro/databases` | `edopro-cdbs` | 整源目录 |
| 4 | `edopro/scripts` | `edopro-scripts` | 整源目录 |

## 逐源结论矩阵

| 资源源 | EDOPro 消费者 | YGOPro 消费者 | 结论 |
| --- | --- | --- | --- |
| `edopro-cdbs` | `edopro/databases`（整源） | 无 | **删除资源源与 `edopro/databases` 目标**（任务 6.3） |
| `edopro-scripts` | `edopro/scripts`（整源） | 无 | **删除资源源与 `edopro/scripts` 目标**（任务 6.3） |
| `edopro-lflists` | `edopro/lflists`（整源） | `ygopro/formats/world`（World.lflist.conf）、`ygopro/formats/speed`（Speed.lflist.conf）、`ygopro/formats/rush`（Rush.lflist.conf）、`ygopro/formats/goat`（GOAT.lflist.conf）、`ygopro/formats/ocg`（OCG.lflist.conf） | **删除 `edopro/lflists` 目标；源 ID 重命名为 `project-ignis-lflists`；保留全部 5 条 YGOPro 文件映射**（任务 6.3）。ID 重命名后弃用的旧 `edopro-lflists` 仓库缓存目录登记为部署清理目标（任务 9.3） |
| `evolution-lflists` | `edopro/evolution-lflists`（整源） | `ygopro/formats/md`（MD.2025.03.lflist.conf）、`ygopro/formats/tengu`（Tengu.Plant.lflist.conf） | **删除 `edopro/evolution-lflists` 目标；保留资源源及 MD、Tengu 文件映射**（任务 6.3） |

## 不供给 `edopro/*` 目标的资源源（确认不变）

| 资源源 | 消费者（全部为 YGOPro 目标） |
| --- | --- |
| `evolution-assets` | `ygopro/formats/jtp`、`ygopro/formats/jtp-adv-2007-03`、`ygopro/formats/genesys`、`ygopro/formats/edison`、`ygopro/classic/classic.cdb`、`ygopro/formats/edison/pre-errata.es.cdb` |
| `moecube-lflist` | `ygopro/base/lflist.conf` |
| `ygopro-moecube-cdb` | `ygopro/base/cards.cdb` |
| `ygopro-fluorohydride-scripts` | `ygopro/base/script` |
| `edison-core` | `ygopro/core/ocgcore-worker`（YGOPro WASM 核心，design.md 决策 5 明确保留） |
| `ygopro-moecube-prereleases` | `ygopro/extensions/prereleases` |
| `custom-cards` | `ygopro/extensions/custom-cards` |

## 部署清理目标登记（任务 6.3）

清单编辑（删除源 + 重命名源 ID）落地后，以下仓库缓存目录在既有部署中成为孤儿——更新器只按当前清单的源 ID 同步，不会触碰或复用旧目录。登记为部署清理目标，实际删除按任务 9.3 的审批流程执行：

| 缓存目录 | 成因 | 删除前置条件 |
| --- | --- | --- |
| `repositories/edopro-lflists/` | 源 ID 重命名为 `project-ignis-lflists`（同一上游内容，新 ID 全新克隆；旧目录不得因内容相同而保留） | 新缓存克隆成功，且 world/speed/rush/goat/ocg 映射验证通过 |
| `repositories/edopro-cdbs/` | 资源源已删除（EDOPro 专用，无 YGOPro 消费者） | 9.3 统一审批 |
| `repositories/edopro-scripts/` | 资源源已删除（EDOPro 专用，无 YGOPro 消费者） | 9.3 统一审批 |

历史发布版本中的 `edopro/` 树由发布 GC（`RESOURCES_KEEP_RELEASES`）随新版本发布自然淘汰；升级部署中残留的旧发布版本按任务 9.3 显式移除。

## 私有清单核查

`resources.manifest.private.example.json`（模板）仅含示例源 `my-private-source`，供给 `ygopro/formats/edison/script` 与 `ygopro/classic/script`，**不供给任何 `edopro/*` 目标**。真实部署的 `resources.manifest.private.json`（gitignored）若覆盖或新增资源源/目标，按 design.md 决策 5 使用同一消费者归属规则重新分类后再执行清理。

## 保留赛制回归要求（承接 design.md 风险表）

重命名 `project-ignis-lflists` 后，world、speed、rush、goat、ocg 五个赛制与保留的 md、tengu 赛制必须逐个通过建房与卡组校验冒烟（任务 8.x），证明文件映射未因 ID 重命名而丢失。

## 干净目录组装验证（任务 6.5）

在临时干净目录（不依赖本机缓存）按新清单执行 `clone_repositories.sh` + `setup_resources.sh`（8 个 git 源全新浅克隆 + 3 个 http 下载，含重命名后的 `project-ignis-lflists`），发布树逐项验证 **21/21 通过**：

| 验证项 | 结果 |
| --- | --- |
| 发布树无 `edopro` 目录 | ✓ |
| `ygopro/base`：cards.cdb（SQLite 魔数）、script/（13528 个脚本）、lflist.conf | ✓ |
| 12 个赛制 lflist.conf 非空：jtp、jtp-adv-2007-03、genesys、md、world、tengu、edison、**hat**、speed、rush、goat、ocg | ✓ |
| `edison/pre-errata.es.cdb`、`classic/classic.cdb`（SQLite 魔数） | ✓ |
| `ygopro/core/ocgcore-worker`（WASM `\0asm` 魔数，1100593 字节） | ✓ |
| 扩展池 `extensions/prereleases`（202 文件）、`extensions/custom-cards`（46 文件） | ✓ |

**验证发现并修复（既有缺口，非本次变更引入）**：hat 赛制在 `runtime.ygopro.standard` 受支持且 `RuleMappings.formatRuleMappings.hat` 通过 `findIndexByAlias("hat")` 解析卡表，但清单自初始提交起从未组装其禁限卡表——hat 房间此前静默绑定第 0 张（当前标准）卡表，对 2014 HAT 白名单赛制为错误行为。所需的 `2014.04 HAT (Pre Errata).lflist.conf`（白名单 `!2014.04 HAT`）仅存在于保留源 `evolution-lflists`，本次新增组装规则 `ygopro/formats/hat/lflist.conf` 修复；加载器仅扫描 standard 池目录，该文件入池后 alias 解析即命中 `2014.04hat`。
