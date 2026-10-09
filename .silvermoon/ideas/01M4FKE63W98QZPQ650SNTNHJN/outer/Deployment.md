# Deployment

## Steps

### D-S01: Implementation 接受后制定 GitHub settings 与实测步骤

当前 deployment contract 仅为占位。Implementation 被针对精确 revision
接受后，再定义 branch protection/required checks、workflow schedule、
environment settings、真实 main push/release run 验证、runner 使用对比与失败
恢复。本占位不授权修改 repository settings、推送 release branch 或触发
production/npm 外部写入。

## Acceptance criteria

### D-AC01: 外部 trigger 与保护状态可读取且不削弱 release gate

未来 Deployment acceptance 必须用 GitHub workflow runs 与 settings 读取证明：
普通 `main` push 不运行完整 validation/CodeQL，release candidate 仍运行
authoritative gates，required checks 不引用已删除 context，且没有未经授权的
deployment、tag 或 npm 写入。
