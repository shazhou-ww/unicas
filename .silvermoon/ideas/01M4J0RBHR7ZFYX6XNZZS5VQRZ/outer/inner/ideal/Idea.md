# 清理 UniCAS repository 并整理目录结构

## 意图

系统识别并安全删除 repository 中已经失去用途的文件，整理不再清晰或不再符合
当前职责边界的目录结构，使维护者更容易定位代码、文档、工具与部署资产，同时
保持已接受的产品行为、公开契约和构建发布能力。

## 背景

UniCAS repository 经历了协议演进、包重命名、部署切换、SDK 发布和 Agent
workflow 建设。随着旧路径、迁移期资产和阶段性辅助文件累积，repository 可能
存在已经没有有效消费者的文件、重复入口，或不能准确表达当前所有权与依赖方向
的目录布局。

本 idea 先建立可核验的现状清单、删除标准和目标目录方案，再决定具体改动。
当前创建动作只记录 cleanup 的目标与讨论边界，不预先认定任何文件过时，也不
预先选择目录迁移方案。详细范围、优先级、兼容策略和分批方式由本 idea 的独立
session 在 Ideal World 阶段讨论并形成可评审契约。

## 期望结果

- repository 中每个计划删除的文件都有可审查的无消费者证据、替代路径或明确
  的历史阶段终止依据；不以文件名、年龄或主观整洁度作为唯一删除理由。
- 目标目录结构清楚表达稳定职责、package ownership、运行时边界、公开与内部
  资产边界，以及文档、测试、脚本、部署和 Agent workflow 的归属。
- 移动或合并路径后，所有 imports、workspace 配置、脚本、CI、文档链接、
  package exports、发布清单和部署入口同步更新，不遗留静默失效的旧引用。
- cleanup 保持现有 App-user、administrator、service、Spaces、SDK、Silvermoon
  和部署行为，除非某项行为变化在本 idea 中被明确列出、证明并单独接受。
- 改动以可验证、可回顾的批次推进；每一批都能通过最窄相关检查，并在 repository
  级验证中证明没有破坏 package boundary、公开 API、构建、测试或发布路径。
- cleanup 后留下简洁的结构说明和必要约定，使后续贡献者知道新文件应放在哪里，
  并降低同类旧资产再次累积的概率。

## 范围

### 范围内

- 盘点 tracked 文件、顶层目录、workspace package、脚本、测试 fixture、文档、
  配置、生成物来源和部署资产的当前用途与消费者。
- 定义“可删除”“应迁移”“应合并”“应保留”的证据标准，并形成候选清单。
- 讨论并确定目标目录结构、命名、所有权、依赖方向和分批迁移顺序。
- 删除经证明不再使用的旧文件，并整理经批准的文件夹与路径。
- 更新所有受影响的代码引用、配置、CI、文档、生成流程、release artifact、
  ownership 规则和开发者入口。
- 添加或调整能够证明删除安全、路径完整和结构约束持续有效的自动化检查。

### 范围外

- 仅为了配合 cleanup 而新增产品功能、改变业务语义或重新设计公开协议。
- 未经证据支持的大规模删除、按文件年龄清理，或为了得到整齐目录而改写正常
  Git 历史。
- 删除 Silvermoon idea history、审计证据、许可证、安全政策或仍受保留规则
  约束的记录。
- 隐式改变生产资源、发布 npm 包、执行生产部署，或修改冻结的
  `unicas.shazhou.work` legacy 环境。
- 在目标模型尚未明确批准前实施广泛的 package 合并、拆分或依赖方向反转。

## 约束

- 在删除或移动前，通过 imports、配置、workspace graph、CI、文档、发布和部署
  路径交叉验证消费者；动态加载或外部调用无法由静态搜索证明不存在时，必须
  记录不确定性并选择保留或增加验证。
- 保持 `.agents/` 为 Agent skills 与 reusable instructions 的唯一 canonical
  root，并遵循 Silvermoon 固定 idea 布局与 lifecycle。
- 任何涉及 `packages/**` 或 `stacks/unicas/**` 的方案和实施都必须遵循 UniCAS
  package boundary、access-plane separation、依赖方向和部署边界。
- 保留公开 package-root exports、版本与兼容策略；路径调整若影响外部消费者，
  必须有显式迁移和版本判断，不能以“内部 cleanup”掩盖 breaking change。
- 不提交生成依赖目录、临时输出、凭据、token、私钥、客户数据或本地环境状态。
- 使用普通 Git rename/delete 和非 force 同步，保留并发工作，不 reset、重写
  或清理未知改动。
- 先完成并批准 Ideal World 的 inventory 方法、目标结构和范围，再编写
  Implementation 契约或批量改动 repository。

## 待解决问题

- 哪些目录或文件最值得优先调查，哪些历史或兼容资产必须明确排除？
- 使用什么证据门槛判定文件已经没有 repository 内部或外部消费者？
- 目标顶层目录和 workspace/package 布局应如何表达当前产品与部署边界？
- cleanup 应拆成哪些可独立验证和回滚的批次，是否需要先添加结构或引用检查？
- 对移动路径保留多长兼容期；哪些内部路径可以一次性切换，哪些公开入口需要
  deprecation 或迁移说明？
