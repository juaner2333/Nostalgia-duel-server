## Context

变更动机参见 `proposal.md`，行为契约参见 `specs/nostalgia-format-routing/spec.md`、`specs/fixed-nostalgia-resources/spec.md` 和 `specs/ygopro-only-server/spec.md`。

当前 `resources.manifest.json` 从多个浮动 Git 分支和 HTTP 地址组装资源，并把 `base` 与所有受服务 format 目录合并为一个全局 standard pool。卡片数据库采用首个同 ID 生效，决斗脚本也使用全局路径，因此房间没有独立的 format 脚本查找链；不同环境出现同名脚本时可能相互影响。周期性上游拉取也与固定卡池和固定裁定的目标冲突。

当前加入流程把 `#` 前解释为房间命令、`#` 后解释为密码。`1103#1001` 和 `1109#1001` 若直接走默认策略，无法表达“环境 + 外部房间号”，也无法隔离同号房间。环境路由还必须只负责定位房间，不能绕过现有玩家、重连和观战状态处理。

本次已有一份经过核对的本地 CDB 与两份直接维护的 format 配置：`706-cards.cdb`、`formats/1103/lflist.conf` 和 `formats/1109/lflist.conf`。两份 format 配置分别固化各环境完整的可用卡池与禁限数量。项目已有 `sql.js`、YGOPro LFList 编码库、资源原子发布机制和 npm 包内 stock WASM core，不需要引入新的第三方依赖。

## Goals / Non-Goals

**Goals:**

- 让同一应用版本在无网络环境中得到逐字节稳定的基础数据库、脚本和 1103/1109 禁限卡表。
- 以基础数据库和固化的 1103 白名单验证两个环境卡池的数量与 ID 集合。
- 每个房间只看到自身 format 的脚本覆盖与共享 base 回退，不看到另一环境。
- 让环境化外部房间号成为明确的领域输入，同时保留现有内部全局房间 ID 和观战/重连状态流。
- 复用候选目录校验、原子 symlink 发布和上一版本回滚边界。

**Non-Goals:**

- 不为每个 format 复制一份 `cards.cdb`；当前差异只通过卡池集合、禁限卡表和脚本覆盖表达。
- 不自动从 Konami、Moecube 或脚本仓库同步历史数据。
- 不修改 YGOPro `JoinGame` 的 20 字符线协议字段，不新增客户端协议。
- 不重写观战、重连或房间状态机，只保证新路由继续进入既有处理链。
- 不保留已移除赛制的兼容别名、卡池或动态资源更新能力。

## Decisions

### 1. 使用一个固定数据库和两个 format 资源目录

资源布局固定为：

```text
nostalgia-resources/
├── lock.json
└── ygopro/
    ├── base/
    │   ├── cards.cdb
    │   └── script/
    └── formats/
        ├── 1103/
        │   ├── lflist.conf
        │   └── script/
        └── 1109/
            ├── lflist.conf
            └── script/
```

`base/cards.cdb` 是 `706-cards.cdb` 的固定副本。数据库物理文件只保存一份；房间绑定的 format 卡池集合决定哪些 ID 可用于卡组校验和决斗。每个 format 都有独立 LFList 与可为空的脚本覆盖目录。

没有选择“每个环境一套 cards.cdb + script”，因为两个环境共享相同卡片元数据，复制数据库会增加体积并产生额外一致性风险。若未来需要不同的卡片文本、类型或数值数据，应另行设计 format 数据库覆盖，不能隐式修改本方案。

### 2. 用直接维护的 format 配置确定双环境卡池

生成器对输入作如下定义：

```text
B     = IDs(706-cards.cdb)
P1103 = IDs(formats/1103/lflist.conf 的 $whitelist)
P1109 = IDs(formats/1109/lflist.conf 的 $whitelist)
```

当前审核基线为：`|B| = 5120`、`|P1103| = 5002`、`|P1109| = 5120`。两份白名单都必须是 `B` 的无重复子集，并由 lock 记录其集合和文件摘要。检查不得从未锁定输入推导或扩大任一环境卡池。

维护者直接编辑对应 `formats/<format>/lflist.conf` 即可调整该环境的卡池或禁限数量；这两份文件不依赖 YDK、历史 LFList 或其他生成输入。

### 3. 校验并锁定直接维护的白名单

校验命令使用项目现有 `sql.js` 和 LFList 工具：

1. 读取 CDB 有效卡片 ID；拒绝非法或重复 ID。
2. 分别解析两份 `formats/<format>/lflist.conf`，要求均含 `$whitelist`、每个 ID 恰好一次、数量为 0–3，且所有 ID 属于 CDB。
3. 断言两份配置的 ID 集合分别等于 `P1103`、`P1109`，并记录 YGOPro LFList hash 与 SHA-256。

校验命令不生成或改写配置；其只验证已提交文件并在 lock 更新时记录新的摘要。因此调整配置后只需执行校验和 lock 更新，无需同步任何外部输入。

### 4. format 脚本覆盖只回退到固定 base

基础脚本快照包含 706 卡池所需卡片脚本以及决斗引擎依赖的公共初始化/过程脚本。只有裁定确实不同的脚本才分别进入 `formats/1103/script` 或 `formats/1109/script`；空目录占位文件不得进入脚本索引。

每场决斗的脚本查找顺序是 `[formats/<room.formatId>/script, base/script]`。卡片存储只读取 `base/cards.cdb`，禁限卡表只读取房间 format 目录；1103 不得查询 1109，1109 也不得查询 1103。真实 reader 集成测试负责锁定底层“第一个匹配项生效”的实际行为。

不保留任意 `YGOPRO_EXTRA_SCRIPTS` 注入固定环境的能力；引擎预加载脚本必须来自应用内固定补丁或本资源快照，并进入摘要，否则会绕过隔离和完整性保证。

### 5. 用本地 source 与 lock 保证整体一致

扩展资源清单支持受限 `local` source，指向仓库内的 `nostalgia-resources/`。路径必须相对仓库根、解析后仍在声明 source 根内，并拒绝绝对路径、`..`、符号链接逃逸。拉取脚本对 local source 不执行网络操作。

`lock.json` 记录资源 schema 版本、数据库 ID 集合摘要、基础与两个 format 的脚本集合摘要、两份 LFList hash/SHA-256 及白名单卡片数量。两份 format 白名单的集合和文件摘要记录在 format 条目中。目录摘要使用规范化的 repo-relative POSIX 路径并按路径排序。

组装流程先复制到候选 release，再验证 lock、必需文件、环境卡池集合与 LFList 一致性；全部通过后才复用现有原子 symlink 切换。失败不得改动 `resources/current`。资源版本接口同时报告 lock 摘要和 1103/1109 的卡池及 LFList 摘要。

固定资产以普通 Git 内容版本化；`.gitignore` 只增加所需 CDB、LFList 和 Lua 文件的定向例外，不放开通用生成目录。未选择浮动 Git、固定外部 commit 或 HTTP 压缩包，是为了让干净部署可离线复现且与应用版本同步评审。

### 6. 运行时资源解析使用 base + 双 format 映射

资源清单的运行时部分表达一个 base 和两个显式 format，而不是把 format 合并到全局 pool：

```json
{
  "runtime": {
    "ygopro": {
      "base": "base",
      "formats": {
        "1103": "formats/1103",
        "1109": "formats/1109"
      }
    }
  }
}
```

基础卡片存储启动时只加载一次 CDB。禁限卡加载器建立 `formatId -> banListHash` 映射，房间不再依赖加载顺序敏感的数字索引。领域层固定注册表描述两套规则：1103 与 1109 都使用 `rule=0`（OCG）、`duel_rule=2`（Master Rule 2）、MATCH、8000 LP、best-of-3，分别绑定其卡池集合、禁限卡表和脚本链。领域层不导入 manifest 或文件系统。

没有保留 standard/extended 双池；若未来恢复扩展卡池，需要独立变更定义明确边界，不能向 base 隐式合并。

### 7. 在默认策略之前解析环境房间且复用观战状态机

新增高优先级加入策略，匹配 `^((?:1103|1109))#([0-9]+)$` 的完整 raw pass，并执行 20 个 UTF-16 code unit 上限检查。策略以组合键 `<format>#<roomId>` 查找房间；首次加入通过 format 配置创建空密码房间，后续相同键进入既有房间。内部 `room.id` 继续由全局 ID 生成器产生，不改变录像、持久化或 WindBot 接口。

该策略只完成格式解析、房间查找/创建并向现有状态处理器发出加入动作。等待、猜拳、选择先后手、决斗中和换备状态继续由既有处理器判定连接是玩家、重连玩家还是观战者，并继续控制观战历史、实时视图、私密消息过滤、席位、转席和断开行为。AI 与重连专用策略保留既有优先级。

带四位环境前缀但环境未知或格式非法的输入必须在该边界拒绝，不能落入旧默认策略并被解释为名称/密码。房间 API、日志、录像与持久化元数据展示组合外部 ID，同时保留内部 ID 供诊断关联。

### 8. 删除动态和无关资源消费者

公共资源清单按本次唯一消费者重新分类：

| 现有 source | 结论 |
| --- | --- |
| `project-ignis-lflists` | 删除；其 World/Speed/Rush/GOAT/现代 OCG 文件不再提供 |
| `evolution-lflists` | 删除；MD/Tengu/HAT 等不再提供 |
| `evolution-assets` | 删除；JTP/Edison/HAT 数据与 classic CDB 不再提供 |
| `ygopro-moecube-cdb` | 删除；由固定 706 数据库替代 |
| `ygopro-fluorohydride-scripts` | 删除；由固定 base/format 脚本快照替代 |
| `moecube-lflist` | 删除；由两份直接维护的本地 format 配置替代 |
| `ygopro-moecube-prereleases` | 删除；不再有 extended pool |
| `custom-cards` | 删除；不再有 extended pool |
| `edison-core` | 删除；两个环境均使用 npm 依赖提供的 stock WASM core |

唯一资源 source 为 `nostalgia-fixed`（`local`）。部署入口不再启动网络资源更新 sidecar/循环；仍保留一次性本地组装、完整性门禁和原子发布。

### 9. 以测试优先顺序落地

实现先添加失败测试：双环境卡池与 LFList 配置校验、local source 校验、固定资源组装、脚本覆盖/回退、1103/1109 路由、同号隔离、五个房间阶段的观战与重连回归、双环境 HostInfo。随后以最少修改扩展资源清单和 loader，再删除旧 source、format mapping 与扩展池代码。数据资产使用配置检查命令校验；两份已提交白名单是各自环境的唯一卡池事实来源。

## Risks / Trade-offs

- [固定 Lua 快照增加主仓库文件数和体积] → 只保存 706 卡池所需脚本与公共依赖，记录来源和摘要，不引入第二套包管理。
- [脚本快照遗漏间接依赖] → 建立公共依赖清单，并分别用代表性 1103/1109 卡组启动真实 WASM 对局；缺失日志包含 format、卡片 ID 和请求路径。
- [直接维护的禁限规则出现误改] → lock 记录两份白名单集合和文件摘要；评审同时检查对应 format 配置的规则变更。
- [format 白名单被意外改变] → 校验其为无重复且属于基础数据库的 ID，lock 将其集合和文件摘要作为发布边界。
- [脚本 reader 优先级与假设相反] → 用同名、不同标记脚本执行真实 reader 集成测试，只在基础设施边界调整参数顺序。
- [环境路由绕过观战或重连] → 路由层只解析组合键并复用既有加入动作；对等待、猜拳、选择、决斗、换备和断开逐阶段回归。
- [删除旧格式导致现有客户端入口失效] → 作为已声明的破坏性切换，发布前仅公布 `1103#roomId` 与 `1109#roomId` 并对旧格式执行明确拒绝测试。
- [local source 扩大文件读取范围] → 用 realpath 将访问限制在声明 source 根，拒绝绝对路径、符号链接逃逸和父目录遍历。

## Migration Plan

1. 记录基础数据库、两份 format 配置的摘要和卡片集合；冻结基础及两个 format 的脚本快照来源。
2. 先添加失败的双环境配置校验测试，再固化两份 `formats/<format>/lflist.conf` 与初始 lock。
3. 增加受限 local source、固定资源校验和候选 release 组装；在旧清单仍可回滚时验证离线组装。
4. 增加双 format 注册表、卡池/LFList 绑定、format-first 脚本路径和环境化房间策略，完成聚焦单元、观战/重连与真实 reader/WASM 测试。
5. 将 manifest 切换到唯一 `nostalgia-fixed` source，移除旧 source、assembly、extended pool、旧 format mapping、额外脚本注入和网络更新循环。
6. 执行 LFList 配置检查、lock/manifest 校验、聚焦测试、`npm run lint`、`npm run test`、`npm run build`，并从干净检出完成无网络组装。
7. 在隔离端口分别用 `1103#1001`、`1109#1001` 完成含换备的 MATCH，并以第三客户端验证各阶段观战、重连、同号隔离、录像元数据和资源版本接口。
8. 发布应用与固定资源，确认活动对局正常后再清理旧仓库缓存和旧 release；保留上一应用镜像与上一资源 symlink 目标作为回滚资产。

回滚时停止候选实例，恢复上一应用镜像并把 `resources/current` 指回上一份完整 release。旧资源缓存的破坏性清理必须安排在新版本冒烟验证之后；若已清理，则从上一应用版本重新组装其资源。
