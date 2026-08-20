## Context

变更动机参见 `proposal.md`，行为契约参见 `specs/nostalgia-format-routing/spec.md`、`specs/fixed-nostalgia-resources/spec.md` 和 `specs/ygopro-only-server/spec.md`。

当前 `resources.manifest.json` 从多个浮动 Git 分支和 HTTP 地址组装资源，并把 `base` 与所有受服务 format 目录合并为一个全局 standard pool。卡片数据库采用首个同 ID 生效，决斗脚本也使用全局路径，因此房间没有独立的 format 脚本查找链；不同环境出现同名脚本时可能相互影响。周期性上游拉取也与固定卡池和固定裁定的目标冲突。

当前加入流程把 `#` 前解释为房间命令、`#` 后解释为密码。`1103#1001` 和 `1109#1001` 若直接走默认策略，无法表达“环境 + 外部房间号”，也无法隔离同号房间。环境路由还必须只负责定位房间，不能绕过现有玩家、重连和观战状态处理。

本次已有五个经过核对的本地输入：`706-cards.cdb`、`2011.03.lflist`、`2011.09.lflist`、`1103-diff (1).ydk` 和 `1103-diff (2).ydk`。项目已有 `sql.js`、YGOPro CDB/LFList 编码库、资源原子发布机制和 npm 包内 stock WASM core，不需要引入新的第三方依赖。

## Goals / Non-Goals

**Goals:**

- 让同一应用版本在无网络环境中得到逐字节稳定的基础数据库、脚本和 1103/1109 禁限卡表。
- 以明确的集合运算从 706 基础数据库派生两个环境卡池，并可重复验证卡片数量与 ID 集合。
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
├── sources/
│   ├── 2011.03.lflist
│   ├── 2011.09.lflist
│   ├── 1103-diff (1).ydk
│   └── 1103-diff (2).ydk
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

### 2. 用集合运算确定两个环境卡池

生成器对输入作如下定义：

```text
B     = IDs(706-cards.cdb)
D1    = IDs(1103-diff (1).ydk)
D2    = IDs(1103-diff (2).ydk)
P1103 = B − (D1 ∪ D2)
P1109 = B
```

当前审核基线为：`|B| = 5120`、`|D1| = 58`、`|D2| = 60`，两个排除集无交集且全部存在于 `B`，因此 `|P1103| = 5002`、`|P1109| = 5120`。生成器必须校验而不是硬编码这些关系；输入改变时若数量、包含关系或重复项不符合锁文件，检查直接失败。

“减去”只改变 1103 的卡池全集，不重写 `2011.03.lflist` 中的 0/1/2 限制。若同一 ID 同时在排除集和限制输入中，集合差优先使其不进入 1103 输出，并产生稳定诊断。

### 3. 用同一确定性生成器生成两份白名单

生成命令使用项目现有 `sql.js` 和 LFList 工具，按环境接收数据库、限制输入和可选排除集：

1. 读取 CDB 有效卡片 ID；拒绝非法或重复 ID。
2. 解析对应 `.lflist`，要求限制值仅为 0、1、2，并拒绝同一输入中的重复 ID。
3. 解析 YDK 主卡组、额外卡组和副卡组区域中的十进制 ID，合并为该环境的排除集合；1109 不传排除集。
4. 计算环境最终卡池；对池内每个 ID 查找限制值，未命中时使用 3。
5. 输出固定环境头与 `$whitelist`，按 0、1、2、3 分区，各区按无符号十进制 ID 升序；名称只作为单行注释，不参与判断。
6. 限制输入中不存在于最终卡池的 ID进入稳定诊断，但不进入输出，也不替换为其他 ID。当前两份限制输入都包含不在 706 数据库中的 `82301904`，该项不阻断生成。
7. 重新解析输出，断言 ID 集合分别等于 `P1103`、`P1109`，每个 ID 恰好一次且数量为 0–3；记录 YGOPro LFList hash 与 SHA-256。

生成命令提供 `--check` 模式，在内存中重建两份文件并与已提交产物逐字节比较。没有直接复制现有 Tengu/其他 whitelist，因为它们不是本次 OCG 环境的事实来源。

### 4. format 脚本覆盖只回退到固定 base

基础脚本快照包含 706 卡池所需卡片脚本以及决斗引擎依赖的公共初始化/过程脚本。只有裁定确实不同的脚本才分别进入 `formats/1103/script` 或 `formats/1109/script`；空目录占位文件不得进入脚本索引。

每场决斗的脚本查找顺序是 `[formats/<room.formatId>/script, base/script]`。卡片存储只读取 `base/cards.cdb`，禁限卡表只读取房间 format 目录；1103 不得查询 1109，1109 也不得查询 1103。真实 reader 集成测试负责锁定底层“第一个匹配项生效”的实际行为。

不保留任意 `YGOPRO_EXTRA_SCRIPTS` 注入固定环境的能力；引擎预加载脚本必须来自应用内固定补丁或本资源快照，并进入摘要，否则会绕过隔离和完整性保证。

### 5. 用本地 source 与 lock 保证整体一致

扩展资源清单支持受限 `local` source，指向仓库内的 `nostalgia-resources/`。路径必须相对仓库根、解析后仍在声明 source 根内，并拒绝绝对路径、`..`、符号链接逃逸。拉取脚本对 local source 不执行网络操作。

`lock.json` 记录资源 schema 版本、五个原始输入的 SHA-256、数据库 ID 集合摘要、两个排除集合摘要、基础与两个 format 的脚本集合摘要、两份 LFList hash/SHA-256 及输出卡片数量。目录摘要使用规范化的 repo-relative POSIX 路径并按路径排序。

组装流程先复制到候选 release，再验证 lock、必需文件、环境卡池集合与 LFList 一致性；全部通过后才复用现有原子 symlink 切换。失败不得改动 `resources/current`。资源版本接口同时报告 lock 摘要和 1103/1109 的卡池及 LFList 摘要。

固定资产以普通 Git 内容版本化；`.gitignore` 只增加所需 CDB、LFList、YDK 和 Lua 文件的定向例外，不放开通用生成目录。未选择浮动 Git、固定外部 commit 或 HTTP 压缩包，是为了让干净部署可离线复现且与应用版本同步评审。

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
| `moecube-lflist` | 删除；由两份本地历史限制输入和生成 LFList 替代 |
| `ygopro-moecube-prereleases` | 删除；不再有 extended pool |
| `custom-cards` | 删除；不再有 extended pool |
| `edison-core` | 删除；两个环境均使用 npm 依赖提供的 stock WASM core |

唯一资源 source 为 `nostalgia-fixed`（`local`）。部署入口不再启动网络资源更新 sidecar/循环；仍保留一次性本地组装、完整性门禁和原子发布。

### 9. 以测试优先顺序落地

实现先添加失败测试：双环境卡池派生与 LFList 生成、local source 校验、固定资源组装、脚本覆盖/回退、1103/1109 路由、同号隔离、五个房间阶段的观战与重连回归、双环境 HostInfo。随后以最少修改扩展资源清单和 loader，再删除旧 source、format mapping 与扩展池代码。数据资产使用同一生成器的 `--check` 校验，不维护第二份手写完整期望列表。

## Risks / Trade-offs

- [固定 Lua 快照增加主仓库文件数和体积] → 只保存 706 卡池所需脚本与公共依赖，记录来源和摘要，不引入第二套包管理。
- [脚本快照遗漏间接依赖] → 建立公共依赖清单，并分别用代表性 1103/1109 卡组启动真实 WASM 对局；缺失日志包含 format、卡片 ID 和请求路径。
- [历史 OCG 表来源存在误抄或地区混用] → 将已提供的 2011.03/2011.09 文件作为审核输入，记录来源与摘要，不采用 Tengu/TCG 表。
- [禁限输入 ID 不在最终卡池] → 输出稳定诊断并严格以环境池集合为 whitelist 全集；禁止静默替换私有或异画 ID。
- [排除 YDK 的分区或重复项解析错误] → 统一解析三个 YDK 分区，集合去重，并在 lock 中记录每个文件和并集摘要、数量与包含关系。
- [脚本 reader 优先级与假设相反] → 用同名、不同标记脚本执行真实 reader 集成测试，只在基础设施边界调整参数顺序。
- [环境路由绕过观战或重连] → 路由层只解析组合键并复用既有加入动作；对等待、猜拳、选择、决斗、换备和断开逐阶段回归。
- [删除旧格式导致现有客户端入口失效] → 作为已声明的破坏性切换，发布前仅公布 `1103#roomId` 与 `1109#roomId` 并对旧格式执行明确拒绝测试。
- [local source 扩大文件读取范围] → 用 realpath 将访问限制在声明 source 根，拒绝绝对路径、符号链接逃逸和父目录遍历。

## Migration Plan

1. 记录五个输入文件的 SHA-256、卡片/排除集合与异常报告；冻结基础及两个 format 的脚本快照来源。
2. 先添加失败的双环境生成测试，再生成 `formats/1103/lflist.conf`、`formats/1109/lflist.conf` 与初始 lock，并审查稳定诊断。
3. 增加受限 local source、固定资源校验和候选 release 组装；在旧清单仍可回滚时验证离线组装。
4. 增加双 format 注册表、卡池/LFList 绑定、format-first 脚本路径和环境化房间策略，完成聚焦单元、观战/重连与真实 reader/WASM 测试。
5. 将 manifest 切换到唯一 `nostalgia-fixed` source，移除旧 source、assembly、extended pool、旧 format mapping、额外脚本注入和网络更新循环。
6. 执行 LFList `--check`、lock/manifest 校验、聚焦测试、`npm run lint`、`npm run test`、`npm run build`，并从干净检出完成无网络组装。
7. 在隔离端口分别用 `1103#1001`、`1109#1001` 完成含换备的 MATCH，并以第三客户端验证各阶段观战、重连、同号隔离、录像元数据和资源版本接口。
8. 发布应用与固定资源，确认活动对局正常后再清理旧仓库缓存和旧 release；保留上一应用镜像与上一资源 symlink 目标作为回滚资产。

回滚时停止候选实例，恢复上一应用镜像并把 `resources/current` 指回上一份完整 release。旧资源缓存的破坏性清理必须安排在新版本冒烟验证之后；若已清理，则从上一应用版本重新组装其资源。
